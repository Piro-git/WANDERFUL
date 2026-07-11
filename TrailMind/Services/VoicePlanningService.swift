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
    case restricted
}

enum VoicePermissionResult: Equatable, Sendable {
    case granted
    case denied(VoicePermissionDenial)
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
            "TrailMind could not start listening. Please try again."
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

/// Live transcription uses Apple's Speech framework. Depending on the device and
/// language, Apple may process speech using its recognition service. TrailMind does
/// not retain raw audio or send it to a TrailMind backend.
@MainActor
final class AppleSpeechVoicePlanningService: VoicePlanningService {
    private let audioEngine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var continuation: AsyncThrowingStream<VoiceTranscript, Error>.Continuation?
    private var notificationTokens: [NSObjectProtocol] = []
    private var isFinishing = false
    private var hasInputTap = false

    func requestPermissions() async -> VoicePermissionResult {
        let microphoneGranted = await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
        guard microphoneGranted else { return .denied(.microphone) }

        let speechStatus: SFSpeechRecognizerAuthorizationStatus
        switch SFSpeechRecognizer.authorizationStatus() {
        case .notDetermined:
            speechStatus = await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { status in
                    continuation.resume(returning: status)
                }
            }
        case let status:
            speechStatus = status
        }

        switch speechStatus {
        case .authorized:
            return .granted
        case .restricted:
            return .denied(.restricted)
        case .denied, .notDetermined:
            return .denied(.speechRecognition)
        @unknown default:
            return .denied(.restricted)
        }
    }

    func startTranscription(language: VoicePlanningLanguage) throws -> AsyncThrowingStream<VoiceTranscript, Error> {
        cancel()

        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language.rawValue)), recognizer.isAvailable else {
            throw VoicePlanningServiceError.recognitionUnavailable
        }

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        guard recordingFormat.sampleRate > 0, recordingFormat.channelCount > 0 else {
            throw VoicePlanningServiceError.noAudioInput
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation

        let stream = AsyncThrowingStream<VoiceTranscript, Error> { continuation in
            self.continuation = continuation
        }

        self.recognizer = recognizer
        recognitionRequest = request
        isFinishing = false

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor [weak self] in
                guard let self, !self.isFinishing else { return }

                if let result {
                    self.continuation?.yield(
                        VoiceTranscript(
                            text: result.bestTranscription.formattedString,
                            isFinal: result.isFinal
                        )
                    )
                    if result.isFinal {
                        self.finishStream()
                    }
                } else if let error {
                    self.finishStream(throwing: error)
                }
            }
        }

        inputNode.installTap(onBus: 0, bufferSize: 1_024, format: recordingFormat) { buffer, _ in
            request.append(buffer)
        }
        hasInputTap = true

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            audioEngine.prepare()
            try audioEngine.start()
            observeAudioLifecycle()
            return stream
        } catch {
            cancel()
            throw VoicePlanningServiceError.couldNotStart
        }
    }

    func stop() {
        guard recognitionRequest != nil else { return }
        stopAudioCapture()
        recognitionRequest?.endAudio()
    }

    func cancel() {
        isFinishing = true
        stopAudioCapture()
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        continuation?.finish()
        clearRecognitionResources()
    }

    private func observeAudioLifecycle() {
        let center = NotificationCenter.default
        notificationTokens.append(
            center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
                guard let typeValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                      AVAudioSession.InterruptionType(rawValue: typeValue) == .began else { return }
                Task { @MainActor [weak self] in
                    self?.finishStream(throwing: VoicePlanningServiceError.interrupted)
                }
            }
        )
        notificationTokens.append(
            center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
                guard let reasonValue = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                      let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue),
                      reason == .oldDeviceUnavailable || reason == .noSuitableRouteForCategory else { return }
                Task { @MainActor [weak self] in
                    self?.finishStream(throwing: VoicePlanningServiceError.inputChanged)
                }
            }
        )
    }

    private func finishStream(throwing error: Error? = nil) {
        guard !isFinishing else { return }
        isFinishing = true
        stopAudioCapture()
        if let error {
            continuation?.finish(throwing: error)
        } else {
            continuation?.finish()
        }
        clearRecognitionResources()
    }

    private func stopAudioCapture() {
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        if hasInputTap {
            audioEngine.inputNode.removeTap(onBus: 0)
            hasInputTap = false
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        notificationTokens.forEach(NotificationCenter.default.removeObserver)
        notificationTokens.removeAll()
    }

    private func clearRecognitionResources() {
        recognizer = nil
        recognitionRequest = nil
        recognitionTask = nil
        continuation = nil
    }
}

@MainActor
final class FakeVoicePlanningService: VoicePlanningService {
    var permissionResult: VoicePermissionResult = .granted
    var startError: Error?
    private(set) var startCount = 0
    private(set) var stopCount = 0
    private(set) var cancelCount = 0
    private(set) var requestedLanguage: VoicePlanningLanguage?
    private var continuation: AsyncThrowingStream<VoiceTranscript, Error>.Continuation?

    func requestPermissions() async -> VoicePermissionResult {
        permissionResult
    }

    func startTranscription(language: VoicePlanningLanguage) throws -> AsyncThrowingStream<VoiceTranscript, Error> {
        if let startError { throw startError }
        startCount += 1
        requestedLanguage = language
        return AsyncThrowingStream { continuation in
            self.continuation = continuation
        }
    }

    func send(_ text: String, isFinal: Bool = false) {
        continuation?.yield(VoiceTranscript(text: text, isFinal: isFinal))
        if isFinal { continuation?.finish() }
    }

    func fail(_ error: Error) {
        continuation?.finish(throwing: error)
    }

    func stop() {
        stopCount += 1
        continuation?.finish()
    }

    func cancel() {
        cancelCount += 1
        continuation?.finish()
    }
}
