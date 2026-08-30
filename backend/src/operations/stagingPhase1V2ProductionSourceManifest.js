// Reviewed, non-secret source pins for the dormant observer package. These
// literals bind a source snapshot; they do not register a factory or satisfy
// any of the five separately unmet operational pins. sourceDigest is SHA-256
// over path + NUL + file SHA-256 + LF for sourceFiles sorted by path.
// packageDigest is SHA-256 over canonical JSON containing schemaVersion,
// packageId, packageVersion, acceptanceContract, sourceFiles and sourceDigest.
export const STAGING_PHASE1_V2_PRODUCTION_SOURCE_MANIFEST = deepFreeze({
  schemaVersion: 1,
  packageId: "trailmind.production.staging-phase1-v2-observer",
  packageVersion: "2.0.0-unregistered",
  acceptanceContract: {
    path: "docs/operations/staging-v1/observer-review-v2/production-observer-acceptance-v2.json",
    sha256: "aec1efd09638a7b2f5b7e8056f7b7dd1e432a35615249533ede845863a244940"
  },
  sourceFiles: [
    {
      path: "backend/src/operations/stagingPhase1V2Admission.js",
      sha256: "fd2ccbf7d5bf669a29660c5bf3a30058af115a41dee2e201e405e5588447d4c8"
    },
    {
      path: "backend/src/operations/stagingPhase1V2LiveLauncher.js",
      sha256: "5158a7b2f0b464f0af6495c47631eed2c37327e73fb5ab954fbdf628a0c05b5f"
    },
    {
      path: "backend/src/operations/stagingPhase1V2MachineObserver.js",
      sha256: "dfbcb95ed049e58218c59e1fec728947488fe45fbd72f77cb8e683704a631f96"
    },
    {
      path: "backend/src/operations/stagingPhase1V2ProductionArtifacts.js",
      sha256: "6c6042c9fd675780ac3eb3859f1474a061a87cafa4033a3ee476db709cd9c158"
    },
    {
      path: "backend/src/operations/stagingPhase1V2ProductionAuditor.js",
      sha256: "56af779bc9d79315c2d8891cb6a83814dc8324ffd8cb28ff4f67c8bc27060773"
    },
    {
      path: "backend/src/operations/stagingPhase1V2ProductionObserverContract.js",
      sha256: "9c56f5aa51532f24d072c17809734e9900b6efccb4a236b81c205bff474c06e6"
    },
    {
      path: "backend/src/operations/stagingPhase1V2SingleSessionAdapter.js",
      sha256: "1bdceb5bda09a3d525dc2f456fbcbda41d303131c8d0dccc4f40423efc276e49"
    }
  ],
  sourceDigest: "f79835554f4c384149c5185f23fff591bcbb01da6832497b9cd427a04fe05953",
  packageDigest: "896f6512ce55be95c65612e4af549ce824c4e87f766cb33789ed39d6b5d78f65"
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
