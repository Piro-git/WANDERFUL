import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  outdoorEvidenceCorridorQueryForTesting,
  PostgresOutdoorEvidenceRepository
} from "../src/outdoorEvidence/postgresOutdoorEvidenceRepository.js";
import { validateOutdoorEvidenceRequest } from "../src/outdoorEvidence/outdoorEvidenceValidation.js";
import { outdoorEvidenceRequest } from "./outdoorEvidenceTestSupport.js";

describe("PostGIS outdoor evidence repository", () => {
  it("uses parameterized SQL, metric functions and GiST-compatible predicates", async () => {
    const calls = [];
    let released = false;
    const client = {
      async query(text, values) {
        calls.push({ text, values });
        if (String(text).includes("WITH input")) {
          return { rows: [{ route_length_meters: 1_000, covered_length_meters: 0, regions: [] }] };
        }
        return { rows: [] };
      },
      release() { released = true; }
    };
    const repository = new PostgresOutdoorEvidenceRepository({
      pool: { async connect() { return client; }, async query() {} }
    });
    const request = validateOutdoorEvidenceRequest(outdoorEvidenceRequest());
    await repository.queryCorridor(request);
    const query = calls.find((call) => String(call.text).includes("WITH input"));
    assert.deepEqual(JSON.parse(query.values[0]).coordinates[0], [10.61, 51.8]);
    assert.equal(query.values[1], 100);
    assert.match(query.text, /ST_DWithin/);
    assert.match(
      query.text,
      /ST_DWithin\(context\.covered_route_wgs84::geography, piece\.geom::geography, 1\)/
    );
    assert.doesNotMatch(query.text, /ST_Intersects\(context\.covered_route_wgs84, piece\.geom\)/);
    assert.match(query.text, /ST_Segmentize/);
    assert.match(query.text, /ST_Distance/);
    assert.match(query.text, /ST_UnaryUnion\(ST_Collect/);
    assert.match(query.text, /row_number\(\) OVER[\s\S]+covered_route_wgs84::geography[\s\S]+region_id/);
    assert.doesNotMatch(query.text, /candidate_region[\s\S]+LIMIT 1/);
    assert.match(query.text, /\$1/);
    assert.equal(query.text.includes("51.8"), false);
    assert.equal(released, true);
  });

  it("maps statement timeout and cancellation to safe errors", async () => {
    for (const [error, signal, code] of [
      [Object.assign(new Error("private db detail"), { code: "57014" }), undefined, "evidence_timed_out"],
      [new Error("private db detail"), { aborted: true }, "request_cancelled"]
    ]) {
      const client = {
        async query(text) {
          if (text === "BEGIN READ ONLY") return { rows: [] };
          if (String(text).startsWith("SELECT set_config")) return { rows: [] };
          if (text === "ROLLBACK") return { rows: [] };
          throw error;
        },
        release() {}
      };
      const repository = new PostgresOutdoorEvidenceRepository({
        pool: { async connect() { return client; }, async query() {} }
      });
      const request = validateOutdoorEvidenceRequest(outdoorEvidenceRequest());
      await assert.rejects(
        () => repository.queryCorridor(request, { signal }),
        (caught) => caught.code === code && !caught.message.includes("private")
      );
    }
  });

  it("assigns each route piece to one nearest segment before relation aggregation", () => {
    assert.match(outdoorEvidenceCorridorQueryForTesting, /ORDER BY match_distance[\s\S]+LIMIT 1/);
    assert.match(outdoorEvidenceCorridorQueryForTesting, /EXISTS \([\s\S]+outdoor_evidence_hiking_relation_members/);
    assert.doesNotMatch(
      outdoorEvidenceCorridorQueryForTesting,
      /SELECT segment\.\*, context\.(?:import_id|region_id)/
    );
    assert.match(outdoorEvidenceCorridorQueryForTesting, /COALESCE\(seasonal_tag = 'yes', false\)/);
    assert.match(outdoorEvidenceCorridorQueryForTesting, /COALESCE\(permit_tag IN \('yes', 'required'\), false\)/);
  });

  it("deduplicates canonical POIs and segment evidence across overlapping imports", () => {
    assert.match(
      outdoorEvidenceCorridorQueryForTesting,
      /PARTITION BY osm_type, osm_id[\s\S]+identity_rank = 1/
    );
    assert.match(
      outdoorEvidenceCorridorQueryForTesting,
      /row_number\(\) OVER \(ORDER BY line\.path, segment\.path\) AS piece_id/
    );
    assert.match(outdoorEvidenceCorridorQueryForTesting, /ORDER BY match_distance, context\.selection_rank/);
    assert.match(outdoorEvidenceCorridorQueryForTesting, /jsonb_agg[\s\S]+ORDER BY selection_rank/);
  });
});
