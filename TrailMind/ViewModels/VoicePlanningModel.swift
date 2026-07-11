import Foundation
import Observation

enum VoicePlanningState: Equatable {
    case idle
    case requestingPermission
    case preparing
    case listening
    case stopping
    case completed
    case permissionDenied(VoicePermissionDenial)
    case unavailable(String)
    case failed(String)

    var isCapturing: Bool {
        switch self {
        case .requestingPermission, .preparing, .listening, .stopping:
            true
        default:
            false
        }
    }
}

@MainActor
@Observable
final class VoicePlanningModel {
    private let service: any VoicePlanningService
    private var recognitionTask: Task<Void, Never>?
    private var durationTask: Task<Void, Never>?
    private var sessionID: UUID?
    private var promptBeforeListening = ""

    var state: VoicePlanningState = .idle
    var prompt: String
    var language: VoicePlanningLanguage

    init(
        service: any VoicePlanningService,
        initialPrompt: String = "",
        language: VoicePlanningLanguage = .deviceDefault
    ) {
        self.service = service
        prompt = initialPrompt
        self.language = language
    }

    var canSubmit: Bool {
        !state.isCapturing && !trimmedPrompt.isEmpty
    }

    var trimmedPrompt: String {
        prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func start() async {
        guard !state.isCapturing else { return }

        invalidateSession(cancelService: true)
        let id = UUID()
        sessionID = id
        promptBeforeListening = prompt
        state = .requestingPermission

        let permission = await service.requestPermissions()
        guard sessionID == id, !Task.isCancelled else { return }
        guard permission == .granted else {
            if case let .denied(reason) = permission {
                state = .permissionDenied(reason)
            }
            return
        }

        state = .preparing
        do {
            let stream = try service.startTranscription(language: language)
            guard sessionID == id else {
                service.cancel()
                return
            }
            state = .listening
            observe(stream, sessionID: id)
            scheduleMaximumDuration(for: id)
        } catch let error as VoicePlanningServiceError where error == .recognitionUnavailable {
            state = .unavailable(error.localizedDescription)
        } catch {
            state = .failed(userMessage(for: error))
        }
    }

    func stop() {
        guard state == .listening else { return }
        state = .stopping
        durationTask?.cancel()
        durationTask = nil
        service.stop()
        state = .completed
    }

    func cancelRecording() {
        guard state.isCapturing || state == .completed else { return }
        prompt = promptBeforeListening
        invalidateSession(cancelService: true)
        state = .idle
    }

    func dismiss() {
        invalidateSession(cancelService: true)
        if state.isCapturing { state = .idle }
    }

    func retry() async {
        await start()
    }

    private func observe(
        _ stream: AsyncThrowingStream<VoiceTranscript, Error>,
        sessionID id: UUID
    ) {
        recognitionTask = Task { [weak self] in
            do {
                for try await update in stream {
                    guard let self, self.sessionID == id, !Task.isCancelled else { return }
                    self.prompt = update.text
                    if update.isFinal {
                        self.durationTask?.cancel()
                        self.durationTask = nil
                        self.state = .completed
                    }
                }
                guard let self, self.sessionID == id, self.state == .listening else { return }
                self.state = .completed
            } catch is CancellationError {
                return
            } catch {
                guard let self, self.sessionID == id else { return }
                self.durationTask?.cancel()
                self.durationTask = nil
                self.state = .failed(self.userMessage(for: error))
            }
        }
    }

    private func scheduleMaximumDuration(for id: UUID) {
        durationTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(60))
            guard !Task.isCancelled, let self, self.sessionID == id else { return }
            self.stop()
        }
    }

    private func invalidateSession(cancelService: Bool) {
        sessionID = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        durationTask?.cancel()
        durationTask = nil
        if cancelService { service.cancel() }
    }

    private func userMessage(for error: Error) -> String {
        if let localized = error as? LocalizedError, let description = localized.errorDescription {
            return description
        }
        return "Voice transcription stopped unexpectedly. Please try again."
    }
}
