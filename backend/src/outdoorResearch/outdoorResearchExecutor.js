import { assembleAdventureResearchDossierV1 } from "./dossierAssembler.js";
import { OUTDOOR_RESEARCH_LIMITS } from "./contracts.js";
import {
  sourceMetadataFromEvidenceRow,
  transformAssertionRowToEvidenceClaimV1,
  transformMembershipRowToEvidenceClaimV1
} from "./evidenceClaimTransformation.js";
import {
  boundedExecutorTimeout,
  deriveResearchSearchRadiusMetersV1,
  OUTDOOR_RESEARCH_EXECUTOR_POLICY_V1,
  OutdoorResearchExecutorError,
  outdoorResearchExecutorError,
  strictExecutorDateV1
} from "./executorPolicy.js";
import {
  planOutdoorResearchV1
} from "./researchPlanner.js";
import {
  bindOutdoorResearchIntentToReviewedRegionV1,
  OUTDOOR_RESEARCH_REGION_BINDINGS_V1,
  validateOutdoorResearchRegionBindingsV1
} from "./regionBindings.js";

export async function researchOutdoorAdventureV1(intentInput, dependencies) {
  const preflight = safePlan(intentInput, {});
  if (preflight.state === "clarification_required") {
    return freeze({
      state: "clarification_required",
      normalizedIntent: preflight.normalizedIntent,
      planningGaps: preflight.planningGaps,
      clarificationQuestions: preflight.clarificationQuestions
    });
  }

  const resolvedDependencies = validateDependencies(dependencies);
  throwIfExternallyAborted(resolvedDependencies.signal);
  const reviewedRegion = bindOutdoorResearchIntentToReviewedRegionV1(
    preflight.normalizedIntent,
    resolvedDependencies.bindings
  );
  if (!reviewedRegion) {
    return freeze({
      state: "unsupported",
      normalizedIntent: preflight.normalizedIntent,
      planningGaps: preflight.planningGaps,
      availabilityState: "unsupported_region"
    });
  }
  const { binding, normalizedIntent: intent } = reviewedRegion;

  const generatedAt = safeClock(resolvedDependencies.clock);
  return executeWithDeadline(resolvedDependencies, async (signal) =>
    resolvedDependencies.repository.withConsistentSnapshot(
      { signal },
      async (session) => {
        throwIfAborted(signal);
        const capabilityResult = await session.resolveCapabilities(
          binding,
          intent.geographicAnchor.coordinate,
          generatedAt
        );
        validateCapabilityResult(capabilityResult, binding, generatedAt);
        if (capabilityResult.availabilityState !== "active") {
          const unavailablePlan = safePlan(
            intent,
            capabilityResult.availabilityState === "outside_region"
              ? {}
              : { supportedRegionIds: [binding.regionEntityId] }
          );
          return freeze({
            state: "unsupported",
            normalizedIntent: unavailablePlan.normalizedIntent,
            planningGaps: unavailablePlan.planningGaps,
            availabilityState: capabilityResult.availabilityState
          });
        }

        const planned = safePlan(intent, capabilityResult.capabilities);
        if (planned.state !== "ready") {
          return nonReadyPlannerResult(planned, capabilityResult.availabilityState);
        }
        const searchRadiusMeters = deriveResearchSearchRadiusMetersV1(
          planned.normalizedIntent
        );
        const evidenceRecords = [];
        for (const operation of planned.plan.operations) {
          throwIfAborted(signal);
          const records = await executeOperation(
            session,
            operation,
            capabilityResult.snapshot,
            planned.normalizedIntent,
            searchRadiusMeters
          );
          appendBoundedRecords(evidenceRecords, records);
        }
        throwIfAborted(signal);
        const dossier = await resolvedDependencies.assembleDossier({
          normalizedIntent: planned.normalizedIntent,
          planningGaps: planned.planningGaps,
          binding,
          snapshot: capabilityResult.snapshot,
          searchRadiusMeters,
          generatedAt,
          evidenceRecords
        });
        throwIfAborted(signal);
        return freeze({
          state: "ready",
          normalizedIntent: planned.normalizedIntent,
          planningGaps: planned.planningGaps,
          dossier
        });
      }
    )
  );
}

async function executeOperation(
  session,
  operation,
  snapshot,
  intent,
  searchRadiusMeters
) {
  if (operation.operationType === "discover_highlights") {
    const rows = await session.discoverHighlights({
      projectionRunId: snapshot.projectionRunId,
      operationalRegionId: snapshot.operationalRegionId,
      anchor: intent.geographicAnchor.coordinate,
      entityCategories: operation.entityCategories,
      predicates: operation.predicates,
      searchRadiusMeters,
      limit: OUTDOOR_RESEARCH_EXECUTOR_POLICY_V1.maximumHighlightsPerOperation
    });
    validateRowArray(rows);
    assertNoDuplicateRowIds(rows, "assertion_id");
    return rows.map((row) =>
      assertionRecord(row, operation, snapshot, true)
    );
  }
  if (operation.operationType === "retrieve_mapped_hiking_routes") {
    const result = await session.retrieveMappedHikingRoutes({
      projectionRunId: snapshot.projectionRunId,
      operationalRegionId: snapshot.operationalRegionId,
      anchor: intent.geographicAnchor.coordinate,
      predicates: operation.predicates,
      searchRadiusMeters,
      limit: OUTDOOR_RESEARCH_EXECUTOR_POLICY_V1.maximumRoutesPerOperation
    });
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw outdoorResearchExecutorError("malformed_evidence");
    }
    validateRowArray(result.memberships);
    validateRowArray(result.assertions);
    assertNoDuplicateRowIds(result.memberships, "relationship_id");
    assertNoDuplicateRowIds(result.assertions, "assertion_id");
    return [
      ...result.memberships.map((row) =>
        membershipRecord(row, operation, snapshot)
      ),
      ...result.assertions.map((row) =>
        assertionRecord(row, operation, snapshot, false)
      )
    ];
  }
  throw outdoorResearchExecutorError("operation_scope_violation");
}

function assertionRecord(row, operation, snapshot, geographic) {
  enforceSnapshotSource(row, snapshot);
  const claim = transformAssertionRowToEvidenceClaimV1(row, operation);
  let coordinate = null;
  let distanceMeters = null;
  if (geographic) {
    const latitude = numeric(row.latitude);
    const longitude = numeric(row.longitude);
    distanceMeters = numeric(row.distance_meters);
    coordinate = { latitude, longitude };
  }
  return freeze({
    claim,
    sourceMetadata: sourceMetadataFromEvidenceRow(row),
    entityCategory: row.entity_category,
    coordinate,
    distanceMeters,
    relationship: false
  });
}

function membershipRecord(row, operation, snapshot) {
  enforceSnapshotSource(row, snapshot);
  return freeze({
    claim: transformMembershipRowToEvidenceClaimV1(row, operation),
    sourceMetadata: sourceMetadataFromEvidenceRow(row),
    entityCategory: "hiking_route",
    coordinate: null,
    distanceMeters: numeric(row.distance_meters),
    relationship: true
  });
}

function enforceSnapshotSource(row, snapshot) {
  if (row?.source_id !== snapshot.source.sourceId ||
      row?.source_category !== snapshot.source.sourceCategory ||
      row?.source_key !== snapshot.source.sourceKey) {
    throw outdoorResearchExecutorError("operation_scope_violation");
  }
}

function validateDependencies(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !input.repository ||
      typeof input.repository.withConsistentSnapshot !== "function") {
    throw outdoorResearchExecutorError("invalid_dependencies");
  }
  if (input.clock !== undefined && typeof input.clock !== "function") {
    throw outdoorResearchExecutorError("invalid_dependencies");
  }
  if (input.assembleDossier !== undefined &&
      typeof input.assembleDossier !== "function") {
    throw outdoorResearchExecutorError("invalid_dependencies");
  }
  if (input.signal !== undefined &&
      (!input.signal || typeof input.signal.aborted !== "boolean" ||
       typeof input.signal.addEventListener !== "function")) {
    throw outdoorResearchExecutorError("invalid_dependencies");
  }
  let bindings;
  try {
    bindings = input.regionBindings === undefined
      ? OUTDOOR_RESEARCH_REGION_BINDINGS_V1
      : validateOutdoorResearchRegionBindingsV1(input.regionBindings);
  } catch (error) {
    throw outdoorResearchExecutorError("invalid_region_bindings", {
      cause: error
    });
  }
  const policy = OUTDOOR_RESEARCH_EXECUTOR_POLICY_V1;
  return {
    repository: input.repository,
    clock: input.clock ?? (() => new Date()),
    assembleDossier:
      input.assembleDossier ?? assembleAdventureResearchDossierV1,
    signal: input.signal,
    bindings,
    totalTimeoutMs: boundedExecutorTimeout(
      input.totalTimeoutMs,
      policy.defaultTotalTimeoutMs,
      policy.minimumTotalTimeoutMs,
      policy.maximumTotalTimeoutMs
    )
  };
}

async function executeWithDeadline(dependencies, work) {
  const controller = new AbortController();
  let deadlineFired = false;
  let externalCancelled = false;
  const externalAbort = () => {
    externalCancelled = true;
    controller.abort();
  };
  if (dependencies.signal) {
    dependencies.signal.addEventListener("abort", externalAbort, { once: true });
  }
  const timer = setTimeout(() => {
    deadlineFired = true;
    controller.abort();
  }, dependencies.totalTimeoutMs);
  try {
    return await work(controller.signal);
  } catch (error) {
    if (error instanceof OutdoorResearchExecutorError &&
        error.code === "request_cancelled") {
      if (externalCancelled || dependencies.signal?.aborted) {
        throw outdoorResearchExecutorError("request_cancelled");
      }
      if (deadlineFired) {
        throw outdoorResearchExecutorError("execution_timed_out");
      }
    }
    if (controller.signal.aborted && deadlineFired &&
        !(externalCancelled || dependencies.signal?.aborted)) {
      throw outdoorResearchExecutorError("execution_timed_out");
    }
    throw normalizeExecutorError(error);
  } finally {
    clearTimeout(timer);
    dependencies.signal?.removeEventListener("abort", externalAbort);
  }
}

function safePlan(intent, capabilities) {
  try {
    return planOutdoorResearchV1(intent, capabilities);
  } catch (error) {
    if (error?.code === "invalid_intent") {
      throw outdoorResearchExecutorError("invalid_intent", { cause: error });
    }
    throw outdoorResearchExecutorError("invalid_dependencies", { cause: error });
  }
}

function safeClock(clock) {
  try {
    return strictExecutorDateV1(clock(), "invalid_dependencies");
  } catch (error) {
    throw outdoorResearchExecutorError("invalid_dependencies", {
      cause: error
    });
  }
}

function validateCapabilityResult(value, binding, generatedAt) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !["active", "outside_region", "source_unavailable", "source_stale"]
        .includes(value.availabilityState) ||
      !value.capabilities ||
      (value.availabilityState === "active" && !value.snapshot) ||
      (value.availabilityState !== "active" && value.snapshot !== null)) {
    throw outdoorResearchExecutorError("malformed_evidence");
  }
  if (value.availabilityState !== "active") return;
  const snapshot = value.snapshot;
  const sourceDataAt = strictExecutorDateV1(
    snapshot.sourceDataAt,
    "malformed_evidence"
  );
  const retrievedAt = strictExecutorDateV1(
    snapshot.retrievedAt,
    "malformed_evidence"
  );
  const importedAt = strictExecutorDateV1(
    snapshot.importedAt,
    "malformed_evidence"
  );
  if (snapshot.regionEntityId !== binding.regionEntityId ||
      snapshot.operationalRegionId !== binding.operationalRegionId ||
      snapshot.sourceId !== snapshot.source?.sourceId ||
      snapshot.source?.sourceCategory !== "openstreetmap_open_mapping" ||
      snapshot.source?.sourceKey !== "osm_foundational_data" ||
      !Number.isFinite(snapshot.boundaryDistanceMeters) ||
      snapshot.boundaryDistanceMeters < 0 ||
      !Number.isFinite(snapshot.freshnessLimitMilliseconds) ||
      snapshot.freshnessLimitMilliseconds <= 0 ||
      !Array.isArray(value.capabilities.supportedRegionIds) ||
      value.capabilities.supportedRegionIds.length !== 1 ||
      value.capabilities.supportedRegionIds[0] !== binding.regionEntityId ||
      sourceDataAt > retrievedAt ||
      retrievedAt > importedAt ||
      importedAt > generatedAt ||
      sourceDataAt.getTime() + snapshot.freshnessLimitMilliseconds <=
        generatedAt.getTime()) {
    throw outdoorResearchExecutorError("inconsistent_snapshot");
  }
}

function nonReadyPlannerResult(planned, availabilityState) {
  const result = {
    state: planned.state,
    normalizedIntent: planned.normalizedIntent,
    planningGaps: planned.planningGaps,
    availabilityState
  };
  if (planned.state === "clarification_required") {
    result.clarificationQuestions = planned.clarificationQuestions;
  }
  return freeze(result);
}

function validateRowArray(value) {
  if (!Array.isArray(value) ||
      value.length > OUTDOOR_RESEARCH_EXECUTOR_POLICY_V1.maximumRepositoryRowsPerOperation) {
    throw outdoorResearchExecutorError(
      Array.isArray(value) ? "result_too_large" : "malformed_evidence"
    );
  }
}

function assertNoDuplicateRowIds(rows, field) {
  const values = rows.map((row) => row?.[field]);
  if (new Set(values).size !== values.length) {
    throw outdoorResearchExecutorError("malformed_evidence");
  }
}

function appendBoundedRecords(target, records) {
  target.push(...records);
  if (target.length > OUTDOOR_RESEARCH_LIMITS.maximumEvidenceClaims * 2) {
    throw outdoorResearchExecutorError("result_too_large");
  }
}

function numeric(value) {
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(number)) {
    throw outdoorResearchExecutorError("malformed_evidence");
  }
  return number;
}

function throwIfExternallyAborted(signal) {
  if (signal?.aborted) throw outdoorResearchExecutorError("request_cancelled");
}

function throwIfAborted(signal) {
  if (signal.aborted) throw outdoorResearchExecutorError("request_cancelled");
}

function normalizeExecutorError(error) {
  if (error instanceof OutdoorResearchExecutorError) return error;
  return outdoorResearchExecutorError("repository_failed", { cause: error });
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}
