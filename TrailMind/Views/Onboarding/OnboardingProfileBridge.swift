import Foundation

enum OnboardingProfileBridgeV1 {
    static func interfaceDraft(from profile: HikingPreferenceProfileV1) -> OnboardingView.Draft {
        OnboardingView.Draft(
            activity: profile.defaultActivity?.activityType,
            comfortRange: profile.comfortableOuting.map(interfaceComfortRange),
            distanceKilometers: distanceMidpoint(profile.comfortableOuting),
            effort: nil,
            routeShape: profile.preferredRouteShape.map(interfaceRouteShape),
            softAvoidances: profile.softAvoidances.map { Set($0.map(interfaceAvoidance)) },
            requestedExperiences: profile.requestedExperiences.map {
                Set($0.map(interfaceExperience))
            }
        )
    }

    static func step(from storedStepID: String) -> OnboardingView.Step {
        OnboardingView.Step(rawValue: storedStepID) ?? .welcome
    }

    static func coreDraft(
        from interfaceDraft: OnboardingView.Draft,
        step: OnboardingView.Step,
        existing: HikingOnboardingDraftV1?
    ) -> HikingOnboardingDraftV1 {
        var profile = existing?.profile ?? HikingPreferenceProfileV1()
        profile.defaultActivity = interfaceDraft.activity.map(HikingProfileActivityV1.init)
        profile.comfortableOuting = interfaceDraft.comfortRange.map(coreComfortRange)
        profile.preferredRouteShape = interfaceDraft.routeShape.map(coreRouteShape)
        profile.softAvoidances = interfaceDraft.softAvoidances.map {
            $0.map(coreAvoidance).sorted { $0.rawValue < $1.rawValue }
        }
        profile.requestedExperiences = interfaceDraft.requestedExperiences.map {
            $0.map(coreExperience).sorted { $0.rawValue < $1.rawValue }
        }

        if var existing {
            existing.currentStepID = step.rawValue
            existing.profile = profile
            // Keep the ordering token strictly monotonic even if two taps land
            // in the same clock tick or the wall clock moves backwards.
            existing.updatedAt = max(
                Date(),
                existing.updatedAt.addingTimeInterval(0.000_001)
            )
            return existing
        }
        return HikingOnboardingDraftV1(
            currentStepID: step.rawValue,
            profile: profile
        )
    }

    private static func interfaceComfortRange(
        _ comfort: HikingComfortableOutingV1
    ) -> OnboardingView.Draft.ComfortRange {
        switch comfort {
        case let .distanceKilometers(minimum, maximum):
            OnboardingView.Draft.ComfortRange(
                minimum: minimum,
                maximum: maximum,
                unit: .kilometers
            )
        case let .durationMinutes(minimum, maximum):
            OnboardingView.Draft.ComfortRange(
                minimum: Double(minimum) / 60,
                maximum: Double(maximum) / 60,
                unit: .hours
            )
        }
    }

    private static func coreComfortRange(
        _ comfort: OnboardingView.Draft.ComfortRange
    ) -> HikingComfortableOutingV1 {
        switch comfort.unit {
        case .kilometers:
            .distanceKilometers(minimum: comfort.minimum, maximum: comfort.maximum)
        case .hours:
            .durationMinutes(
                minimum: Int((comfort.minimum * 60).rounded()),
                maximum: Int((comfort.maximum * 60).rounded())
            )
        }
    }

    private static func distanceMidpoint(_ comfort: HikingComfortableOutingV1?) -> Double? {
        guard let comfort,
              case let .distanceKilometers(minimum, maximum) = comfort
        else {
            return nil
        }
        return (minimum + maximum) / 2
    }

    private static func interfaceRouteShape(
        _ shape: HikingPreferredRouteShapeV1
    ) -> OnboardingView.Draft.RouteShapePreference {
        switch shape {
        case .loop: .loop
        case .pointToPoint: .pointToPoint
        }
    }

    private static func coreRouteShape(
        _ shape: OnboardingView.Draft.RouteShapePreference
    ) -> HikingPreferredRouteShapeV1 {
        switch shape {
        case .loop: .loop
        case .pointToPoint: .pointToPoint
        }
    }

    private static func interfaceAvoidance(
        _ avoidance: HikingSoftAvoidanceV1
    ) -> OnboardingView.Draft.SoftAvoidance {
        switch avoidance {
        case .steepClimbs: .steepClimbs
        case .majorRoads: .longRoadSections
        case .repeatedSections: .repeatedSections
        }
    }

    private static func coreAvoidance(
        _ avoidance: OnboardingView.Draft.SoftAvoidance
    ) -> HikingSoftAvoidanceV1 {
        switch avoidance {
        case .steepClimbs: .steepClimbs
        case .longRoadSections: .majorRoads
        case .repeatedSections: .repeatedSections
        }
    }

    private static func interfaceExperience(
        _ experience: HikingRequestedExperienceV1
    ) -> OnboardingView.Draft.RequestedExperience {
        switch experience {
        case .viewpoints: .viewpoints
        case .forest: .forest
        case .quietNature: .quietNature
        case .waterfalls: .waterfalls
        case .lakes: .lakes
        case .peaks: .peaks
        case .huts: .huts
        case .landmarks: .landmarks
        }
    }

    private static func coreExperience(
        _ experience: OnboardingView.Draft.RequestedExperience
    ) -> HikingRequestedExperienceV1 {
        switch experience {
        case .viewpoints: .viewpoints
        case .forest: .forest
        case .quietNature: .quietNature
        case .waterfalls: .waterfalls
        case .lakes: .lakes
        case .peaks: .peaks
        case .huts: .huts
        case .landmarks: .landmarks
        }
    }
}
