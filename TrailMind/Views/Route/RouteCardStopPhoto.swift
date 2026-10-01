import Foundation
import ImageIO
import SwiftUI
import UIKit

/// A card image is shown only after both its stop identity and its image bytes are valid.
nonisolated struct RouteCardStopPhoto: @unchecked Sendable {
    let stopName: String
    let photo: CommonsRoutePhoto
    let image: UIImage
}

enum RouteCardPhotoEligibility {
    static func stops(on route: TrailRoute) -> [DynamicResearchStop] {
        guard route.path.count >= 2 else { return [] }
        return route.dynamicResearchStops.filter { stop in
            guard (try? BackendDynamicResearchPlanningClient.validateStoredEvidence([stop])) != nil,
                  stop.access?.state != .excluded else { return false }
            let target = stop.access?.state == .documented
                ? stop.access?.target?.coordinate ?? stop.coordinate
                : stop.coordinate
            return isOnRoute(target, path: route.path)
        }
    }

    static func isOnRoute(_ coordinate: DynamicResearchCoordinate, path: [GeoPoint]) -> Bool {
        guard coordinate.isValid, path.count >= 2,
              path.allSatisfy({ point in
                  point.latitude.isFinite && point.longitude.isFinite &&
                  abs(point.latitude) <= 90 && abs(point.longitude) <= 180
              }) else { return false }
        return RouteStays.distanceToPath(coordinate, path: path) <= 100
    }
}

/// Serial work keeps a long list of alternatives from starting parallel metadata
/// requests and image decodes. The gallery's resolver cache is shared with this view.
actor RouteCardStopPhotoService {
    static let shared = RouteCardStopPhotoService()

    private let resolver: WikimediaCommonsPhotoResolver
    private let session: URLSession
    private var busy = false
    private var images: [URL: UIImage] = [:]
    private var imageOrder: [URL] = []
    private enum ResolvedPhoto {
        case available(CommonsRoutePhoto)
        case absent
    }
    private var resolvedPhotos: [DynamicResearchStop: ResolvedPhoto] = [:]

    init(resolver: WikimediaCommonsPhotoResolver = .shared, session: URLSession? = nil) {
        self.resolver = resolver
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.default
            configuration.timeoutIntervalForRequest = 8
            configuration.timeoutIntervalForResource = 12
            self.session = URLSession(configuration: configuration)
        }
    }

    func load(stops: [DynamicResearchStop]) async -> RouteCardStopPhoto? {
        do {
            while busy {
                try Task.checkCancellation()
                try await Task.sleep(for: .milliseconds(80))
            }
            busy = true
            defer { busy = false }

            for stop in stops {
                try Task.checkCancellation()
                let stored = await MainActor.run { CommonsRoutePhotoGalleryModel.storedPhoto(for: stop) }
                let photo: CommonsRoutePhoto?
                if let stored {
                    photo = stored
                } else {
                    photo = try? await resolvedPhoto(for: stop)
                }
                guard let photo else { continue }
                if let image = try? await image(for: photo.imageURL) {
                    return RouteCardStopPhoto(stopName: stop.name, photo: photo, image: image)
                }
            }
        } catch {
            // Photos are optional; keep the route map when the network fails or a view disappears.
        }
        return nil
    }

    private func resolvedPhoto(for stop: DynamicResearchStop) async throws -> CommonsRoutePhoto? {
        if let cached = resolvedPhotos[stop] {
            switch cached {
            case .available(let photo): return photo
            case .absent: return nil
            }
        }
        let photo = try await resolver.photo(for: stop)
        resolvedPhotos[stop] = photo.map(ResolvedPhoto.available) ?? .absent
        if resolvedPhotos.count > 48 { resolvedPhotos.removeAll(keepingCapacity: true) }
        return photo
    }

    private func image(for url: URL) async throws -> UIImage {
        if let cached = images[url] { return cached }
        var request = URLRequest(url: url)
        request.cachePolicy = .returnCacheDataElseLoad
        let limits = RouteTransportLimits(
            maximumSuccessBodyBytes: 5_000_000, maximumErrorBodyBytes: 64 * 1_024,
            maximumPaths: 0, maximumCoordinatesPerPath: 0, maximumInstructionsPerPath: 0,
            maximumPathDetailsPerPath: 0, maximumAbsoluteElevationMeters: 0
        )
        let (data, response) = try await BoundedRouteHTTPTransport(
            session: session, limits: limits, rejectsRedirects: true
        ).data(for: request)
        try Task.checkCancellation()
        guard let response = response as? HTTPURLResponse,
              response.statusCode == 200,
              response.url == url,
              ["image/jpeg", "image/png", "image/webp"].contains(response.mimeType ?? ""),
              !data.isEmpty, data.count <= 5_000_000,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: 520
              ] as CFDictionary) else { throw CocoaError(.fileReadCorruptFile) }
        let image = UIImage(cgImage: cgImage)
        images[url] = image
        imageOrder.append(url)
        if imageOrder.count > 12 {
            let oldest = imageOrder.removeFirst()
            images.removeValue(forKey: oldest)
        }
        return image
    }
}

struct RouteSuggestionCardRow: View {
    @Environment(AppLanguageController.self) private var languageController
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let suggestion: RouteSuggestion
    let researchPresentation: ResearchRoutePresentation?
    private let photoService: RouteCardStopPhotoService
    @State private var stopPhoto: RouteCardStopPhoto?
    @State private var selectedSource: CommonsRoutePhoto?

    init(suggestion: RouteSuggestion, researchPresentation: ResearchRoutePresentation?,
         photoService: RouteCardStopPhotoService = .shared) {
        self.suggestion = suggestion
        self.researchPresentation = researchPresentation
        self.photoService = photoService
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            NavigationLink {
                RouteDetailView(route: suggestion.route, researchPresentation: researchPresentation)
            } label: {
                RouteCard(
                    route: suggestion.route,
                    comparisonLabel: suggestion.explanation,
                    qualityExplanations: RouteQualityExplanationGenerator.explanations(
                        for: suggestion.route,
                        debugMetadata: suggestion.debugMetadata,
                        maximumCount: 3
                    ),
                    researchPresentation: researchPresentation,
                    stopPhoto: stopPhoto
                )
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(accessibilitySummary)
                .accessibilityHint(isGerman ? "Öffnet die Routendetails." : "Opens this route’s details.")
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("route.open.\(suggestion.route.id.uuidString)")

            if let stopPhoto {
                Button {
                    selectedSource = stopPhoto.photo
                } label: {
                    Label(isGerman ? "Fotoquelle & Lizenz" : "Photo source & license", systemImage: "info.circle")
                        .font(.caption)
                        .frame(minHeight: 44, alignment: .leading)
                }
                .accessibilityLabel(sourceAccessibilityLabel(for: stopPhoto))
                .accessibilityIdentifier("route.card.photoSource.\(suggestion.route.id.uuidString)")
            }
        }
        .trailCard()
        .task(id: suggestion.route) {
            stopPhoto = nil
            let loaded = await photoService.load(stops: RouteCardPhotoEligibility.stops(on: suggestion.route))
            if !Task.isCancelled { stopPhoto = loaded }
        }
        .sheet(item: $selectedSource) { photo in
            CommonsPhotoSourceView(photo: photo, placeName: stopPhoto?.stopName)
                .environment(\.dynamicTypeSize, dynamicTypeSize)
        }
    }

    private var accessibilitySummary: String {
        let base = RouteComparisonAccessibilitySummary(
            route: suggestion.route,
            comparisonLabel: suggestion.explanation,
            researchPresentation: researchPresentation
        ).label
        guard let stopPhoto else { return base }
        return base + (isGerman ? ". Foto eines Routenstopps: " : ". Photo of a route stop: ") + stopPhoto.stopName
    }

    private func sourceAccessibilityLabel(for item: RouteCardStopPhoto) -> String {
        if isGerman {
            return "Fotoquelle für \(item.stopName). \(item.photo.author). Lizenz \(item.photo.licence). Quelle öffnen."
        }
        return "Photo source for \(item.stopName). \(item.photo.author). License \(item.photo.licence). Open source details."
    }

    private var isGerman: Bool { languageController.language == .german }
}
