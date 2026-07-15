import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

const root = process.cwd();
const env = {
  ...parseEnvFile(join(root, ".env")),
  ...parseEnvFile(join(root, ".env.production")),
  ...process.env,
};

const supabaseUrl = env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const siteUrl = (env.VITE_SITE_URL || "https://buildy.app").replace(/\/$/, "");

if (!supabaseUrl || !publishableKey) {
  console.error("Launch-check kan niet starten: VITE_SUPABASE_URL of VITE_SUPABASE_PUBLISHABLE_KEY ontbreekt.");
  process.exit(1);
}

const checks = [];
const errorMessage = (error) => {
  if (!(error instanceof Error)) return String(error);
  const causeCode = error.cause && typeof error.cause === "object" && "code" in error.cause
    ? String(error.cause.code)
    : null;
  return causeCode ? `${error.message} (${causeCode})` : error.message;
};
const runCheck = async (name, task) => {
  try {
    const detail = await task();
    checks.push({ status: "PASS", name, detail });
  } catch (error) {
    checks.push({
      status: "FAIL",
      name,
      detail: errorMessage(error),
    });
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const apiHeaders = {
  apikey: publishableKey,
  Authorization: `Bearer ${publishableKey}`,
  "Content-Type": "application/json",
};

const requestJson = async (url, init = {}) => {
  const response = await fetch(url, init);
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  return { response, body };
};

await runCheck("Publiek domein bereikbaar", async () => {
  const response = await fetch(`${siteUrl}/`, { method: "HEAD", redirect: "follow" });
  assert(response.ok, `HTTP ${response.status} op ${siteUrl}`);
  return `${response.status} ${new URL(response.url).host}`;
});

await runCheck("Supabase publieke projecten", async () => {
  const { response, body } = await requestJson(
    `${supabaseUrl}/rest/v1/trips?select=id,cover_storage_path,floorplan_storage_path&is_public=eq.true&limit=1`,
    { headers: apiHeaders },
  );
  assert(response.ok, `privacy-migratie ontbreekt of REST gaf HTTP ${response.status}`);
  assert(Array.isArray(body), "Onverwacht REST-antwoord");
  return `${body.length} rij(en) als anon zichtbaar`;
});

for (const [label, table, select] of [
  ["Fotoboekorders afgeschermd", "photobook_orders", "id,pdf_storage_path,pdf_delete_after,checkout_snapshot"],
  ["Meldingen afgeschermd", "notifications", "id"],
  ["Privéadressen afgeschermd", "trip_private_info", "trip_id"],
]) {
  await runCheck(label, async () => {
    const { response, body } = await requestJson(
      `${supabaseUrl}/rest/v1/${table}?select=${select}&limit=1`,
      { headers: apiHeaders },
    );
    assert(response.ok, `REST gaf HTTP ${response.status}`);
    assert(Array.isArray(body) && body.length === 0, "Anonieme gebruiker kon privédata lezen");
    return "0 rijen als anon";
  });
}

await runCheck("E-mailauth en registraties actief", async () => {
  const { response, body } = await requestJson(`${supabaseUrl}/auth/v1/settings`, {
    headers: { apikey: publishableKey },
  });
  assert(response.ok, `Auth settings gaf HTTP ${response.status}`);
  assert(body?.external?.email === true, "E-mail-auth staat uit");
  assert(body?.disable_signup !== true, "Nieuwe registraties staan uit");
  return "e-mail, magic link en registratie beschikbaar";
});

await runCheck("Google-loginroute werkt", async () => {
  const oauthUrl = new URL("/~oauth/initiate", `${siteUrl}/`);
  oauthUrl.searchParams.set("provider", "google");
  oauthUrl.searchParams.set("redirect_uri", `${siteUrl}/auth?next=%2Ftrips%2Fnew`);
  oauthUrl.searchParams.set("state", "buildy-launch-probe");
  const response = await fetch(oauthUrl, { redirect: "manual" });
  assert(
    response.status >= 300 && response.status < 400 && response.headers.has("location"),
    `OAuth broker gaf HTTP ${response.status} zonder redirect`,
  );
  return `HTTP ${response.status} redirect naar provider`;
});

await runCheck("Checkout weigert anonieme orders", async () => {
  const { response } = await requestJson(
    `${supabaseUrl}/functions/v1/create-photobook-checkout`,
    {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({ orderId: crypto.randomUUID() }),
    },
  );
  assert(response.status === 401, `Verwacht HTTP 401, kreeg ${response.status}`);
  return "HTTP 401";
});

for (const [label, functionName, body] of [
  ["AI-plattegrond weigert anoniem gebruik", "floorplan-blueprint", { imageUrl: `${siteUrl}/test.jpg` }],
  ["Accountverwijdering weigert anoniem gebruik", "delete-account", {}],
  ["PDF-retentiejob weigert anoniem gebruik", "cleanup-photobook-retention", {}],
]) {
  await runCheck(label, async () => {
    const { response } = await requestJson(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify(body),
    });
    assert(response.status === 401, `Verwacht HTTP 401, kreeg ${response.status}`);
    return "HTTP 401";
  });
}

await runCheck("Stripe-webhook geconfigureerd en beveiligd", async () => {
  const { response, body } = await requestJson(`${supabaseUrl}/functions/v1/stripe-webhook`, {
    method: "POST",
    headers: apiHeaders,
    body: "{}",
  });
  const message = typeof body === "object" && body ? body.error || body.message : String(body || "");
  assert(!/not configured|ontbreekt/i.test(message), "Stripe webhook secret/configuratie ontbreekt");
  assert(response.status === 400 || response.status === 401, `Ongesigneerd verzoek gaf onverwacht HTTP ${response.status}`);
  return `HTTP ${response.status} voor ongeldige signature`;
});

await runCheck("Peecho-pingback beveiligd", async () => {
  const { response } = await requestJson(`${supabaseUrl}/functions/v1/peecho-pingback`, {
    method: "POST",
    headers: apiHeaders,
    body: JSON.stringify({ order_reference: "buildy-launch-probe", order_id: "0", signature: "invalid" }),
  });
  assert(response.status === 401, `Ongeldige signature gaf HTTP ${response.status}`);
  return "HTTP 401 voor ongeldige signature";
});

for (const check of checks) {
  const icon = check.status === "PASS" ? "✓" : "✗";
  console.log(`${icon} ${check.name}: ${check.detail}`);
}

const failures = checks.filter((check) => check.status === "FAIL");
console.log(`\n${checks.length - failures.length}/${checks.length} launch-checks geslaagd.`);
if (failures.length > 0) process.exitCode = 1;
