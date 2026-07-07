import Foundation

struct GraphHopperConfiguration: Sendable {
    nonisolated static let infoPlistKey = "GRAPHHOPPER_API_KEY"

    let apiKey: String
    let baseURL: URL

    nonisolated init(
        apiKey: String,
        baseURL: URL = URL(string: "https://graphhopper.com/api/1")!
    ) throws {
        let cleanKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.isUsableKey(cleanKey) else {
            throw GraphHopperError.missingAPIKey
        }
        self.apiKey = cleanKey
        self.baseURL = baseURL
    }

    nonisolated static func local(
        bundle: Bundle = .main,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> GraphHopperConfiguration {
        if let environmentKey = environment[infoPlistKey], isUsableKey(environmentKey) {
            return try GraphHopperConfiguration(apiKey: environmentKey)
        }
        if let plistValue = bundle.object(forInfoDictionaryKey: infoPlistKey) as? String,
           isUsableKey(plistValue) {
            return try GraphHopperConfiguration(apiKey: plistValue)
        }
        throw GraphHopperError.missingAPIKey
    }

    private nonisolated static func isUsableKey(_ key: String) -> Bool {
        let cleanKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
        return !cleanKey.isEmpty
            && !cleanKey.contains("$(")
            && !cleanKey.localizedCaseInsensitiveContains("paste_your")
            && !cleanKey.localizedCaseInsensitiveContains("replace_me")
    }
}
