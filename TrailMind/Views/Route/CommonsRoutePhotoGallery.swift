import SwiftUI

@MainActor
final class CommonsRoutePhotoGalleryModel: ObservableObject {
    @Published private(set) var photos: [String: CommonsRoutePhoto] = [:]
    @Published private(set) var hasLoaded = false
    private let resolver: WikimediaCommonsPhotoResolver

    init(resolver: WikimediaCommonsPhotoResolver = .shared) { self.resolver = resolver }

    static func storedPhoto(for stop: DynamicResearchStop) -> CommonsRoutePhoto? {
        guard let photo = stop.photo,
              (try? BackendDynamicResearchPlanningClient.validateStoredEvidence([stop])) != nil else { return nil }
        return CommonsRoutePhoto(stopID: stop.id, wikidataID: stop.wikidataId,
            imageURL: photo.url, sourceURL: photo.sourceURL, licence: photo.license,
            licenceURL: photo.licenseURL, author: photo.credit, retrievedAt: .distantPast)
    }

    func load(stops: [DynamicResearchStop]) async {
        hasLoaded = false
        photos = [:]
        let candidates = stops.filter { Self.storedPhoto(for: $0) == nil }
        let resolver = resolver
        let resolved = await withTaskGroup(of: (String, CommonsRoutePhoto?).self, returning: [String: CommonsRoutePhoto].self) { group in
            for stop in candidates {
                group.addTask {
                    guard !Task.isCancelled else { return (stop.id, nil) }
                    return (stop.id, try? await resolver.photo(for: stop))
                }
            }
            var photos: [String: CommonsRoutePhoto] = [:]
            for await (stopID, photo) in group {
                if let photo { photos[stopID] = photo }
            }
            return photos
        }
        guard !Task.isCancelled else { return }
        photos = resolved
        hasLoaded = true
    }
}

struct CommonsRoutePhotoGallery: View {
    @Environment(AppLanguageController.self) private var languageController
    let stops: [DynamicResearchStop]
    @StateObject private var model = CommonsRoutePhotoGalleryModel()
    @State private var selectedPhoto: CommonsRoutePhoto?

    private var items: [(DynamicResearchStop, CommonsRoutePhoto)] {
        var seen: Set<URL> = []
        return stops.compactMap { stop in
            guard let photo = model.photos[stop.id] ?? CommonsRoutePhotoGalleryModel.storedPhoto(for: stop),
                  seen.insert(photo.sourceURL).inserted else { return nil }
            return (stop, photo)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !items.isEmpty {
                Text(isGerman ? "Fotos zu deinen Stopps" : "Photos of your stops").font(.title3.weight(.semibold))
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 12) {
                        ForEach(items, id: \.1.id) { stop, photo in
                            VStack(alignment: .leading, spacing: 6) {
                                AsyncImage(url: photo.imageURL) { phase in
                                    if let image = phase.image { image.resizable().scaledToFill() }
                                    else if phase.error == nil { ProgressView() }
                                    else {
                                        Label(isGerman ? "Foto gerade nicht verfügbar" : "Photo unavailable right now", systemImage: "photo.badge.exclamationmark")
                                            .font(.caption).foregroundStyle(.secondary).padding()
                                            .accessibilityIdentifier("route.commons.imageUnavailable")
                                    }
                                }
                                .frame(width: 244, height: 152).background(.quaternary)
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .accessibilityLabel(stop.name)
                                Text(stop.name).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                                Button { selectedPhoto = photo } label: {
                                    Label(isGerman ? "Fotoquelle & Lizenz" : "Photo source & license", systemImage: "info.circle")
                                        .font(.caption).frame(minHeight: 44, alignment: .leading)
                                }
                                .accessibilityLabel((isGerman ? "Fotoquelle und Lizenz: " : "Photo source and license: ") + stop.name)
                            }.frame(width: 244, alignment: .leading)
                        }
                    }.padding(.vertical, 2)
                }
                .accessibilityIdentifier("route.commons.gallery")
            } else if model.hasLoaded && !stops.isEmpty {
                Label(isGerman ? "Für diese Stopps sind gerade keine passenden Fotos verfügbar." : "Matching photos aren’t available for these stops right now.", systemImage: "photo")
                    .font(.subheadline).foregroundStyle(.secondary)
                    .accessibilityIdentifier("route.commons.empty")
            } else if !stops.isEmpty {
                ProgressView(isGerman ? "Fotos werden geladen …" : "Loading photos…")
                    .font(.caption)
            }
        }
        .task(id: stops) { await model.load(stops: stops) }
        .sheet(item: $selectedPhoto) { photo in
            CommonsPhotoSourceView(photo: photo)
        }
    }
    private var isGerman: Bool { languageController.language == .german }
}

struct CommonsPhotoSourceView: View {
    let photo: CommonsRoutePhoto
    @Environment(AppLanguageController.self) private var languageController
    @Environment(\.dismiss) private var dismiss
    private var isGerman: Bool { languageController.language == .german }
    var body: some View {
        NavigationStack {
            List {
                Section(isGerman ? "Urheberangabe" : "Attribution") {
                    Text(photo.author).fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("route.commons.credit")
                    Link(isGerman ? "Original auf Wikimedia Commons" : "Original on Wikimedia Commons", destination: photo.sourceURL)
                        .frame(minHeight: 44)
                    Link(photo.licence, destination: photo.licenceURL).frame(minHeight: 44)
                }
                Section {
                    Text(isGerman ? "Das Foto ist diesem Ort zugeordnet. Aufnahmezeit und heutige Bedingungen können abweichen. Die Vorschau ist zugeschnitten." : "This photo is linked to this place. The capture date and current conditions may differ. The preview is cropped.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle(isGerman ? "Fotoquelle" : "Photo source")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(isGerman ? "Fertig" : "Done") { dismiss() } } }
        }
    }
}
