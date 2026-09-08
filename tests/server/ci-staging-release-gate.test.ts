// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");

function sectionBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1) throw new Error(`Workflowsectie ontbreekt: ${start}`);
  return source.slice(startIndex, endIndex);
}

function stepNamed(job: string, name: string): string {
  const marker = `      - name: ${name}`;
  const startIndex = job.indexOf(marker);
  if (startIndex === -1) throw new Error(`Workflowstap ontbreekt: ${name}`);
  const endIndex = job.indexOf("\n      - name:", startIndex + marker.length);
  return job.slice(startIndex, endIndex === -1 ? job.length : endIndex);
}

describe("protected staging release identity gate", () => {
  it("checks the validated staging origin at the exact 40-character workflow SHA before E2E", () => {
    const job = sectionBetween(
      workflow,
      "  staging-auth-e2e:\n",
      "  staging-release-gate:\n",
    );
    const validateTarget = stepNamed(job, "Validate explicit staging target");
    const launchGateName = "Bind selected staging deployment to workflow SHA";
    const launchGate = stepNamed(job, launchGateName);

    expect(job.indexOf(`      - name: ${launchGateName}`)).toBeGreaterThan(
      job.indexOf("      - name: Validate explicit staging target"),
    );
    expect(job.indexOf(`      - name: ${launchGateName}`)).toBeLessThan(
      job.indexOf("      - name: Run unmocked staging provider journey"),
    );

    expect(validateTarget).toContain("STAGING_BASE_URL: ${{ inputs.staging_base_url }}");
    expect(validateTarget).toContain("EXPECTED_STAGING_ORIGIN: ${{ vars.PLAYWRIGHT_STAGING_ORIGIN }}");
    expect(validateTarget).toContain("if (requested !== expected)");
    expect(validateTarget).toContain("PLAYWRIGHT_BASE_URL=${requested}");

    expect(launchGate).toContain('if [[ ! "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]]');
    expect(launchGate.match(/LAUNCH_EXPECTED_GIT_SHA=/g)).toHaveLength(1);
    expect(launchGate).toContain('LAUNCH_EXPECTED_GIT_SHA="$GITHUB_SHA" \\');
    expect(launchGate).toContain(
      'bun run check:launch -- --staging --base-url="$PLAYWRIGHT_BASE_URL"',
    );
    expect(launchGate).not.toContain("--preview");
    expect(launchGate).not.toContain("--production");
    expect(launchGate).not.toContain("--expected-sha");
  });
});
