import { pathToFileURL } from "node:url";
import {
  liveLauncherHelp,
  parseLiveLauncherArguments,
  runStagingPhase1V2LiveLauncher
} from "../../src/operations/stagingPhase1V2LiveLauncher.js";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const options = parseLiveLauncherArguments(process.argv.slice(2));
    if (options.mode === "help") {
      process.stdout.write(`${liveLauncherHelp()}\n`);
    } else {
      const outcome = await runStagingPhase1V2LiveLauncher(options);
      process.stdout.write(`${JSON.stringify(outcome)}\n`);
    }
  } catch (error) {
    const code = typeof error?.code === "string" &&
      /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : "unknown";
    process.stderr.write(`trailmind_phase1_v2_live_launcher_blocked:${code}\n`);
    process.exitCode = 1;
  }
}
