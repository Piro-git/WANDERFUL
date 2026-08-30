export class StagingPrerequisitesV3Error extends Error {
  constructor(code, status = "blocked") {
    super(`trailmind_staging_prerequisites_v3_${status}:${code}`);
    this.name = "StagingPrerequisitesV3Error";
    this.code = code;
    this.status = status;
  }
}

export function blocked(code) {
  throw new StagingPrerequisitesV3Error(code, "blocked");
}

export function notReady(code) {
  throw new StagingPrerequisitesV3Error(code, "not_ready");
}
