export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogField = string | number | boolean | null | undefined;
export type LogFields = Readonly<Record<string, LogField>>;

const SAFE_FIELD_NAME = /^[a-z][a-zA-Z0-9_]{0,79}$/;
const FORBIDDEN_FIELD_NAME = /(authorization|cookie|credential|secret|password|token|email|address|recipient|payload|body|url|ip$|useragent)/i;
const SAFE_EVENT_NAME = /^[a-z][a-z0-9_.-]{2,119}$/;
const SAFE_ERROR_CODE = /^[A-Z0-9_.:-]{1,80}$/i;

function sanitizeFields(fields: LogFields): Record<string, Exclude<LogField, undefined>> {
  return Object.fromEntries(
    Object.entries(fields).flatMap(([key, value]) => {
      if (
        value === undefined ||
        !SAFE_FIELD_NAME.test(key) ||
        FORBIDDEN_FIELD_NAME.test(key) ||
        (typeof value === "string" && value.length > 200)
      ) return [];
      return [[key, value]];
    }),
  );
}

export function safeErrorFields(error: unknown): LogFields {
  if (!(error instanceof Error)) return { errorName: "UnknownError" };
  const rawCode = "code" in error ? error.code : undefined;
  const errorCode = typeof rawCode === "string" && SAFE_ERROR_CODE.test(rawCode)
    ? rawCode
    : undefined;
  return { errorName: error.name.slice(0, 80), errorCode };
}

export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (!SAFE_EVENT_NAME.test(event)) throw new Error("Logeventnaam is ongeldig.");
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...sanitizeFields(fields),
  });

  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else if (level === "debug") console.debug(entry);
  else console.info(entry);
}
