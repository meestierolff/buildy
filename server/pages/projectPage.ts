const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const META_NAMES = new Set([
  "description",
  "robots",
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
  "twitter:image:alt",
]);

const META_PROPERTIES = new Set([
  "og:type",
  "og:locale",
  "og:site_name",
  "og:title",
  "og:description",
  "og:url",
  "og:image",
  "og:image:secure_url",
  "og:image:alt",
]);

export interface PublicProjectPageData {
  id: string;
  title: string;
  description: string | null;
  ownerDisplayName: string;
  coverAssetId: string | null;
}

export interface ProjectPageDependencies {
  appOrigin: string;
  loadSpaShell: () => Promise<string>;
  readAnonymousPublicProject: (projectId: string) => Promise<PublicProjectPageData | null>;
}

interface PageMetadata {
  canonicalUrl: string;
  description: string;
  imageAlt: string;
  imageUrl: string;
  indexable: boolean;
  title: string;
  type: "article" | "website";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizedOrigin(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) throw new Error("De publieke app-origin voor projectpagina's is ongeldig.");
  return url.origin;
}

function compactDescription(value: string | null, fallback: string): string {
  const compact = value?.replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  return compact.length <= 180 ? compact : `${compact.slice(0, 179).trimEnd()}…`;
}

function tagAttribute(tag: string, attribute: string): string | null {
  const match = new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag);
  return match?.[2]?.toLowerCase() ?? null;
}

function stripExistingPageMetadata(shell: string): string {
  return shell
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, "")
    .replace(/<meta\b[^>]*>/gi, (tag) => {
      const name = tagAttribute(tag, "name");
      const property = tagAttribute(tag, "property");
      return (name && META_NAMES.has(name)) || (property && META_PROPERTIES.has(property)) ? "" : tag;
    })
    .replace(/<link\b[^>]*>/gi, (tag) => (
      tagAttribute(tag, "rel") === "canonical" ? "" : tag
    ));
}

export function renderProjectPageHtml(shell: string, metadata: PageMetadata): string {
  if (!/<\/head\s*>/i.test(shell) || !/<div\s+id=["']root["']/i.test(shell)) {
    throw new Error("De gebouwde SPA-shell mist de verwachte head of root.");
  }

  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description);
  const canonicalUrl = escapeHtml(metadata.canonicalUrl);
  const imageUrl = escapeHtml(metadata.imageUrl);
  const imageAlt = escapeHtml(metadata.imageAlt);
  const robots = metadata.indexable ? "index,follow" : "noindex,nofollow";
  const block = `
    <title>${title}</title>
    <meta name="description" content="${description}">
    <meta name="robots" content="${robots}">
    <link rel="canonical" href="${canonicalUrl}">
    <meta property="og:type" content="${metadata.type}">
    <meta property="og:locale" content="nl_NL">
    <meta property="og:site_name" content="Buildy">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${canonicalUrl}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:image:secure_url" content="${imageUrl}">
    <meta property="og:image:alt" content="${imageAlt}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    <meta name="twitter:image" content="${imageUrl}">
    <meta name="twitter:image:alt" content="${imageAlt}">
  `;

  return stripExistingPageMetadata(shell).replace(/<\/head\s*>/i, `${block}</head>`);
}

export function createProjectPageHandler(dependencies: ProjectPageDependencies) {
  const appOrigin = normalizedOrigin(dependencies.appOrigin);

  const unavailableResponse = () => new Response("De applicatiepagina is tijdelijk niet beschikbaar.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-robots-tag": "noindex, nofollow",
    },
  });

  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    const url = new URL(request.url);
    const candidateId = url.searchParams.get("__buildy_project_id")?.trim().toLowerCase() ?? "";
    const projectId = UUID.test(candidateId) ? candidateId : null;
    let project: PublicProjectPageData | null = null;

    if (projectId) {
      try {
        project = await dependencies.readAnonymousPublicProject(projectId);
      } catch {
        // Link previews must fail closed without leaking database/provider detail.
        project = null;
      }
    }

    const canonicalPath = projectId ? `/project/${projectId}` : url.pathname;
    const canonicalUrl = new URL(canonicalPath, appOrigin).toString();
    const metadata: PageMetadata = project ? {
      canonicalUrl,
      title: `${project.title} — Buildy`,
      description: compactDescription(
        project.description,
        `Bekijk het openbare verbouwingsproject van ${project.ownerDisplayName} op Buildy.`,
      ),
      imageUrl: new URL(
        project.coverAssetId ? `/api/media/${project.coverAssetId}` : "/social-preview.svg",
        appOrigin,
      ).toString(),
      imageAlt: `Openbaar verbouwingsproject ${project.title} op Buildy`,
      indexable: true,
      type: "article",
    } : {
      canonicalUrl,
      title: "Project — Buildy",
      description: "Open Buildy om te controleren of dit verbouwingsproject voor jou beschikbaar is.",
      imageUrl: new URL("/social-preview.svg", appOrigin).toString(),
      imageAlt: "Buildy — sociaal verbouwingsdagboek",
      indexable: false,
      type: "website",
    };

    let shell: string;
    try {
      shell = await dependencies.loadSpaShell();
    } catch {
      return unavailableResponse();
    }

    let html: string;
    try {
      html = renderProjectPageHtml(shell, metadata);
    } catch {
      return unavailableResponse();
    }
    const headers = new Headers({
      // Public projects can become private at any time. Caching page metadata at
      // an intermediary could keep a title or cover visible after that change.
      "cache-control": "private, no-store",
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "x-robots-tag": metadata.indexable ? "index, follow" : "noindex, nofollow",
    });
    return new Response(request.method === "HEAD" ? null : html, { status: 200, headers });
  };
}
