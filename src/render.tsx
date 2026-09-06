import type { ComponentType } from "preact";
import { renderToString } from "preact-render-to-string";
import { config, type PageMeta, type Params, type Site } from "./config.ts";
import type { HeadData } from "./Head.tsx";
import { isDev } from "./runtime/dev.ts";
import { send } from "./runtime/respond.ts";

export type { Params };

export type Page<D = unknown> = {
  default: ComponentType<{ params: Params; data: D }>;
  title: (params: Params, data: D) => string;
  /** What this page says about itself for search results and link previews,
   *  merged over the site defaults. LAUT-RENDER-16..20 */
  meta?: (params: Params, data: D) => PageMeta;
  /** Server-side data load, awaited before the render. LAUT-RENDER-19 */
  load?: (params: Params, req: Request) => D | Promise<D>;
  /** The chrome this page wants, named in your own app. LAUT-RENDER-03,
   *  LAUT-RENDER-04 */
  layout?: string;
  /** Serve this page as plain HTML and CSS -- no client runtime, no preact, no
   *  hydration. Governs a cold load only. LAUT-HEAD-08, LAUT-BUDGET-04 */
  ZERO_JS?: boolean;
};

/** LAUT-RENDER-06, LAUT-RENDER-07, LAUT-RENDER-08, LAUT-RENDER-09 */
function documentTitle(title: string, site: Site): string {
  if (site.titleTemplate) return site.titleTemplate.replace("%s", title);
  if (!site.name || title === site.name) return title || site.name || "";
  return `${title} · ${site.name}`;
}

/** LAUT-RENDER-11, LAUT-RENDER-12, LAUT-RENDER-13, LAUT-RENDER-14 */
const absolute = (origin: string, url?: string) =>
  !url
    ? undefined
    : /^[a-z][a-z0-9+.-]*:/i.test(url)
      ? url
      : origin + (url.startsWith("/") ? url : `/${url}`);

/** Turn a page module into a route handler: `"/about": page(about)`. */
export const page = (mod: Page<any>) => (req: Bun.BunRequest) =>
  renderPage(req, mod, req.params as Params);

/** Render a page: a whole document, a <main> fragment, or a shell swap.
 *  LAUT-RENDER-01, LAUT-RENDER-02, LAUT-RENDER-03, LAUT-RENDER-04 */
export async function renderPage(req: Request, page: Page<any>, params: Params = {}) {
  const { App, locale, beforeRender, site = {} } = config();
  const resolved = locale?.(req) ?? { lang: "en" };
  const data = await page.load?.(params, req);

  // LAUT-RENDER-21, LAUT-RENDER-24
  beforeRender?.(resolved.lang);

  const url = new URL(req.url);
  const Body = page.default;
  const title = documentTitle(page.title(params, data), site);
  const layout = page.layout ?? "";
  const zeroJS = page.ZERO_JS ?? false;
  const headers: Record<string, string> = { ...resolved.headers };

  if (req.headers.get("x-fragment")) {
    // LAUT-RENDER-03
    if ((req.headers.get("x-layout") ?? "") === layout) {
      headers["x-title"] = encodeURIComponent(title);
      return send(req, renderToString(<Body params={params} data={data} />), { headers });
    }
    // LAUT-RENDER-04
    headers["x-shell"] = "1";
  }

  // LAUT-RENDER-10, LAUT-RENDER-15, LAUT-RENDER-16, LAUT-RENDER-17
  const meta = page.meta?.(params, data) ?? {};
  const origin = (site.url ?? url.origin).replace(/\/+$/, "");
  const head: HeadData = {
    title,
    lang: resolved.lang,
    description: meta.description ?? site.description,
    canonical: absolute(origin, meta.canonical ?? url.pathname)!,
    image: absolute(origin, meta.image ?? site.image),
    imageAlt: meta.imageAlt,
    robots: meta.robots,
    type: meta.type ?? "website",
    siteName: site.name,
    twitter: site.twitter,
    ZERO_JS: zeroJS,
  };

  const html = renderToString(
    <App Body={Body} params={params} data={data} path={url.pathname} layout={layout} head={head} />,
  );

  // LAUT-HEAD-08, LAUT-BUDGET-04
  if (zeroJS && isDev() && html.includes("data-island")) {
    console.warn(
      `${url.pathname} is ZERO_JS but renders an island -- it ships no runtime, so ` +
        `the island will never hydrate. Drop ZERO_JS, or move the island off this ` +
        `page and off the ${layout ? `"${layout}"` : "default"} layout.`,
    );
  }

  return send(req, "<!doctype html>" + html, { headers });
}
