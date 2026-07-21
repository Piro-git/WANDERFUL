export function outdoorEvidenceRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    routeFingerprint: "abc123",
    geometry: [
      { latitude: 51.80, longitude: 10.61 },
      { latitude: 51.81, longitude: 10.63 },
      { latitude: 51.82, longitude: 10.65 }
    ],
    corridorWidthMeters: 100,
    ...overrides
  };
}

export function outdoorEvidenceDatabaseRow(overrides = {}) {
  const harzImportId = "11111111-1111-4111-8111-111111111111";
  const harzDataset = "Geofabrik Saxony-Anhalt regional extract";
  return {
    regions: [outdoorEvidenceRegionRow()],
    route_length_meters: 1_000,
    covered_length_meters: 1_000,
    highway_coverage_meters: 800,
    surface_coverage_meters: 600,
    trail_visibility_coverage_meters: 400,
    sac_scale_coverage_meters: 300,
    access_coverage_meters: 200,
    mapped_hiking_relation_meters: 500,
    maximum_sac_scale_rank: 3,
    highway_breakdown: [
      { value: "path", lengthMeters: 500 },
      { value: "track", lengthMeters: 300 }
    ],
    surface_breakdown: [{ value: "ground", lengthMeters: 600 }],
    trail_visibility_breakdown: [{ value: "good", lengthMeters: 400 }],
    sac_scale_breakdown: [{ value: "mountain_hiking", lengthMeters: 300 }],
    explicit_access_restrictions: [{
      osmType: "way", osmId: "42", access: "private", foot: null,
      conditional: false, seasonal: false, permitRequired: false
    }],
    mapped_poi_counts: { viewpoint: 1, peak: 1 },
    mapped_pois: [{
      osmType: "node", osmId: "7", category: "viewpoint", name: "Mapped Lookout",
      latitude: 51.81, longitude: 10.63, distanceFromRouteMeters: 12,
      regionId: "harz-v1", importId: harzImportId, sourceDataset: harzDataset,
      sourceVersion: 3, sourceTimestamp: "2026-07-18T00:00:00Z"
    }],
    ...overrides
  };
}

export function outdoorEvidenceRegionRow(overrides = {}) {
  return {
    id: "harz-v1",
    name: "Harz v1",
    coveredLengthMeters: 1_000,
    freshnessThresholdDays: 14,
    importId: "11111111-1111-4111-8111-111111111111",
    importStatus: "active",
    sourceDataset: "Geofabrik Saxony-Anhalt regional extract",
    sourceIdentifier: "https://download.geofabrik.de/europe/germany/sachsen-anhalt.html",
    sourceDataTimestamp: new Date("2026-07-19T00:00:00Z"),
    importedTimestamp: new Date("2026-07-19T02:00:00Z"),
    ...overrides
  };
}

export function innsbruckOutdoorEvidenceRegionRow(overrides = {}) {
  return outdoorEvidenceRegionRow({
    id: "innsbruck-alps-v1",
    name: "Innsbruck Alpine Pilot v1",
    importId: "22222222-2222-4222-8222-222222222222",
    sourceDataset: "Operator-selected Tyrol regional OSM extract",
    sourceIdentifier: "operator-supplied-tyrol-pilot-extract",
    ...overrides
  });
}
