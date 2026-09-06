// The contract between Laut and an app. LAUT-ARCH-01
import type { ComponentType } from "preact";
import type { HeadData } from "./Head.tsx";

export type Params = Record<string, string>;

/**
 * What a page says about itself for search results and link previews, over the
 * top of `createServer({ site })`. A page exports it as a function of the same
 * `params` and `data` its `title` gets:
 *
 *   export const meta = (params: Params, data: Data) => ({
 *     description: data.post.summary,
 *     image: data.post.cover,
 *     type: "article",
 *   });
 *
 * Everything here is optional, and everything left out falls back to the site
 * default. Laut resolves the merge -- relative image paths made absolute, the
 * canonical URL filled in from the request -- before your App sees it.
 */
export type PageMeta = {
  /** One or two sentences. This is the line under the title in a search
   *  result, and the body of a link preview. */
  description?: string;
  /** The share image, root-relative (`/public/og.png`) or absolute. */
  image?: string;
  /** Alt text for that image. */
  imageAlt?: string;
  /** `<meta name="robots">`, for the pages that should not be indexed --
   *  "noindex, nofollow" on a search result page or a private dashboard. */
  robots?: string;
  /** The canonical URL, when this page is reachable at more than one address
   *  and this is not the one. Defaults to the path being rendered. */
  canonical?: string;
  /** og:type. Defaults to "website"; "article" for a post. */
  type?: string;
};

/** Facts about the site as a whole -- the fallbacks under every page's own
 *  `meta`, and the things that are the site's rather than any one page's. */
export type Site = {
  /** The site name: og:site_name, and the tail of every document title. */
  name?: string;
  /**
   * The canonical origin, e.g. "https://example.com". Absolute URLs need one,
   * and the request's own is the wrong answer behind a proxy or a preview
   * deployment -- that is how a canonical tag ends up pointing at an internal
   * host. Set this in production; without it Laut falls back to the request.
   */
  url?: string;
  /** Fallback description, for pages that do not write their own. */
  description?: string;
  /** Fallback share image. */
  image?: string;
  /** The site's @handle, for twitter:site. */
  twitter?: string;
  /** How a page title becomes a document title -- `%s` is the page's own.
   *  Defaults to "%s · {name}" when `name` is set, and to the page title
   *  alone when it is not. A page whose title already *is* the site name is
   *  left alone, so the home page does not read "Acme · Acme". */
  titleTemplate?: string;
};

/** What Laut hands your document root on every render. */
export type AppProps = {
  Body: ComponentType<{ params: Params; data: any }>;
  params: Params;
  data: unknown;
  path: string;
  /**
   * The chrome this page asked for, straight from the page module's `layout`
   * export -- `""` when it asked for nothing. The name means nothing to the
   * framework: your App maps it to a component, and the router only ever
   * compares it to the one the document already has.
   */
  layout: string;
  /**
   * Everything the document's <head> needs, resolved: title, language, SEO,
   * and the `ZERO_JS` flag the scripts hang off. Spread it onto `<Head>` --
   * that component is Laut's, and it is what turns this into tags.
   */
  head: HeadData;
};

export type Config = {
  /** Your document root -- the `<html>` document. Required. */
  App: ComponentType<AppProps>;
  /** Your route table. Laut merges its own routes underneath it. Required. */
  routes: Record<string, unknown>;

  /**
   * Name, origin and fallbacks for the document <head> -- see `Site`. Every
   * field is optional and every one of them is a default a page can override
   * with its own `meta` export. Setting `url` is the one that matters in
   * production: it is what canonical and og:url are built from.
   */
  site?: Site;

  /** Port to listen on. Default 3000. */
  port?: number;
  /** Project root on disk; sources are read relative to it. Default `process.cwd()`. */
  root?: string;
  /**
   * Bare specifier -> file inside node_modules, merged over Laut's own.
   * preact, preact/hooks, preact/jsx-runtime, @preact/signals and kinu are
   * already there -- this is for anything else your islands import.
   */
  vendor?: Record<string, string>;
  /**
   * Subtrees of /src that must never be served to the browser, as URL prefixes.
   * Default `["/src/backend/"]`. Everything else under /src is public by
   * definition: it is the module graph the browser imports.
   */
  private?: string[];
  /**
   * Compress response bodies at or above this many bytes. Default 1024.
   */
  compressMin?: number;
  /**
   * Paste stylesheets smaller than this many bytes into the document as one
   * `<style>` tag, instead of linking them. Default 4096, the same cutoff
   * Astro's `build.inlineStylesheets: "auto"` uses. `0` turns it off.
   *
   * A component sheet is a few hundred bytes and a render-blocking round trip,
   * and `cache-control: no-cache` means the browser makes that trip on every
   * load -- so an app with forty islands pays forty of them before first paint
   * to fetch a few kilobytes. Inlining trades that for bytes in the document,
   * which the response gzip is already compressing.
   *
   * Big, stable sheets are better left linked: they are fetched once and reused
   * across every page, where an inlined sheet rides along with each document.
   * That is what the threshold is choosing between.
   *
   * Dev ignores this and links everything, so the reloader can still swap one
   * sheet's href without re-rendering the island under it.
   */
  cssInlineStylesheet?: number;

  /** Per-request document language, plus any headers that choice implies.
   *  Omit it and every document is rendered as `lang="en"`. */
  locale?: (req: Request) => { lang: string; headers?: Record<string, string> };
  /** Runs synchronously right before the render -- set your signals here. */
  beforeRender?: (lang: string) => void;
};

let current: Config | null = null;

export function setConfig(config: Config) {
  current = config;
}

export function config(): Config {
  if (!current) throw new Error("Laut is not configured -- call createServer() first.");
  return current;
}
