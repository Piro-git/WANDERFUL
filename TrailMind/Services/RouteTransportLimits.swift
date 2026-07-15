import Foundation

/// Conservative ceilings for provider route responses. The byte limit is far
/// above representative same-day routes while preventing an unbounded body;
/// collection limits independently cap decoder memory and validation work.
struct RouteTransportLimits: Sendable, Equatable {
    static let standard = RouteTransportLimits(
        maximumSuccessBodyBytes: 16 * 1_024 * 1_024,
        maximumErrorBodyBytes: 64 * 1_024,
        maximumPaths: 8,
        maximumCoordinatesPerPath: 100_000,
        maximumInstructionsPerPath: 25_000,
        maximumPathDetailsPerPath: 100_000,
        maximumAbsoluteElevationMeters: 100_000
    )

    let maximumSuccessBodyBytes: Int
    let maximumErrorBodyBytes: Int
    let maximumPaths: Int
    let maximumCoordinatesPerPath: Int
    let maximumInstructionsPerPath: Int
    let maximumPathDetailsPerPath: Int
    let maximumAbsoluteElevationMeters: Double
}

enum RouteTransportValidationError: Error, Sendable {
    case responseTooLarge
    case structuralLimitExceeded
    case invalidGeometry
    case invalidMetrics
    case invalidInstruction
    case invalidPathDetail
}

extension CodingUserInfoKey {
    static let routeTransportLimits = CodingUserInfoKey(
        rawValue: "com.trailmind.route-transport-limits"
    )!
}

struct BoundedRouteHTTPTransport: Sendable {
    private let session: URLSession
    private let limits: RouteTransportLimits

    init(session: URLSession, limits: RouteTransportLimits) {
        self.session = session
        self.limits = limits
    }

    /// Reads the response incrementally. Content-Length is an early rejection
    /// hint only; the received byte count is always enforced as the authority.
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try Task.checkCancellation()
        let (bytes, response) = try await session.bytes(for: request)
        try Task.checkCancellation()

        let maximumBytes: Int
        if let httpResponse = response as? HTTPURLResponse,
           !(200..<300).contains(httpResponse.statusCode)
        {
            maximumBytes = limits.maximumErrorBodyBytes
        } else {
            maximumBytes = limits.maximumSuccessBodyBytes
        }

        guard response.expectedContentLength <= Int64(maximumBytes) else {
            throw RouteTransportValidationError.responseTooLarge
        }

        var data = Data()
        if response.expectedContentLength > 0 {
            data.reserveCapacity(Int(response.expectedContentLength))
        }

        for try await byte in bytes {
            guard data.count < maximumBytes else {
                throw RouteTransportValidationError.responseTooLarge
            }
            data.append(byte)
            if data.count.isMultiple(of: 16 * 1_024) {
                try Task.checkCancellation()
            }
        }

        try Task.checkCancellation()
        return (data, response)
    }
}
