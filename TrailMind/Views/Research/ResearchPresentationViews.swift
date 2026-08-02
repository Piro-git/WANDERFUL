import SwiftUI

enum ResearchPresentationAccessibilityID {
  static let cardSummary = "research.card.summary"
  static let fitReasons = "research.detail.fitReasons"
  static let highlights = "research.detail.highlights"
  static let limitations = "research.detail.limitations"
  static let showAllLimitations = "research.detail.limitations.showAll"
  static let evidenceSummary = "research.detail.evidenceSummary"
  static let clarification = "research.clarification"
}

struct ResearchRouteCardSummaryView: View {
  @Environment(TrailTheme.self) private var theme

  let presentation: ResearchRoutePresentation

  var body: some View {
    if presentation.kind.isResearchGuided,
      let badge = presentation.badge
    {
      VStack(alignment: .leading, spacing: 10) {
        Label(badge.title, systemImage: badge.symbol)
          .font(.caption.weight(.bold))
          .foregroundStyle(theme.forest)
          .padding(.horizontal, 10)
          .padding(.vertical, 7)
          .background(
            theme.mossSoft.opacity(0.64),
            in: Capsule()
          )
          .accessibilityAddTraits(.isHeader)

        ForEach(presentation.cardFacts) { fact in
          HStack(alignment: .top, spacing: 9) {
            Image(systemName: fact.symbol)
              .font(.caption.weight(.bold))
              .foregroundStyle(theme.moss)
              .frame(width: 18, height: 18)
              .accessibilityHidden(true)

            Text(fact.title)
              .font(.footnote.weight(.semibold))
              .foregroundStyle(theme.graphite)
              .fixedSize(horizontal: false, vertical: true)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(fact.title)
        }
      }
      .padding(12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        theme.mossSoft.opacity(0.28),
        in: RoundedRectangle(cornerRadius: 16, style: .continuous)
      )
      .overlay {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
          .stroke(theme.moss.opacity(0.16), lineWidth: 1)
      }
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier(
        ResearchPresentationAccessibilityID.cardSummary
      )
    }
  }
}

struct WhyThisRouteFitsView: View {
  @Environment(TrailTheme.self) private var theme

  let reasons: [ResearchFitReason]

  var body: some View {
    if !reasons.isEmpty {
      VStack(alignment: .leading, spacing: 14) {
        SectionHeader(
          title: "Why this route fits",
          subtitle: "Verified route facts and on-route research, ranked by what matters most."
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)

        ForEach(reasons) { reason in
          HStack(alignment: .top, spacing: 12) {
            Image(systemName: reason.symbol)
              .font(.footnote.weight(.bold))
              .foregroundStyle(theme.forest)
              .frame(width: 30, height: 30)
              .background(
                theme.mossSoft.opacity(0.62),
                in: RoundedRectangle(
                  cornerRadius: 10,
                  style: .continuous
                )
              )
              .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
              Text(reason.title)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(theme.graphite)
                .fixedSize(
                  horizontal: false,
                  vertical: true
                )

              if let detail = reason.detail {
                Text(detail)
                  .font(.footnote)
                  .foregroundStyle(theme.secondaryText)
                  .fixedSize(
                    horizontal: false,
                    vertical: true
                  )
              }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
          .padding(12)
          .background(
            theme.warmWhite.opacity(0.72),
            in: RoundedRectangle(
              cornerRadius: 14,
              style: .continuous
            )
          )
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(
            [reason.title, reason.detail]
              .compactMap(\.self)
              .joined(separator: ". ")
          )
          .accessibilityIdentifier(
            "research.detail.fitReasons.\(reason.code.rawValue)"
          )
        }
      }
      .trailCard()
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier(
        ResearchPresentationAccessibilityID.fitReasons
      )
    }
  }
}

struct VerifiedResearchHighlightsView: View {
  @Environment(TrailTheme.self) private var theme

  let highlights: [ResearchHighlightPresentation]

  var body: some View {
    if !highlights.isEmpty {
      VStack(alignment: .leading, spacing: 14) {
        SectionHeader(
          title: "Verified on this route",
          subtitle: "Only researched places confirmed on the routed path are shown here."
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)

        ForEach(highlights) { highlight in
          HStack(alignment: .top, spacing: 12) {
            Image(systemName: highlight.symbol)
              .font(.subheadline.weight(.bold))
              .foregroundStyle(theme.forest)
              .frame(width: 38, height: 38)
              .background(
                theme.mossSoft.opacity(0.68),
                in: RoundedRectangle(
                  cornerRadius: 12,
                  style: .continuous
                )
              )
              .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
              HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(highlight.title)
                  .font(.subheadline.weight(.bold))
                  .foregroundStyle(theme.graphite)
                  .fixedSize(
                    horizontal: false,
                    vertical: true
                  )

                if highlight.isMustHave {
                  Text("MUST-HAVE")
                    .font(.caption2.weight(.bold))
                    .tracking(0.45)
                    .foregroundStyle(theme.moss)
                }
              }

              Text(highlight.evidenceLabel)
                .font(.footnote)
                .foregroundStyle(theme.secondaryText)
                .fixedSize(
                  horizontal: false,
                  vertical: true
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
          }
          .padding(12)
          .background(
            theme.warmWhite.opacity(0.72),
            in: RoundedRectangle(
              cornerRadius: 14,
              style: .continuous
            )
          )
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(
            "\(highlight.title). \(highlight.evidenceLabel)"
              + (highlight.isMustHave
                ? ". Requested must-have"
                : "")
          )
          .accessibilityIdentifier(
            "research.detail.highlight.\(highlight.id)"
          )
        }
      }
      .trailCard()
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier(
        ResearchPresentationAccessibilityID.highlights
      )
    }
  }
}

struct RouteResearchLimitationsView: View {
  @Environment(TrailTheme.self) private var theme
  @State private var showsAll = false

  let limitations: [ResearchLimitationPresentation]

  var body: some View {
    if !limitations.isEmpty {
      VStack(alignment: .leading, spacing: 14) {
        SectionHeader(
          title: "What to check",
          subtitle:
            "Missing information is kept visible instead of being treated as a positive route claim."
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)

        ForEach(visibleLimitations) { limitation in
          HStack(alignment: .top, spacing: 11) {
            Image(systemName: limitation.symbol)
              .font(.footnote.weight(.bold))
              .foregroundStyle(theme.warning)
              .frame(width: 28, height: 28)
              .background(
                theme.sand.opacity(0.82),
                in: RoundedRectangle(
                  cornerRadius: 9,
                  style: .continuous
                )
              )
              .accessibilityHidden(true)

            Text(limitation.title)
              .font(.footnote.weight(.semibold))
              .foregroundStyle(theme.graphite)
              .fixedSize(horizontal: false, vertical: true)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .padding(12)
          .background(
            theme.sand.opacity(0.42),
            in: RoundedRectangle(
              cornerRadius: 14,
              style: .continuous
            )
          )
          .accessibilityElement(children: .ignore)
          .accessibilityLabel(
            "Research limitation. \(limitation.title)"
          )
          .accessibilityIdentifier(
            "research.detail.limitation.\(limitation.code.rawValue)"
          )
        }

        if limitations.count > ResearchRoutePresentation.initialLimitationCount {
          Button {
            showsAll.toggle()
          } label: {
            Label(
              showsAll
                ? "Show fewer"
                : "Show all \(limitations.count) limitations",
              systemImage: showsAll
                ? "chevron.up"
                : "chevron.down"
            )
            .font(.footnote.weight(.bold))
            .foregroundStyle(theme.forest)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 44)
          }
          .buttonStyle(.plain)
          .accessibilityValue(
            showsAll ? "Expanded" : "Collapsed"
          )
          .accessibilityIdentifier(
            ResearchPresentationAccessibilityID
              .showAllLimitations
          )
        }
      }
      .trailCard()
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier(
        ResearchPresentationAccessibilityID.limitations
      )
    }
  }

  private var visibleLimitations: [ResearchLimitationPresentation] {
    if showsAll {
      return limitations
    }
    return Array(
      limitations.prefix(
        ResearchRoutePresentation.initialLimitationCount
      )
    )
  }
}

struct RouteResearchEvidenceSummaryView: View {
  @Environment(TrailTheme.self) private var theme

  let summary: ResearchEvidenceSummary

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: summary.symbol)
        .font(.subheadline.weight(.bold))
        .foregroundStyle(theme.forest)
        .frame(width: 36, height: 36)
        .background(theme.mossSoft.opacity(0.68), in: Circle())
        .accessibilityHidden(true)

      VStack(alignment: .leading, spacing: 5) {
        Text(summary.title)
          .font(.subheadline.weight(.bold))
          .foregroundStyle(theme.graphite)
          .fixedSize(horizontal: false, vertical: true)

        Text(summary.detail)
          .font(.footnote)
          .foregroundStyle(theme.secondaryText)
          .fixedSize(horizontal: false, vertical: true)

        if let coverageLabel = summary.coverageLabel {
          Text(coverageLabel)
            .font(.caption.weight(.bold))
            .foregroundStyle(theme.moss)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      theme.mossSoft.opacity(0.32),
      in: RoundedRectangle(cornerRadius: 18, style: .continuous)
    )
    .overlay {
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .stroke(theme.moss.opacity(0.14), lineWidth: 1)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      [summary.title, summary.detail, summary.coverageLabel]
        .compactMap(\.self)
        .joined(separator: ". ")
    )
    .accessibilityIdentifier(
      ResearchPresentationAccessibilityID.evidenceSummary
    )
  }
}

struct ResearchClarificationContextView: View {
  @Environment(TrailTheme.self) private var theme

  let presentation: ResearchClarificationPresentation

  var body: some View {
    VStack(alignment: .leading, spacing: 11) {
      Label(
        presentation.title,
        systemImage: "books.vertical.fill"
      )
      .font(.subheadline.weight(.bold))
      .foregroundStyle(theme.forest)

      Text(presentation.rationale)
        .font(.footnote)
        .foregroundStyle(theme.secondaryText)
        .fixedSize(horizontal: false, vertical: true)

      if presentation.questions.count > 1 {
        VStack(alignment: .leading, spacing: 8) {
          ForEach(
            Array(presentation.questions.enumerated()),
            id: \.offset
          ) { index, question in
            HStack(alignment: .top, spacing: 8) {
              Text("\(index + 1)")
                .font(.caption2.weight(.bold))
                .foregroundStyle(theme.forest)
                .frame(width: 22, height: 22)
                .background(
                  theme.mossSoft.opacity(0.68),
                  in: Circle()
                )
                .accessibilityHidden(true)

              Text(question)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(theme.graphite)
                .fixedSize(
                  horizontal: false,
                  vertical: true
                )
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(
              "Question \(index + 1). \(question)"
            )
          }
        }
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      theme.mossSoft.opacity(0.3),
      in: RoundedRectangle(cornerRadius: 17, style: .continuous)
    )
    .overlay {
      RoundedRectangle(cornerRadius: 17, style: .continuous)
        .stroke(theme.moss.opacity(0.14), lineWidth: 1)
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier(
      ResearchPresentationAccessibilityID.clarification
    )
  }
}

#if DEBUG
  private enum ResearchPresentationPreviewFixtures {
    static let complete = ResearchRoutePresentation(
      kind: .researchGuided,
      badge: ResearchRouteBadge(
        title: "Researched route",
        symbol: "books.vertical.fill"
      ),
      cardFacts: [
        ResearchRouteCardFact(
          code: .verifiedHighlights,
          title: "Built around 2 on-route highlights",
          symbol: "mappin.and.ellipse"
        ),
        ResearchRouteCardFact(
          code: .highlightCategories,
          title: "Includes viewpoint and waterfall",
          symbol: "checkmark.circle.fill"
        ),
      ],
      fitReasons: [
        ResearchFitReason(
          code: .mustHaveHighlights,
          title: "Includes two requested must-have highlights",
          detail: "viewpoint and waterfall",
          symbol: "star.fill"
        ),
        ResearchFitReason(
          code: .routeShape,
          title: "Built as a hiking loop",
          detail: "The verified route returns to its start point.",
          symbol: "arrow.trianglehead.2.clockwise.rotate.90"
        ),
        ResearchFitReason(
          code: .distanceMatch,
          title: "0.2 km from your requested distance",
          detail: "Actual 14.8 km versus requested 15 km.",
          symbol: "ruler"
        ),
      ],
      highlights: [
        ResearchHighlightPresentation(
          id: 0,
          title: "Viewpoint",
          categoryLabel: "viewpoint",
          evidenceLabel: "Mapped place on this routed path",
          symbol: "binoculars.fill",
          isMustHave: true
        ),
        ResearchHighlightPresentation(
          id: 1,
          title: "Waterfall",
          categoryLabel: "waterfall",
          evidenceLabel: "Mapped place on this routed path",
          symbol: "water.waves",
          isMustHave: true
        ),
      ],
      limitations: [],
      evidenceSummary: ResearchEvidenceSummary(
        title: "Research-guided route",
        detail:
          "Based on mapped trails and researched places. Route geometry and statistics come from a verified routed result.",
        coverageLabel: "Research coverage: complete",
        symbol: "books.vertical.fill"
      )
    )

    static let partial = ResearchRoutePresentation(
      kind: .researchGuidedPartial,
      badge: complete.badge,
      cardFacts: complete.cardFacts + [
        ResearchRouteCardFact(
          code: .partialCoverage,
          title: "Some preferences unverified",
          symbol: "info.circle.fill"
        )
      ],
      fitReasons: complete.fitReasons,
      highlights: Array(complete.highlights.prefix(1)),
      limitations: [
        ResearchLimitationPresentation(
          code: .access,
          title: "Official access information wasn’t available.",
          symbol: "figure.walk.diamond.fill",
          priority: .high
        ),
        ResearchLimitationPresentation(
          code: .currentConditions,
          title: "Current trail conditions weren’t available.",
          symbol: "clock.badge.questionmark",
          priority: .high
        ),
        ResearchLimitationPresentation(
          code: .unconnectedHighlight,
          title: "One requested highlight could not be confirmed on the routed path.",
          symbol: "point.3.connected.trianglepath.dotted",
          priority: .medium
        ),
      ],
      evidenceSummary: ResearchEvidenceSummary(
        title: "Research-guided route",
        detail:
          "Based on mapped trails and researched places. Route geometry and statistics come from a verified routed result.",
        coverageLabel: "Research coverage: partial",
        symbol: "books.vertical.fill"
      )
    )

    static let fallback = ResearchEvidenceSummary(
      title: "Standard routed option",
      detail:
        "This is a real routed option. Research matching was unavailable, so requested experiences were not verified against researched places.",
      coverageLabel: nil,
      symbol: "point.bottomleft.forward.to.point.topright.scurvepath"
    )

    static let longGerman = ResearchRoutePresentation(
      kind: .researchGuidedPartial,
      badge: complete.badge,
      cardFacts: [
        ResearchRouteCardFact(
          code: .partialCoverage,
          title: "Einige gewünschte Routeneigenschaften sind noch nicht verifiziert",
          symbol: "info.circle.fill"
        )
      ],
      fitReasons: [
        ResearchFitReason(
          code: .routeShape,
          title: "Als Rundwanderung auf verifizierbaren Wegen geplant",
          detail:
            "Die berechnete Route kehrt zum Ausgangspunkt zurück; die tatsächlichen Bedingungen vor Ort können sich dennoch kurzfristig ändern.",
          symbol: "arrow.trianglehead.2.clockwise.rotate.90"
        )
      ],
      highlights: [],
      limitations: [
        ResearchLimitationPresentation(
          code: .currentConditions,
          title:
            "Aktuelle Wegbedingungen, kurzfristige Sperrungen und saisonale Einschränkungen konnten für diesen Routenvorschlag nicht verifiziert werden.",
          symbol: "clock.badge.questionmark",
          priority: .high
        ),
        ResearchLimitationPresentation(
          code: .access,
          title:
            "Offizielle Informationen zu Zugänglichkeit und örtlichen Regeln waren in den verfügbaren Forschungsdaten nicht enthalten.",
          symbol: "figure.walk.diamond.fill",
          priority: .high
        ),
        ResearchLimitationPresentation(
          code: .unconnectedHighlight,
          title:
            "Ein gewünschter Aussichtspunkt konnte nicht zuverlässig mit dem berechneten Routenverlauf verbunden werden.",
          symbol: "point.3.connected.trianglepath.dotted",
          priority: .medium
        ),
      ],
      evidenceSummary: ResearchEvidenceSummary(
        title: "Forschungsunterstützte Route",
        detail:
          "Basiert auf kartierten Wegen und recherchierten Orten. Geometrie und Statistiken stammen aus einem verifizierten Routenergebnis.",
        coverageLabel: "Forschungsabdeckung: teilweise",
        symbol: "books.vertical.fill"
      )
    )
  }

  private struct ResearchPresentationPreviewStack: View {
    let presentation: ResearchRoutePresentation

    var body: some View {
      ScrollView {
        VStack(spacing: TrailSpacing.section) {
          ResearchRouteCardSummaryView(presentation: presentation)
          RouteResearchEvidenceSummaryView(
            summary: presentation.evidenceSummary
          )
          WhyThisRouteFitsView(reasons: presentation.fitReasons)
          VerifiedResearchHighlightsView(
            highlights: presentation.highlights
          )
          RouteResearchLimitationsView(
            limitations: presentation.limitations
          )
        }
        .padding(TrailSpacing.page)
      }
      .background(TrailBackground())
      .environment(TrailTheme())
    }
  }

  #Preview("Research complete") {
    ResearchPresentationPreviewStack(
      presentation: ResearchPresentationPreviewFixtures.complete
    )
  }

  #Preview("Research partial") {
    ResearchPresentationPreviewStack(
      presentation: ResearchPresentationPreviewFixtures.partial
    )
  }

  #Preview("Standard fallback") {
    RouteResearchEvidenceSummaryView(
      summary: ResearchPresentationPreviewFixtures.fallback
    )
    .padding()
    .background(TrailBackground())
    .environment(TrailTheme())
  }

  #Preview("Long text · accessibility") {
    ResearchPresentationPreviewStack(
      presentation: ResearchPresentationPreviewFixtures.longGerman
    )
    .environment(\.dynamicTypeSize, .accessibility3)
  }
#endif
