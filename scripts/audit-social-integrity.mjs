#!/usr/bin/env node

import { spawnSync } from "node:child_process";

// Compatibility entrypoint. The shared inventory queries the known ownership,
// project, update, media, comment, reaction and follow orphan relationships in
// one repeatable-read, read-only source snapshot.
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
