export function planningRequestFixture() {
  return {
    schemaVersion: 1,
    prompt: "Plan a quiet hiking loop from Ilsenburg with a viewpoint.",
    locale: "en",
    userLocationHint: "Harz, Germany"
  };
}

export function routePlanFixture() {
  return {
    schemaVersion: 1,
    intent: {
      activityType: "hiking",
      routeType: "loop",
      startLocationName: "Ilsenburg",
      endLocationName: null,
      targetDistanceKm: 12,
      targetDurationMinutes: null,
      difficulty: "moderate",
      requestedFeatures: ["viewpoint", "quiet"],
      avoidFeatures: ["majorRoads"]
    },
    candidates: [{
      stops: [{ role: "highlight", kind: "viewpoint", name: "Ilsenstein" }]
    }]
  };
}
export function openAIResponseFixture(plan = routePlanFixture()) {
  return {
    id: "resp_fixture",
    status: "completed",
    output: [{
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: JSON.stringify(plan), annotations: [] }]
    }]
  };
}

export function graphHopperResponseFixture() {
  return {
    locale: "en",
    hits: [{
      point: { lat: 51.866, lng: 10.664 },
      name: "Ilsenburg",
      city: "Ilsenburg",
      state: "Saxony-Anhalt",
      country: "Germany",
      osm_key: "place",
      osm_value: "town"
    }]
  };
}
