// Wiring: this is the whole of what Laut needs to know about your app.
// Run it with `bun dev` (hot) or `bun start` (production).
import { createServer } from "lautjs";
import { routes } from "./routes.ts";
import { App } from "./src/App.tsx";

const server = createServer({
  App,
  routes,
  port: 3000,

  // What every document's <head> says when the page itself says nothing. Laut
  // merges a page's own `meta` export over this, makes the URLs absolute and
  // renders the tags -- see <Head> in src/frontend/sea/Document.tsx.
  site: {
    name: "Laut",
    description: "An islands meta-framework for Bun. Preact + signals, no build step.",
    // The canonical origin. Behind a proxy or on a preview deployment the
    // request's own host is the wrong answer -- that is how a canonical tag
    // ends up pointing at an internal name -- so say it once, here. Left unset,
    // Laut falls back to the request, which is right in dev and nowhere else.
    // url: "https://example.com",

    // Fallback share image, root-relative or absolute. Anything a crawler is
    // meant to fetch has to be reachable, so /public/… , not /src/… .
    // image: "/public/og.png",

    // twitter: "@example",

    // How a page title becomes a document title -- `%s` is the page's own.
    // Defaults to "%s · {name}", which is what you usually want.
    // titleTemplate: "%s · Laut",
  },

  // Paste stylesheets below this many bytes into the document instead of
  // linking them -- one <style> tag rather than a render-blocking round trip
  // each. 4096 is the default; `0` turns it off and links everything.
  // cssInlineStylesheet: 4096,

  // Browser ESM builds for any *extra* bare specifier your app imports.
  // preact, @preact/signals and kinu are already wired up by Laut.
  // vendor: { "date-fns": "date-fns/index.js" },
});

console.log(`→ ${server.url}`);
