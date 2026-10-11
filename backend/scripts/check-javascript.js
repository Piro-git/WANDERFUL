import { readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// `node --check a.js b.js` checks only a.js. Visit every source file explicitly,
// including nested runtime/provider modules and container entrypoints.
export function checkJavaScript(root, directories = ['api', 'container', 'evaluation', 'scripts', 'src', 'test']) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
    }
  };
  for (const directory of directories) walk(resolve(root, directory));
  const failures = [];
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 10000 });
    // Report paths only: parser diagnostics may echo source lines with private fixtures.
    if (result.status !== 0) failures.push(relative(root, file));
  }
  return { checked: files.length, failures };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = checkJavaScript(fileURLToPath(new URL('../', import.meta.url)));
    console.log(JSON.stringify(report));
    process.exitCode = report.failures.length ? 1 : 0;
  } catch {
    console.error('javascript_check_failed');
    process.exitCode = 1;
  }
}
