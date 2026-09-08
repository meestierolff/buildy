import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent, safeErrorFields } from "../../server/observability/logger";

afterEach(() => vi.restoreAllMocks());

describe("structured privacy-safe logging", () => {
  it("emits one machine-readable record with correlation fields", () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logEvent("info", "http.request_completed", {
      requestId: "9d061f28-8a45-4e3b-a57c-a036d3799957",
      status: 204,
    });

    const record = JSON.parse(String(output.mock.calls[0][0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "info",
      event: "http.request_completed",
      requestId: "9d061f28-8a45-4e3b-a57c-a036d3799957",
      status: 204,
    });
    expect(record.timestamp).toEqual(expect.any(String));
  });

  it("drops high-risk fields even when a caller accidentally supplies them", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logEvent("error", "provider.request_failed", {
      requestId: "request-1",
      recipientEmail: "bouwer@example.test",
      signedUrl: "https://private.example/token",
      authorization: "Bearer secret",
      username: "private_account_name",
      passwordHash: "private_password_hash",
    });

    const serialized = String(output.mock.calls[0][0]);
    expect(serialized).not.toContain("bouwer@example.test");
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain("Bearer secret");
    expect(serialized).not.toContain("private_account_name");
    expect(serialized).not.toContain("private_password_hash");
  });

  it("classifies errors without logging messages or stacks", () => {
    const error = Object.assign(new Error("password=secret"), { code: "ECONNRESET" });
    expect(safeErrorFields(error)).toEqual({ errorName: "Error", errorCode: "ECONNRESET" });
    expect(JSON.stringify(safeErrorFields(error))).not.toContain("password");
  });
});
