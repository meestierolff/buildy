import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const outputArgumentIndex = process.argv.indexOf("--output-dir");
const outputDirectory = resolve(
  root,
  outputArgumentIndex >= 0 ? process.argv[outputArgumentIndex + 1] || "dist" : "dist",
);
const configuredSiteUrl = process.env.APP_ORIGIN || process.env.VITE_SITE_URL;
const siteUrl = (() => {
  if (!configuredSiteUrl) return "https://buildy.invalid";
  const parsed = new URL(configuredSiteUrl);
  const localHttp = parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !localHttp)
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) throw new Error("APP_ORIGIN/VITE_SITE_URL moet een veilige origin zonder pad zijn.");
  return parsed.origin;
})();
const today = new Date().toISOString().slice(0, 10);

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const fetchPublicEntries = async () => {
  const sourceUrl = process.env.SITEMAP_SOURCE_URL;
  if (!sourceUrl || typeof fetch !== "function") return { projects: [], profiles: [] };

  try {
    const response = await fetch(sourceUrl, {
      headers: process.env.SITEMAP_SOURCE_TOKEN
        ? { authorization: `Bearer ${process.env.SITEMAP_SOURCE_TOKEN}` }
        : undefined,
    });
    if (!response.ok) {
      console.warn(`Sitemapbron overgeslagen: ${response.status} ${response.statusText}`);
      return { projects: [], profiles: [] };
    }

    const payload = await response.json();
    return {
      projects: Array.isArray(payload.projects) ? payload.projects : [],
      profiles: Array.isArray(payload.profiles) ? payload.profiles : [],
    };
  } catch (error) {
    console.warn("Sitemapbron overgeslagen:", error instanceof Error ? error.message : "onbekende fout");
    return { projects: [], profiles: [] };
  }
};

const staticRoutes = [
  { path: "/", changefreq: "weekly", priority: "1.0", lastmod: today },
  { path: "/ontdekken", changefreq: "daily", priority: "0.8", lastmod: today },
  { path: "/voorwaarden", changefreq: "yearly", priority: "0.2", lastmod: today },
  { path: "/privacy", changefreq: "yearly", priority: "0.2", lastmod: today },
  { path: "/herroeping", changefreq: "yearly", priority: "0.2", lastmod: today },
];

const publicEntries = await fetchPublicEntries();
const dynamicRoutes = [
  ...publicEntries.projects.filter((project) => (
    project && typeof project.id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(project.id)
  )).map((project) => ({
    path: `/project/${encodeURIComponent(project.id.toLowerCase())}`,
    changefreq: "weekly",
    priority: "0.8",
    lastmod: String(project.updatedAt || today).slice(0, 10),
  })),
  ...publicEntries.profiles.filter((profile) => (
    profile && typeof profile.slug === "string"
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile.slug)
  )).map((profile) => ({
    path: `/profiel/${encodeURIComponent(profile.slug)}`,
    changefreq: "monthly",
    priority: "0.5",
    lastmod: String(profile.updatedAt || today).slice(0, 10),
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
Disallow: /account
Disallow: /beheer/
Disallow: /bestelling/
Disallow: /bestellingen/
Disallow: /connecties
Disallow: /notificaties
Disallow: /project/nieuw
Disallow: /project/*/budget
Disallow: /project/*/bouwboek
Disallow: /projecten
Disallow: /update/nieuw
Disallow: /volgend

Sitemap: ${siteUrl}/sitemap.xml
`;

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "sitemap.xml"), sitemap);
writeFileSync(resolve(outputDirectory, "robots.txt"), robots);
