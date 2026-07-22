import { HIGH_STAKES_PREDICATES, OUTDOOR_RESEARCH_LIMITS } from "./contracts.js";

const HIGH_STAKES = new Set(HIGH_STAKES_PREDICATES);

// Resolves claims that have already passed EvidenceClaimV1 validation. Keeping
// this core validation-free lets dossier validation use exactly the same
// fail-closed semantics without introducing a validation/resolver import cycle.
export function resolveValidatedEvidenceClaimsV1(claims, options) {
  if (!Array.isArray(claims) || claims.length > OUTDOOR_RESEARCH_LIMITS.maximumEvidenceClaims) {
    throw new TypeError("claims must be a bounded array.");
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("resolution options are required.");
  }
  const now = normalizeNow(options.now);
  const entityId = normalizedIdentifier(options.entityId, "entityId");
  const predicate = normalizedIdentifier(options.predicate, "predicate");
  const cohort = claims
    .filter((claim) => claim.entityId === entityId && claim.predicate === predicate)
    .sort((left, right) => left.claimId.localeCompare(right.claimId));

  if (cohort.length === 0) return result("unknown", [], [], ["no_evidence_claim"]);

  const temporallyCurrent = [];
  const stale = [];
  const unavailable = [];
  for (const claim of cohort) {
    const temporal = temporalState(claim, now);
    if (temporal === "current") temporallyCurrent.push(claim);
    else if (temporal === "stale") stale.push(claim);
    else unavailable.push(claim);
  }

  if (temporallyCurrent.length === 0) {
    if (stale.length > 0) {
      return result("stale", stale, [], ["current_evidence_unavailable"]);
    }
    return result("unavailable", unavailable, [], ["usable_evidence_unavailable"]);
  }

  let relevant = temporallyCurrent;
  if (HIGH_STAKES.has(predicate)) {
    relevant = temporallyCurrent.filter((claim) => claim.evidenceClass === "official");
    if (relevant.length === 0) {
      return result(
        "unavailable",
        temporallyCurrent.length > 0 ? temporallyCurrent : unavailable,
        [],
        ["official_evidence_required", "community_model_and_derived_cannot_resolve_high_stakes"]
      );
    }
  }

  const known = [];
  const explicitlyConflicted = [];
  for (const claim of relevant) {
    if (claim.resolutionState === "known" && claim.value.type !== "unknown") known.push(claim);
    else if (claim.resolutionState === "conflicted") explicitlyConflicted.push(claim);
    else if (claim.resolutionState === "stale") stale.push(claim);
    else unavailable.push(claim);
  }

  if (explicitlyConflicted.length > 0) {
    const conflictCohort = [...known, ...explicitlyConflicted]
      .sort((left, right) => left.claimId.localeCompare(right.claimId));
    return result(
      "conflicted",
      conflictCohort,
      distinctValues(conflictCohort.filter((claim) => claim.value.type !== "unknown")),
      ["claim_resolution_state_conflicted"]
    );
  }

  if (known.length === 0) {
    if (stale.length > 0) {
      return result("stale", stale, [], ["current_evidence_unavailable"]);
    }
    return result("unavailable", unavailable, [], ["usable_evidence_unavailable"]);
  }

  const authoritative = known.filter((claim) => claim.evidenceClass === "official");
  if (distinctValues(authoritative).length > 1) {
    return result(
      "conflicted",
      authoritative,
      distinctValues(authoritative),
      ["conflicting_current_authoritative_assertions"]
    );
  }

  const values = distinctValues(known);
  if (values.length > 1) {
    return result("conflicted", known, values, ["conflicting_current_assertions"]);
  }

  return {
    state: "known",
    value: values[0],
    claimIds: known.map((claim) => claim.claimId),
    evidenceClasses: [...new Set(known.map((claim) => claim.evidenceClass))].sort(),
    limitationCodes: []
  };
}

function temporalState(claim, now) {
  if (claim.freshness === "stale" || claim.freshness === "expired") return "stale";
  if (claim.freshness !== "current") return "unavailable";
  const nowMs = now.getTime();
  if (Date.parse(claim.retrievedAt) > nowMs) return "unavailable";
  if (claim.validFrom && Date.parse(claim.validFrom) > nowMs) return "unavailable";
  if (claim.validUntil && Date.parse(claim.validUntil) <= nowMs) return "stale";
  return "current";
}

function distinctValues(claims) {
  const values = new Map();
  for (const claim of claims) {
    const key = canonicalValue(claim.value);
    if (!values.has(key)) values.set(key, claim.value);
  }
  return [...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function canonicalValue(value) {
  const sorted = Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
  return JSON.stringify(sorted);
}

function result(state, claims, values, limitationCodes) {
  return {
    state,
    value: null,
    conflictingValues: values,
    claimIds: claims.map((claim) => claim.claimId),
    evidenceClasses: [...new Set(claims.map((claim) => claim.evidenceClass))].sort(),
    limitationCodes
  };
}

function normalizeNow(value) {
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(now.getTime())) throw new TypeError("now must be a valid timestamp.");
  return now;
}

function normalizedIdentifier(value, name) {
  if (typeof value !== "string" || value.length < 1 || value.length > 120) {
    throw new TypeError(`${name} is invalid.`);
  }
  return value;
}
