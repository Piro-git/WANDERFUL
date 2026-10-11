import AVFAudio
import XCTest
@testable import TrailMind

@MainActor
final class VoicePlanningModelTests: XCTestCase {
    func testInitialStateIsIdleAndEmptyPromptCannotSubmit() {
        let model = VoicePlanningModel(service: FakeVoicePlanningService())

        XCTAssertEqual(model.state, .idle)
        XCTAssertFalse(model.canSubmit)
    }

    func testPermissionGrantedStartsListeningAfterPermission() async {
        let service = FakeVoicePlanningService()
        let model = VoicePlanningModel(service: service)

        await model.start()

        XCTAssertEqual(model.state, .listening)
        XCTAssertEqual(service.startCount, 1)
        model.dismiss()
    }

    func testPermissionDeniedDoesNotStartListening() async {
        let service = FakeVoicePlanningService()
        service.permissionResult = .denied(.microphone)
        let model = VoicePlanningModel(service: service)

        await model.start()

        XCTAssertEqual(model.state, .permissionDenied(.microphone))
        XCTAssertEqual(service.startCount, 0)
    }

    func testUnavailableRecognitionCanRetry() async {
        let service = FakeVoicePlanningService()
        service.startError = VoicePlanningServiceError.recognitionUnavailable
        let model = VoicePlanningModel(service: service)
        await model.start()
        XCTAssertEqual(
            model.state,
            .unavailable(VoicePlanningServiceError.recognitionUnavailable.localizedDescription)
        )

        service.startError = nil
        await model.retry()

        XCTAssertEqual(model.state, .listening)
        model.dismiss()
    }

    func testPartialAndFinalTranscriptsUpdateEditablePrompt() async {
        let service = FakeVoicePlanningService()
        let model = VoicePlanningModel(service: service)
        await model.start()

        service.send("15 km Rundwanderung")
        await settle()
        XCTAssertEqual(model.prompt, "15 km Rundwanderung")
        XCTAssertEqual(model.state, .listening)

        service.send("15 km Rundwanderung um Ilsenburg", isFinal: true)
        await settle()
        XCTAssertEqual(model.prompt, "15 km Rundwanderung um Ilsenburg")
        XCTAssertEqual(model.state, .completed)

        model.prompt += " mit Aussicht"
        XCTAssertEqual(model.trimmedPrompt, "15 km Rundwanderung um Ilsenburg mit Aussicht")
    }

    func testStopEndsCaptureAndKeepsTranscript() async {
        let service = FakeVoicePlanningService()
        let model = VoicePlanningModel(service: service)
        await model.start()
        service.send("Plan a forest loop")
        await settle()

        model.stop()

        XCTAssertEqual(service.stopCount, 1)
        XCTAssertEqual(model.state, .completed)
        XCTAssertEqual(model.prompt, "Plan a forest loop")
    }

    func testCancelRestoresTextFromBeforeRecording() async {
        let service = FakeVoicePlanningService()
        let model = VoicePlanningModel(service: service, initialPrompt: "Existing typed request")
        await model.start()
        service.send("Replacement voice request")
        await settle()

        model.cancelRecording()

        XCTAssertEqual(model.prompt, "Existing typed request")
        XCTAssertEqual(model.state, .idle)
        XCTAssertGreaterThanOrEqual(service.cancelCount, 1)
    }

    func testDismissalCancelsCaptureAndIgnoresLateResults() async {
        let service = FakeVoicePlanningService()
        let model = VoicePlanningModel(service: service)
        await model.start()

        model.dismiss()
        service.send("Late transcript")
        await settle()

        XCTAssertEqual(model.prompt, "")
        XCTAssertGreaterThanOrEqual(service.cancelCount, 1)
    }

    func testRapidStartWhileListeningDoesNotCreateAnotherSession() async {
        let service = FakeVoicePlanningService()
        let model = VoicePlanningModel(service: service)

        await model.start()
        await model.start()

        XCTAssertEqual(service.startCount, 1)
        model.dismiss()
    }

    func testWhitespaceIsTrimmedAndCannotSubmit() {
        let model = VoicePlanningModel(
            service: FakeVoicePlanningService(),
            initialPrompt: "  \n "
        )

        XCTAssertFalse(model.canSubmit)
        XCTAssertEqual(model.trimmedPrompt, "")
    }

    func testGermanAndEnglishLocaleSelection() async {
        let germanService = FakeVoicePlanningService()
        let germanModel = VoicePlanningModel(service: germanService, language: .german)
        await germanModel.start()
        XCTAssertEqual(germanService.requestedLanguage, .german)
        germanModel.dismiss()

        let englishService = FakeVoicePlanningService()
        let englishModel = VoicePlanningModel(service: englishService, language: .english)
        await englishModel.start()
        XCTAssertEqual(englishService.requestedLanguage, .english)
        englishModel.dismiss()
    }

    func testFailureAllowsRetry() async {
        let service = FakeVoicePlanningService()
        service.startError = VoicePlanningServiceError.couldNotStart
        let model = VoicePlanningModel(service: service)
        await model.start()
        guard case .failed = model.state else {
            return XCTFail("Expected failed state")
        }

        service.startError = nil
        await model.retry()

        XCTAssertEqual(model.state, .listening)
        model.dismiss()
    }

    func testLateResultFromPreviousSessionCannotMutateRetry() async {
        let service = FakeVoicePlanningService()
        let model = VoicePlanningModel(service: service)
        await model.start()
        model.cancelRecording()
        await model.start()

        service.send("Stale transcript", session: 0)
        service.send("Current transcript", session: 1)
        await settle()

        XCTAssertEqual(model.prompt, "Current transcript")
        XCTAssertEqual(model.state, .listening)
        model.dismiss()
    }

    func testExistingTextOnlyPromptRemainsEditableAndSubmittable() {
        let model = VoicePlanningModel(
            service: FakeVoicePlanningService(),
            initialPrompt: "  Ilsenburg nach Schierke  "
        )

        XCTAssertEqual(model.state, .idle)
        XCTAssertTrue(model.canSubmit)
        XCTAssertEqual(model.trimmedPrompt, "Ilsenburg nach Schierke")
    }

    private func settle() async {
        for _ in 0..<4 { await Task.yield() }
    }
}

@MainActor
final class AppleSpeechVoicePlanningServiceTests: XCTestCase {
    func testNotDeterminedPermissionsAreRequestedIndependently() async {
        let harness = VoiceServiceHarness()
        harness.permissions.microphoneStatus = .notDetermined
        harness.permissions.requestedMicrophoneStatus = .authorized
        harness.permissions.speechRecognitionStatus = .notDetermined
        harness.permissions.requestedSpeechStatus = .authorized

        let result = await harness.service.requestPermissions()

        XCTAssertEqual(result, .granted)
        XCTAssertEqual(harness.permissions.microphoneRequestCount, 1)
        XCTAssertEqual(harness.permissions.speechRequestCount, 1)
    }

    func testAuthorizedSecondLaunchDoesNotRequestPermissionsAgain() async {
        let harness = VoiceServiceHarness()

        let result = await harness.service.requestPermissions()

        XCTAssertEqual(result, .granted)
        XCTAssertEqual(harness.permissions.microphoneRequestCount, 0)
        XCTAssertEqual(harness.permissions.speechRequestCount, 0)
    }

    func testPermissionFailuresRemainTypedByCapabilityAndStatus() async {
        let cases: [(VoiceAuthorizationStatus, VoiceAuthorizationStatus, VoicePermissionDenial)] = [
            (.denied, .authorized, .microphone),
            (.restricted, .authorized, .microphoneRestricted),
            (.unavailable, .authorized, .microphoneUnavailable),
            (.authorized, .denied, .speechRecognition),
            (.authorized, .restricted, .speechRecognitionRestricted),
            (.authorized, .unavailable, .speechRecognitionUnavailable)
        ]

        for (microphone, speech, expected) in cases {
            let harness = VoiceServiceHarness()
            harness.permissions.microphoneStatus = microphone
            harness.permissions.speechRecognitionStatus = speech
            let result = await harness.service.requestPermissions()
            XCTAssertEqual(result, .denied(expected))
        }
    }

    func testStartUsesSafePhysicalDeviceAudioOrder() throws {
        let harness = VoiceServiceHarness()

        _ = try harness.service.startTranscription(language: .english)

        XCTAssertEqual(
            harness.log.values,
            [
                "recognition.available",
                "session.configureAndActivate",
                "session.hasAudioInput",
                "engine.inputFormat",
                "recognition.start",
                "engine.installTap",
                "lifecycle.start",
                "engine.prepare",
                "engine.start"
            ]
        )
        harness.service.cancel()
    }

    func testMissingInputCleansUpAndReturnsTypedError() {
        let harness = VoiceServiceHarness()
        harness.audioSession.hasAudioInputValue = false

        XCTAssertThrowsError(try harness.service.startTranscription(language: .english)) { error in
            XCTAssertEqual(error as? VoicePlanningServiceError, .noAudioInput)
        }
        XCTAssertEqual(harness.audioSession.deactivateCount, 1)
        XCTAssertEqual(harness.audioEngine.installTapCount, 0)
        XCTAssertEqual(harness.lifecycle.stopCount, 1)
    }

    func testEngineStartFailureRemovesTapCancelsRecognitionAndDeactivates() {
        let harness = VoiceServiceHarness()
        harness.audioEngine.startError = VoiceTestError.expected

        XCTAssertThrowsError(try harness.service.startTranscription(language: .english)) { error in
            XCTAssertEqual(error as? VoicePlanningServiceError, .couldNotStart)
        }
        XCTAssertEqual(harness.audioEngine.removeTapCount, 1)
        XCTAssertEqual(harness.recognition.sessions.first?.cancelCount, 1)
        XCTAssertEqual(harness.audioSession.deactivateCount, 1)
        XCTAssertEqual(harness.lifecycle.stopCount, 1)
    }

    func testCancelAndStopAreIdempotentAndReleaseCapture() throws {
        let harness = VoiceServiceHarness()
        _ = try harness.service.startTranscription(language: .english)

        harness.service.stop()
        harness.service.stop()
        harness.service.cancel()

        XCTAssertEqual(harness.recognition.sessions.first?.endAudioCount, 1)
        XCTAssertEqual(harness.audioEngine.stopCount, 1)
        XCTAssertEqual(harness.audioEngine.removeTapCount, 1)
        XCTAssertEqual(harness.audioSession.deactivateCount, 1)
    }

    func testInterruptionFailsStreamAndPerformsFullCleanup() async throws {
        let harness = VoiceServiceHarness()
        let stream = try harness.service.startTranscription(language: .english)
        let resultTask = streamResult(stream)

        harness.lifecycle.emit(.interruptionBegan)
        let error = await resultTask.value

        XCTAssertEqual(error, .interrupted)
        XCTAssertEqual(harness.recognition.sessions.first?.cancelCount, 1)
        XCTAssertEqual(harness.audioEngine.removeTapCount, 1)
        XCTAssertEqual(harness.audioSession.deactivateCount, 1)
    }

    func testInputLossFailsStreamAndPerformsFullCleanup() async throws {
        let harness = VoiceServiceHarness()
        let stream = try harness.service.startTranscription(language: .english)
        let resultTask = streamResult(stream)

        harness.lifecycle.emit(.inputLost)
        let error = await resultTask.value

        XCTAssertEqual(error, .inputChanged)
        XCTAssertEqual(harness.recognition.sessions.first?.cancelCount, 1)
        XCTAssertEqual(harness.audioEngine.removeTapCount, 1)
        XCTAssertEqual(harness.audioSession.deactivateCount, 1)
    }

    func testRecognitionErrorFailsStreamAndPerformsFullCleanup() async throws {
        let harness = VoiceServiceHarness()
        let stream = try harness.service.startTranscription(language: .english)
        let resultTask = streamResult(stream)

        harness.recognition.emit(.failure(VoicePlanningServiceError.recognitionUnavailable), session: 0)
        let error = await resultTask.value

        XCTAssertEqual(error, .recognitionUnavailable)
        XCTAssertEqual(harness.recognition.sessions.first?.cancelCount, 1)
        XCTAssertEqual(harness.audioEngine.removeTapCount, 1)
        XCTAssertEqual(harness.audioSession.deactivateCount, 1)
    }

    func testRecognitionFinalCompletesAndStaleCallbackCannotReachNewSession() async throws {
        let harness = VoiceServiceHarness()
        let first = try harness.service.startTranscription(language: .english)
        let firstTask = transcriptValues(first)
        harness.recognition.emit(.transcript(VoiceTranscript(text: "first", isFinal: true)), session: 0)
        let firstValues = await firstTask.value
        XCTAssertEqual(firstValues, [VoiceTranscript(text: "first", isFinal: true)])

        let second = try harness.service.startTranscription(language: .english)
        let secondTask = transcriptValues(second)
        harness.recognition.emit(.transcript(VoiceTranscript(text: "stale", isFinal: true)), session: 0)
        harness.recognition.emit(.transcript(VoiceTranscript(text: "current", isFinal: true)), session: 1)

        let secondValues = await secondTask.value
        XCTAssertEqual(secondValues, [VoiceTranscript(text: "current", isFinal: true)])
    }

    func testStartingAgainCancelsPreviousSessionBeforeInstallingNewTap() throws {
        let harness = VoiceServiceHarness()
        _ = try harness.service.startTranscription(language: .english)

        _ = try harness.service.startTranscription(language: .german)

        XCTAssertEqual(harness.recognition.sessions[0].cancelCount, 1)
        XCTAssertEqual(harness.audioEngine.removeTapCount, 1)
        XCTAssertEqual(harness.audioEngine.installTapCount, 2)
        XCTAssertEqual(harness.audioSession.deactivateCount, 1)
        harness.service.cancel()
    }

    func testServiceTeardownReleasesAnActiveCapture() async throws {
        let log = VoiceOperationLog()
        let permissions = FakeVoicePermissionAuthorizer()
        let audioSession = FakeVoiceAudioSessionManager(log: log)
        let audioEngine = FakeVoiceAudioEngineManager(log: log)
        let recognition = FakeVoiceRecognitionManager(log: log)
        let lifecycle = FakeVoiceAudioLifecycleObserver(log: log)
        var service: AppleSpeechVoicePlanningService? = AppleSpeechVoicePlanningService(
            permissions: permissions,
            audioSession: audioSession,
            audioEngine: audioEngine,
            recognition: recognition,
            lifecycle: lifecycle
        )
        weak var weakService: AppleSpeechVoicePlanningService?
        weakService = service
        _ = try service?.startTranscription(language: .english)

        service = nil
        for _ in 0..<8 { await Task.yield() }

        XCTAssertNil(weakService)
        XCTAssertEqual(recognition.sessions.first?.cancelCount, 1)
        XCTAssertEqual(audioEngine.removeTapCount, 1)
        XCTAssertEqual(audioSession.deactivateCount, 1)
    }

    private func streamResult(
        _ stream: AsyncThrowingStream<VoiceTranscript, Error>
    ) -> Task<VoicePlanningServiceError?, Never> {
        Task {
            do {
                for try await _ in stream {}
                return nil
            } catch {
                return error as? VoicePlanningServiceError
            }
        }
    }

    private func transcriptValues(
        _ stream: AsyncThrowingStream<VoiceTranscript, Error>
    ) -> Task<[VoiceTranscript], Never> {
        Task {
            var values: [VoiceTranscript] = []
            do {
                for try await value in stream { values.append(value) }
            } catch {}
            return values
        }
    }
}

private enum VoiceTestError: Error {
    case expected
}

private final class VoiceOperationLog: @unchecked Sendable {
    nonisolated(unsafe) var values: [String] = []
    nonisolated func record(_ value: String) { values.append(value) }
}

@MainActor
private final class VoiceServiceHarness {
    let log = VoiceOperationLog()
    let permissions: FakeVoicePermissionAuthorizer
    let audioSession: FakeVoiceAudioSessionManager
    let audioEngine: FakeVoiceAudioEngineManager
    let recognition: FakeVoiceRecognitionManager
    let lifecycle: FakeVoiceAudioLifecycleObserver
    let service: AppleSpeechVoicePlanningService

    init() {
        permissions = FakeVoicePermissionAuthorizer()
        audioSession = FakeVoiceAudioSessionManager(log: log)
        audioEngine = FakeVoiceAudioEngineManager(log: log)
        recognition = FakeVoiceRecognitionManager(log: log)
        lifecycle = FakeVoiceAudioLifecycleObserver(log: log)
        service = AppleSpeechVoicePlanningService(
            permissions: permissions,
            audioSession: audioSession,
            audioEngine: audioEngine,
            recognition: recognition,
            lifecycle: lifecycle
        )
    }
}

@MainActor
private final class FakeVoicePermissionAuthorizer: VoicePermissionAuthorizing {
    var microphoneStatus: VoiceAuthorizationStatus = .authorized
    var speechRecognitionStatus: VoiceAuthorizationStatus = .authorized
    var requestedMicrophoneStatus: VoiceAuthorizationStatus = .authorized
    var requestedSpeechStatus: VoiceAuthorizationStatus = .authorized
    private(set) var microphoneRequestCount = 0
    private(set) var speechRequestCount = 0

    func requestMicrophonePermission() async -> VoiceAuthorizationStatus {
        microphoneRequestCount += 1
        return requestedMicrophoneStatus
    }

    func requestSpeechRecognitionPermission() async -> VoiceAuthorizationStatus {
        speechRequestCount += 1
        return requestedSpeechStatus
    }
}

@MainActor
private final class FakeVoiceAudioSessionManager: VoiceAudioSessionManaging {
    let log: VoiceOperationLog
    var hasAudioInputValue = true
    var configureError: Error?
    private(set) var deactivateCount = 0

    init(log: VoiceOperationLog) { self.log = log }

    var hasAudioInput: Bool {
        log.record("session.hasAudioInput")
        return hasAudioInputValue
    }

    func configureAndActivate() throws {
        log.record("session.configureAndActivate")
        if let configureError { throw configureError }
    }

    func deactivate() {
        log.record("session.deactivate")
        deactivateCount += 1
    }
}

@MainActor
private final class FakeVoiceAudioEngineManager: VoiceAudioEngineManaging {
    let log: VoiceOperationLog
    var isRunning = false
    var format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
    var startError: Error?
    private(set) var installTapCount = 0
    private(set) var removeTapCount = 0
    private(set) var stopCount = 0

    init(log: VoiceOperationLog) { self.log = log }

    func inputFormat() -> AVAudioFormat {
        log.record("engine.inputFormat")
        return format
    }

    func installTap(format: AVAudioFormat, handler: @escaping AVAudioNodeTapBlock) {
        log.record("engine.installTap")
        installTapCount += 1
    }

    func removeTap() {
        log.record("engine.removeTap")
        removeTapCount += 1
    }

    func prepare() { log.record("engine.prepare") }

    func start() throws {
        log.record("engine.start")
        if let startError { throw startError }
        isRunning = true
    }

    func stop() {
        log.record("engine.stop")
        isRunning = false
        stopCount += 1
    }
}

private final class FakeVoiceRecognitionSession: VoiceRecognitionSession, @unchecked Sendable {
    nonisolated(unsafe) private(set) var endAudioCount = 0
    nonisolated(unsafe) private(set) var cancelCount = 0
    nonisolated func append(_ buffer: AVAudioPCMBuffer) {}
    nonisolated func endAudio() { endAudioCount += 1 }
    nonisolated func cancel() { cancelCount += 1 }
}

@MainActor
private final class FakeVoiceRecognitionManager: VoiceRecognitionManaging {
    let log: VoiceOperationLog
    var available = true
    var startError: Error?
    private(set) var sessions: [FakeVoiceRecognitionSession] = []
    private var handlers: [@Sendable (VoiceRecognitionEvent) -> Void] = []

    init(log: VoiceOperationLog) { self.log = log }

    func isAvailable(language: VoicePlanningLanguage) -> Bool {
        log.record("recognition.available")
        return available
    }

    func start(
        language: VoicePlanningLanguage,
        eventHandler: @escaping @Sendable (VoiceRecognitionEvent) -> Void
    ) throws -> any VoiceRecognitionSession {
        log.record("recognition.start")
        if let startError { throw startError }
        let session = FakeVoiceRecognitionSession()
        sessions.append(session)
        handlers.append(eventHandler)
        return session
    }

    func emit(_ event: VoiceRecognitionEvent, session index: Int) {
        handlers[index](event)
    }
}

@MainActor
private final class FakeVoiceAudioLifecycleObserver: VoiceAudioLifecycleObserving {
    let log: VoiceOperationLog
    private var handler: (@MainActor @Sendable (VoiceAudioLifecycleEvent) -> Void)?
    private(set) var stopCount = 0

    init(log: VoiceOperationLog) { self.log = log }

    func start(handler: @escaping @MainActor @Sendable (VoiceAudioLifecycleEvent) -> Void) {
        log.record("lifecycle.start")
        self.handler = handler
    }

    func stop() {
        log.record("lifecycle.stop")
        handler = nil
        stopCount += 1
    }

    func emit(_ event: VoiceAudioLifecycleEvent) {
        handler?(event)
    }
}
