import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyHikingRelation,
  classifyOutdoorPoi,
  explicitAccessRestriction,
  hasNonCurrentLifecycle,
  normalizeTrailSegment
} from "../src/outdoorEvidence/classification.js";

const ALPINE_POI_FIXTURES = Object.freeze([
  [{ tourism: "alpine_hut", name: "Mapped alpine hut" }, "alpineHut"],
  [{ tourism: "wilderness_hut", name: "Mapped wilderness hut" }, "wildernessHut"],
  [{ natural: "peak", name: "Mapped peak" }, "peak"],
  [{ tourism: "viewpoint", name: "Mapped viewpoint" }, "viewpoint"],
  [{ natural: "water", water: "lake", name: "Mapped lake" }, "lake"],
  [{ waterway: "waterfall", name: "Mapped waterfall" }, "waterfall"]
]);

const ALPINE_TRAIL_FIXTURES = Object.freeze([
  {
    tags: {
      highway: "path", surface: "rock", trail_visibility: "bad",
      sac_scale: "demanding_mountain_hiking", foot: "private"
    },
    expected: {
      highwayClass: "path", surface: "rock", trailVisibility: "bad",
      sacScale: "demanding_mountain_hiking", access: undefined, foot: "private",
      accessConditional: undefined, footConditional: undefined,
      seasonal: undefined, permit: undefined
    }
  },
  {
    tags: { highway: "steps", surface: "ground", access: "permit", seasonal: "yes" },
    expected: {
      highwayClass: "steps", surface: "ground", trailVisibility: undefined,
      sacScale: undefined, access: "permit", foot: undefined,
      accessConditional: undefined, footConditional: undefined,
      seasonal: "yes", permit: undefined
    }
  },
  {
    tags: { highway: "track" },
    expected: {
      highwayClass: "track", surface: undefined, trailVisibility: undefined,
      sacScale: undefined, access: undefined, foot: undefined,
      accessConditional: undefined, footConditional: undefined,
      seasonal: undefined, permit: undefined
    }
  }
]);

describe("OSM outdoor evidence classification", () => {
  it("classifies only documented mapped POI tags", () => {
    assert.equal(classifyOutdoorPoi({ tourism: "viewpoint" }), "viewpoint");
    assert.equal(classifyOutdoorPoi({ natural: "peak" }), "peak");
    assert.equal(classifyOutdoorPoi({ natural: "water", water: "lake" }), "lake");
    assert.equal(classifyOutdoorPoi({ natural: "water" }), undefined);
    assert.equal(classifyOutdoorPoi({ waterway: "waterfall" }), "waterfall");
    assert.equal(classifyOutdoorPoi({ tourism: "alpine_hut" }), "alpineHut");
    assert.equal(classifyOutdoorPoi({ tourism: "wilderness_hut" }), "wildernessHut");
  });

  it("classifies the deterministic Alpine POI fixture without availability claims", () => {
    for (const [tags, category] of ALPINE_POI_FIXTURES) {
      assert.equal(classifyOutdoorPoi(tags), category);
      assert.equal("opening_hours" in tags, false);
      assert.equal("drinking_water" in tags, false);
      assert.equal("safe" in tags, false);
    }
  });

  it("excludes lifecycle-tagged non-current objects", () => {
    assert.equal(hasNonCurrentLifecycle({ "abandoned:highway": "path" }), true);
    assert.equal(classifyOutdoorPoi({ tourism: "viewpoint", disused: "yes" }), undefined);
    assert.equal(normalizeTrailSegment({ highway: "proposed" }), undefined);
    assert.equal(classifyHikingRelation({ type: "route", route: "hiking", state: "proposed" }), undefined);
  });

  it("uses mapped hiking relation terminology without inferring official status", () => {
    assert.deepEqual(
      classifyHikingRelation({ type: "route", route: "hiking", network: "rwn", operator: "Club" }),
      { routeType: "hiking", network: "rwn", state: "current" }
    );
    assert.deepEqual(
      classifyHikingRelation({ type: "route", route: "foot", network: "unknown", state: "alternate" }),
      { routeType: "foot", network: undefined, state: "alternate" }
    );
  });

  it("normalizes path attributes and leaves missing attributes unknown", () => {
    assert.deepEqual(normalizeTrailSegment({ highway: "path" }), {
      highwayClass: "path", surface: undefined, trailVisibility: undefined,
      sacScale: undefined, access: undefined, foot: undefined,
      accessConditional: undefined, footConditional: undefined,
      seasonal: undefined, permit: undefined
    });
    assert.equal(normalizeTrailSegment({ highway: "path", sac_scale: "T1" }).sacScale, undefined);
    assert.equal(normalizeTrailSegment({ highway: "path", trail_visibility: "good" }).trailVisibility, "good");
  });

  it("normalizes deterministic Alpine path, surface, visibility, SAC and restriction fixtures", () => {
    for (const fixture of ALPINE_TRAIL_FIXTURES) {
      assert.deepEqual(normalizeTrailSegment(fixture.tags), fixture.expected);
    }
    assert.equal(explicitAccessRestriction(ALPINE_TRAIL_FIXTURES[0].expected), true);
    assert.equal(explicitAccessRestriction(ALPINE_TRAIL_FIXTURES[1].expected), true);
    assert.equal(explicitAccessRestriction(ALPINE_TRAIL_FIXTURES[2].expected), undefined);
    assert.deepEqual(
      classifyHikingRelation({
        type: "route", route: "hiking", network: "rwn", ref: "A1", "osmc:symbol": "red:white:red_bar"
      }),
      { routeType: "hiking", network: "rwn", state: "current" }
    );
  });

  it("excludes non-current Alpine fixture objects in every evidence class", () => {
    assert.equal(classifyOutdoorPoi({ tourism: "alpine_hut", abandoned: "yes" }), undefined);
    assert.equal(normalizeTrailSegment({ "disused:highway": "path" }), undefined);
    assert.equal(classifyHikingRelation({ type: "route", route: "hiking", proposed: "yes" }), undefined);
  });

  it("treats only explicit access evidence as known", () => {
    assert.equal(explicitAccessRestriction({}), undefined);
    assert.equal(explicitAccessRestriction({ access: "yes" }), false);
    assert.equal(explicitAccessRestriction({ foot: "private" }), true);
    assert.equal(explicitAccessRestriction({ footConditional: "no @ (Nov-Mar)" }), true);
  });
});
