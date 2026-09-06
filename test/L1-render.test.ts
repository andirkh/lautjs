/**
 * L1 -- how a page's exports become the resolved facts a <head> is built from.
 *
 * The split against L2 is deliberate. This file is about *resolution*: merging a
 * page's `meta` over the site defaults, applying the title template, making URLs
 * absolute, choosing the canonical. L2 is about *emission*: what tags come out
 * and in what order. A bug in resolution produces a plausible-looking tag with
 * the wrong value in it, which no amount of eyeballing the markup will catch.
 */
import { describe, expect, test } from "bun:test";
import type { AppProps, Config } from "../src/config.ts";
import { setConfig } from "../src/config.ts";
import type { HeadData } from "../src/Head.tsx";
import { renderPage, type Page } from "../src/render.tsx";

/**
 * Render a page and hand back what Laut resolved for its <head>.
 *
 * The App is a probe rather than a real document: it captures `head` and
 * renders nothing. Reading the values out of the props is exact, where reading
 * them back out of serialised HTML would mean un-escaping entities and
 * re-parsing attributes -- and would quietly conflate a resolution bug with an
 * escaping one.
 */
async function resolveHead(
  page: Partial<Page<any>>,
  config: Partial<Config> = {},
  url = "http://localhost:3000/about",
): Promise<{ head: HeadData; res: Response }> {
  let captured: HeadData | undefined;

  setConfig({
    App: (props: AppProps) => {
      captured = props.head;
      return null as any;
    },
    routes: {},
    ...config,
  });

  const res = await renderPage(new Request(url), {
    default: () => null as any,
    title: () => "About",
    ...page,
  } as Page<any>);

  return { head: captured!, res };
}

describe("LAUT-RENDER -- titles", () => {
  /**
   * LAUT-RENDER-06 -- the default template appends the site name.
   */
  test("LAUT-RENDER-06 a page title becomes '<title> · <site>'", async () => {
    const { head } = await resolveHead({}, { site: { name: "Acme" } });
    expect(head.title).toBe("About · Acme");
  });

  /**
   * LAUT-RENDER-07 -- a page already titled the site name is left alone.
   *
   * Otherwise the home page reads "Acme · Acme", which is the sort of thing that
   * ships because everybody who looks at it assumes somebody else meant it.
   */
  test("LAUT-RENDER-07 a title equal to the site name is not doubled", async () => {
    const { head } = await resolveHead({ title: () => "Acme" }, { site: { name: "Acme" } });
    expect(head.title).toBe("Acme");
  });

  /**
   * LAUT-RENDER-08 -- an explicit template wins, and is applied verbatim.
   */
  test("LAUT-RENDER-08 titleTemplate replaces %s", async () => {
    const { head } = await resolveHead(
      {},
      { site: { name: "Acme", titleTemplate: "%s | Acme Corp" } },
    );
    expect(head.title).toBe("About | Acme Corp");
  });

  /**
   * LAUT-RENDER-09 -- with no site name there is nothing to append.
   */
  test("LAUT-RENDER-09 a site with no name yields the bare page title", async () => {
    const { head } = await resolveHead({}, { site: {} });
    expect(head.title).toBe("About");
  });
});

describe("LAUT-RENDER -- canonical and absolute URLs", () => {
  /**
   * LAUT-RENDER-10 -- the canonical is the path, and the query is dropped.
   *
   * Deliberate, and the single most useful thing in the block: a query string is
   * how one page becomes a hundred near-duplicates in an index. `?utm_source=`,
   * `?ref=`, `?page=1` -- all the same page, all competing with each other,
   * unless the canonical says which one they are.
   */
  test("LAUT-RENDER-10 the canonical drops the query string", async () => {
    const { head } = await resolveHead(
      {},
      { site: { url: "https://acme.test" } },
      "http://localhost:3000/about?utm_source=newsletter&ref=x",
    );
    expect(head.canonical).toBe("https://acme.test/about");
  });

  /**
   * LAUT-RENDER-11 -- `site.url` beats the request's own origin.
   *
   * Behind a proxy or on a preview deployment the request's host is an internal
   * name, and a canonical tag built from it points crawlers at a host they
   * cannot reach -- while `og:url` sends anyone who pastes the link there too.
   */
  test("LAUT-RENDER-11 site.url overrides the request origin", async () => {
    const { head } = await resolveHead(
      {},
      { site: { url: "https://acme.test" } },
      "http://internal-7f3a.cluster.local:8080/about",
    );
    expect(head.canonical).toBe("https://acme.test/about");
  });

  /**
   * LAUT-RENDER-12 -- with no site.url the request's origin is the fallback.
   *
   * Right in dev, where nobody has configured one, and wrong everywhere else --
   * which is why LAUT-RENDER-11 exists.
   */
  test("LAUT-RENDER-12 the request origin is used when site.url is unset", async () => {
    const { head } = await resolveHead({}, { site: {} }, "http://localhost:3000/about");
    expect(head.canonical).toBe("http://localhost:3000/about");
  });

  /**
   * LAUT-RENDER-13 -- a trailing slash on site.url does not double up.
   */
  test("LAUT-RENDER-13 trailing slashes on site.url are trimmed", async () => {
    const { head } = await resolveHead({}, { site: { url: "https://acme.test///" } });
    expect(head.canonical).toBe("https://acme.test/about");
  });

  /**
   * LAUT-RENDER-14 -- share images are made absolute; already-absolute ones are
   * left alone.
   *
   * Crawlers and unfurlers will not resolve a relative image, and an app should
   * not have to keep repeating where it is deployed. A path with no leading
   * slash is still a path, so it gets one.
   */
  test("LAUT-RENDER-14 relative images become absolute, absolute ones are untouched", async () => {
    const site = { url: "https://acme.test" };

    expect(
      (await resolveHead({ meta: () => ({ image: "/public/og.png" }) }, { site })).head.image,
    ).toBe("https://acme.test/public/og.png");

    expect(
      (await resolveHead({ meta: () => ({ image: "public/og.png" }) }, { site })).head.image,
    ).toBe("https://acme.test/public/og.png");

    expect(
      (await resolveHead({ meta: () => ({ image: "https://cdn.example/og.png" }) }, { site })).head
        .image,
    ).toBe("https://cdn.example/og.png");
  });

  /**
   * LAUT-RENDER-15 -- an explicit canonical wins over the request path.
   *
   * For the page that is genuinely reachable at more than one address, where
   * this is not the one that should be indexed.
   */
  test("LAUT-RENDER-15 a page can name its own canonical", async () => {
    const { head } = await resolveHead(
      { meta: () => ({ canonical: "/canonical-home" }) },
      { site: { url: "https://acme.test" } },
    );
    expect(head.canonical).toBe("https://acme.test/canonical-home");
  });
});

describe("LAUT-RENDER -- the page's meta over the site's", () => {
  const site = { name: "Acme", description: "site default", image: "/public/site.png" };

  /**
   * LAUT-RENDER-16 -- a page's own values win.
   */
  test("LAUT-RENDER-16 page meta overrides the site defaults", async () => {
    const { head } = await resolveHead(
      { meta: () => ({ description: "this page", type: "article" }) },
      { site },
    );
    expect(head.description).toBe("this page");
    expect(head.type).toBe("article");
  });

  /**
   * LAUT-RENDER-17 -- anything the page leaves out falls back.
   *
   * Field by field, not object by object: a page that sets only `type` should
   * keep the site's description, not lose it.
   */
  test("LAUT-RENDER-17 unset page fields fall back to the site", async () => {
    const { head } = await resolveHead({ meta: () => ({ type: "article" }) }, { site });
    expect(head.description).toBe("site default");
    expect(head.image).toBe("http://localhost:3000/public/site.png");
    expect(head.type).toBe("article");
  });

  /**
   * LAUT-RENDER-18 -- a page with no meta export is the site's defaults.
   */
  test("LAUT-RENDER-18 a page without meta still resolves the site defaults", async () => {
    const { head } = await resolveHead({}, { site });
    expect(head.description).toBe("site default");
    expect(head.type).toBe("website");
    expect(head.robots).toBeUndefined();
  });

  /**
   * LAUT-RENDER-19 -- meta and title see the loaded data.
   *
   * `load()` is awaited before the render precisely so the document's own head
   * can describe what was loaded -- a post's summary as the description, its
   * cover as the share image. If `load` resolved after the head were built, the
   * page would render correctly and unfurl as nothing.
   */
  test("LAUT-RENDER-19 load() data reaches both title and meta", async () => {
    const { head } = await resolveHead(
      {
        load: async () => ({ post: { name: "Deep Dive", summary: "how it works" } }),
        title: (_p, d: any) => d.post.name,
        meta: (_p, d: any) => ({ description: d.post.summary }),
      },
      { site: { name: "Acme" } },
    );

    expect(head.title).toBe("Deep Dive · Acme");
    expect(head.description).toBe("how it works");
  });

  /**
   * LAUT-RENDER-20 -- robots is omitted rather than defaulted.
   *
   * No `robots` tag means "index, follow" to every crawler, so the absence is
   * already the right default and emitting one would only be a chance to get it
   * wrong.
   */
  test("LAUT-RENDER-20 robots is carried through only when the page sets it", async () => {
    expect((await resolveHead({}, { site })).head.robots).toBeUndefined();
    expect(
      (await resolveHead({ meta: () => ({ robots: "noindex, nofollow" }) }, { site })).head.robots,
    ).toBe("noindex, nofollow");
  });
});

describe("LAUT-RENDER -- locale", () => {
  /**
   * LAUT-RENDER-21 -- the document language comes from the config hook.
   */
  test("LAUT-RENDER-21 config.locale sets the document language", async () => {
    const { head } = await resolveHead({}, { locale: () => ({ lang: "id" }) });
    expect(head.lang).toBe("id");
  });

  /**
   * LAUT-RENDER-22 -- with no hook, every document is English.
   */
  test("LAUT-RENDER-22 the default language is en", async () => {
    const { head } = await resolveHead({}, {});
    expect(head.lang).toBe("en");
  });

  /**
   * LAUT-RENDER-23 -- headers the locale choice implies reach the response.
   *
   * A per-request language that never appears in the response headers is
   * invisible to caches, which will then serve one language's document to
   * everybody.
   */
  test("LAUT-RENDER-23 locale headers are set on the response", async () => {
    const { res } = await resolveHead(
      {},
      { locale: () => ({ lang: "id", headers: { "content-language": "id", vary: "cookie" } }) },
    );
    expect(res.headers.get("content-language")).toBe("id");
  });

  /**
   * LAUT-RENDER-24 -- beforeRender runs with the resolved language, before the
   * render.
   *
   * Everything that suspends is behind it: from that call to the end of the
   * render nothing yields, so a concurrent request cannot swap the locale
   * signal out from under a half-rendered page. That property is why the hook is
   * synchronous, and this test is what notices if it stops being called at the
   * right moment.
   */
  test("LAUT-RENDER-24 beforeRender is called synchronously with the language", async () => {
    const calls: string[] = [];

    await resolveHead(
      { load: async () => ({}) },
      {
        locale: () => ({ lang: "id" }),
        beforeRender: (lang) => calls.push(`before:${lang}`),
        App: ((props: AppProps) => {
          calls.push("render");
          return null as any;
        }) as any,
      },
    );

    expect(calls).toEqual(["before:id", "render"]);
  });
});
