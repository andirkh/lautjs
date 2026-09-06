# my-laut-app

Built with [Laut](https://github.com/deltahq/laut) — an islands meta-framework
for Bun 1.4 with no build step.

```bash
bun install
bun dev      # → http://localhost:3000
bun start    # production
```

## Where things go

```
server.ts             wiring — createServer({ … })
routes.ts             the route table
public/app.css        document-wide CSS
src/App.tsx           your document root
src/backend/          PRIVATE — never served to the browser
src/frontend/
  boot.ts             the one client entry
  islands/            interactive components (these ship JS)
  sea/                pages + layouts (these ship none)
  core/state/         signals shared between islands
```

## The `<head>`

`server.ts` carries a `site: { … }` block — name, canonical `url`, fallback
description and share image. Laut turns that, plus a page's own `export const
meta`, into the title, SEO and social tags. Set `site.url` before you deploy:
without it the canonical URL is built from whatever host the request arrived on.

**The full guide is `node_modules/lautjs/GUIDE.md`** — directory rules, pages,
layouts, islands, styling, state, API routes, navigation, localization, the
config reference, and a do/don't list worth reading once.
