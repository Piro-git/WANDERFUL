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
