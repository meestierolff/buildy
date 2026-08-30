// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const verificationUrl = new URL(
  "../../scripts/setup/verify-database-roles.sql",
  import.meta.url,
);
const configurationUrl = new URL(
  "../../scripts/setup/configure-database-roles.sql",
  import.meta.url,
);

describe("database role verification", () => {
  it("validates provider-provisioned role attributes and memberships before granting", async () => {
    const configuration = await readFile(configurationUrl, "utf8");

    expect(configuration).not.toContain("'ALTER ROLE %I");
    expect(configuration).toContain("LEFT JOIN pg_catalog.pg_roles role");
    expect(configuration).toContain(
      "WITH RECURSIVE runtime_role_memberships(runtime_role_oid, granted_role_oid)",
    );
    expect(configuration).toContain(
      "JOIN pg_catalog.pg_auth_members membership ON membership.member = role.oid",
    );
    expect(configuration).toContain(
      "a runtime role has direct or transitive role membership",
    );
  });

  it("rejects direct and transitive runtime-role memberships", async () => {
    const verification = await readFile(verificationUrl, "utf8");

    expect(verification).toContain(
      "WITH RECURSIVE runtime_role_memberships(runtime_role_oid, granted_role_oid)",
    );
    expect(verification).toContain(
      "JOIN pg_catalog.pg_auth_members membership ON membership.member = role.oid",
    );
    expect(verification).toContain(
      "ON membership.member = membership_path.granted_role_oid",
    );
    expect(verification).toContain(
      "a runtime role has direct or transitive role membership",
    );
  });
});
