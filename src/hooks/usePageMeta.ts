import { useEffect } from "react";

const DEFAULT_TITLE = "Buildy — Verbouwingsdagboek en Bouwboek maken";
const DEFAULT_DESCRIPTION =
  "Houd je verbouwing bij met foto's, updates, mijlpalen en budget. Maak van je renovatie automatisch een gedrukt Bouwboek.";
const DEFAULT_IMAGE = "/og-image.png";

interface PageMeta {
  title?: string;
  description?: string;
  image?: string;
  path?: string;
  noIndex?: boolean;
}

const siteUrl = () => {
  const configured = import.meta.env.VITE_SITE_URL?.replace(/\/$/, "");
  return configured || window.location.origin;
};

const absoluteUrl = (value: string) => {
  if (/^https?:\/\//i.test(value)) return value;
  return `${siteUrl()}${value.startsWith("/") ? value : `/${value}`}`;
};

const upsertMeta = (selector: string, attrs: Record<string, string>) => {
  let element = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!element) {
    element = document.createElement("meta");
    if (attrs.name) element.setAttribute("name", attrs.name);
    if (attrs.property) element.setAttribute("property", attrs.property);
    document.head.appendChild(element);
  }
  Object.entries(attrs).forEach(([key, value]) => element?.setAttribute(key, value));
};

const upsertCanonical = (href: string) => {
  let link = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.href = href;
};

export const usePageMeta = ({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  image = DEFAULT_IMAGE,
  path,
  noIndex = false,
}: PageMeta) => {
  useEffect(() => {
    const pageTitle = title.includes("Buildy") ? title : `${title} — Buildy`;
    const pageUrl = absoluteUrl(path ?? window.location.pathname);
    const imageUrl = absoluteUrl(image);

    document.title = pageTitle;
    upsertCanonical(pageUrl);
    upsertMeta('meta[name="description"]', { name: "description", content: description });
    upsertMeta('meta[name="robots"]', { name: "robots", content: noIndex ? "noindex,follow" : "index,follow" });
    upsertMeta('meta[property="og:title"]', { property: "og:title", content: pageTitle });
    upsertMeta('meta[property="og:description"]', { property: "og:description", content: description });
    upsertMeta('meta[property="og:url"]', { property: "og:url", content: pageUrl });
    upsertMeta('meta[property="og:image"]', { property: "og:image", content: imageUrl });
    upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: pageTitle });
    upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: description });
    upsertMeta('meta[name="twitter:image"]', { name: "twitter:image", content: imageUrl });
  }, [description, image, noIndex, path, title]);
};
