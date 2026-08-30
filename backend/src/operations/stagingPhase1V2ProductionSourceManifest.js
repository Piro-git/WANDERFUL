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
      sha256: "517ef7af4d23670b4563520683418ca6d4bb950a095ef192209f447eb6e49c34"
    },
    {
      path: "backend/src/operations/stagingPhase1V2SingleSessionAdapter.js",
      sha256: "1bdceb5bda09a3d525dc2f456fbcbda41d303131c8d0dccc4f40423efc276e49"
    },
    {
      path: "backend/src/operations/stagingPrerequisitesV3/admissionEvidence.js",
      sha256: "acdb311c97155aca2c9eabc2517ad7ca9553f413233af4d7231963bce6647061"
    },
    {
      path: "backend/src/operations/stagingPrerequisitesV3/caPin.js",
      sha256: "43b75ceabd263014077a025eee17e7dcbc85ace5010396ba9fcfd6a5019dbf51"
    },
    {
      path: "backend/src/operations/stagingPrerequisitesV3/canonicalJson.js",
      sha256: "ba33611d74b1c4eae24545df62e60df91b4ee30f4ac03b7b39461747b12d1f35"
    },
    {
      path: "backend/src/operations/stagingPrerequisitesV3/catalogAssertion.js",
      sha256: "1f75ff56be0a0a101661417b77027c147ab45c40929e473f313b83a8fa075650"
    },
    {
      path: "backend/src/operations/stagingPrerequisitesV3/constants.js",
      sha256: "9d9fce632d0e03a7b8f45ff9b24b5896a2438b52e185101be1de1bbc0cafbca9"
    },
    {
      path: "backend/src/operations/stagingPrerequisitesV3/errors.js",
      sha256: "86fd5603746a5855e22a5d9435d32dc0665f580524dd825bf889906940a310be"
    },
    {
      path: "backend/src/operations/stagingPrerequisitesV3/expectedManifest.js",
      sha256: "3d4c2b9815a9a21ee3135f4974ef7988cf4fdf15b53199055585bb1bccc18d5b"
    },
    {
      path: "backend/src/operations/stagingPrerequisitesV3/independentSessionProof.js",
      sha256: "5c9134495b6cc1eab7632de68cdd0540901eda46c46bfe530ad63b4e87574c14"
    },
    {
      path: "backend/src/operations/stagingPrerequisitesV3/migrationProfiles.js",
      sha256: "a674ab764630e8e905b86f9127c712483948335a77cbff4d45c76b76b66a49e8"
    },
    {
      path: "backend/src/operations/stagingPrerequisitesV3/readiness.js",
      sha256: "05c98eb4d5533cba0580d6dda55490dc736b37c7846b60ae74043218443898ce"
    },
    {
      path: "backend/src/operations/stagingPrerequisitesV3/reviewed-declarations-v1.json",
      sha256: "ac1d17132df79c403a8276f2aa695696fbc74436b791bf06ea89ad42ecbb46de"
    },
    {
      path: "backend/src/operations/stagingPrerequisitesV3/reviewed-pins-v1.json",
      sha256: "e23b090742d5532babe86b4c31d7e0f6fd6b6c3690c77ab93403b3635db0b6d4"
    },
    {
      path: "backend/src/operations/stagingPrerequisitesV3/safeFiles.js",
      sha256: "8b67befdf8a51a7a219c10445311c26e5afdc692a1e6f475a7ea60e302cb65cb"
    },
    {
      path: "backend/src/operations/stagingPrerequisitesV3/signing.js",
      sha256: "580242bc34d57ec30e90061651534ee019c55d5350160d60153deb208d023681"
    }
  ],
  sourceDigest: "6ae3179cdf9f7c18bb751274a6d35158e52367d7b39da4585e94d9d74d88b840",
  packageDigest: "e5200338957937c0cf404d18ab265c23e66961d3a3a70785460e558a4662df79"
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
