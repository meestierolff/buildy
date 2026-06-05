import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

const siteUrl = (env.VITE_SITE_URL || "https://buildy.app").replace(/\/$/, "");
const today = new Date().toISOString().slice(0, 10);
const supabaseUrl = env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const fetchSupabaseRows = async (table, query) => {
  if (!supabaseUrl || !supabaseKey || typeof fetch !== "function") return [];

  const url = `${supabaseUrl}/rest/v1/${table}?${query}`;
  try {
    const response = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        authorization: `Bearer ${supabaseKey}`,
      },
    });
    if (!response.ok) {
      console.warn(`Skipping ${table} sitemap entries: ${response.status} ${response.statusText}`);
      return [];
    }
    return await response.json();
  } catch (error) {
    console.warn(`Skipping ${table} sitemap entries:`, error.message);
    return [];
  }
};

const staticRoutes = [
  { path: "/", changefreq: "weekly", priority: "1.0", lastmod: today },
  { path: "/vrienden", changefreq: "weekly", priority: "0.7", lastmod: today },
];

const publicTrips = await fetchSupabaseRows(
  "trips",
  "select=id,updated_at,created_at&is_public=eq.true&order=updated_at.desc&limit=500",
);
const publicProfiles = await fetchSupabaseRows(
  "profiles",
  "select=user_id,updated_at,created_at&is_private=eq.false&order=updated_at.desc&limit=500",
);

const dynamicRoutes = [
  ...publicTrips.map((trip) => ({
    path: `/trip/${trip.id}`,
    changefreq: "weekly",
    priority: "0.8",
    lastmod: (trip.updated_at || trip.created_at || today).slice(0, 10),
  })),
  ...publicProfiles.map((profile) => ({
    path: `/profile/${profile.user_id}`,
    changefreq: "monthly",
    priority: "0.5",
    lastmod: (profile.updated_at || profile.created_at || today).slice(0, 10),
  })),
];

const seen = new Set();
const routes = [...staticRoutes, ...dynamicRoutes].filter((route) => {
  if (seen.has(route.path)) return false;
  seen.add(route.path);
  return true;
});

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes
  .map(
    (route) => `  <url>
    <loc>${escapeXml(`${siteUrl}${route.path}`)}</loc>
    <lastmod>${route.lastmod}</lastmod>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;

const robots = `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;

writeFileSync(join(root, "public", "sitemap.xml"), sitemap);
writeFileSync(join(root, "public", "robots.txt"), robots);
