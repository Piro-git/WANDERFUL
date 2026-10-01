import AVFAudio
import Foundation
import Speech

enum VoicePlanningLanguage: String, CaseIterable, Identifiable, Sendable {
    case german = "de-DE"
    case english = "en-US"

    var id: String { rawValue }

    var shortLabel: String {
        switch self {
        case .german: "DE"
        case .english: "EN"
        }
    }

    var displayName: String {
        switch self {
        case .german: "Deutsch"
        case .english: "English"
        }
    }

    static var deviceDefault: Self {
        Locale.preferredLanguages.first?.lowercased().hasPrefix("de") == true ? .german : .english
    }
}

enum VoicePermissionDenial: Equatable, Sendable {
    case microphone
    case speechRecognition
    case microphoneRestricted
    case speechRecognitionRestricted
    case microphoneUnavailable
    case speechRecognitionUnavailable
}

enum VoicePermissionResult: Equatable, Sendable {
    case granted
    case denied(VoicePermissionDenial)
}

enum VoiceAuthorizationStatus: Equatable, Sendable {
    case notDetermined
    case denied
    case restricted
    case unavailable
    case authorized
}

struct VoiceTranscript: Equatable, Sendable {
    let text: String
    let isFinal: Bool
}

enum VoicePlanningServiceError: LocalizedError, Equatable, Sendable {
    case recognitionUnavailable
    case noAudioInput
    case interrupted
    case inputChanged
    case couldNotStart

    var errorDescription: String? {
        switch self {
        case .recognitionUnavailable:
            "Speech recognition is currently unavailable. Please try again later."
        case .noAudioInput:
            "No microphone input is available."
        case .interrupted:
            "Listening was interrupted by another audio session."
        case .inputChanged:
            "The microphone input changed. Please try again."
        case .couldNotStart:
            "Wanderful could not start listening. Please try again."
        }
    }
}

@MainActor
protocol VoicePlanningService: AnyObject {
    func requestPermissions() async -> VoicePermissionResult
    func startTranscription(language: VoicePlanningLanguage) throws -> AsyncThrowingStream<VoiceTranscript, Error>
    func stop()
    func cancel()
}

@MainActor
protocol VoicePermissionAuthorizing: AnyObject {
    var microphoneStatus: VoiceAuthorizationStatus { get }
    var speechRecognitionStatus: VoiceAuthorizationStatus { get }
    func requestMicrophonePermission() async -> VoiceAuthorizationStatus
    func requestSpeechRecognitionPermission() async -> VoiceAuthorizationStatus
}

@MainActor
protocol VoiceAudioSessionManaging: AnyObject, Sendable {
    var hasAudioInput: Bool { get }
    func configureAndActivate() throws
    func deactivate()
}

@MainActor
protocol VoiceAudioEngineManaging: AnyObject, Sendable {
    var isRunning: Bool { get }
    func inputFormat() -> AVAudioFormat
    func installTap(format: AVAudioFormat, handler: @escaping AVAudioNodeTapBlock)
    func removeTap()
    func prepare()
    func start() throws
    func stop()
}

enum VoiceRecognitionEvent: @unchecked Sendable {
    case transcript(VoiceTranscript)
    case failure(Error)
}

protocol VoiceRecognitionSession: AnyObject, Sendable {
    nonisolated func append(_ buffer: AVAudioPCMBuffer)
    nonisolated func endAudio()
    nonisolated func cancel()
}

@MainActor
protocol VoiceRecognitionManaging: AnyObject {
    func isAvailable(language: VoicePlanningLanguage) -> Bool
    func start(
        language: VoicePlanningLanguage,
        eventHandler: @escaping @Sendable (VoiceRecognitionEvent) -> Void
    ) throws -> any VoiceRecognitionSession
}

enum VoiceAudioLifecycleEvent: Sendable {
    case interruptionBegan
    case inputLost
}

@MainActor
protocol VoiceAudioLifecycleObserving: AnyObject, Sendable {
    func start(handler: @escaping @MainActor @Sendable (VoiceAudioLifecycleEvent) -> Void)
    func stop()
}

/// Live transcription uses Apple's Speech framework. Depending on the device and
/// language, Apple may process speech using its recognition service. TrailMind does
/// not retain raw audio or send it to a TrailMind backend.
@MainActor
final class AppleSpeechVoicePlanningService: VoicePlanningService {
    private let permissions: any VoicePermissionAuthorizing
    private let audioSession: any VoiceAudioSessionManaging
    private let audioEngine: any VoiceAudioEngineManaging
    private let recognition: any VoiceRecognitionManaging
    private let lifecycle: any VoiceAudioLifecycleObserving

    private var recognitionSession: (any VoiceRecognitionSession)?
    private var continuation: AsyncThrowingStream<VoiceTranscript, Error>.Continuation?
    private var activeSessionID: UUID?
    private var hasInputTap = false
    private var audioSessionNeedsDeactivation = false
    private var audioEngineNeedsStop = false
    private var isFinishing = false

    convenience init() {
        self.init(
            permissions: AppleVoicePermissionAuthorizer(),
            audioSession: AppleVoiceAudioSessionManager(),
            audioEngine: AppleVoiceAudioEngineManager(),
            recognition: AppleVoiceRecognitionManager(),
            lifecycle: AppleVoiceAudioLifecycleObserver()
        )
    }

    init(
        permissions: any VoicePermissionAuthorizing,
        audioSession: any VoiceAudioSessionManaging,
        audioEngine: any VoiceAudioEngineManaging,
        recognition: any VoiceRecognitionManaging,
        lifecycle: any VoiceAudioLifecycleObserving
    ) {
        self.permissions = permissions
        self.audioSession = audioSession
        self.audioEngine = audioEngine
        self.recognition = recognition
        self.lifecycle = lifecycle
    }

    deinit {
        let lifecycle = lifecycle
        let audioEngine = audioEngine
        let audioSession = audioSession
        let hadInputTap = hasInputTap
        let shouldStopEngine = audioEngineNeedsStop
        let shouldDeactivate = audioSessionNeedsDeactivation
        recognitionSession?.cancel()
        continuation?.finish()
        Task { @MainActor in
            lifecycle.stop()
            if audioEngine.isRunning || shouldStopEngine {
                audioEngine.stop()
            }
            if hadInputTap {
                audioEngine.removeTap()
            }
            if shouldDeactivate {
                audioSession.deactivate()
            }
        }
    }

    func requestPermissions() async -> VoicePermissionResult {
        let microphone = await resolvedMicrophoneStatus()
        guard microphone == .authorized else {
            return .denied(permissionDenial(forMicrophone: microphone))
        }

        let speech = await resolvedSpeechStatus()
        guard speech == .authorized else {
            return .denied(permissionDenial(forSpeech: speech))
        }
        return .granted
    }

    func startTranscription(language: VoicePlanningLanguage) throws -> AsyncThrowingStream<VoiceTranscript, Error> {
        cancel()

        guard recognition.isAvailable(language: language) else {
            throw VoicePlanningServiceError.recognitionUnavailable
        }

        let id = UUID()
        let stream = AsyncThrowingStream<VoiceTranscript, Error> { continuation in
            self.continuation = continuation
        }
        activeSessionID = id
        isFinishing = false

        do {
            // Configure and activate before touching the input node. On physical devices,
            // the available route and input format are only trustworthy after activation.
            audioSessionNeedsDeactivation = true
            try audioSession.configureAndActivate()
            guard audioSession.hasAudioInput else {
                throw VoicePlanningServiceError.noAudioInput
            }

            let format = audioEngine.inputFormat()
            guard format.sampleRate > 0, format.channelCount > 0 else {
                throw VoicePlanningServiceError.noAudioInput
            }

            let eventHandler = Self.makeRecognitionEventHandler(service: self, sessionID: id)
            let session = try recognition.start(language: language, eventHandler: eventHandler)
            recognitionSession = session

            let tapHandler = Self.makeAudioTapHandler(session: session)
            audioEngine.installTap(format: format, handler: tapHandler)
            hasInputTap = true

            lifecycle.start { [weak self] event in
                self?.handleLifecycleEvent(event, sessionID: id)
            }
            audioEngine.prepare()
            audioEngineNeedsStop = true
            try audioEngine.start()
            return stream
        } catch let error as VoicePlanningServiceError {
            finishSession(id: id, throwing: error, cancelRecognition: true)
            throw error
        } catch {
            finishSession(id: id, throwing: VoicePlanningServiceError.couldNotStart, cancelRecognition: true)
            throw VoicePlanningServiceError.couldNotStart
        }
    }

    func stop() {
        guard let id = activeSessionID else { return }
        finishSession(id: id, endRecognitionAudio: true, cancelRecognition: true)
    }

    func cancel() {
        guard let id = activeSessionID else { return }
        finishSession(id: id, cancelRecognition: true)
    }

    private func resolvedMicrophoneStatus() async -> VoiceAuthorizationStatus {
        let status = permissions.microphoneStatus
        return status == .notDetermined ? await permissions.requestMicrophonePermission() : status
    }

    private func resolvedSpeechStatus() async -> VoiceAuthorizationStatus {
        let status = permissions.speechRecognitionStatus
        return status == .notDetermined ? await permissions.requestSpeechRecognitionPermission() : status
    }

    private func permissionDenial(forMicrophone status: VoiceAuthorizationStatus) -> VoicePermissionDenial {
        switch status {
        case .restricted: .microphoneRestricted
        case .unavailable: .microphoneUnavailable
        case .notDetermined, .denied, .authorized: .microphone
        }
    }

    private func permissionDenial(forSpeech status: VoiceAuthorizationStatus) -> VoicePermissionDenial {
        switch status {
        case .restricted: .speechRecognitionRestricted
        case .unavailable: .speechRecognitionUnavailable
        case .notDetermined, .denied, .authorized: .speechRecognition
        }
    }

    private nonisolated static func makeAudioTapHandler(
        session: any VoiceRecognitionSession
    ) -> AVAudioNodeTapBlock {
        { buffer, _ in
            session.append(buffer)
        }
    }

    private nonisolated static func makeRecognitionEventHandler(
        service: AppleSpeechVoicePlanningService,
        sessionID: UUID
    ) -> @Sendable (VoiceRecognitionEvent) -> Void {
        { [weak service] event in
            Task { @MainActor [weak service] in
                service?.handleRecognitionEvent(event, sessionID: sessionID)
            }
        }
    }

    private func handleRecognitionEvent(_ event: VoiceRecognitionEvent, sessionID id: UUID) {
        guard activeSessionID == id, !isFinishing else { return }
        switch event {
        case let .transcript(transcript):
            continuation?.yield(transcript)
            if transcript.isFinal {
                finishSession(id: id)
            }
        case let .failure(error):
            finishSession(id: id, throwing: error, cancelRecognition: true)
        }
    }

    private func handleLifecycleEvent(_ event: VoiceAudioLifecycleEvent, sessionID id: UUID) {
        guard activeSessionID == id else { return }
        switch event {
        case .interruptionBegan:
            finishSession(id: id, throwing: VoicePlanningServiceError.interrupted, cancelRecognition: true)
        case .inputLost:
            finishSession(id: id, throwing: VoicePlanningServiceError.inputChanged, cancelRecognition: true)
        }
    }

    private func finishSession(
        id: UUID,
        throwing error: Error? = nil,
        endRecognitionAudio: Bool = false,
        cancelRecognition: Bool = false
    ) {
        guard activeSessionID == id, !isFinishing else { return }
        isFinishing = true
        cleanupCapture()
        if endRecognitionAudio {
            recognitionSession?.endAudio()
        }
        if cancelRecognition {
            recognitionSession?.cancel()
        }
        if let error {
            continuation?.finish(throwing: error)
        } else {
            continuation?.finish()
        }
        continuation = nil
        activeSessionID = nil
        recognitionSession = nil
    }

    private func cleanupCapture() {
        lifecycle.stop()
        if audioEngine.isRunning || audioEngineNeedsStop {
            audioEngine.stop()
            audioEngineNeedsStop = false
        }
        if hasInputTap {
            audioEngine.removeTap()
            hasInputTap = false
        }
        if audioSessionNeedsDeactivation {
            audioSession.deactivate()
            audioSessionNeedsDeactivation = false
        }
    }
}

@MainActor
private final class AppleVoicePermissionAuthorizer: VoicePermissionAuthorizing {
    var microphoneStatus: VoiceAuthorizationStatus {
        switch AVAudioApplication.shared.recordPermission {
        case .undetermined: .notDetermined
        case .denied: .denied
        case .granted: .authorized
        @unknown default: .unavailable
        }
    }

    var speechRecognitionStatus: VoiceAuthorizationStatus {
        Self.mapSpeechStatus(SFSpeechRecognizer.authorizationStatus())
    }

    func requestMicrophonePermission() async -> VoiceAuthorizationStatus {
        await Self.requestMicrophonePermissionOffActor()
    }

    func requestSpeechRecognitionPermission() async -> VoiceAuthorizationStatus {
        await Self.requestSpeechPermissionOffActor()
    }

    private nonisolated static func requestMicrophonePermissionOffActor() async -> VoiceAuthorizationStatus {
        let granted = await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
        return granted ? .authorized : .denied
    }

    private nonisolated static func requestSpeechPermissionOffActor() async -> VoiceAuthorizationStatus {
        let status = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
        return mapSpeechStatus(status)
    }

    private nonisolated static func mapSpeechStatus(
        _ status: SFSpeechRecognizerAuthorizationStatus
    ) -> VoiceAuthorizationStatus {
        switch status {
        case .notDetermined: .notDetermined
        case .denied: .denied
        case .restricted: .restricted
        case .authorized: .authorized
        @unknown default: .unavailable
        }
    }
}

@MainActor
private final class AppleVoiceAudioSessionManager: VoiceAudioSessionManaging {
    private let session = AVAudioSession.sharedInstance()

    var hasAudioInput: Bool { session.isInputAvailable }

    func configureAndActivate() throws {
        try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try session.setActive(true, options: .notifyOthersOnDeactivation)
    }

    func deactivate() {
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
    }
}

@MainActor
private final class AppleVoiceAudioEngineManager: VoiceAudioEngineManaging {
    private let engine = AVAudioEngine()

    var isRunning: Bool { engine.isRunning }

    func inputFormat() -> AVAudioFormat {
        engine.inputNode.outputFormat(forBus: 0)
    }

    func installTap(format: AVAudioFormat, handler: @escaping AVAudioNodeTapBlock) {
        engine.inputNode.installTap(onBus: 0, bufferSize: 1_024, format: format, block: handler)
    }

    func removeTap() {
        engine.inputNode.removeTap(onBus: 0)
    }

    func prepare() {
        engine.prepare()
    }

    func start() throws {
        try engine.start()
    }

    func stop() {
        engine.stop()
    }
}

private final class AppleVoiceRecognitionSession: VoiceRecognitionSession, @unchecked Sendable {
    nonisolated(unsafe) let recognizer: SFSpeechRecognizer
    nonisolated(unsafe) let request: SFSpeechAudioBufferRecognitionRequest
    nonisolated(unsafe) var task: SFSpeechRecognitionTask?

    init(recognizer: SFSpeechRecognizer, request: SFSpeechAudioBufferRecognitionRequest) {
        self.recognizer = recognizer
        self.request = request
    }

    nonisolated func append(_ buffer: AVAudioPCMBuffer) {
        request.append(buffer)
    }

    nonisolated func endAudio() {
        request.endAudio()
    }

    nonisolated func cancel() {
        task?.cancel()
        request.endAudio()
    }
}

@MainActor
private final class AppleVoiceRecognitionManager: VoiceRecognitionManaging {
    func isAvailable(language: VoicePlanningLanguage) -> Bool {
        SFSpeechRecognizer(locale: Locale(identifier: language.rawValue))?.isAvailable == true
    }

    func start(
        language: VoicePlanningLanguage,
        eventHandler: @escaping @Sendable (VoiceRecognitionEvent) -> Void
    ) throws -> any VoiceRecognitionSession {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language.rawValue)), recognizer.isAvailable else {
            throw VoicePlanningServiceError.recognitionUnavailable
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation

        let session = AppleVoiceRecognitionSession(recognizer: recognizer, request: request)
        let callback = Self.makeRecognitionCallback(eventHandler: eventHandler)
        session.task = recognizer.recognitionTask(with: request, resultHandler: callback)
        return session
    }

    private nonisolated static func makeRecognitionCallback(
        eventHandler: @escaping @Sendable (VoiceRecognitionEvent) -> Void
    ) -> @Sendable (SFSpeechRecognitionResult?, (any Error)?) -> Void {
        { result, error in
            if let result {
                eventHandler(
                    .transcript(
                        VoiceTranscript(
                            text: result.bestTranscription.formattedString,
                            isFinal: result.isFinal
                        )
                    )
                )
            } else if let error {
                eventHandler(.failure(error))
            }
        }
    }
}

@MainActor
private final class AppleVoiceAudioLifecycleObserver: VoiceAudioLifecycleObserving {
    private let center = NotificationCenter.default
    private var tokens: [NSObjectProtocol] = []

    func start(handler: @escaping @MainActor @Sendable (VoiceAudioLifecycleEvent) -> Void) {
        stop()
        let interruptionCallback = Self.makeInterruptionCallback(handler: handler)
        let routeCallback = Self.makeRouteCallback(handler: handler)
        tokens = [
            center.addObserver(
                forName: AVAudioSession.interruptionNotification,
                object: nil,
                queue: .main,
                using: interruptionCallback
            ),
            center.addObserver(
                forName: AVAudioSession.routeChangeNotification,
                object: nil,
                queue: .main,
                using: routeCallback
            )
        ]
    }

    func stop() {
        tokens.forEach(center.removeObserver)
        tokens.removeAll()
    }

    private nonisolated static func makeInterruptionCallback(
        handler: @escaping @MainActor @Sendable (VoiceAudioLifecycleEvent) -> Void
    ) -> @Sendable (Notification) -> Void {
        { notification in
            guard let value = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: value) == .began else { return }
            Task { @MainActor in handler(.interruptionBegan) }
        }
    }

    private nonisolated static func makeRouteCallback(
        handler: @escaping @MainActor @Sendable (VoiceAudioLifecycleEvent) -> Void
    ) -> @Sendable (Notification) -> Void {
        { notification in
            guard let value = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  let reason = AVAudioSession.RouteChangeReason(rawValue: value),
                  reason == .oldDeviceUnavailable || reason == .noSuitableRouteForCategory else { return }
            Task { @MainActor in handler(.inputLost) }
        }
    }
}

#if DEBUG
@MainActor
final class FakeVoicePlanningService: VoicePlanningService {
    var permissionResult: VoicePermissionResult = .granted
    var startError: Error?
    private(set) var startCount = 0
    private(set) var stopCount = 0
    private(set) var cancelCount = 0
    private(set) var requestedLanguage: VoicePlanningLanguage?
    private var continuations: [AsyncThrowingStream<VoiceTranscript, Error>.Continuation] = []

    func requestPermissions() async -> VoicePermissionResult {
        permissionResult
    }

    func startTranscription(language: VoicePlanningLanguage) throws -> AsyncThrowingStream<VoiceTranscript, Error> {
        if let startError { throw startError }
        startCount += 1
        requestedLanguage = language
        return AsyncThrowingStream { continuation in
            self.continuations.append(continuation)
        }
    }

    func send(_ text: String, isFinal: Bool = false, session index: Int? = nil) {
        guard let continuation = continuation(at: index) else { return }
        continuation.yield(VoiceTranscript(text: text, isFinal: isFinal))
        if isFinal { continuation.finish() }
    }

    func fail(_ error: Error, session index: Int? = nil) {
        continuation(at: index)?.finish(throwing: error)
    }

    func stop() {
        stopCount += 1
        continuations.last?.finish()
    }

    func cancel() {
        cancelCount += 1
        continuations.last?.finish()
    }

    private func continuation(
        at index: Int?
    ) -> AsyncThrowingStream<VoiceTranscript, Error>.Continuation? {
        if let index, continuations.indices.contains(index) {
            return continuations[index]
        }
        return continuations.last
    }
}
#endif
