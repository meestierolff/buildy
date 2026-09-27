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

const staticRoutes = [
  { path: "/", changefreq: "weekly", priority: "1.0", lastmod: today },
  { path: "/voorwaarden", changefreq: "yearly", priority: "0.2", lastmod: today },
  { path: "/privacy", changefreq: "yearly", priority: "0.2", lastmod: today },
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticRoutes
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
Disallow: /connecties
Disallow: /notificaties
Disallow: /project/nieuw
Disallow: /project/*/bouwboek
Disallow: /projecten
Disallow: /update/nieuw
Disallow: /volgend

Sitemap: ${siteUrl}/sitemap.xml
`;

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "sitemap.xml"), sitemap);
writeFileSync(resolve(outputDirectory, "robots.txt"), robots);
