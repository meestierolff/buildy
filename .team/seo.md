# SEO Audit

## Strengths

- `usePageMeta` handles title, description, canonical, Open Graph and Twitter metadata.
- Sitemap and robots are generated from static routes and public Supabase content.
- Public project pages have shareable routes and project-specific metadata.

## Risks

- SPA rendering limits crawl depth for some bots. If organic search is a primary acquisition channel, add prerender/SSR for public project and landing pages.
- The homepage is more product-led than content-led. Renovation SEO needs evergreen pages: verbouwdagboek, bouwboek maken, renovatie planning, before-after renovation log.
- Public profiles/projects can become long-tail SEO assets, but privacy controls must be crisp.

## Next SEO Moves

- Add landing pages for "Bouwboek maken", "Verbouwing bijhouden", "Renovatie dagboek app".
- Add JSON-LD for Organization and public project pages where appropriate.
- Track indexed URLs and sitemap fetches after launch.
- Add alt text patterns for project cover images and generated social previews.
