import Foundation

enum PublicAppLinkKind: String, CaseIterable, Sendable {
    case privacyPolicy = "WANDERFUL_PRIVACY_POLICY_URL"
    case support = "WANDERFUL_SUPPORT_URL"
}

enum PublicAppLinkConfiguration: Equatable, Sendable {
    case unavailable
    case invalid
    case configured(URL)

    var url: URL? {
        guard case let .configured(url) = self else { return nil }
        return url
    }
}

struct WanderfulPublicLinks: Equatable, Sendable {
    let privacyPolicy: PublicAppLinkConfiguration
    let support: PublicAppLinkConfiguration

    static var current: WanderfulPublicLinks {
        resolve(infoDictionary: Bundle.main.infoDictionary ?? [:])
    }

    static func resolve(infoDictionary: [String: Any]) -> WanderfulPublicLinks {
        WanderfulPublicLinks(
            privacyPolicy: configuration(
                value: infoDictionary[PublicAppLinkKind.privacyPolicy.rawValue]
            ),
            support: configuration(
                value: infoDictionary[PublicAppLinkKind.support.rawValue]
            )
        )
    }

    static func configuration(value: Any?) -> PublicAppLinkConfiguration {
        guard let value else { return .unavailable }
        guard let rawValue = value as? String else { return .invalid }
        guard !rawValue.isEmpty else { return .unavailable }
        guard rawValue == rawValue.trimmingCharacters(in: .whitespacesAndNewlines) else {
            return .invalid
        }
        guard rawValue.utf8.count <= 2_048 else { return .invalid }
        guard !rawValue.contains("$(") else { return .invalid }
        guard let components = URLComponents(string: rawValue),
              components.scheme == "https",
              components.user == nil,
              components.password == nil,
              components.port == nil,
              components.query == nil,
              components.fragment == nil,
              let host = components.host,
              isValidPublicHost(host),
              let url = components.url,
              url.absoluteString == rawValue
        else {
            return .invalid
        }
        return .configured(url)
    }

    private static func isValidPublicHost(_ host: String) -> Bool {
        guard host == host.lowercased(),
              host.utf8.count <= 253,
              host.contains("."),
              !host.contains(":"),
              !host.hasPrefix("."),
              !host.hasSuffix("."),
              !host.contains("..")
        else {
            return false
        }

        let placeholderMarkers = [
            "placeholder", "yourdomain", "your-domain", "change-me", "changeme"
        ]
        guard !placeholderMarkers.contains(where: host.contains) else { return false }

        let deniedHosts = ["example.com", "example.net", "example.org"]
        guard !deniedHosts.contains(host),
              !deniedHosts.contains(where: { host.hasSuffix(".\($0)") }),
              !host.hasSuffix(".localhost"),
              !host.hasSuffix(".local"),
              !host.hasSuffix(".internal"),
              !host.hasSuffix(".invalid"),
              !host.hasSuffix(".test")
        else {
            return false
        }

        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2 else { return false }
        guard labels.allSatisfy({ label in
            guard !label.isEmpty,
                  label.count <= 63,
                  label.first != "-",
                  label.last != "-"
            else {
                return false
            }
            return label.utf8.allSatisfy { byte in
                (byte >= 48 && byte <= 57)
                    || (byte >= 97 && byte <= 122)
                    || byte == 45
            }
        }) else {
            return false
        }

        // A digits-and-dots host is an IP literal, not a reviewed public domain.
        guard !host.allSatisfy({ $0.isNumber || $0 == "." }) else { return false }
        return true
    }
}
