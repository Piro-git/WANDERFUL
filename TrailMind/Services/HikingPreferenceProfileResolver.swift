import Foundation

nonisolated enum HikingExplicitRequestValueV1<Value: Hashable & Sendable>: Hashable, Sendable {
    /// The current request did not mention this field, so a profile default may apply.
    case omitted
    /// The user explicitly supplied this value in the current request.
    case specified(Value)
    /// The user explicitly asked the planner not to apply a stored preference.
    case noPreference
}

nonisolated struct HikingExplicitRouteRequestV1: Hashable, Sendable {
    var activity: HikingExplicitRequestValueV1<HikingProfileActivityV1>
    var comfortableOuting: HikingExplicitRequestValueV1<HikingComfortableOutingV1>
    var routeShape: HikingExplicitRequestValueV1<HikingPreferredRouteShapeV1>
    var requestedExperiences: HikingExplicitRequestValueV1<[HikingRequestedExperienceV1]>
    var softAvoidances: HikingExplicitRequestValueV1<[HikingSoftAvoidanceV1]>

    init(
        activity: HikingExplicitRequestValueV1<HikingProfileActivityV1> = .omitted,
        comfortableOuting: HikingExplicitRequestValueV1<HikingComfortableOutingV1> = .omitted,
        routeShape: HikingExplicitRequestValueV1<HikingPreferredRouteShapeV1> = .omitted,
        requestedExperiences: HikingExplicitRequestValueV1<[HikingRequestedExperienceV1]> = .omitted,
        softAvoidances: HikingExplicitRequestValueV1<[HikingSoftAvoidanceV1]> = .omitted
    ) {
        self.activity = activity
        self.comfortableOuting = comfortableOuting
        self.routeShape = routeShape
        self.requestedExperiences = requestedExperiences
        self.softAvoidances = softAvoidances
    }
}

nonisolated struct HikingProfileEngineFallbacksV1: Hashable, Sendable {
    var activity: HikingProfileActivityV1?
    var comfortableOuting: HikingComfortableOutingV1?
    var routeShape: HikingPreferredRouteShapeV1?
    var requestedExperiences: [HikingRequestedExperienceV1]?
    var softAvoidances: [HikingSoftAvoidanceV1]?

    init(
        activity: HikingProfileActivityV1? = nil,
        comfortableOuting: HikingComfortableOutingV1? = nil,
        routeShape: HikingPreferredRouteShapeV1? = nil,
        requestedExperiences: [HikingRequestedExperienceV1]? = nil,
        softAvoidances: [HikingSoftAvoidanceV1]? = nil
    ) {
        self.activity = activity
        self.comfortableOuting = comfortableOuting
        self.routeShape = routeShape
        self.requestedExperiences = requestedExperiences
        self.softAvoidances = softAvoidances
    }
}

nonisolated enum HikingPreferenceValueSourceV1: String, Hashable, Sendable {
    case explicitRequest = "explicit_request"
    case explicitNoPreference = "explicit_no_preference"
    case profileDefault = "profile_default"
    case engineFallback = "engine_fallback"
    case absent
}

nonisolated struct HikingResolvedPreferenceV1<Value: Hashable & Sendable>: Hashable, Sendable {
    let value: Value?
    let source: HikingPreferenceValueSourceV1
}

nonisolated struct HikingResolvedProfileDefaultsV1: Hashable, Sendable {
    let activity: HikingResolvedPreferenceV1<HikingProfileActivityV1>
    let comfortableOuting: HikingResolvedPreferenceV1<HikingComfortableOutingV1>
    let routeShape: HikingResolvedPreferenceV1<HikingPreferredRouteShapeV1>
    let requestedExperiences: HikingResolvedPreferenceV1<[HikingRequestedExperienceV1]>
    let softAvoidances: HikingResolvedPreferenceV1<[HikingSoftAvoidanceV1]>
}

/// Resolves each field independently using the strict order:
/// explicit request > profile default > engine fallback > absent.
/// `noPreference` suppresses the stored profile. For collection fields it
/// resolves to an explicit empty array; required scalar fields may still use
/// an engine fallback so the routing request remains valid.
nonisolated struct HikingProfileDefaultResolverV1: Sendable {
    func resolve(
        explicitRequest suppliedExplicitRequest: HikingExplicitRouteRequestV1,
        profile suppliedProfile: HikingPreferenceProfileV1?,
        engineFallbacks suppliedFallbacks: HikingProfileEngineFallbacksV1 = HikingProfileEngineFallbacksV1()
    ) throws -> HikingResolvedProfileDefaultsV1 {
        let profile = try suppliedProfile.map(HikingPreferenceProfileValidatorV1.canonicalized)
        let explicitRequest = try canonicalExplicitRequest(suppliedExplicitRequest)
        let fallbacks = try canonicalFallbacks(suppliedFallbacks)

        return HikingResolvedProfileDefaultsV1(
            activity: resolveScalar(
                explicitRequest.activity,
                profileValue: profile?.defaultActivity,
                fallbackValue: fallbacks.activity
            ),
            comfortableOuting: resolveScalar(
                explicitRequest.comfortableOuting,
                profileValue: profile?.comfortableOuting,
                fallbackValue: fallbacks.comfortableOuting
            ),
            routeShape: resolveScalar(
                explicitRequest.routeShape,
                profileValue: profile?.preferredRouteShape,
                fallbackValue: fallbacks.routeShape
            ),
            requestedExperiences: resolveCollection(
                explicitRequest.requestedExperiences,
                profileValue: profile?.requestedExperiences,
                fallbackValue: fallbacks.requestedExperiences
            ),
            softAvoidances: resolveCollection(
                explicitRequest.softAvoidances,
                profileValue: profile?.softAvoidances,
                fallbackValue: fallbacks.softAvoidances
            )
        )
    }

    private func resolveScalar<Value: Hashable & Sendable>(
        _ explicit: HikingExplicitRequestValueV1<Value>,
        profileValue: Value?,
        fallbackValue: Value?
    ) -> HikingResolvedPreferenceV1<Value> {
        switch explicit {
        case let .specified(value):
            return HikingResolvedPreferenceV1(value: value, source: .explicitRequest)
        case .noPreference:
            return HikingResolvedPreferenceV1(
                value: fallbackValue,
                source: .explicitNoPreference
            )
        case .omitted:
            if let profileValue {
                return HikingResolvedPreferenceV1(value: profileValue, source: .profileDefault)
            }
            if let fallbackValue {
                return HikingResolvedPreferenceV1(value: fallbackValue, source: .engineFallback)
            }
            return HikingResolvedPreferenceV1(value: nil, source: .absent)
        }
    }

    private func resolveCollection<Value: Hashable & Sendable>(
        _ explicit: HikingExplicitRequestValueV1<[Value]>,
        profileValue: [Value]?,
        fallbackValue: [Value]?
    ) -> HikingResolvedPreferenceV1<[Value]> {
        switch explicit {
        case let .specified(value):
            return HikingResolvedPreferenceV1(value: value, source: .explicitRequest)
        case .noPreference:
            return HikingResolvedPreferenceV1(value: [], source: .explicitNoPreference)
        case .omitted:
            if let profileValue {
                return HikingResolvedPreferenceV1(value: profileValue, source: .profileDefault)
            }
            if let fallbackValue {
                return HikingResolvedPreferenceV1(value: fallbackValue, source: .engineFallback)
            }
            return HikingResolvedPreferenceV1(value: nil, source: .absent)
        }
    }

    private func canonicalExplicitRequest(
        _ request: HikingExplicitRouteRequestV1
    ) throws -> HikingExplicitRouteRequestV1 {
        let validationProfile = HikingPreferenceProfileV1(
            defaultActivity: request.activity.specifiedValue,
            comfortableOuting: request.comfortableOuting.specifiedValue,
            preferredRouteShape: request.routeShape.specifiedValue,
            requestedExperiences: request.requestedExperiences.specifiedValue,
            softAvoidances: request.softAvoidances.specifiedValue
        )
        let canonical = try HikingPreferenceProfileValidatorV1.canonicalized(validationProfile)
        var result = request
        if case .specified = request.requestedExperiences {
            result.requestedExperiences = .specified(canonical.requestedExperiences ?? [])
        }
        if case .specified = request.softAvoidances {
            result.softAvoidances = .specified(canonical.softAvoidances ?? [])
        }
        return result
    }

    private func canonicalFallbacks(
        _ fallbacks: HikingProfileEngineFallbacksV1
    ) throws -> HikingProfileEngineFallbacksV1 {
        let validationProfile = HikingPreferenceProfileV1(
            defaultActivity: fallbacks.activity,
            comfortableOuting: fallbacks.comfortableOuting,
            preferredRouteShape: fallbacks.routeShape,
            requestedExperiences: fallbacks.requestedExperiences,
            softAvoidances: fallbacks.softAvoidances
        )
        let canonical = try HikingPreferenceProfileValidatorV1.canonicalized(validationProfile)
        return HikingProfileEngineFallbacksV1(
            activity: canonical.defaultActivity,
            comfortableOuting: canonical.comfortableOuting,
            routeShape: canonical.preferredRouteShape,
            requestedExperiences: canonical.requestedExperiences,
            softAvoidances: canonical.softAvoidances
        )
    }
}

nonisolated private extension HikingExplicitRequestValueV1 {
    var specifiedValue: Value? {
        guard case let .specified(value) = self else { return nil }
        return value
    }
}

nonisolated enum HikingProfilePlanningGapV1: Hashable, Sendable {
    case comfortableOutingRangeReducedToMidpoint(HikingComfortBasisV1)
    case unsupportedRequestedExperience(HikingRequestedExperienceV1)
    case pointToPointRequiresDestination
}

@MainActor
struct HikingProfileRoutePlanningAdaptationV1 {
    let request: RoutePlanningRequest
    let resolvedDefaults: HikingResolvedProfileDefaultsV1
    let gaps: [HikingProfilePlanningGapV1]
}

/// Pure planner adapter. It does not geocode, route, or perform network work.
/// The caller must supply explicitness captured before parser/engine defaults
/// are applied; otherwise those defaults cannot be distinguished from a
/// user's current request.
@MainActor
struct HikingProfileRoutePlanningAdapterV1 {
    private let resolver: HikingProfileDefaultResolverV1

    init(resolver: HikingProfileDefaultResolverV1 = HikingProfileDefaultResolverV1()) {
        self.resolver = resolver
    }

    func adapt(
        baseRequest: RoutePlanningRequest,
        explicitRequest: HikingExplicitRouteRequestV1,
        profile: HikingPreferenceProfileV1?
    ) throws -> HikingProfileRoutePlanningAdaptationV1 {
        let baseComfort: HikingComfortableOutingV1?
        if let duration = baseRequest.targetDurationMinutes {
            baseComfort = .durationMinutes(minimum: duration, maximum: duration)
        } else if let distance = baseRequest.targetDistanceKm {
            baseComfort = .distanceKilometers(minimum: distance, maximum: distance)
        } else {
            baseComfort = nil
        }

        let resolved = try resolver.resolve(
            explicitRequest: explicitRequest,
            profile: profile,
            engineFallbacks: HikingProfileEngineFallbacksV1(
                activity: HikingProfileActivityV1(baseRequest.activityType),
                comfortableOuting: baseComfort,
                routeShape: HikingPreferredRouteShapeV1(baseRequest.routeType)
            )
        )

        var activity = baseRequest.activityType
        var graphHopperProfile = baseRequest.graphHopperProfile
        if resolved.activity.source == .profileDefault,
           let resolvedActivity = resolved.activity.value {
            activity = resolvedActivity.activityType
            graphHopperProfile = graphHopperProfileName(for: activity)
        }

        var routeType = baseRequest.routeType
        var gaps: [HikingProfilePlanningGapV1] = []
        if resolved.routeShape.source == .profileDefault,
           let routeShape = resolved.routeShape.value {
            if routeShape == .pointToPoint && baseRequest.endQuery == nil {
                gaps.append(.pointToPointRequiresDestination)
            } else {
                routeType = routeShape.routeType
            }
        }

        var targetDistance = baseRequest.targetDistanceKm
        var targetDuration = baseRequest.targetDurationMinutes
        if resolved.comfortableOuting.source == .profileDefault {
            switch resolved.comfortableOuting.value {
            case let .distanceKilometers(minimum, maximum):
                targetDistance = (minimum + maximum) / 2
                targetDuration = nil
                if minimum != maximum {
                    gaps.append(.comfortableOutingRangeReducedToMidpoint(.distanceKilometers))
                }
            case let .durationMinutes(minimum, maximum):
                targetDistance = nil
                targetDuration = Int((Double(minimum + maximum) / 2).rounded())
                if minimum != maximum {
                    gaps.append(.comfortableOutingRangeReducedToMidpoint(.durationMinutes))
                }
            case nil:
                break
            }
        }

        var desiredFeatures = baseRequest.desiredFeatures
        if resolved.requestedExperiences.source == .explicitNoPreference {
            desiredFeatures = []
        } else if resolved.requestedExperiences.source == .profileDefault,
                  let experiences = resolved.requestedExperiences.value {
            desiredFeatures = experiences.compactMap { experience in
                switch experience {
                case .viewpoints:
                    return .viewpoint
                case .forest:
                    return .forest
                case .quietNature:
                    return .quiet
                case .waterfalls, .lakes, .peaks, .huts, .landmarks:
                    gaps.append(.unsupportedRequestedExperience(experience))
                    return nil
                }
            }
        }

        var avoidFeatures = baseRequest.avoidFeatures
        if resolved.softAvoidances.source == .explicitNoPreference {
            avoidFeatures = []
        } else if resolved.softAvoidances.source == .profileDefault,
                  let avoidances = resolved.softAvoidances.value {
            avoidFeatures = avoidances.map { avoidance in
                switch avoidance {
                case .steepClimbs: .steepClimbs
                case .majorRoads: .majorRoads
                case .repeatedSections: .repeatedPath
                }
            }
        }

        let adaptedRequest = RoutePlanningRequest(
            routeType: routeType,
            startQuery: baseRequest.startQuery,
            endQuery: routeType == .loop ? nil : baseRequest.endQuery,
            activityType: activity,
            graphHopperProfile: graphHopperProfile,
            targetDistanceKm: targetDistance,
            targetDurationMinutes: targetDuration,
            difficulty: baseRequest.difficulty,
            desiredFeatures: desiredFeatures,
            avoidFeatures: avoidFeatures
        )
        return HikingProfileRoutePlanningAdaptationV1(
            request: adaptedRequest,
            resolvedDefaults: resolved,
            gaps: gaps
        )
    }

    func adapt(
        baseRequest: RoutePlanningRequest,
        validatedIntent: ValidatedAdventureIntent,
        profile: HikingPreferenceProfileV1?
    ) throws -> HikingProfileRoutePlanningAdaptationV1 {
        try adapt(
            baseRequest: baseRequest,
            explicitRequest: HikingExplicitRouteRequestV1(
                activity: explicitScalar(
                    validatedIntent.preferenceExplicitness.activity,
                    value: HikingProfileActivityV1(validatedIntent.activityType)
                ),
                comfortableOuting: explicitComfort(
                    validatedIntent.preferenceExplicitness.comfortableOuting,
                    intent: validatedIntent
                ),
                routeShape: explicitRouteShape(
                    validatedIntent.preferenceExplicitness.routeShape,
                    routeType: validatedIntent.routeType
                ),
                requestedExperiences: explicitCollectionMarker(
                    validatedIntent.preferenceExplicitness.requestedExperiences
                ),
                softAvoidances: explicitCollectionMarker(
                    validatedIntent.preferenceExplicitness.softAvoidances
                )
            ),
            profile: profile
        )
    }

    private func explicitScalar<Value: Hashable & Sendable>(
        _ state: AdventureIntentPreferenceFieldStateV1,
        value: Value
    ) -> HikingExplicitRequestValueV1<Value> {
        switch state {
        case .omitted: .omitted
        case .specified: .specified(value)
        case .noPreference: .noPreference
        }
    }

    private func explicitComfort(
        _ state: AdventureIntentPreferenceFieldStateV1,
        intent: ValidatedAdventureIntent
    ) -> HikingExplicitRequestValueV1<HikingComfortableOutingV1> {
        switch state {
        case .omitted:
            return .omitted
        case .noPreference:
            return .noPreference
        case .specified:
            if let duration = intent.targetDurationMinutes {
                return .specified(.durationMinutes(minimum: duration, maximum: duration))
            }
            if let distance = intent.targetDistanceKm {
                return .specified(.distanceKilometers(minimum: distance, maximum: distance))
            }
            // A malformed "specified" marker must suppress the profile rather
            // than guessing a value for the current request.
            return .noPreference
        }
    }

    private func explicitRouteShape(
        _ state: AdventureIntentPreferenceFieldStateV1,
        routeType: TrailRouteType
    ) -> HikingExplicitRequestValueV1<HikingPreferredRouteShapeV1> {
        switch state {
        case .omitted:
            return .omitted
        case .noPreference:
            return .noPreference
        case .specified:
            guard let routeShape = HikingPreferredRouteShapeV1(routeType) else {
                return .noPreference
            }
            return .specified(routeShape)
        }
    }

    private func explicitCollectionMarker<Value: Hashable & Sendable>(
        _ state: AdventureIntentPreferenceFieldStateV1
    ) -> HikingExplicitRequestValueV1<[Value]> {
        switch state {
        case .omitted: .omitted
        case .specified: .specified([])
        case .noPreference: .noPreference
        }
    }

    private func graphHopperProfileName(for activity: ActivityType) -> String {
        switch activity {
        case .biking: "bike"
        case .hiking, .trailRunning: "foot"
        }
    }
}
