import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function discoverTestFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(path);
    }
  };
  walk(resolve(root, 'test'));
  if (!files.length) throw new Error('backend_test_files_missing');
  return files;
}

export function runBackendTests(root, { nodeArguments = [], stdio = 'inherit' } = {}) {
  // Explicit files prevent Node from treating opt-in operation CLIs named
  // *-test.js elsewhere in the repository as runnable tests.
  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_TEST_CONTEXT; // Do not inherit Node's internal parent-test IPC mode.
  return spawnSync(process.execPath, ['--test', ...nodeArguments, ...discoverTestFiles(root)], {
    cwd: root, stdio, env: childEnvironment, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runBackendTests(fileURLToPath(new URL('../', import.meta.url)), {
      nodeArguments: process.argv.slice(2)
    });
    process.exitCode = result.status ?? 1;
  } catch {
    console.error('backend_test_discovery_failed');
    process.exitCode = 1;
  }
}
