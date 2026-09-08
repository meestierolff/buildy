import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  parseLaunchCliArguments,
  releaseContractFor,
  requireExpectedGitSha,
  targetReadinessFailures,
  verifyDeployedGitSha,
  verifyTargetCapabilities,
  verifyTargetProductProfile,
} from "./release-gates.mjs";

const root = process.cwd();

const parseEnvFile = (file) => {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key.trim(), rest.join("=").trim().replace(/^["']|["']$/g, "")];
      }),
  );
};

const env = {
  ...parseEnvFile(join(root, ".env")),
  ...parseEnvFile(join(root, ".env.production")),
  ...process.env,
};
let launchOptions;
try {
  launchOptions = parseLaunchCliArguments(process.argv.slice(2), env);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Ongeldige launchargumenten."}\n`);
  process.exit(2);
}
const {
  staticOnly,
  requestedEnvironment,
  rawBaseUrl,
  rawExpectedGitSha,
} = launchOptions;

const checks = [];
const addResult = (status, category, name, detail) => checks.push({ status, category, name, detail });
const errorMessage = (error) => {
  if (!(error instanceof Error)) return String(error);
  const code = error.cause && typeof error.cause === "object" && "code" in error.cause
    ? String(error.cause.code)
    : undefined;
  return code ? `${error.message} (${code})` : error.message;
};
const runCheck = async (category, name, task) => {
  try {
    addResult("PASS", category, name, await task());
  } catch (error) {
    addResult("FAIL", category, name, errorMessage(error));
  }
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function filesBelow(entry, extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json"])) {
  const absolute = resolve(root, entry);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isDirectory()) return extensions.has(extname(absolute)) ? [absolute] : [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((child) => {
    if (["node_modules", "dist", "coverage", "artifacts"].includes(child.name)) return [];
    return filesBelow(join(entry, child.name), extensions);
  });
}

const requiredDocs = [
  ".env.example",
  "README.md",
  "docs/MVP_SCOPE.md",
  "docs/MVP_SHIP_REPORT.md",
  "docs/OPERATOR_ACTIONS_REQUIRED.md",
  "docs/POLARSTEPS_TO_BUILDY.md",
];

await runCheck("static", "Doelruntime bevat geen legacy-providerkoppeling", async () => {
  const forbidden = /@supabase|integrations\/supabase|VITE_SUPABASE|LOVABLE_API_KEY|@lovable\.dev|lovable-tagger|cloud-auth-js|supabase[.]co|\/functions\/v1\//i;
  const files = [
    ...filesBelow("api"),
    ...filesBelow("server"),
    ...filesBelow("shared"),
    ...filesBelow("src"),
    ...filesBelow("vite.config.ts"),
    ...filesBelow("vercel.json"),
  ];
  const violations = files.filter((file) => forbidden.test(readFileSync(file, "utf8")));
  assert(violations.length === 0, `legacy-koppeling in ${violations.map((file) => relative(root, file)).join(", ")}`);
  return `${files.length} actieve bronbestanden gescand`;
});

await runCheck("static", "Packagegraph bevat geen legacy runtimepackage", async () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const packages = { ...manifest.dependencies, ...manifest.devDependencies };
  const forbidden = Object.keys(packages).filter((name) => (
    /supabase|lovable/i.test(name)
    || [
      "@aws-sdk/client-s3",
      "@aws-sdk/s3-request-presigner",
      "@better-auth/drizzle-adapter",
      "better-auth",
    ].includes(name)
  ));
  assert(forbidden.length === 0, `verwijder eerst: ${forbidden.join(", ")}`);
  const retiredTemplatePackages = ["@react-leaflet/core", "leaflet", "react-leaflet", "jspdf"]
    .filter((name) => name in packages);
  assert(retiredTemplatePackages.length === 0, `verwijder templatepackages: ${retiredTemplatePackages.join(", ")}`);
  assert(existsSync(join(root, "bun.lock")), "bun.lock ontbreekt");
  assert(!existsSync(join(root, "bun.lockb")), "verouderde bun.lockb bestaat nog");
  assert(!existsSync(join(root, "package-lock.json")), "tweede lockfile package-lock.json bestaat nog");
  return "package.json en canonieke Bun-lockfile zijn schoon";
});

await runCheck("static", "Actieve runtime importeert geen uitgefaseerde provider", async () => {
  const activeFiles = [
    ...filesBelow("api"),
    ...filesBelow("server"),
    ...filesBelow("shared"),
    ...filesBelow("src"),
    ...filesBelow("scripts"),
    ...filesBelow("vite.config.ts"),
    ...filesBelow("vercel.json"),
  ].filter((path) => (
    /[.](?:[cm]?js|tsx?|json)$/.test(path)
    && path !== resolve(root, "scripts/check-launch.mjs")
  ));
  const forbiddenImport = /(?:from\s*["'][^"']*(?:r2ObjectStorage|\/email\/|\/fulfilment\/|\/print\/)|@aws-sdk|@better-auth|better-auth|BREVO_|PEECHO_|R2_)/i;
  const forbiddenRoute = /\/api\/(?:internal\/cron\/(?:email|peecho-fulfilment)|webhooks\/(?:brevo|peecho))/i;
  const violations = activeFiles.filter((path) => {
    const contents = readFileSync(path, "utf8");
    return forbiddenImport.test(contents) || forbiddenRoute.test(contents);
  });
  assert(
    violations.length === 0,
    `retired runtimekoppeling in ${violations.map((path) => relative(root, path)).join(", ")}`,
  );
  return `${activeFiles.length} actieve runtimebestanden schoon`;
});

await runCheck("static", "Template- en providererfenis is fysiek verwijderd", async () => {
  const retiredPaths = [
    ".lovable",
    ".team",
    "LOVABLE_PROMPT.md",
    "artifacts/email-previews",
    "scripts/email",
    "scripts/peecho",
    "server/auth/outbox.ts",
    "server/auth/postgresOutbox.ts",
    "server/email",
    "server/fulfilment",
    "server/print",
    "server/storage/r2ObjectStorage.ts",
    "src/components/TripRouteMap.tsx",
    "src/integrations",
    "src/lib/peecho.ts",
    "supabase",
  ];
  const remaining = retiredPaths.filter((path) => existsSync(join(root, path)));
  assert(remaining.length === 0, `verwijder oude paden: ${remaining.join(", ")}`);
  return `${retiredPaths.length} retired paden afwezig`;
});

await runCheck("static", "Productiebrongraaf bevat geen dode modules", async () => {
  const sourceFiles = filesBelow("src", new Set([".ts", ".tsx"]))
    .filter((file) => {
      const path = relative(root, file);
      return !path.startsWith("src/test/") && !path.endsWith(".test.ts")
        && !path.endsWith(".test.tsx") && !path.endsWith(".d.ts");
    })
    .map(normalize);
  const sourceSet = new Set(sourceFiles);
  const resolveModule = (from, specifier) => {
    const base = specifier.startsWith("@/")
      ? resolve(root, "src", specifier.slice(2))
      : specifier.startsWith(".")
        ? resolve(dirname(from), specifier)
        : undefined;
    if (!base) return undefined;
    return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]
      .map(normalize)
      .find((candidate) => sourceSet.has(candidate));
  };
  const edges = new Map(sourceFiles.map((file) => [file, []]));
  for (const file of sourceFiles) {
    const contents = readFileSync(file, "utf8");
    const importPattern = /(?:from\s*|import\s*\()\s*["']([^"']+)["']/g;
    for (const match of contents.matchAll(importPattern)) {
      const dependency = resolveModule(file, match[1]);
      if (dependency) edges.get(file).push(dependency);
    }
  }
  const reachable = new Set();
  const pending = [normalize(resolve(root, "src/main.tsx"))];
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || reachable.has(file)) continue;
    reachable.add(file);
    pending.push(...(edges.get(file) ?? []));
  }
  const unreachable = sourceFiles
    .filter((file) => !reachable.has(file))
    .map((file) => relative(root, file));
  assert(unreachable.length === 0, `dode productiemodules: ${unreachable.join(", ")}`);
  return `${reachable.size} bereikbare productiemodules vanaf src/main.tsx`;
});

await runCheck("static", "Vercelconfig is fail-closed", async () => {
  const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  assert(config.framework === "vite", "Vercel framework is niet Vite");
  assert(Array.isArray(config.regions) && config.regions.includes("fra1"), "EU-functieregio fra1 ontbreekt");
  const cronPaths = new Set((config.crons ?? []).map((cron) => cron.path));
  const hobbyCronWorkflowPath = join(root, ".github/workflows/hobby-worker-crons.yml");
  const hobbyCronWorkflow = existsSync(hobbyCronWorkflowPath)
    ? readFileSync(hobbyCronWorkflowPath, "utf8")
    : "";
  const hasScheduledHobbyCronWorkflow = /\bon:\s*[\s\S]*\bschedule\s*:/.test(hobbyCronWorkflow);
  const expectedCronPaths = new Set([
    "/api/internal/cron/account-lifecycle",
  ]);
  assert(
    cronPaths.size === expectedCronPaths.size
      && [...expectedCronPaths].every((path) => cronPaths.has(path)),
    "Vercel-crons wijken af van de ene dagelijkse accountonderhoudstaak",
  );
  for (const cron of config.crons ?? []) {
    assert(/^\d{1,2} \d{1,2} \* \* \*$/.test(cron.schedule), `${cron.path} is niet eenmaal daags gepland`);
  }
  assert(!hasScheduledHobbyCronWorkflow, "feedbackbèta mag geen actieve hobby-workercrons vereisen");
  const redirects = new Map((config.redirects ?? []).map((redirect) => [redirect.source, redirect]));
  for (const [source, destination] of [
    ["/trips/new", "/project/nieuw"],
    ["/trip/:id", "/project/:id"],
    ["/trip/:id/photobook", "/project/:id/bouwboek"],
    ["/projecten/:id/bouwboek", "/project/:id/bouwboek"],
    ["/trip/:id/budget", "/project/:id/budget"],
    ["/profile/:profileKey", "/profiel/:profileKey"],
    ["/favorieten", "/volgend"],
    ["/vrienden", "/connecties"],
  ]) {
    const redirect = redirects.get(source);
    assert(redirect?.destination === destination && redirect?.permanent === true, `permanente redirect ontbreekt: ${source}`);
  }
  const serialized = JSON.stringify(config);
  assert(
    config.functions?.["api/router.ts"]?.maxDuration === 300,
    "API-router vereist expliciet 300 seconden voor hervatbare private streams",
  );
  assert(!/supabase|lovable/i.test(serialized), "Vercelconfig verwijst naar legacyprovider");
  assert(!/cloudflarestorage|peecho|brevo/i.test(serialized), "Vercelconfig verwijst naar uitgefaseerde provider");
  assert(serialized.includes("blob.vercel-storage.com"), "Vercel Blob upload-CSP ontbreekt");
  const globalHeaders = config.headers?.find((rule) => rule.source === "/(.*)")?.headers ?? [];
  const globalHeaderNames = new Set(globalHeaders.map((header) => header.key));
  const documentCors = globalHeaders.find((header) => header.key === "Access-Control-Allow-Origin");
  assert(
    documentCors?.value === "https://buildy-gamma.vercel.app",
    "document-CORS moet exact op het publieke Buildy-origin staan",
  );
  for (const name of [
    "Content-Security-Policy",
    "Cross-Origin-Opener-Policy",
    "Cross-Origin-Resource-Policy",
    "Permissions-Policy",
    "Referrer-Policy",
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
  ]) {
    assert(globalHeaderNames.has(name), `${name} ontbreekt op de globale /(.*)-route`);
  }
  return `${cronPaths.size} dagelijkse onderhoudscrons; ${redirects.size} redirects en securityheaders aanwezig`;
});

await runCheck("static", "Zichtbare provider- en bestelteksten spreken de MVP-waarheid", async () => {
  const files = [
    "src/pages/legal/Privacy.tsx",
    "src/pages/legal/Terms.tsx",
    "src/pages/legal/Withdrawal.tsx",
    "src/pages/OrderAdmin.tsx",
    "src/pages/OrderConfirmation.tsx",
    "src/pages/Photobook.tsx",
  ];
  const combined = files.map((path) => readFileSync(join(root, path), "utf8")).join("\n");
  assert(!/Peecho|Brevo|Cloudflare R2|cloudflarestorage/i.test(combined), "zichtbare copy noemt een uitgefaseerde provider");
  assert(/private Vercel Blob/i.test(combined), "private Vercel Blob ontbreekt in privacycopy");
  assert(/handmatig/i.test(combined), "handmatige druk-/fulfilmentwaarheid ontbreekt");
  assert(/Stripe[^\n]*(?:alleen|wanneer)|(?:alleen|wanneer)[^\n]*Stripe/i.test(combined), "conditionele Stripe-copy ontbreekt");
  return `${files.length} zichtbare juridische en besteloppervlakken gecontroleerd`;
});

await runCheck("static", "Verplichte opleverdocumenten bestaan", async () => {
  const missing = requiredDocs.filter((path) => !existsSync(join(root, path)));
  assert(missing.length === 0, `ontbreekt: ${missing.join(", ")}`);
  return `${requiredDocs.length}/${requiredDocs.length} documenten aanwezig`;
});

await runCheck("static", "Migratiebestanden en ledger zijn statisch geldig", async () => {
  const result = spawnSync("node", ["--import", "tsx", "db/migrate.ts", "--check"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    timeout: 30_000,
  });
  assert(result.status === 0, (result.stderr || result.stdout || "migratiecheck faalde").trim());
  return (result.stdout || "migratiecheck geslaagd").trim().split("\n").at(-1);
});

let baseUrl;
let expectedGitSha;
let expectedReleaseContract;
const vercelAutomationBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
if (!staticOnly) {
  await runCheck("live", "Doelomgeving is expliciet en veilig", async () => {
    assert(["preview", "staging", "production"].includes(requestedEnvironment), "gebruik --preview, --staging of --production");
    assert(rawBaseUrl, "geef --base-url=https://... of LAUNCH_BASE_URL op");
    const candidateBaseUrl = new URL(rawBaseUrl.includes("://") ? rawBaseUrl : `https://${rawBaseUrl}`);
    assert(candidateBaseUrl.protocol === "https:", "live launchprobe vereist HTTPS");
    assert(
      !candidateBaseUrl.username
        && !candidateBaseUrl.password
        && !candidateBaseUrl.search
        && !candidateBaseUrl.hash,
      "base URL mag geen credentials/query bevatten",
    );
    assert(candidateBaseUrl.pathname === "/", "base URL moet een origin zonder pad zijn");
    assert(!candidateBaseUrl.hostname.endsWith(".example"), "placeholderdomein is geen launchdoel");
    const candidateExpectedGitSha = requireExpectedGitSha(rawExpectedGitSha);
    baseUrl = candidateBaseUrl;
    expectedGitSha = candidateExpectedGitSha;
    expectedReleaseContract = releaseContractFor(requestedEnvironment);
    return `${requestedEnvironment} op ${baseUrl.origin}; ${expectedReleaseContract.profile}/${expectedReleaseContract.checkoutMode}; release-SHA expliciet vastgezet`;
  });
}

async function fetchWithin(path, init = {}) {
  assert(baseUrl, "veilige base URL kon niet worden vastgesteld");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const headers = new Headers(init.headers);
  headers.set("user-agent", "buildy-launch-check/2");
  if (vercelAutomationBypassSecret) {
    headers.set("x-vercel-protection-bypass", vercelAutomationBypassSecret);
  }
  try {
    return await fetch(new URL(path, baseUrl), {
      cache: "no-store",
      redirect: "manual",
      ...init,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function responseJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`HTTP ${response.status} gaf geen JSON`);
  }
}

if (!staticOnly && baseUrl) {
  await runCheck("live", "Publieke app en securityheaders", async () => {
    const response = await fetchWithin("/");
    assert(response.status === 200, `homepage gaf HTTP ${response.status}`);
    assert((response.headers.get("content-type") || "").includes("text/html"), "homepage is geen HTML");
    for (const header of [
      "content-security-policy",
      "cross-origin-opener-policy",
      "permissions-policy",
      "referrer-policy",
      "strict-transport-security",
      "x-content-type-options",
      "x-frame-options",
    ]) assert(response.headers.has(header), `${header} ontbreekt`);
    assert(!response.headers.get("access-control-allow-origin")?.includes("*"), "wildcard CORS op document");
    return `HTTP 200 met ${7} verplichte browserheaders`;
  });

  await runCheck("live", "Server-owned launchprofiel", async () => {
    const response = await fetchWithin("/api/product-profile");
    const body = await responseJson(response);
    assert(response.status === 200, `product-profile gaf HTTP ${response.status}`);
    assert(expectedReleaseContract, "verwacht releasecontract ontbreekt");
    verifyTargetProductProfile(body?.data, expectedReleaseContract);
    return `${expectedReleaseContract.profile}; checkout ${expectedReleaseContract.checkoutMode}; volledige productcapabilities actief`;
  });

  await runCheck("live", "Health heeft juiste release en capabilities", async () => {
    const response = await fetchWithin("/api/health");
    const body = await responseJson(response);
    assert(response.status === 200 && body?.data?.status === "ok", `health gaf HTTP ${response.status}`);
    assert(body.data.environment === requestedEnvironment, `verwacht ${requestedEnvironment}, kreeg ${body.data.environment}`);
    assert(expectedGitSha, "verwachte release-SHA ontbreekt");
    verifyDeployedGitSha(body.data.release, expectedGitSha);
    const capabilities = body.data.capabilities ?? {};
    verifyTargetCapabilities(capabilities);
    assert(response.headers.has("x-request-id"), "request-ID ontbreekt");
    return `auth, media en digitaal Bouwboek ready; checkout uit; release ${body.data.release}`;
  });

  await runCheck("live", "Readiness en least-privilegerollen", async () => {
    const response = await fetchWithin("/api/readiness");
    const body = await responseJson(response);
    assert(response.status === 200 && body?.data?.ready === true, `readiness gaf HTTP ${response.status}`);
    const failed = targetReadinessFailures(body.data.checks);
    assert(failed.length === 0, `onbewezen checks: ${failed.join(", ")}`);
    return `${Object.keys(body.data.checks).length} configuratie-/database- en workergrenzen pass`;
  });

  await runCheck("live", "Publieke legal-, robots- en sitemaproutes", async () => {
    for (const path of ["/privacy", "/voorwaarden", "/herroeping", "/robots.txt", "/sitemap.xml"]) {
      const response = await fetchWithin(path);
      assert(response.status === 200, `${path} gaf HTTP ${response.status}`);
    }
    return "5/5 routes bereikbaar";
  });

  await runCheck("live", "Anonieme private/mutatiegrenzen", async () => {
    const randomId = crypto.randomUUID();
    const privateResponse = await fetchWithin(`/api/media/${randomId}/original`);
    const protectedStatuses = [401, 404];
    assert(protectedStatuses.includes(privateResponse.status), `private media gaf HTTP ${privateResponse.status}`);
    assert(!privateResponse.headers.has("location"), "private media redirectte naar een object-URL");

    const mutationResponse = await fetchWithin("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl.origin },
      body: "{}",
    });
    const writeStatuses = [401];
    assert(writeStatuses.includes(mutationResponse.status), `anonieme projectwrite gaf HTTP ${mutationResponse.status}`);

    const hostileResponse = await fetchWithin("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.invalid" },
      body: "{}",
    });
    assert(hostileResponse.status === 403, `hostile Origin gaf HTTP ${hostileResponse.status}`);

    const adminResponse = await fetchWithin("/api/admin/orders");
    assert(writeStatuses.includes(adminResponse.status), `anoniem bestellingbeheer gaf HTTP ${adminResponse.status}`);
    return "private media, writes en bestellingbeheer fail-closed";
  });

  await runCheck("live", "Alleen accountonderhoud heeft een beschermde cronroute", async () => {
    const accountCron = await fetchWithin("/api/internal/cron/account-lifecycle");
    const expectedAccountCronStatuses = [401];
    assert(expectedAccountCronStatuses.includes(accountCron.status), `accountcron gaf HTTP ${accountCron.status}`);
    for (const path of ["/api/internal/cron/media", "/api/internal/cron/photobooks"]) {
      const response = await fetchWithin(path);
      assert(response.status === 404, `${path} is nog actief met HTTP ${response.status}`);
    }
    return "accountcron beschermd; media- en Bouwboekcron afwezig";
  });

  await runCheck("live", "Stripe-webhook volgt de checkoutgrens", async () => {
    const response = await fetchWithin("/api/webhooks/stripe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const expected = 503;
    assert(response.status === expected, `/api/webhooks/stripe gaf HTTP ${response.status}, verwacht ${expected}`);
    return "checkout uit; Stripe-webhook fail-closed onbeschikbaar";
  });
}

for (const check of checks) {
  const icon = check.status === "PASS" ? "✓" : "✗";
  console.log(`${icon} [${check.category}] ${check.name}: ${check.detail}`);
}

const failures = checks.filter((check) => check.status === "FAIL");
console.log(`\n${checks.length - failures.length}/${checks.length} launchchecks geslaagd.`);
if (staticOnly) console.log("Live provider-, domein- en restorebewijs is in --static bewust niet geclaimd.");
if (failures.length > 0) process.exitCode = 1;
