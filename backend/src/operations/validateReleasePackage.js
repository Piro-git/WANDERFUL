import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateAppleReleasePackageFromDisk,
  validateReleasePackageFromDisk
} from "./releasePackage.js";

export function runReleasePackageValidation(options = {}) {
  const write = options.write ?? process.stdout.write.bind(process.stdout);
  try {
    const result = validateReleasePackageFromDisk(options);
    const appStore = validateAppleReleasePackageFromDisk(options);
    write(`${JSON.stringify({ ...result, appStore })}\n`);
    return 0;
  } catch (error) {
    write(`${JSON.stringify({
      schemaVersion: 1,
      decision: "invalid",
      code: error?.code ?? "release_package_invalid"
    })}\n`);
    return 1;
  }
}

const isMain =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) process.exitCode = runReleasePackageValidation();
