import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const KIB = 1024;
const DEFAULT_OUTPUT_DIR = "dist";
const budgets = Object.freeze({
  javascriptFileRaw: 250 * KIB,
  javascriptFileGzip: 75 * KIB,
  javascriptTotalRaw: 1_250 * KIB,
  javascriptTotalGzip: 380 * KIB,
  stylesheetFileRaw: 100 * KIB,
  stylesheetFileGzip: 25 * KIB,
});

function outputDirectory(argv) {
  const index = argv.indexOf("--output-dir");
  if (index === -1) return resolve(DEFAULT_OUTPUT_DIR);

  const value = argv[index + 1]?.trim();
  if (!value) throw new Error("--output-dir vereist een waarde.");
  return resolve(value);
}

function formatBytes(bytes) {
  return `${(bytes / KIB).toFixed(1)} KiB`;
}

async function assetFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await assetFiles(path));
      continue;
    }
    if (entry.isFile() && /\.(?:css|js)$/.test(entry.name)) files.push(path);
  }

  return files.sort();
}

function exceeds(label, actual, budget, failures) {
  if (actual <= budget) return;
  failures.push(`${label}: ${formatBytes(actual)} > ${formatBytes(budget)}`);
}

const directory = outputDirectory(process.argv.slice(2));
const assetsDirectory = join(directory, "assets");
const directoryStats = await stat(assetsDirectory).catch(() => null);
if (!directoryStats?.isDirectory()) {
  throw new Error(`Geen gebouwde assetmap gevonden: ${assetsDirectory}`);
}

const measurements = await Promise.all((await assetFiles(assetsDirectory)).map(async (path) => {
  const contents = await readFile(path);
  return {
    path: relative(directory, path),
    raw: contents.byteLength,
    gzip: gzipSync(contents, { level: 9 }).byteLength,
    type: path.endsWith(".js") ? "javascript" : "stylesheet",
  };
}));

if (measurements.length === 0) throw new Error("De productiebuild bevat geen JavaScript- of CSS-assets.");

const failures = [];
const javascript = measurements.filter((asset) => asset.type === "javascript");
const stylesheets = measurements.filter((asset) => asset.type === "stylesheet");

for (const asset of javascript) {
  exceeds(`${asset.path} raw`, asset.raw, budgets.javascriptFileRaw, failures);
  exceeds(`${asset.path} gzip`, asset.gzip, budgets.javascriptFileGzip, failures);
}
for (const asset of stylesheets) {
  exceeds(`${asset.path} raw`, asset.raw, budgets.stylesheetFileRaw, failures);
  exceeds(`${asset.path} gzip`, asset.gzip, budgets.stylesheetFileGzip, failures);
}

const javascriptRaw = javascript.reduce((total, asset) => total + asset.raw, 0);
const javascriptGzip = javascript.reduce((total, asset) => total + asset.gzip, 0);
exceeds("alle JavaScript-assets raw", javascriptRaw, budgets.javascriptTotalRaw, failures);
exceeds("alle JavaScript-assets gzip", javascriptGzip, budgets.javascriptTotalGzip, failures);

const largest = [...measurements]
  .sort((left, right) => right.raw - left.raw)
  .slice(0, 5)
  .map((asset) => `${asset.path} (${formatBytes(asset.raw)} raw / ${formatBytes(asset.gzip)} gzip)`);

console.log(`Bundelbudget: ${javascript.length} JS- en ${stylesheets.length} CSS-assets.`);
console.log(`JavaScript totaal: ${formatBytes(javascriptRaw)} raw / ${formatBytes(javascriptGzip)} gzip.`);
console.log(`Grootste assets:\n- ${largest.join("\n- ")}`);

if (failures.length > 0) {
  throw new Error(`Bundelbudget overschreden:\n- ${failures.join("\n- ")}`);
}

console.log("Bundelbudget: PASS");
