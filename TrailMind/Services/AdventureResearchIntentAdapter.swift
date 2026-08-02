import Foundation

protocol AdventureResearchIntentAdaptingV1: Sendable {
    func adapt(
        _ input: AdventureResearchIntentAdapterInputV1
    ) -> AdventureResearchIntentAdapterResultV1
}

struct AdventureResearchIntentAdapterInputV1: Sendable {
    let validatedIntent: ValidatedAdventureIntent
    let resolvedStart: LocationCandidate?

    init(
        validatedIntent: ValidatedAdventureIntent,
        resolvedStart: LocationCandidate?
    ) {
        self.validatedIntent = validatedIntent
        self.resolvedStart = resolvedStart
    }
}

enum AdventureResearchIntentAdapterStateV1: String, Equatable, Sendable {
    case ready
    case clarificationRequired = "clarification_required"
    case unsupported
}

enum AdventureResearchIntentAdapterGapV1:
    String,
    CaseIterable,
    Hashable,
    Sendable
{
    case activityNotSupported
    case pointToPointDestinationNotRepresentable
    case multiDayNotSupported
    case resolvedAnchorRequired
    case broadRegionRequiresClarification
    case resolvedAnchorCoordinatesInvalid
    case resolvedAnchorNameInvalid
    case distanceNotRepresentable
    case durationNotRepresentable
    case technicalDifficultyNotEquivalent
    case waterPreferenceAmbiguous
    case sunsetNotModeled
    case groupContextUnavailable
    case arrivalContextUnavailable
    case researchContractRejected
}

enum AdventureResearchIntentAdapterResultV1: Equatable, Sendable {
    case ready(
        intent: AdventureResearchIntentV1,
        gaps: [AdventureResearchIntentAdapterGapV1]
    )
    case clarificationRequired(
        intent: AdventureResearchIntentV1,
        gaps: [AdventureResearchIntentAdapterGapV1]
    )
    case unsupported(
        gaps: [AdventureResearchIntentAdapterGapV1]
    )

    var state: AdventureResearchIntentAdapterStateV1 {
        switch self {
        case .ready:
            .ready
        case .clarificationRequired:
            .clarificationRequired
        case .unsupported:
            .unsupported
        }
    }

    var intent: AdventureResearchIntentV1? {
        switch self {
        case let .ready(intent, _),
             let .clarificationRequired(intent, _):
            intent
        case .unsupported:
            nil
        }
    }

    var gaps: [AdventureResearchIntentAdapterGapV1] {
        switch self {
        case let .ready(_, gaps),
             let .clarificationRequired(_, gaps),
             let .unsupported(gaps):
            gaps
        }
    }

    var satisfiesStateInvariants: Bool {
        let gapsAreBoundedAndUnique =
            gaps.count <= AdventureResearchIntentAdapterGapV1.allCases.count &&
            Set(gaps).count == gaps.count
        guard gapsAreBoundedAndUnique else { return false }

        switch self {
        case let .ready(intent, gaps):
            guard case .resolved = intent.geographicAnchor else {
                return false
            }
            return Self.isSupportedIntentShape(intent) &&
                intent.unresolvedClarificationQuestions.isEmpty &&
                gaps.contains(.groupContextUnavailable) &&
                gaps.contains(.arrivalContextUnavailable) &&
                gaps.allSatisfy(Self.isAdvisoryGap)

        case let .clarificationRequired(intent, gaps):
            let expectedQuestion = AdventureResearchClarificationQuestionV1(
                code: .locationRequired,
                field: .geographicAnchor
            )
            guard case .unresolved(requirementCode: .locationRequired) =
                intent.geographicAnchor
            else {
                return false
            }
            let hasAnchorGap =
                gaps.contains(.resolvedAnchorRequired) ||
                gaps.contains(.broadRegionRequiresClarification)
            return Self.isSupportedIntentShape(intent) &&
                hasAnchorGap &&
                gaps.contains(.groupContextUnavailable) &&
                gaps.contains(.arrivalContextUnavailable) &&
                gaps.allSatisfy {
                    Self.isAdvisoryGap($0) ||
                        $0 == .resolvedAnchorRequired ||
                        $0 == .broadRegionRequiresClarification
                } &&
                intent.unresolvedClarificationQuestions == [expectedQuestion]

        case let .unsupported(gaps):
            return !gaps.isEmpty &&
                intent == nil &&
                gaps.allSatisfy(Self.isBlockingUnsupportedGap)
        }
    }

    private static func isSupportedIntentShape(
        _ intent: AdventureResearchIntentV1
    ) -> Bool {
        let activityIsSupported =
            intent.activity == .hiking ||
            intent.activity == .trailRunning
        return activityIsSupported && intent.routeType == .loop
    }

    private static func isAdvisoryGap(
        _ gap: AdventureResearchIntentAdapterGapV1
    ) -> Bool {
        switch gap {
        case .technicalDifficultyNotEquivalent,
             .waterPreferenceAmbiguous,
             .sunsetNotModeled,
             .groupContextUnavailable,
             .arrivalContextUnavailable:
            true
        case .activityNotSupported,
             .pointToPointDestinationNotRepresentable,
             .multiDayNotSupported,
             .resolvedAnchorRequired,
             .broadRegionRequiresClarification,
             .resolvedAnchorCoordinatesInvalid,
             .resolvedAnchorNameInvalid,
             .distanceNotRepresentable,
             .durationNotRepresentable,
             .researchContractRejected:
            false
        }
    }

    private static func isBlockingUnsupportedGap(
        _ gap: AdventureResearchIntentAdapterGapV1
    ) -> Bool {
        switch gap {
        case .activityNotSupported,
             .pointToPointDestinationNotRepresentable,
             .multiDayNotSupported,
             .resolvedAnchorCoordinatesInvalid,
             .resolvedAnchorNameInvalid,
             .distanceNotRepresentable,
             .durationNotRepresentable,
             .researchContractRejected:
            true
        case .resolvedAnchorRequired,
             .broadRegionRequiresClarification,
             .technicalDifficultyNotEquivalent,
             .waterPreferenceAmbiguous,
             .sunsetNotModeled,
             .groupContextUnavailable,
             .arrivalContextUnavailable:
            false
        }
    }
}

struct AdventureResearchIntentAdapterV1:
    AdventureResearchIntentAdaptingV1,
    Sendable
{
    func adapt(
        _ input: AdventureResearchIntentAdapterInputV1
    ) -> AdventureResearchIntentAdapterResultV1 {
        var blockingGaps: [AdventureResearchIntentAdapterGapV1] = []

        let researchActivity: AdventureResearchActivityV1?
        switch input.validatedIntent.activityType {
        case .hiking:
            researchActivity = .hiking
        case .trailRunning:
            researchActivity = .trailRunning
        case .biking:
            researchActivity = nil
            Self.appendUnique(.activityNotSupported, to: &blockingGaps)
        }

        let researchRouteType: AdventureResearchRouteTypeV1?
        switch input.validatedIntent.routeType {
        case .loop:
            researchRouteType = .loop
        case .pointToPoint:
            researchRouteType = nil
            Self.appendUnique(
                .pointToPointDestinationNotRepresentable,
                to: &blockingGaps
            )
        case .multiDay:
            researchRouteType = nil
            Self.appendUnique(.multiDayNotSupported, to: &blockingGaps)
        }

        var distanceRange: AdventureResearchDistanceRangeV1?
        if let targetDistanceKm = input.validatedIntent.targetDistanceKm {
            do {
                distanceRange = try AdventureResearchDistanceRangeV1(
                    min: targetDistanceKm,
                    max: targetDistanceKm
                )
            } catch {
                Self.appendUnique(
                    .distanceNotRepresentable,
                    to: &blockingGaps
                )
            }
        }

        var durationRange: AdventureResearchDurationRangeV1?
        if let targetDurationMinutes =
            input.validatedIntent.targetDurationMinutes
        {
            do {
                durationRange = try AdventureResearchDurationRangeV1(
                    min: targetDurationMinutes,
                    max: targetDurationMinutes
                )
            } catch {
                Self.appendUnique(
                    .durationNotRepresentable,
                    to: &blockingGaps
                )
            }
        }

        guard blockingGaps.isEmpty,
              let researchActivity,
              let researchRouteType
        else {
            return Self.unsupportedResult(gaps: blockingGaps)
        }

        var advisoryGaps: [AdventureResearchIntentAdapterGapV1] = []
        let maximumTechnicalDifficulty:
            AdventureResearchTechnicalDifficultyV1?
        switch input.validatedIntent.difficulty {
        case .easy:
            maximumTechnicalDifficulty = .hiking
        case .moderate, .challenging:
            maximumTechnicalDifficulty = nil
            Self.appendUnique(
                .technicalDifficultyNotEquivalent,
                to: &advisoryGaps
            )
        case nil:
            maximumTechnicalDifficulty = nil
        }

        let preferredExperiences = Self.preferredExperiences(
            from: input.validatedIntent.desiredFeatures,
            gaps: &advisoryGaps
        )
        let avoidedExperiences = Self.avoidedExperiences(
            from: input.validatedIntent.avoidFeatures
        )
        guard let mustHaveExperiences = Self.mustHaveExperiences(
            from: input.validatedIntent.mustHaveResearchExperiences
        ) else {
            return Self.unsupportedResult(
                gaps: [.researchContractRejected]
            )
        }
        Self.appendUnique(.groupContextUnavailable, to: &advisoryGaps)
        Self.appendUnique(.arrivalContextUnavailable, to: &advisoryGaps)

        guard let resolvedStart = input.resolvedStart else {
            return makeClarificationResult(
                gap: .resolvedAnchorRequired,
                activity: researchActivity,
                routeType: researchRouteType,
                distanceRange: distanceRange,
                durationRange: durationRange,
                maximumTechnicalDifficulty: maximumTechnicalDifficulty,
                mustHaveExperiences: mustHaveExperiences,
                preferredExperiences: preferredExperiences,
                avoidedExperiences: avoidedExperiences,
                advisoryGaps: advisoryGaps
            )
        }

        guard resolvedStart.semanticKind.isUsableRouteAnchor else {
            let gap: AdventureResearchIntentAdapterGapV1
            switch resolvedStart.semanticKind {
            case .park, .mountainRange, .broadRegion:
                gap = .broadRegionRequiresClarification
            case .unknown:
                gap = .resolvedAnchorRequired
            case .settlement, .trailhead, .landmark:
                gap = .researchContractRejected
            }
            return makeClarificationResult(
                gap: gap,
                activity: researchActivity,
                routeType: researchRouteType,
                distanceRange: distanceRange,
                durationRange: durationRange,
                maximumTechnicalDifficulty: maximumTechnicalDifficulty,
                mustHaveExperiences: mustHaveExperiences,
                preferredExperiences: preferredExperiences,
                avoidedExperiences: avoidedExperiences,
                advisoryGaps: advisoryGaps
            )
        }

        guard Self.isRepresentableAnchorName(resolvedStart.displayName) else {
            return Self.unsupportedResult(gaps: [.resolvedAnchorNameInvalid])
        }

        let coordinate: AdventureResearchCoordinateV1
        do {
            coordinate = try AdventureResearchCoordinateV1(
                latitude: resolvedStart.coordinate.latitude,
                longitude: resolvedStart.coordinate.longitude
            )
        } catch {
            return Self.unsupportedResult(
                gaps: [.resolvedAnchorCoordinatesInvalid]
            )
        }

        let geographicAnchor = AdventureResearchGeographicAnchorV1.resolved(
            name: resolvedStart.displayName,
            coordinate: coordinate,
            regionEntityID: nil
        )
        guard let intent = Self.makeIntent(
            activity: researchActivity,
            geographicAnchor: geographicAnchor,
            routeType: researchRouteType,
            distanceRange: distanceRange,
            durationRange: durationRange,
            maximumTechnicalDifficulty: maximumTechnicalDifficulty,
            mustHaveExperiences: mustHaveExperiences,
            preferredExperiences: preferredExperiences,
            avoidedExperiences: avoidedExperiences,
            clarificationQuestions: []
        ) else {
            return Self.unsupportedResult(gaps: [.researchContractRejected])
        }

        let result = AdventureResearchIntentAdapterResultV1.ready(
            intent: intent,
            gaps: advisoryGaps
        )
        guard result.satisfiesStateInvariants else {
            return Self.unsupportedResult(gaps: [.researchContractRejected])
        }
        return result
    }

    private func makeClarificationResult(
        gap: AdventureResearchIntentAdapterGapV1,
        activity: AdventureResearchActivityV1,
        routeType: AdventureResearchRouteTypeV1,
        distanceRange: AdventureResearchDistanceRangeV1?,
        durationRange: AdventureResearchDurationRangeV1?,
        maximumTechnicalDifficulty:
            AdventureResearchTechnicalDifficultyV1?,
        mustHaveExperiences:
            [AdventureResearchExperienceRequirementV1],
        preferredExperiences: [AdventureResearchExperienceV1],
        avoidedExperiences: [AdventureResearchAvoidedExperienceV1],
        advisoryGaps: [AdventureResearchIntentAdapterGapV1]
    ) -> AdventureResearchIntentAdapterResultV1 {
        let question = AdventureResearchClarificationQuestionV1(
            code: .locationRequired,
            field: .geographicAnchor
        )
        guard let intent = Self.makeIntent(
            activity: activity,
            geographicAnchor: .unresolved(
                requirementCode: .locationRequired
            ),
            routeType: routeType,
            distanceRange: distanceRange,
            durationRange: durationRange,
            maximumTechnicalDifficulty: maximumTechnicalDifficulty,
            mustHaveExperiences: mustHaveExperiences,
            preferredExperiences: preferredExperiences,
            avoidedExperiences: avoidedExperiences,
            clarificationQuestions: [question]
        ) else {
            return Self.unsupportedResult(gaps: [.researchContractRejected])
        }

        var gaps = [gap]
        for advisoryGap in advisoryGaps {
            Self.appendUnique(advisoryGap, to: &gaps)
        }
        let result =
            AdventureResearchIntentAdapterResultV1.clarificationRequired(
                intent: intent,
                gaps: gaps
            )
        guard result.satisfiesStateInvariants else {
            return Self.unsupportedResult(gaps: [.researchContractRejected])
        }
        return result
    }

    private static func makeIntent(
        activity: AdventureResearchActivityV1,
        geographicAnchor: AdventureResearchGeographicAnchorV1,
        routeType: AdventureResearchRouteTypeV1,
        distanceRange: AdventureResearchDistanceRangeV1?,
        durationRange: AdventureResearchDurationRangeV1?,
        maximumTechnicalDifficulty:
            AdventureResearchTechnicalDifficultyV1?,
        mustHaveExperiences:
            [AdventureResearchExperienceRequirementV1],
        preferredExperiences: [AdventureResearchExperienceV1],
        avoidedExperiences: [AdventureResearchAvoidedExperienceV1],
        clarificationQuestions: [AdventureResearchClarificationQuestionV1]
    ) -> AdventureResearchIntentV1? {
        do {
            let groupContext = try AdventureResearchGroupContextV1(
                partySize: 1,
                includesChildren: false,
                youngestAge: nil,
                mobility: .unknown,
                experienceLevel: .unknown
            )
            let overnightRequirements =
                try AdventureResearchOvernightRequirementsV1(
                    required: false,
                    nights: 0,
                    allowedAccommodationTypes: []
                )
            return try AdventureResearchIntentV1(
                activity: activity,
                geographicAnchor: geographicAnchor,
                routeType: routeType,
                distanceRangeKm: distanceRange,
                durationRangeMinutes: durationRange,
                maximumElevationGainMeters: nil,
                maximumTechnicalDifficulty: maximumTechnicalDifficulty,
                mustHaveExperiences: mustHaveExperiences,
                preferredExperiences: preferredExperiences,
                avoidedExperiences: avoidedExperiences,
                requiredFacilities: [],
                groupContext: groupContext,
                dateOrSeason: nil,
                overnightRequirements: overnightRequirements,
                transportRequirements:
                    AdventureResearchTransportRequirementsV1(
                        arrivalMode: .unknown,
                        returnToStart: true,
                        publicTransportRequired: false
                    ),
                unresolvedClarificationQuestions: clarificationQuestions
            )
        } catch {
            return nil
        }
    }

    private static func mustHaveExperiences(
        from constraints: [MustHaveResearchExperienceConstraint]
    ) -> [AdventureResearchExperienceRequirementV1]? {
        do {
            return try constraints.map { constraint in
                try AdventureResearchExperienceRequirementV1(
                    experience: researchExperience(
                        from: constraint.experience
                    ),
                    minimumCount: constraint.minimumCount
                )
            }
        } catch {
            return nil
        }
    }

    private static func researchExperience(
        from experience: ResearchExperience
    ) -> AdventureResearchExperienceV1 {
        switch experience {
        case .viewpoint:
            .viewpoint
        case .waterfall:
            .waterfall
        case .peak:
            .peak
        case .lake:
            .lake
        case .forest:
            .forest
        case .quietTrails:
            .quietTrails
        case .officialHikingRoute:
            .officialHikingRoute
        case .alpineHut:
            .alpineHut
        case .wildernessHut:
            .wildernessHut
        case .landmark:
            .landmark
        }
    }

    private static func preferredExperiences(
        from features: [DesiredFeature],
        gaps: inout [AdventureResearchIntentAdapterGapV1]
    ) -> [AdventureResearchExperienceV1] {
        var mapped: [AdventureResearchExperienceV1] = []
        for feature in features {
            switch feature {
            case .viewpoint:
                appendUnique(.viewpoint, to: &mapped)
            case .forest:
                appendUnique(.forest, to: &mapped)
            case .quiet:
                appendUnique(.quietTrails, to: &mapped)
            case .water:
                appendUnique(.waterPreferenceAmbiguous, to: &gaps)
            case .sunset:
                appendUnique(.sunsetNotModeled, to: &gaps)
            }
        }
        return mapped
    }

    private static func avoidedExperiences(
        from features: [AvoidFeature]
    ) -> [AdventureResearchAvoidedExperienceV1] {
        var mapped: [AdventureResearchAvoidedExperienceV1] = []
        for feature in features {
            let value: AdventureResearchAvoidedExperienceV1
            switch feature {
            case .majorRoads:
                value = .majorRoads
            case .steepClimbs:
                value = .steepClimbs
            case .repeatedPath:
                value = .repeatedPath
            }
            appendUnique(value, to: &mapped)
        }
        return mapped
    }

    private static func unsupportedResult(
        gaps: [AdventureResearchIntentAdapterGapV1]
    ) -> AdventureResearchIntentAdapterResultV1 {
        var uniqueGaps: [AdventureResearchIntentAdapterGapV1] = []
        for gap in gaps {
            appendUnique(gap, to: &uniqueGaps)
        }
        if uniqueGaps.isEmpty {
            uniqueGaps = [.researchContractRejected]
        }
        return .unsupported(gaps: uniqueGaps)
    }

    private static func appendUnique<Value: Equatable>(
        _ value: Value,
        to values: inout [Value]
    ) {
        guard !values.contains(value) else { return }
        values.append(value)
    }

    private static func isRepresentableAnchorName(_ value: String) -> Bool {
        let length = value.utf16.count
        guard (1...160).contains(length),
              value == value.trimmingCharacters(
                  in: .whitespacesAndNewlines
              ),
              !value.contains("<"),
              !value.contains(">")
        else {
            return false
        }
        return !value.unicodeScalars.contains { scalar in
            let code = scalar.value
            return code <= 0x08 ||
                code == 0x0B ||
                code == 0x0C ||
                (0x0E...0x1F).contains(code) ||
                code == 0x7F
        }
    }
}
