import Foundation

enum ResearchResultKind: Equatable, Sendable {
  case researchGuided
  case researchGuidedPartial
  case standardRouteFallback
  case standardRoute
  case clarification
  case unsupported

  var isResearchGuided: Bool {
    self == .researchGuided || self == .researchGuidedPartial
  }
}

struct ResearchRouteBadge: Equatable, Sendable {
  let title: String
  let symbol: String
}

struct ResearchRouteCardFact: Identifiable, Equatable, Sendable {
  enum Code: String, Sendable {
    case verifiedHighlights
    case highlightCategories
    case partialCoverage
  }

  let code: Code
  let title: String
  let symbol: String

  var id: Code { code }
}

struct ResearchFitReason: Identifiable, Equatable, Sendable {
  enum Code: String, Sendable {
    case mustHaveHighlights
    case verifiedHighlights
    case routeShape
    case distanceMatch
    case durationMatch
    case lowerClimb
    case shorterDuration
  }

  let code: Code
  let title: String
  let detail: String?
  let symbol: String

  var id: Code { code }
}

struct ResearchHighlightPresentation: Identifiable, Equatable, Sendable {
  let id: Int
  let title: String
  let categoryLabel: String
  let evidenceLabel: String
  let symbol: String
  let isMustHave: Bool
}

struct ResearchLimitationPresentation: Identifiable, Equatable, Sendable {
  enum Code: String, Sendable {
    case access
    case accessRestriction
    case closure
    case opening
    case overnightLegality
    case water
    case currentConditions
    case staleSource
    case unknownFreshness
    case conflictingOfficialInformation
    case mappedPresenceOnly
    case terrainDerivedOnly
    case partialCoverage
    case officialRouteStatus
    case mappedNetworkConnection
    case insufficientEvidence
    case trailDifficulty
    case trailVisibility
    case exposure
    case steepSections
    case bookability
    case seasonalStatus
    case transport
    case mobilitySuitability
    case childSuitability
    case beginnerSuitability
    case unconnectedHighlight
    case researchAttempt
    case scenicQuality
    case technicalDifficulty
    case unsupportedEvidence
    case partialResult
  }

  enum Priority: Int, Comparable, Sendable {
    case high = 0
    case medium = 1
    case low = 2

    static func < (lhs: Priority, rhs: Priority) -> Bool {
      lhs.rawValue < rhs.rawValue
    }
  }

  let code: Code
  let title: String
  let symbol: String
  let priority: Priority

  var id: Code { code }
}

struct ResearchEvidenceSummary: Equatable, Sendable {
  let title: String
  let detail: String
  let coverageLabel: String?
  let symbol: String
}

struct ResearchRoutePresentation: Equatable, Sendable {
  static let maximumCardFactCount = 3
  static let maximumFitReasonCount = 5
  static let maximumHighlightCount = 6
  static let maximumLimitationCount = 12
  static let initialLimitationCount = 3

  let kind: ResearchResultKind
  let badge: ResearchRouteBadge?
  let cardFacts: [ResearchRouteCardFact]
  let fitReasons: [ResearchFitReason]
  let highlights: [ResearchHighlightPresentation]
  let limitations: [ResearchLimitationPresentation]
  let evidenceSummary: ResearchEvidenceSummary

  var initiallyVisibleLimitations: [ResearchLimitationPresentation] {
    Array(limitations.prefix(Self.initialLimitationCount))
  }

  var hasAdditionalLimitations: Bool {
    limitations.count > Self.initialLimitationCount
  }
}

struct ResearchClarificationPresentation: Equatable, Sendable {
  static let maximumQuestionCount = 4

  let title: String
  let rationale: String
  let questions: [String]
}

enum ResearchPresentationProjector {
  static func routePresentations(
    suggestions: [RouteSuggestion],
    context: PlannerViewModel.ResearchPlanningContext?
  ) -> [UUID: ResearchRoutePresentation] {
    guard let context else { return [:] }

    var output: [UUID: ResearchRoutePresentation] = [:]
    for suggestion in suggestions {
      if let presentation = routePresentation(
        suggestion: suggestion,
        allSuggestions: suggestions,
        context: context
      ) {
        output[suggestion.id] = presentation
      }
    }
    return output
  }

  static func routePresentation(
    suggestion: RouteSuggestion,
    allSuggestions: [RouteSuggestion],
    context: PlannerViewModel.ResearchPlanningContext
  ) -> ResearchRoutePresentation? {
    guard suggestion.route.isVerifiedRoutedResult else { return nil }

    switch context.outcome {
    case .legacyFallback:
      return fallbackPresentation()

    case .routed, .partial:
      guard
        let sidecar =
          context.alternativesBySuggestionID[suggestion.id]
      else {
        return nil
      }
      return guidedPresentation(
        suggestion: suggestion,
        allSuggestions: allSuggestions,
        context: context,
        sidecar: sidecar
      )
    }
  }

  static func clarificationPresentation(
    context: PlannerViewModel.ResearchClarificationContext?
  ) -> ResearchClarificationPresentation? {
    guard let context else { return nil }

    let questions = unique(
      context.questions.compactMap(questionText)
    )
    guard !questions.isEmpty else { return nil }

    let hasLocationQuestion = context.questions.contains {
      $0.field == .geographicAnchor
    }
    return ResearchClarificationPresentation(
      title: "Research needs one more detail",
      rationale: hasLocationQuestion
        ? "A precise starting place helps Wanderful research places that can connect to a real routed option."
        : "This detail keeps requested preferences separate from information Wanderful can actually verify.",
      questions: Array(
        questions.prefix(
          ResearchClarificationPresentation.maximumQuestionCount
        )
      )
    )
  }
}

extension ResearchPresentationProjector {
  fileprivate static func guidedPresentation(
    suggestion: RouteSuggestion,
    allSuggestions: [RouteSuggestion],
    context: PlannerViewModel.ResearchPlanningContext,
    sidecar: PlannerViewModel.ResearchPlanningContext.AlternativeSidecar
  ) -> ResearchRoutePresentation {
    let isPartial: Bool
    switch context.outcome {
    case .partial:
      isPartial = true
    case .routed, .legacyFallback:
      isPartial = false
    }

    let selectedWaypoints = uniqueWaypoints(
      sidecar.researchProvenance.selectedWaypoints
    )
    let reachedEntityIDs = Set(
      sidecar.waypointVisits.compactMap { visit -> UUID? in
        guard visit.isResearchWaypointReached else { return nil }
        return visit.entityID
      }
    )
    let reachedWaypoints = selectedWaypoints.filter {
      reachedEntityIDs.contains($0.entityID)
    }
    let highlights = highlightPresentations(for: reachedWaypoints)
    let missedWaypointCount = max(
      0,
      selectedWaypoints.count - reachedWaypoints.count
    )

    let limitations = limitationPresentations(
      context: context,
      provenance: sidecar.researchProvenance,
      missedWaypointCount: missedWaypointCount,
      isPartial: isPartial
    )
    let kind: ResearchResultKind =
      isPartial ? .researchGuidedPartial : .researchGuided

    return ResearchRoutePresentation(
      kind: kind,
      badge: ResearchRouteBadge(
        title: "Researched route",
        symbol: "books.vertical.fill"
      ),
      cardFacts: cardFacts(
        highlights: highlights,
        isPartial: isPartial
      ),
      fitReasons: fitReasons(
        suggestion: suggestion,
        allSuggestions: allSuggestions,
        reachedWaypoints: reachedWaypoints
      ),
      highlights: Array(
        highlights.prefix(
          ResearchRoutePresentation.maximumHighlightCount
        )
      ),
      limitations: Array(
        limitations.prefix(
          ResearchRoutePresentation.maximumLimitationCount
        )
      ),
      evidenceSummary: ResearchEvidenceSummary(
        title: "Research-guided route",
        detail:
          "Based on mapped trails and researched places. Route geometry and statistics come from a verified routed result.",
        coverageLabel: isPartial || !limitations.isEmpty
          ? "Mapped research: partial"
          : "Mapped research: available",
        symbol: "books.vertical.fill"
      )
    )
  }

  fileprivate static func fallbackPresentation() -> ResearchRoutePresentation {
    ResearchRoutePresentation(
      kind: .standardRouteFallback,
      badge: nil,
      cardFacts: [],
      fitReasons: [],
      highlights: [],
      limitations: [],
      evidenceSummary: ResearchEvidenceSummary(
        title: "Standard routed option",
        detail:
          "This is a real routed option. Research matching was unavailable, so requested experiences were not verified against researched places.",
        coverageLabel: nil,
        symbol: "point.bottomleft.forward.to.point.topright.scurvepath"
      )
    )
  }

  fileprivate static func cardFacts(
    highlights: [ResearchHighlightPresentation],
    isPartial: Bool
  ) -> [ResearchRouteCardFact] {
    var facts: [ResearchRouteCardFact] = []

    if !highlights.isEmpty {
      let count = highlights.count
      facts.append(
        ResearchRouteCardFact(
          code: .verifiedHighlights,
          title: count == 1
            ? "Built around 1 on-route highlight"
            : "Built around \(count) on-route highlights",
          symbol: "mappin.and.ellipse"
        )
      )

      let categories = unique(highlights.map(\.categoryLabel))
      if !categories.isEmpty {
        facts.append(
          ResearchRouteCardFact(
            code: .highlightCategories,
            title: "Includes \(naturalLanguageList(categories))",
            symbol: "checkmark.circle.fill"
          )
        )
      }
    }

    if isPartial {
      facts.append(
        ResearchRouteCardFact(
          code: .partialCoverage,
          title: "Some preferences unverified",
          symbol: "info.circle.fill"
        )
      )
    }

    return Array(
      facts.prefix(ResearchRoutePresentation.maximumCardFactCount)
    )
  }

  fileprivate static func fitReasons(
    suggestion: RouteSuggestion,
    allSuggestions: [RouteSuggestion],
    reachedWaypoints: [ResearchSelectedWaypointV1]
  ) -> [ResearchFitReason] {
    let route = suggestion.route
    var reasons: [ResearchFitReason] = []

    let mustHaveWaypoints = reachedWaypoints.filter {
      $0.role == .mustHave
    }
    if !mustHaveWaypoints.isEmpty {
      let categories = unique(
        mustHaveWaypoints.map { categoryLabel($0.highlightCategory) }
      )
      reasons.append(
        ResearchFitReason(
          code: .mustHaveHighlights,
          title: mustHaveWaypoints.count == 1
            ? "Includes a requested must-have highlight"
            : "Includes \(mustHaveWaypoints.count) requested must-have highlights",
          detail: categories.isEmpty
            ? nil
            : naturalLanguageList(categories),
          symbol: "star.fill"
        )
      )
    }

    let secondaryWaypoints = reachedWaypoints.filter {
      $0.role != .mustHave
    }
    if !secondaryWaypoints.isEmpty || mustHaveWaypoints.isEmpty && !reachedWaypoints.isEmpty {
      let presentedWaypoints =
        mustHaveWaypoints.isEmpty
        ? reachedWaypoints
        : secondaryWaypoints
      let categories = unique(
        presentedWaypoints.map {
          categoryLabel($0.highlightCategory)
        }
      )
      reasons.append(
        ResearchFitReason(
          code: .verifiedHighlights,
          title: presentedWaypoints.count == 1
            ? "A researched highlight lies on the routed path"
            : "\(presentedWaypoints.count) researched highlights lie on the routed path",
          detail: categories.isEmpty
            ? nil
            : naturalLanguageList(categories),
          symbol: "mappin.and.ellipse"
        )
      )
    }

    reasons.append(
      ResearchFitReason(
        code: .routeShape,
        title: route.routeType == .loop
          ? "Built as a \(route.activity.rawValue.lowercased()) loop"
          : "Built for \(route.activity.rawValue.lowercased())",
        detail: route.routeType == .loop
          ? "The verified route returns to its start point."
          : "The route shape matches the selected activity.",
        symbol: route.routeType == .loop
          ? "arrow.trianglehead.2.clockwise.rotate.90"
          : route.activity.symbol
      )
    )

    if let distanceReason = distanceReason(
      for: suggestion,
      allSuggestions: allSuggestions
    ) {
      reasons.append(distanceReason)
    }

    if let durationReason = durationReason(
      for: suggestion,
      allSuggestions: allSuggestions
    ) {
      reasons.append(durationReason)
    }

    if reasons.count < ResearchRoutePresentation.maximumFitReasonCount,
      let comparisonReason = comparisonReason(
        for: suggestion,
        allSuggestions: allSuggestions
      )
    {
      reasons.append(comparisonReason)
    }

    return Array(
      deduplicatedReasons(reasons).prefix(
        ResearchRoutePresentation.maximumFitReasonCount
      )
    )
  }

  fileprivate static func distanceReason(
    for suggestion: RouteSuggestion,
    allSuggestions: [RouteSuggestion]
  ) -> ResearchFitReason? {
    let route = suggestion.route
    guard
      let target = route.planningMetadata?.targetDistanceKm,
      target > 0
    else {
      return nil
    }

    let difference = abs(route.distanceKilometers - target)
    let eligible = allSuggestions.filter {
      $0.route.planningMetadata?.targetDistanceKm == target
    }
    let isUniqueClosest = isUniqueMinimum(
      value: difference,
      among: eligible.map {
        abs($0.route.distanceKilometers - target)
      }
    )
    return ResearchFitReason(
      code: .distanceMatch,
      title: difference < 0.05
        ? "Matches your requested distance"
        : isUniqueClosest && eligible.count > 1
          ? "Closest available option to your requested distance"
          : "\(distanceLabel(difference)) from your requested distance",
      detail:
        "Actual \(distanceLabel(route.distanceKilometers)) versus requested \(distanceLabel(target)).",
      symbol: "ruler"
    )
  }

  fileprivate static func durationReason(
    for suggestion: RouteSuggestion,
    allSuggestions: [RouteSuggestion]
  ) -> ResearchFitReason? {
    let route = suggestion.route
    guard
      let target = route.planningMetadata?.targetDurationMinutes,
      target > 0
    else {
      return nil
    }

    let difference = abs(route.durationMinutes - target)
    let eligible = allSuggestions.filter {
      $0.route.planningMetadata?.targetDurationMinutes == target
    }
    let isUniqueClosest = isUniqueMinimum(
      value: Double(difference),
      among: eligible.map {
        Double(abs($0.route.durationMinutes - target))
      }
    )
    return ResearchFitReason(
      code: .durationMatch,
      title: difference == 0
        ? "Matches your requested duration"
        : isUniqueClosest && eligible.count > 1
          ? "Closest available option to your requested duration"
          : "\(durationLabel(difference)) from your requested duration",
      detail:
        "Actual \(durationLabel(route.durationMinutes)) versus requested \(durationLabel(target)).",
      symbol: "clock"
    )
  }

  fileprivate static func comparisonReason(
    for suggestion: RouteSuggestion,
    allSuggestions: [RouteSuggestion]
  ) -> ResearchFitReason? {
    guard allSuggestions.count > 1 else { return nil }
    let route = suggestion.route

    if isUniqueMinimum(
      value: Double(route.elevationGainMeters),
      among: allSuggestions.map {
        Double($0.route.elevationGainMeters)
      }
    ) {
      return ResearchFitReason(
        code: .lowerClimb,
        title: "Lowest climb of the available options",
        detail: "\(route.elevationGainMeters.formatted()) m of verified route ascent.",
        symbol: "mountain.2.fill"
      )
    }

    if isUniqueMinimum(
      value: route.durationHours,
      among: allSuggestions.map(\.route.durationHours)
    ) {
      return ResearchFitReason(
        code: .shorterDuration,
        title: "Shortest duration of the available options",
        detail: route.durationLabel,
        symbol: "clock.fill"
      )
    }
    return nil
  }

  fileprivate static func highlightPresentations(
    for waypoints: [ResearchSelectedWaypointV1]
  ) -> [ResearchHighlightPresentation] {
    waypoints.enumerated().map { index, waypoint in
      let category = categoryLabel(waypoint.highlightCategory)
      let isMappedOnly = waypoint.knownLimitations.contains(
        .mappedPresenceOnly
      )
      return ResearchHighlightPresentation(
        id: index,
        title: category.capitalized,
        categoryLabel: category,
        evidenceLabel: isMappedOnly
          ? "Mapped place on this routed path"
          : "Researched place on this routed path",
        symbol: categorySymbol(waypoint.highlightCategory),
        isMustHave: waypoint.role == .mustHave
      )
    }
  }

  fileprivate static func limitationPresentations(
    context: PlannerViewModel.ResearchPlanningContext,
    provenance: ResearchRouteProvenanceV1,
    missedWaypointCount: Int,
    isPartial: Bool
  ) -> [ResearchLimitationPresentation] {
    var indexed: [(Int, ResearchLimitationPresentation)] = []
    var insertionIndex = 0

    func append(_ limitation: ResearchLimitationPresentation?) {
      guard let limitation else { return }
      indexed.append((insertionIndex, limitation))
      insertionIndex += 1
    }

    for gap in context.backendPlanningGaps {
      append(planningGapLimitation(gap))
    }
    for gap in context.adapterGaps {
      append(adapterGapLimitation(gap))
    }
    for limitation in provenance.knownLimitations {
      append(knownLimitation(limitation))
    }
    for rawValue in context.remainingLimitations {
      append(rawLimitation(rawValue))
    }
    for verification in provenance.requiredVerification {
      append(verificationLimitation(verification))
    }

    if missedWaypointCount > 0 {
      append(
        limitation(
          code: .unconnectedHighlight,
          title: missedWaypointCount == 1
            ? "One requested highlight could not be confirmed on the routed path."
            : "\(missedWaypointCount) requested highlights could not be confirmed on the routed path.",
          symbol: "point.3.connected.trianglepath.dotted",
          priority: .medium
        )
      )
    }

    if isPartial {
      append(
        limitation(
          code: .partialResult,
          title: "Some requested preferences could not be confirmed.",
          symbol: "info.circle.fill",
          priority: .low
        )
      )
    }

    var seen: Set<ResearchLimitationPresentation.Code> = []
    return
      indexed
      .sorted { left, right in
        if left.1.priority != right.1.priority {
          return left.1.priority < right.1.priority
        }
        return left.0 < right.0
      }
      .compactMap { _, value in
        guard seen.insert(value.code).inserted else { return nil }
        return value
      }
  }

  fileprivate static func knownLimitation(
    _ value: ResearchKnownLimitationV1
  ) -> ResearchLimitationPresentation? {
    switch value {
    case .accessUnverified:
      limitation(
        code: .access,
        title: "Official access information wasn’t available.",
        symbol: "figure.walk.diamond.fill",
        priority: .high
      )
    case .accessRestrictionUnverified:
      limitation(
        code: .accessRestriction,
        title: "Access restrictions weren’t verified.",
        symbol: "hand.raised.fill",
        priority: .high
      )
    case .openingUnverified:
      limitation(
        code: .opening,
        title: "Current opening status wasn’t verified.",
        symbol: "door.left.hand.closed",
        priority: .high
      )
    case .overnightLegalityUnverified:
      limitation(
        code: .overnightLegality,
        title: "Overnight legality wasn’t verified.",
        symbol: "moon.stars.fill",
        priority: .high
      )
    case .waterAvailabilityUnverified:
      limitation(
        code: .water,
        title: "Water availability wasn’t verified.",
        symbol: "drop.fill",
        priority: .high
      )
    case .currentConditionsUnavailable:
      limitation(
        code: .currentConditions,
        title: "Current trail conditions weren’t available.",
        symbol: "clock.badge.questionmark",
        priority: .high
      )
    case .sourceStale:
      limitation(
        code: .staleSource,
        title: "Some research information may be out of date.",
        symbol: "clock.arrow.circlepath",
        priority: .high
      )
    case .sourceTimestampUnavailable:
      limitation(
        code: .unknownFreshness,
        title: "Information freshness could not be verified.",
        symbol: "calendar.badge.questionmark",
        priority: .high
      )
    case .conflictingAuthoritativeEvidence:
      limitation(
        code: .conflictingOfficialInformation,
        title: "Available official information conflicted.",
        symbol: "arrow.triangle.branch",
        priority: .high
      )
    case .mappedPresenceOnly:
      limitation(
        code: .mappedPresenceOnly,
        title: "Highlighted places are mapped, but current status wasn’t verified.",
        symbol: "map.fill",
        priority: .medium
      )
    case .terrainDerivedOnly:
      limitation(
        code: .terrainDerivedOnly,
        title: "Terrain information was derived, not current on-site information.",
        symbol: "mountain.2.fill",
        priority: .medium
      )
    case .partialRegionalCoverage:
      limitation(
        code: .partialCoverage,
        title: "Research coverage is limited in this area.",
        symbol: "map.circle.fill",
        priority: .medium
      )
    case .officialStatusUnverified:
      limitation(
        code: .officialRouteStatus,
        title: "Official route status wasn’t verified.",
        symbol: "checkmark.seal",
        priority: .high
      )
    case .routeConnectionUnverified:
      limitation(
        code: .mappedNetworkConnection,
        title: "Mapped hiking-network context wasn’t verified.",
        symbol: "point.3.connected.trianglepath.dotted",
        priority: .medium
      )
    case .insufficientEvidence:
      limitation(
        code: .insufficientEvidence,
        title: "Some requested preferences could not be confirmed.",
        symbol: "questionmark.circle.fill",
        priority: .medium
      )
    case .trailDifficultyUnverified:
      limitation(
        code: .trailDifficulty,
        title: "Technical trail difficulty wasn’t verified.",
        symbol: "mountain.2.fill",
        priority: .high
      )
    case .exposureUnverified:
      limitation(
        code: .exposure,
        title: "Exposed terrain wasn’t verified.",
        symbol: "wind",
        priority: .high
      )
    case .bookabilityUnverified:
      limitation(
        code: .bookability,
        title: "Booking availability wasn’t verified.",
        symbol: "calendar.badge.questionmark",
        priority: .high
      )
    case .seasonalStatusUnverified:
      limitation(
        code: .seasonalStatus,
        title: "Seasonal operation wasn’t verified.",
        symbol: "calendar",
        priority: .high
      )
    case .transportUnverified:
      limitation(
        code: .transport,
        title: "Transport availability wasn’t verified.",
        symbol: "bus.fill",
        priority: .medium
      )
    case .mobilitySuitabilityUnverified:
      limitation(
        code: .mobilitySuitability,
        title: "Mobility suitability wasn’t verified.",
        symbol: "figure.roll",
        priority: .high
      )
    case .childSuitabilityUnverified:
      limitation(
        code: .childSuitability,
        title: "Suitability for children wasn’t verified.",
        symbol: "figure.and.child.holdinghands",
        priority: .high
      )
    case .beginnerSuitabilityUnverified:
      limitation(
        code: .beginnerSuitability,
        title: "Suitability for beginners wasn’t verified.",
        symbol: "figure.hiking",
        priority: .high
      )
    case .requiresRealRouting, .endpointUnavailable,
      .lowerBoundExceedsTarget:
      nil
    }
  }

  fileprivate static func verificationLimitation(
    _ value: ResearchVerificationCodeV1
  ) -> ResearchLimitationPresentation? {
    switch value {
    case .publicAccessRequired:
      limitation(
        code: .access,
        title: "Official access information wasn’t available.",
        symbol: "figure.walk.diamond.fill",
        priority: .high
      )
    case .accessRestrictionRequired:
      limitation(
        code: .accessRestriction,
        title: "Access restrictions weren’t verified.",
        symbol: "hand.raised.fill",
        priority: .high
      )
    case .closureStatusRequired:
      limitation(
        code: .closure,
        title: "Current closure information wasn’t verified.",
        symbol: "signpost.right.and.left",
        priority: .high
      )
    case .trailDifficultyRequired:
      limitation(
        code: .trailDifficulty,
        title: "Technical trail difficulty wasn’t verified.",
        symbol: "mountain.2.fill",
        priority: .high
      )
    case .trailVisibilityRequired:
      limitation(
        code: .trailVisibility,
        title: "Current trail visibility wasn’t verified.",
        symbol: "eye.trianglebadge.exclamationmark",
        priority: .high
      )
    case .exposureRequired:
      limitation(
        code: .exposure,
        title: "Exposed terrain wasn’t verified.",
        symbol: "wind",
        priority: .high
      )
    case .steepClimbRequired:
      limitation(
        code: .steepSections,
        title: "Steep trail sections weren’t verified.",
        symbol: "arrow.up.forward",
        priority: .high
      )
    case .openingStatusRequired:
      limitation(
        code: .opening,
        title: "Current opening status wasn’t verified.",
        symbol: "door.left.hand.closed",
        priority: .high
      )
    case .seasonalOperationRequired:
      limitation(
        code: .seasonalStatus,
        title: "Seasonal operation wasn’t verified.",
        symbol: "calendar",
        priority: .high
      )
    case .overnightPermissionRequired, .legalSleepRequired:
      limitation(
        code: .overnightLegality,
        title: "Overnight legality wasn’t verified.",
        symbol: "moon.stars.fill",
        priority: .high
      )
    case .bookingRequired:
      limitation(
        code: .bookability,
        title: "Booking availability wasn’t verified.",
        symbol: "calendar.badge.questionmark",
        priority: .high
      )
    case .waterStatusRequired:
      limitation(
        code: .water,
        title: "Water availability wasn’t verified.",
        symbol: "drop.fill",
        priority: .high
      )
    case .currentConditionsRequired:
      limitation(
        code: .currentConditions,
        title: "Current trail conditions weren’t available.",
        symbol: "clock.badge.questionmark",
        priority: .high
      )
    case .transportRequired:
      limitation(
        code: .transport,
        title: "Transport availability wasn’t verified.",
        symbol: "bus.fill",
        priority: .medium
      )
    case .mobilitySuitabilityRequired:
      limitation(
        code: .mobilitySuitability,
        title: "Mobility suitability wasn’t verified.",
        symbol: "figure.roll",
        priority: .high
      )
    case .childSuitabilityRequired:
      limitation(
        code: .childSuitability,
        title: "Suitability for children wasn’t verified.",
        symbol: "figure.and.child.holdinghands",
        priority: .high
      )
    case .beginnerSuitabilityRequired:
      limitation(
        code: .beginnerSuitability,
        title: "Suitability for beginners wasn’t verified.",
        symbol: "figure.hiking",
        priority: .high
      )
    case .officialStatusRequired:
      limitation(
        code: .officialRouteStatus,
        title: "Official route status wasn’t verified.",
        symbol: "checkmark.seal",
        priority: .high
      )
    case .realRoutingRequired, .connectivityRequired,
      .actualDistanceRequired, .actualDurationRequired,
      .actualElevationRequired, .endpointCoordinateRequired:
      nil
    }
  }

  fileprivate static func planningGapLimitation(
    _ gap: OutdoorAdventurePlanningGapV1
  ) -> ResearchLimitationPresentation? {
    switch gap.code {
    case .officialSourceUnavailable:
      limitation(
        code: .access,
        title: "Official access or status information wasn’t available.",
        symbol: "checkmark.seal",
        priority: .high
      )
    case .currentSourceUnavailable:
      limitation(
        code: .currentConditions,
        title: "Current information wasn’t available.",
        symbol: "clock.badge.questionmark",
        priority: .high
      )
    case .waterAvailabilitySourceMissing:
      limitation(
        code: .water,
        title: "Water availability wasn’t verified.",
        symbol: "drop.fill",
        priority: .high
      )
    case .scenicQualityNotVerifiable:
      limitation(
        code: .scenicQuality,
        title: "Scenic quality wasn’t verified.",
        symbol: "binoculars.fill",
        priority: .low
      )
    case .unsupportedRegion:
      limitation(
        code: .partialCoverage,
        title: "Research coverage is limited in this area.",
        symbol: "map.circle.fill",
        priority: .medium
      )
    case .unsupportedEvidenceDimension, .operationTypeUnavailable,
      .predicateUnavailable, .derivedSourceUnavailable,
      .mappedSourceUnavailable:
      limitation(
        code: .unsupportedEvidence,
        title: "Some requested information could not be researched.",
        symbol: "questionmark.circle.fill",
        priority: .medium
      )
    case .transportEvidenceNotModeled:
      limitation(
        code: .transport,
        title: "Transport availability wasn’t verified.",
        symbol: "bus.fill",
        priority: .medium
      )
    case .bikingNetworkNotModeled, .toiletEvidenceNotModeled:
      limitation(
        code: .unsupportedEvidence,
        title: "Some requested information could not be researched.",
        symbol: "questionmark.circle.fill",
        priority: .medium
      )
    }
  }

  fileprivate static func adapterGapLimitation(
    _ gap: AdventureResearchIntentAdapterGapV1
  ) -> ResearchLimitationPresentation? {
    switch gap {
    case .technicalDifficultyNotEquivalent:
      limitation(
        code: .technicalDifficulty,
        title: "Requested difficulty did not map to verified technical trail difficulty.",
        symbol: "mountain.2.fill",
        priority: .high
      )
    case .waterPreferenceAmbiguous:
      limitation(
        code: .water,
        title:
          "A water preference could not be verified as drinking water or a specific water feature.",
        symbol: "drop.fill",
        priority: .high
      )
    case .sunsetNotModeled:
      limitation(
        code: .unsupportedEvidence,
        title: "Sunset suitability wasn’t verified.",
        symbol: "sunset.fill",
        priority: .medium
      )
    case .groupContextUnavailable, .arrivalContextUnavailable:
      nil
    case .activityNotSupported, .pointToPointDestinationNotRepresentable,
      .multiDayNotSupported, .resolvedAnchorRequired,
      .broadRegionRequiresClarification,
      .resolvedAnchorCoordinatesInvalid, .resolvedAnchorNameInvalid,
      .distanceNotRepresentable, .durationNotRepresentable,
      .researchContractRejected:
      nil
    }
  }

  fileprivate static func rawLimitation(
    _ rawValue: String
  ) -> ResearchLimitationPresentation? {
    if let typed = ResearchKnownLimitationV1(rawValue: rawValue) {
      return knownLimitation(typed)
    }
    switch rawValue {
    case "snapping_unavailable", "snapping_exceeds_tolerance":
      return limitation(
        code: .unconnectedHighlight,
        title: "A researched highlight could not be confirmed on the routed path.",
        symbol: "point.3.connected.trianglepath.dotted",
        priority: .medium
      )
    case "provider_failure":
      return limitation(
        code: .researchAttempt,
        title: "One researched route attempt could not be completed.",
        symbol: "arrow.triangle.2.circlepath",
        priority: .low
      )
    case "route_type_unsupported", "candidate_plan_unsupported",
      "candidate_plan_not_routable":
      return limitation(
        code: .unsupportedEvidence,
        title: "Some requested information could not be researched.",
        symbol: "questionmark.circle.fill",
        priority: .medium
      )
    default:
      return nil
    }
  }

  fileprivate static func questionText(
    _ question: AdventureResearchClarificationQuestionV1
  ) -> String? {
    switch question.code {
    case .locationRequired:
      "Which specific town, valley, landmark or trailhead should Wanderful use?"
    case .startRequired:
      "Where should the route start?"
    case .destinationRequired:
      "Where should the route finish?"
    case .distanceRequired:
      "How long should the route be?"
    case .durationRequired:
      "How much time should the route take?"
    case .dateOrSeasonRequired:
      "When are you planning to go?"
    case .overnightLegalityRequired:
      "Is an overnight stop required?"
    case .transportRequirementRequired:
      "How do you plan to reach the route?"
    case .difficultyClarificationRequired:
      "What level of technical trail difficulty should Wanderful plan for?"
    }
  }

  fileprivate static func limitation(
    code: ResearchLimitationPresentation.Code,
    title: String,
    symbol: String,
    priority: ResearchLimitationPresentation.Priority
  ) -> ResearchLimitationPresentation {
    ResearchLimitationPresentation(
      code: code,
      title: title,
      symbol: symbol,
      priority: priority
    )
  }

  fileprivate static func categoryLabel(
    _ category: ResearchHighlightCategoryV1
  ) -> String {
    switch category {
    case .viewpoint:
      "viewpoint"
    case .waterfall:
      "waterfall"
    case .peak:
      "peak"
    case .lake:
      "lake"
    case .alpineHut:
      "alpine hut"
    case .wildernessHut:
      "wilderness hut"
    case .landmark:
      "landmark"
    }
  }

  fileprivate static func categorySymbol(
    _ category: ResearchHighlightCategoryV1
  ) -> String {
    switch category {
    case .viewpoint:
      "binoculars.fill"
    case .waterfall:
      "water.waves"
    case .peak:
      "mountain.2.fill"
    case .lake:
      "drop.circle.fill"
    case .alpineHut, .wildernessHut:
      "house.lodge.fill"
    case .landmark:
      "mappin.and.ellipse"
    }
  }

  fileprivate static func uniqueWaypoints(
    _ values: [ResearchSelectedWaypointV1]
  ) -> [ResearchSelectedWaypointV1] {
    var seen: Set<UUID> = []
    return values.filter { seen.insert($0.entityID).inserted }
  }

  fileprivate static func unique<T: Hashable>(_ values: [T]) -> [T] {
    var seen: Set<T> = []
    return values.filter { seen.insert($0).inserted }
  }

  fileprivate static func deduplicatedReasons(
    _ values: [ResearchFitReason]
  ) -> [ResearchFitReason] {
    var codes: Set<ResearchFitReason.Code> = []
    var titles: Set<String> = []
    return values.filter {
      codes.insert($0.code).inserted && titles.insert($0.title).inserted
    }
  }

  fileprivate static func naturalLanguageList(_ values: [String]) -> String {
    switch values.count {
    case 0:
      ""
    case 1:
      values[0]
    case 2:
      "\(values[0]) and \(values[1])"
    default:
      "\(values.dropLast().joined(separator: ", ")), and \(values.last!)"
    }
  }

  fileprivate static func isUniqueMinimum(
    value: Double,
    among values: [Double]
  ) -> Bool {
    guard let minimum = values.min(),
      abs(value - minimum) < 0.000_001
    else {
      return false
    }
    return values.filter {
      abs($0 - minimum) < 0.000_001
    }.count == 1
  }

  fileprivate static func distanceLabel(_ value: Double) -> String {
    let digits = value < 0.05 ? 0 : 1
    return value.formatted(
      .number
        .locale(Locale(identifier: "en_US_POSIX"))
        .precision(.fractionLength(digits))
    ) + " km"
  }

  fileprivate static func durationLabel(_ minutes: Int) -> String {
    let hours = minutes / 60
    let remainder = minutes % 60
    if hours == 0 {
      return "\(minutes) min"
    }
    if remainder == 0 {
      return "\(hours) hr"
    }
    return "\(hours) hr \(remainder) min"
  }
}
