#!/usr/bin/env node

import { spawnSync } from "node:child_process";

// Compatibility entrypoint. The former implementation used a broad provider
// service-role SDK. Inventory now runs through the exact-host, read-only,
// run-bound migration boundary and remains dry-run unless explicitly gated.
const result = spawnSync(process.execPath, [
  "--import",
  "tsx",
  "scripts/migration/buildy-migrate.ts",
  "inventory",
  ...process.argv.slice(2),
], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  process.stderr.write('{"code":"MIGRATION_INVENTORY_LAUNCH_FAILED"}\n');
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
