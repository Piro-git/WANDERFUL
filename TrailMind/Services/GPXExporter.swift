import Foundation
import UniformTypeIdentifiers

nonisolated protocol GPXService: Sendable {
    @MainActor
    func prepareExport(route: TrailRoute) async throws -> PreparedGPXExport
    @discardableResult
    func cleanup(_ export: PreparedGPXExport) async -> Bool
    @discardableResult
    func recoverAbandonedExports() async -> Bool
}

nonisolated enum GPXContentType {
    static let gpx = UTType(filenameExtension: "gpx", conformingTo: .xml) ?? .xml
}

nonisolated struct PreparedGPXExport: Identifiable, Hashable, Sendable {
    let id: UUID
    let fileURL: URL
    let filename: String
    let contentType: UTType
    fileprivate let directoryURL: URL

    var contentTypeIdentifier: String {
        contentType.identifier
    }
}

nonisolated enum GPXExportError: LocalizedError, Equatable, Sendable {
    case temporaryStorageUnavailable
    case fileWriteFailed
    case fileProtectionFailed
    case invalidDocument
    case shareFailed
    case cleanupFailed

    var errorDescription: String? {
        switch self {
        case .temporaryStorageUnavailable:
            "Wanderful could not prepare a private temporary export location."
        case .fileWriteFailed:
            "Wanderful could not create the GPX file."
        case .fileProtectionFailed:
            "Wanderful could not protect the GPX file."
        case .invalidDocument:
            "Wanderful could not create a valid GPX document."
        case .shareFailed:
            "Wanderful could not share the GPX file."
        case .cleanupFailed:
            "Wanderful could not remove the temporary GPX file."
        }
    }

    static func userMessage(for error: Error) -> String {
        if let cleanupRequired = error as? GPXCleanupRequiredError {
            if cleanupRequired.primaryError == nil {
                return "Wanderful could not remove the cancelled temporary GPX file. Retry cleanup before exporting again."
            }
            return "Wanderful could not finish the GPX export or remove its temporary file. Retry cleanup before exporting again."
        }
        if error is RouteEligibilityError {
            return "This route cannot be exported because its verified route data is unavailable or invalid."
        }
        if let exportError = error as? GPXExportError {
            switch exportError {
            case .shareFailed:
                return "Wanderful could not share the GPX file. Please try again."
            case .cleanupFailed:
                return "Wanderful could not remove the temporary GPX file. Retry cleanup before exporting again."
            case .temporaryStorageUnavailable, .fileWriteFailed, .fileProtectionFailed, .invalidDocument:
                break
            }
        }
        return "Wanderful could not create a protected GPX file. Please try again."
    }
}

nonisolated struct GPXCleanupRequiredError: LocalizedError, Equatable, Sendable {
    let primaryError: GPXExportError?
    let export: PreparedGPXExport

    var errorDescription: String? {
        GPXExportError.userMessage(for: self)
    }
}

nonisolated struct GPXDirectoryEntry: Sendable {
    let url: URL
    let isDirectory: Bool
    let isSymbolicLink: Bool
    let modificationDate: Date?
}

nonisolated protocol GPXFileSystem: Sendable {
    func createDirectory(at url: URL, withIntermediateDirectories: Bool) throws
    func atomicWrite(_ data: Data, to url: URL) throws
    func protectFile(at url: URL) throws
    func directoryEntry(at url: URL) throws -> GPXDirectoryEntry
    func contentsOfDirectory(at url: URL) throws -> [GPXDirectoryEntry]
    func removeItem(at url: URL) throws
}

nonisolated private final class GPXExportRegistry: @unchecked Sendable {
    private enum Status: Equatable {
        case active
        case cleanupPending
    }

    private let lock = NSLock()
    private var statuses: [URL: Status] = [:]

    func register(_ directoryURL: URL) {
        withLock {
            statuses[directoryURL.standardizedFileURL] = .active
        }
    }

    func markCleanupPending(_ directoryURL: URL) {
        withLock {
            statuses[directoryURL.standardizedFileURL] = .cleanupPending
        }
    }

    func remove(_ directoryURL: URL) {
        withLock {
            _ = statuses.removeValue(forKey: directoryURL.standardizedFileURL)
        }
    }

    func contains(_ directoryURL: URL) -> Bool {
        withLock {
            statuses[directoryURL.standardizedFileURL] != nil
        }
    }

    func cleanupPendingDirectories(under rootURL: URL) -> [URL] {
        let standardizedRoot = rootURL.standardizedFileURL
        return withLock {
            statuses.compactMap { url, status in
                guard
                    status == .cleanupPending,
                    url.deletingLastPathComponent() == standardizedRoot
                else { return nil }
                return url
            }
        }
    }

    func hasCleanupPendingDirectories(under rootURL: URL) -> Bool {
        !cleanupPendingDirectories(under: rootURL).isEmpty
    }

    private func withLock<T>(_ operation: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return operation()
    }
}

nonisolated struct SystemGPXFileSystem: GPXFileSystem {
    func createDirectory(at url: URL, withIntermediateDirectories: Bool) throws {
        try FileManager.default.createDirectory(
            at: url,
            withIntermediateDirectories: withIntermediateDirectories
        )
    }

    func atomicWrite(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: [.atomic, .completeFileProtection])
    }

    func protectFile(at url: URL) throws {
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.complete],
            ofItemAtPath: url.path
        )
    }

    func directoryEntry(at url: URL) throws -> GPXDirectoryEntry {
        let keys: Set<URLResourceKey> = [
            .contentModificationDateKey,
            .isDirectoryKey,
            .isSymbolicLinkKey
        ]
        let values = try url.resourceValues(forKeys: keys)
        return GPXDirectoryEntry(
            url: url,
            isDirectory: values.isDirectory == true,
            isSymbolicLink: values.isSymbolicLink == true,
            modificationDate: values.contentModificationDate
        )
    }

    func contentsOfDirectory(at url: URL) throws -> [GPXDirectoryEntry] {
        let keys: Set<URLResourceKey> = [
            .contentModificationDateKey,
            .isDirectoryKey,
            .isSymbolicLinkKey
        ]
        return try FileManager.default.contentsOfDirectory(
            at: url,
            includingPropertiesForKeys: Array(keys),
            options: []
        ).map { itemURL in
            let values = try itemURL.resourceValues(forKeys: keys)
            return GPXDirectoryEntry(
                url: itemURL,
                isDirectory: values.isDirectory == true,
                isSymbolicLink: values.isSymbolicLink == true,
                modificationDate: values.contentModificationDate
            )
        }
    }

    func removeItem(at url: URL) throws {
        try FileManager.default.removeItem(at: url)
    }
}

nonisolated private struct GPXRouteSnapshot: Sendable {
    let title: String
    let path: [GeoPoint]
}

nonisolated struct DefaultGPXService: GPXService {
    static let creator = "Wanderful"
    static let namespace = "http://www.topografix.com/GPX/1/1"
    static let fallbackFilename = "Wanderful-Route.gpx"
    static let maximumFilenameStemBytes = 96

    private static let exportRootName = "TrailMind-GPX-Exports"
    private static let exportDirectoryPrefix = "Export-"
    private static let registry = GPXExportRegistry()

    private let canonicalExportRootDirectory: URL
    private let fileSystem: any GPXFileSystem
    private let now: @Sendable () -> Date
    private let makeIdentifier: @Sendable () -> UUID
    private let staleExportAge: TimeInterval
    private let maximumStaleRemovals: Int
    private let executionProbe: @Sendable () -> Void

    init(
        temporaryDirectory: URL = FileManager.default.temporaryDirectory,
        fileSystem: any GPXFileSystem = SystemGPXFileSystem(),
        now: @escaping @Sendable () -> Date = Date.init,
        makeIdentifier: @escaping @Sendable () -> UUID = UUID.init,
        staleExportAge: TimeInterval = 24 * 60 * 60,
        maximumStaleRemovals: Int = 20,
        executionProbe: @escaping @Sendable () -> Void = {}
    ) {
        self.canonicalExportRootDirectory = temporaryDirectory
            .resolvingSymlinksInPath()
            .standardizedFileURL
            .appendingPathComponent(Self.exportRootName, isDirectory: true)
        self.fileSystem = fileSystem
        self.now = now
        self.makeIdentifier = makeIdentifier
        self.staleExportAge = max(staleExportAge, 0)
        self.maximumStaleRemovals = max(maximumStaleRemovals, 0)
        self.executionProbe = executionProbe
    }

    var exportRootDirectory: URL {
        canonicalExportRootDirectory
    }

    @MainActor
    func prepareExport(route: TrailRoute) async throws -> PreparedGPXExport {
        try RouteEligibilityPolicy.validate(route, for: .export)
        let snapshot = GPXRouteSnapshot(title: route.title, path: route.path)
        let task = Task.detached(priority: .userInitiated) { [self] in
            try prepareExportSynchronously(snapshot: snapshot)
        }
        return try await withTaskCancellationHandler {
            try await task.value
        } onCancel: {
            task.cancel()
        }
    }

    private func prepareExportSynchronously(snapshot: GPXRouteSnapshot) throws -> PreparedGPXExport {
        executionProbe()
        try Task.checkCancellation()
        try recoverAbandonedExportsSynchronously()
        try Task.checkCancellation()
        let data = try encodedGPX(snapshot: snapshot)
        try Task.checkCancellation()

        let identifier = makeIdentifier()
        let directoryURL = exportRootDirectory.appendingPathComponent(
            Self.exportDirectoryPrefix + identifier.uuidString,
            isDirectory: true
        )
        let filename = Self.sanitizedFilename(for: snapshot.title)
        let fileURL = directoryURL.appendingPathComponent(filename, isDirectory: false)

        let export = PreparedGPXExport(
            id: identifier,
            fileURL: fileURL,
            filename: filename,
            contentType: GPXContentType.gpx,
            directoryURL: directoryURL
        )

        Self.registry.register(directoryURL)
        do {
            try fileSystem.createDirectory(at: directoryURL, withIntermediateDirectories: false)
        } catch {
            try failAfterCreatedDirectory(export, primaryError: .temporaryStorageUnavailable)
        }

        do {
            try Task.checkCancellation()
        } catch {
            try failAfterCreatedDirectory(export, primaryError: nil)
        }

        do {
            try fileSystem.atomicWrite(data, to: fileURL)
        } catch {
            try failAfterCreatedDirectory(export, primaryError: .fileWriteFailed)
        }

        do {
            try Task.checkCancellation()
        } catch {
            try failAfterCreatedDirectory(export, primaryError: nil)
        }

        do {
            try fileSystem.protectFile(at: fileURL)
        } catch {
            try failAfterCreatedDirectory(export, primaryError: .fileProtectionFailed)
        }

        do {
            try Task.checkCancellation()
        } catch {
            try failAfterCreatedDirectory(export, primaryError: nil)
        }
        return export
    }

    @discardableResult
    func cleanup(_ export: PreparedGPXExport) async -> Bool {
        await Task.detached(priority: .utility) { [self] in
            cleanupSynchronously(export)
        }.value
    }

    private func cleanupSynchronously(_ export: PreparedGPXExport) -> Bool {
        executionProbe()
        let expectedDirectoryName = Self.exportDirectoryPrefix + export.id.uuidString
        let directoryURL = export.directoryURL.standardizedFileURL
        let rootURL = exportRootDirectory.standardizedFileURL
        guard
            directoryURL.deletingLastPathComponent() == rootURL,
            directoryURL.lastPathComponent == expectedDirectoryName
        else { return false }

        do {
            let rootEntry = try fileSystem.directoryEntry(at: rootURL)
            guard rootEntry.isDirectory, !rootEntry.isSymbolicLink else {
                Self.registry.markCleanupPending(directoryURL)
                return false
            }
        } catch {
            if Self.isMissingFileError(error) {
                Self.registry.remove(directoryURL)
                return true
            }
            Self.registry.markCleanupPending(directoryURL)
            return false
        }

        do {
            try fileSystem.removeItem(at: directoryURL)
            Self.registry.remove(directoryURL)
            return true
        } catch {
            if Self.isMissingFileError(error) {
                Self.registry.remove(directoryURL)
                return true
            }
            Self.registry.markCleanupPending(directoryURL)
            return false
        }
    }

    func cleanupStaleExports() async throws {
        let task = Task.detached(priority: .utility) { [self] in
            try cleanupStaleExportsSynchronously()
        }
        return try await withTaskCancellationHandler {
            try await task.value
        } onCancel: {
            task.cancel()
        }
    }

    /// The registry is process-local. An owned export directory absent from it belongs to a
    /// previous process/session and can be removed immediately; current active exports remain
    /// registered and are never swept by this recovery pass.
    @discardableResult
    func recoverAbandonedExports() async -> Bool {
        await Task.detached(priority: .utility) { [self] in
            executionProbe()
            do {
                try recoverAbandonedExportsSynchronously()
                return true
            } catch {
                return false
            }
        }.value
    }

    private func cleanupStaleExportsSynchronously() throws {
        do {
            try ensureExportRootSynchronously()
            _ = retryAllPendingCleanupSynchronously()
            try performStaleCleanup()
            guard !Self.registry.hasCleanupPendingDirectories(under: exportRootDirectory) else {
                throw GPXExportError.cleanupFailed
            }
        } catch let error as GPXExportError {
            throw error
        } catch {
            throw GPXExportError.temporaryStorageUnavailable
        }
    }

    private func recoverAbandonedExportsSynchronously() throws {
        do {
            try ensureExportRootSynchronously()
            _ = retryAllPendingCleanupSynchronously()

            let rootURL = exportRootDirectory.standardizedFileURL
            let entries = try fileSystem.contentsOfDirectory(at: rootURL)
            for entry in entries {
                let directoryURL = entry.url.standardizedFileURL
                guard
                    entry.isDirectory,
                    !entry.isSymbolicLink,
                    Self.isOwnedExportDirectory(directoryURL, under: rootURL),
                    !Self.registry.contains(directoryURL)
                else { continue }

                do {
                    try fileSystem.removeItem(at: directoryURL)
                    Self.registry.remove(directoryURL)
                } catch where Self.isMissingFileError(error) {
                    Self.registry.remove(directoryURL)
                    continue
                } catch {
                    Self.registry.markCleanupPending(directoryURL)
                }
            }

            guard !Self.registry.hasCleanupPendingDirectories(under: rootURL) else {
                throw GPXExportError.cleanupFailed
            }
        } catch let error as GPXExportError {
            throw error
        } catch {
            throw GPXExportError.temporaryStorageUnavailable
        }
    }

    private func ensureExportRootSynchronously() throws {
        try fileSystem.createDirectory(
            at: exportRootDirectory,
            withIntermediateDirectories: true
        )
        let rootEntry = try fileSystem.directoryEntry(at: exportRootDirectory)
        guard rootEntry.isDirectory, !rootEntry.isSymbolicLink else {
            throw GPXExportError.temporaryStorageUnavailable
        }
    }

    private func retryAllPendingCleanupSynchronously() -> Bool {
        let rootURL = exportRootDirectory.standardizedFileURL
        for directoryURL in Self.registry.cleanupPendingDirectories(under: rootURL) {
            guard Self.isOwnedExportDirectory(directoryURL, under: rootURL) else {
                Self.registry.remove(directoryURL)
                continue
            }
            do {
                try fileSystem.removeItem(at: directoryURL)
                Self.registry.remove(directoryURL)
            } catch where Self.isMissingFileError(error) {
                Self.registry.remove(directoryURL)
            } catch {
                Self.registry.markCleanupPending(directoryURL)
            }
        }

        return !Self.registry.hasCleanupPendingDirectories(under: rootURL)
    }

    private func failAfterCreatedDirectory(
        _ export: PreparedGPXExport,
        primaryError: GPXExportError?
    ) throws -> Never {
        if cleanupSynchronously(export) {
            if let primaryError {
                throw primaryError
            }
            throw CancellationError()
        }
        throw GPXCleanupRequiredError(primaryError: primaryError, export: export)
    }

    #if DEBUG
    // Compatibility for deterministic legacy tests. Release product sharing has no raw-string path.
    @MainActor
    func exportRouteAsGPX(route: TrailRoute) throws -> String {
        try RouteEligibilityPolicy.validate(route, for: .export)
        let snapshot = GPXRouteSnapshot(title: route.title, path: route.path)
        return String(decoding: try encodedGPX(snapshot: snapshot), as: UTF8.self)
    }
    #endif

    @MainActor
    func encodedGPX(for route: TrailRoute) async throws -> Data {
        try RouteEligibilityPolicy.validate(route, for: .export)
        let snapshot = GPXRouteSnapshot(title: route.title, path: route.path)
        let task = Task.detached(priority: .userInitiated) { [self] in
            try encodedGPX(snapshot: snapshot)
        }
        return try await withTaskCancellationHandler {
            try await task.value
        } onCancel: {
            task.cancel()
        }
    }

    private func encodedGPX(snapshot: GPXRouteSnapshot) throws -> Data {
        try Task.checkCancellation()

        let name = Self.escapedXMLText(snapshot.title)
        var points = ""
        for (index, point) in snapshot.path.enumerated() {
            if index.isMultiple(of: 256) {
                try Task.checkCancellation()
            }
            let latitude = Self.decimalString(point.latitude)
            let longitude = Self.decimalString(point.longitude)
            let encodedPoint: String
            if let elevation = point.elevationMeters {
                encodedPoint = """
                      <trkpt lat="\(latitude)" lon="\(longitude)">
                        <ele>\(Self.decimalString(elevation))</ele>
                      </trkpt>
                """
            } else {
                encodedPoint = "      <trkpt lat=\"\(latitude)\" lon=\"\(longitude)\"></trkpt>"
            }
            if !points.isEmpty {
                points.append("\n")
            }
            points.append(encodedPoint)
        }
        try Task.checkCancellation()

        let document = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="\(Self.creator)" xmlns="\(Self.namespace)">
          <trk>
            <name>\(name)</name>
            <trkseg>
        \(points)
            </trkseg>
          </trk>
        </gpx>
        """
        let data = Data(document.utf8)
        try Task.checkCancellation()
        let parser = XMLParser(data: data)
        let cancellationDelegate = GPXCancellationParserDelegate()
        parser.delegate = cancellationDelegate
        guard parser.parse() else {
            if cancellationDelegate.wasCancelled || Task.isCancelled {
                throw CancellationError()
            }
            throw GPXExportError.invalidDocument
        }
        try Task.checkCancellation()
        return data
    }

    static func sanitizedFilename(for title: String) -> String {
        var stem = title
            .precomposedStringWithCanonicalMapping
            .trimmingCharacters(in: .whitespacesAndNewlines)

        while stem.lowercased().hasSuffix(".gpx") {
            stem.removeLast(4)
            stem = stem.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        let allowedPunctuation = CharacterSet(charactersIn: " -_()&'")
        var sanitized = ""
        for scalar in stem.unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) || allowedPunctuation.contains(scalar) {
                sanitized.unicodeScalars.append(scalar)
            } else if CharacterSet.whitespacesAndNewlines.contains(scalar) {
                appendFilenameSeparator(" ", to: &sanitized)
            } else {
                appendFilenameSeparator("-", to: &sanitized)
            }
        }

        sanitized = sanitized.trimmingCharacters(in: CharacterSet(charactersIn: " -_"))
        var limited = ""
        for character in sanitized {
            guard limited.utf8.count + character.utf8.count <= maximumFilenameStemBytes else {
                break
            }
            limited.append(character)
        }
        limited = limited.trimmingCharacters(in: CharacterSet(charactersIn: " -_"))

        guard !limited.isEmpty else { return fallbackFilename }
        return limited + ".gpx"
    }

    static func decimalString(_ value: Double) -> String {
        precondition(value.isFinite)
        guard value != 0 else { return "0" }

        let description = String(value).lowercased()
        guard let exponentMarker = description.firstIndex(of: "e") else {
            return description.hasSuffix(".0") ? String(description.dropLast(2)) : description
        }

        var mantissa = String(description[..<exponentMarker])
        let exponentText = description[description.index(after: exponentMarker)...]
        guard let exponent = Int(exponentText) else { return description }

        var sign = ""
        if mantissa.first == "-" || mantissa.first == "+" {
            sign = mantissa.first == "-" ? "-" : ""
            mantissa.removeFirst()
        }

        let decimalIndex: Int
        if let decimalPoint = mantissa.firstIndex(of: ".") {
            decimalIndex = mantissa.distance(from: mantissa.startIndex, to: decimalPoint)
            mantissa.remove(at: decimalPoint)
        } else {
            decimalIndex = mantissa.count
        }

        let shiftedIndex = decimalIndex + exponent
        let magnitude: String
        if shiftedIndex <= 0 {
            magnitude = "0." + String(repeating: "0", count: -shiftedIndex) + mantissa
        } else if shiftedIndex >= mantissa.count {
            magnitude = mantissa + String(repeating: "0", count: shiftedIndex - mantissa.count)
        } else {
            let insertionIndex = mantissa.index(mantissa.startIndex, offsetBy: shiftedIndex)
            magnitude = String(mantissa[..<insertionIndex]) + "." + String(mantissa[insertionIndex...])
        }
        return sign + magnitude
    }

    private func performStaleCleanup() throws {
        guard maximumStaleRemovals > 0 else { return }
        let rootURL = exportRootDirectory.standardizedFileURL
        let cutoff = now().addingTimeInterval(-staleExportAge)
        let candidates = try fileSystem.contentsOfDirectory(at: rootURL)
            .filter { entry in
                let url = entry.url.standardizedFileURL
                guard
                    url.deletingLastPathComponent() == rootURL,
                    entry.isDirectory,
                    !entry.isSymbolicLink,
                    !Self.registry.contains(url),
                    let modificationDate = entry.modificationDate,
                    modificationDate <= cutoff
                else { return false }

                let name = url.lastPathComponent
                guard name.hasPrefix(Self.exportDirectoryPrefix) else { return false }
                return UUID(uuidString: String(name.dropFirst(Self.exportDirectoryPrefix.count))) != nil
            }
            .sorted {
                ($0.modificationDate ?? .distantFuture) < ($1.modificationDate ?? .distantFuture)
            }

        for entry in candidates.prefix(maximumStaleRemovals) {
            try? fileSystem.removeItem(at: entry.url)
        }
    }

    private static func isOwnedExportDirectory(_ directoryURL: URL, under rootURL: URL) -> Bool {
        let standardizedDirectory = directoryURL.standardizedFileURL
        let standardizedRoot = rootURL.standardizedFileURL
        guard standardizedDirectory.deletingLastPathComponent() == standardizedRoot else {
            return false
        }
        let name = standardizedDirectory.lastPathComponent
        guard name.hasPrefix(exportDirectoryPrefix) else { return false }
        return UUID(uuidString: String(name.dropFirst(exportDirectoryPrefix.count))) != nil
    }

    private static func escapedXMLText(_ text: String) -> String {
        var cleanText = ""
        for scalar in text.unicodeScalars where isValidXMLScalar(scalar) {
            cleanText.unicodeScalars.append(scalar)
        }
        if cleanText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            cleanText = "Wanderful Route"
        }

        var escaped = ""
        for scalar in cleanText.unicodeScalars {
            switch scalar.value {
            case 0x26: escaped += "&amp;"
            case 0x3C: escaped += "&lt;"
            case 0x3E: escaped += "&gt;"
            case 0x22: escaped += "&quot;"
            case 0x27: escaped += "&apos;"
            default: escaped.unicodeScalars.append(scalar)
            }
        }
        return escaped
    }

    private static func isValidXMLScalar(_ scalar: UnicodeScalar) -> Bool {
        switch scalar.value {
        case 0x9, 0xA, 0xD, 0x20...0xD7FF, 0xE000...0xFFFD, 0x10000...0x10FFFF:
            true
        default:
            false
        }
    }

    private static func appendFilenameSeparator(_ separator: Character, to value: inout String) {
        guard let last = value.last, last != " ", last != "-", last != "_" else {
            if value.isEmpty { return }
            return
        }
        value.append(separator)
    }

    private static func isMissingFileError(_ error: Error) -> Bool {
        let cocoaError = error as NSError
        let missingFileCodes = [
            CocoaError.fileNoSuchFile.rawValue,
            CocoaError.fileReadNoSuchFile.rawValue
        ]
        return cocoaError.domain == NSCocoaErrorDomain && missingFileCodes.contains(cocoaError.code)
    }
}

nonisolated private final class GPXCancellationParserDelegate: NSObject, XMLParserDelegate {
    private(set) var wasCancelled = false

    func parser(
        _ parser: XMLParser,
        didStartElement elementName: String,
        namespaceURI: String?,
        qualifiedName qName: String?,
        attributes attributeDict: [String: String] = [:]
    ) {
        guard Task.isCancelled else { return }
        wasCancelled = true
        parser.abortParsing()
    }
}
