import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PrintProviderError } from "../../server/print/printProvider";
import { PeechoV3HttpProvider } from "../../server/print/peechoV3Provider";

const MAX_JSON_INPUT_BYTES = 1024 * 1024;

export interface CliArguments {
  options: Readonly<Record<string, string>>;
  flags: ReadonlySet<string>;
}

export function parseCliArguments(
  argv: readonly string[],
  definition: { options?: readonly string[]; flags?: readonly string[] },
): CliArguments {
  const optionNames = new Set(definition.options ?? []);
  const flagNames = new Set(definition.flags ?? []);
  const options: Record<string, string> = {};
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--") || argument === "--") {
      throw new Error("Gebruik uitsluitend benoemde --opties.");
    }
    const separator = argument.indexOf("=");
    const name = argument.slice(2, separator === -1 ? undefined : separator);
    if (flagNames.has(name)) {
      if (separator !== -1 || flags.has(name)) throw new Error(`Ongeldige of dubbele --${name}-flag.`);
      flags.add(name);
      continue;
    }
    if (!optionNames.has(name) || options[name] !== undefined) {
      throw new Error(`Onbekende of dubbele optie: --${name}.`);
    }
    const value = separator === -1 ? argv[index + 1] : argument.slice(separator + 1);
    if (!value || value.startsWith("--")) throw new Error(`Optie --${name} vereist een waarde.`);
    options[name] = value;
    if (separator === -1) index += 1;
  }
  return { options, flags };
}

export function requireOption(arguments_: CliArguments, name: string): string {
  const value = arguments_.options[name];
  if (!value) throw new Error(`Verplichte optie ontbreekt: --${name}.`);
  return value;
}

export function optionalPositiveInteger(
  arguments_: CliArguments,
  name: string,
  fallback?: number,
): number | undefined {
  const raw = arguments_.options[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`Optie --${name} moet een positief geheel getal zijn.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`Optie --${name} is te groot.`);
  return value;
}

export function readPeechoEnvironment(environment: NodeJS.ProcessEnv = process.env): "test" | "live" {
  const value = environment.PEECHO_ENVIRONMENT;
  if (value !== "test" && value !== "live") {
    throw new Error("PEECHO_ENVIRONMENT moet expliciet 'test' of 'live' zijn.");
  }
  return value;
}

export function createPeechoProvider(
  environment: NodeJS.ProcessEnv = process.env,
): PeechoV3HttpProvider {
  const providerEnvironment = readPeechoEnvironment(environment);
  const merchantApiKey = environment.PEECHO_MERCHANT_API_KEY;
  if (!merchantApiKey) throw new Error("PEECHO_MERCHANT_API_KEY ontbreekt.");
  const timeoutRaw = environment.PEECHO_TIMEOUT_MS;
  const timeoutMs = timeoutRaw === undefined ? 10_000 : Number(timeoutRaw);
  if (!Number.isInteger(timeoutMs)) throw new Error("PEECHO_TIMEOUT_MS moet een geheel getal zijn.");
  return new PeechoV3HttpProvider({
    environment: providerEnvironment,
    merchantApiKey,
    ...(environment.PEECHO_SECRET_KEY ? { secretKey: environment.PEECHO_SECRET_KEY } : {}),
    timeoutMs,
  });
}

export function requireSandboxMutation(
  environment: "test" | "live",
  arguments_: CliArguments,
  action: "create" | "pay",
): void {
  if (environment === "live") {
    throw new Error(`Production ${action} is hard geblokkeerd in dit hulpscript.`);
  }
  const flag = `confirm-sandbox-${action}`;
  if (!arguments_.flags.has(flag)) {
    throw new Error(`Geen mutatie uitgevoerd: voeg --${flag} toe voor een bewuste sandbox-${action}.`);
  }
}

export async function readJsonInput(pathValue: string): Promise<unknown> {
  const path = resolve(pathValue);
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 2 || stats.size > MAX_JSON_INPUT_BYTES) {
    throw new Error("JSON-input moet een regulier, niet-gelinkt bestand van maximaal 1 MiB zijn.");
  }
  const raw = await readFile(path, "utf8");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("JSON-input is syntactisch ongeldig.");
  }
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function runCli(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    if (error instanceof PrintProviderError) {
      process.stderr.write(`${JSON.stringify({
        error: {
          code: error.code,
          operation: error.operation,
          message: error.message,
          retry: error.retry,
          ...(error.options.httpStatus === undefined ? {} : { httpStatus: error.options.httpStatus }),
          ...(error.options.providerCode === undefined ? {} : { providerCode: error.options.providerCode }),
        },
      })}\n`);
    } else {
      process.stderr.write(`${JSON.stringify({
        error: { code: "SCRIPT_FAILED", message: error instanceof Error ? error.message : "Script mislukt." },
      })}\n`);
    }
    process.exitCode = 1;
  }
}
