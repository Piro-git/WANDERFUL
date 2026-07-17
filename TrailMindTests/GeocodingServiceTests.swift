import CoreLocation
import XCTest
@testable import TrailMind

final class GeocodingServiceTests: XCTestCase {
    func testUserFacingErrorsAreDeterministicEnglish() {
        let cases: [(GeocodingServiceError, String)] = [
            (.emptyQuery, "Enter a place name."),
            (
                .noResults(query: "Ilsenburg"),
                "“Ilsenburg” could not be found. Check the place name and try again."
            ),
            (.requestInProgress, "Place search is already in progress. Try again in a moment."),
            (
                .endpointsTooClose,
                "Start and destination could not be distinguished. Use more specific place names."
            ),
            (
                .network,
                "Place search is unavailable right now. Check your connection and try again."
            ),
            (.unavailable, "Place search is not available on this device right now."),
            (
                .failed(message: "Die Internetverbindung scheint offline zu sein."),
                "Place search failed. Try again."
            )
        ]

        for (error, expectedDescription) in cases {
            XCTAssertEqual(error.errorDescription, expectedDescription)
            XCTAssertEqual(error.localizedDescription, expectedDescription)
        }
    }

    @MainActor
    func testUnqualifiedPlacesUseAnEnglishGermanyQualifier() {
        XCTAssertEqual(
            NativeGeocodingService.contextualizedQuery("Ilsenburg"),
            "Ilsenburg, Germany"
        )
        XCTAssertEqual(
            NativeGeocodingService.contextualizedQuery(
                "Schierke",
                locality: "Ilsenburg",
                subAdministrativeArea: "Landkreis Harz",
                administrativeArea: "Saxony-Anhalt"
            ),
            "Schierke, Landkreis Harz, Saxony-Anhalt, Germany"
        )
    }

    @MainActor
    func testExplicitEnglishOrGermanCountryQualifierIsNotRewritten() {
        XCTAssertEqual(
            NativeGeocodingService.contextualizedQuery("Ilsenburg, Germany"),
            "Ilsenburg, Germany"
        )
        XCTAssertEqual(
            NativeGeocodingService.contextualizedQuery("Ilsenburg, Deutschland"),
            "Ilsenburg, Deutschland"
        )
        XCTAssertEqual(
            NativeGeocodingService.contextualizedQuery("Paris, France"),
            "Paris, France"
        )
        XCTAssertEqual(
            NativeGeocodingService.contextualizedQuery("Paris, Frankreich"),
            "Paris, Frankreich"
        )
    }

    @MainActor
    func testInitialSearchRegionIsAnExplicitGermanyBias() throws {
        let region = try XCTUnwrap(
            NativeGeocodingService.searchRegion(for: "Ilsenburg", near: nil)
        )

        XCTAssertEqual(region.identifier, "GermanyBias")
        XCTAssertEqual(
            region.center.latitude,
            NativeGeocodingService.germanyBiasCenter.latitude,
            accuracy: 0.000_001
        )
        XCTAssertEqual(
            region.center.longitude,
            NativeGeocodingService.germanyBiasCenter.longitude,
            accuracy: 0.000_001
        )
        XCTAssertEqual(region.radius, NativeGeocodingService.germanyBiasRadiusMeters)
    }

    @MainActor
    func testDestinationSearchUsesTheResolvedStartInsteadOfTheCountryCenter() throws {
        let start = Coordinate(latitude: 51.8666, longitude: 10.6782)
        let region = try XCTUnwrap(
            NativeGeocodingService.searchRegion(for: "Schierke", near: start)
        )

        XCTAssertEqual(region.identifier, "RouteStartBias")
        XCTAssertEqual(region.center.latitude, start.latitude, accuracy: 0.000_001)
        XCTAssertEqual(region.center.longitude, start.longitude, accuracy: 0.000_001)
        XCTAssertEqual(region.radius, NativeGeocodingService.nearbyBiasRadiusMeters)
    }

    @MainActor
    func testExplicitForeignCountryRemovesGermanyAndRouteStartBiases() {
        let germanStart = Coordinate(latitude: 51.8666, longitude: 10.6782)

        XCTAssertNil(
            NativeGeocodingService.searchRegion(for: "Paris, France", near: nil)
        )
        XCTAssertNil(
            NativeGeocodingService.searchRegion(for: "Paris, Frankreich", near: germanStart)
        )
        XCTAssertFalse(
            NativeGeocodingService.shouldPreferNearbyResults(
                for: "Paris, France",
                near: germanStart
            )
        )
        XCTAssertFalse(
            NativeGeocodingService.shouldPreferNearbyResults(
                for: "Paris, Frankreich",
                near: germanStart
            )
        )
        XCTAssertTrue(
            NativeGeocodingService.shouldPreferNearbyResults(
                for: "Schierke",
                near: germanStart
            )
        )
    }
}
