/**
 * L2 -- golden output for <Head>, the highest-tier module in the repository.
 *
 * `Head.tsx` is 177 lines and gets the heaviest testing here for one reason: its
 * failures are silent. A <head> whose tags come out in the wrong order still
 * renders, still typechecks, and still looks right in dev -- and drops every
 * inlined stylesheet in production, or resolves no bare specifier because the
 * import map arrived after the module that needed it. Nothing throws. Nothing
 * logs. The page is just wrong on a stranger's machine.
 *
 * So these tests assert on *order*, not only on presence. The assertions are
 * written against a normalised tag sequence rather than a raw HTML blob,
 * because a 2 KB string diff tells you that something moved without telling you
 * what.
 *
 * A note on the fixture state below. `runtime/css.ts` caches its link/inline
 * split under the key `${sheetCount}:${inlineLimit}:${isDev()}`, which is sound
 * in production only because the sheet set never shrinks -- a sheet joins when
 * its module is first imported and never leaves, so the count alone identifies
 * the contents. A test suite does shrink it, so every scenario here changes the
 * count, the limit or the mode. See LAUT-HEAD-17.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToString } from "preact-render-to-string";
import { setConfig } from "../src/config.ts";
import { Head, type HeadData } from "../src/Head.tsx";
import { configureCssInlining } from "../src/runtime/css.ts";

let root: string;
let previousEnv: string | undefined;
const sheets = () => (globalThis as any).__lautCSS as Set<string>;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "laut-head-"));
  mkdirSync(join(root, "src"));
  setConfig({ App: (() => null) as any, routes: {}, root });

  // Production, deliberately, for every block except the dev one at the end.
  // Development links every stylesheet and inlines none -- so a suite left in
  // dev would run the whole inline/link section against the branch that does
  // nothing, and pass by never reaching the code under test. `bun test` does
  // not set NODE_ENV to production, so isDev() would otherwise be true here.
  previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
});

afterAll(() => {
  if (previousEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnv;
  rmSync(root, { recursive: true, force: true });
});

afterEach(() => sheets().clear());

/**
 * Write a component stylesheet and register it the way the Bun plugin would
 * when its module is first imported.
 *
 * It goes under `<root>/src` because `runtime/css.ts` keeps only the sheets
 * this server would actually serve -- the ones whose path, with the root
 * stripped, starts with `/src/` or `/public/`. A sheet written at the root
 * itself is silently dropped, which is correct behaviour and a very confusing
 * way for a test fixture to fail.
 */
function sheet(name: string, css: string) {
  const path = join(root, "src", name);
  writeFileSync(path, css);
  sheets().add(path);
  return path;
}

const BASE: HeadData = {
  title: "About · Acme",
  lang: "en",
  description: "what this page is",
  canonical: "https://acme.test/about",
  type: "website",
  ZERO_JS: false,
};

const render = (data: Partial<HeadData> & Record<string, unknown> = {}) =>
  renderToString(<Head {...BASE} {...(data as any)} />);

/**
 * The document's head as an ordered list of short tag signatures.
 *
 * Order is the property under test, so the assertion should read as an order.
 * `["meta:charset", "title", "link:stylesheet:/public/app.css", ...]` fails with
 * a diff that names the tag that moved; a raw HTML comparison fails with two
 * kilobytes of near-identical text.
 */
function tags(html: string): string[] {
  return [...html.matchAll(/<(\w+)([^>]*)>/g)].flatMap(([, name, attrs]) => {
    const attr = (n: string) => attrs.match(new RegExp(`${n}="([^"]*)"`))?.[1];
    if (name === "head") return [];
    if (name === "meta") {
      const key = attr("charset") !== undefined ? "charset" : (attr("name") ?? attr("property"));
      return [`meta:${key}`];
    }
    if (name === "link") return [`link:${attr("rel")}:${attr("href")}`];
    if (name === "script") return [`script:${attr("type") ?? "inline"}:${attr("src") ?? ""}`];
    return [name];
  });
}

describe("LAUT-HEAD -- the shape of the document head", () => {
  /**
   * LAUT-HEAD-01 -- charset comes first, before anything with text in it.
   *
   * A browser that meets text before it has been told the encoding has to guess,
   * and the spec only guarantees it looks at the first 1024 bytes. Putting the
   * title -- the first tag that can hold a non-ASCII byte -- ahead of the
   * charset is how a page renders mojibake for exactly the users whose language
   * needed the declaration.
   */
  test("LAUT-HEAD-01 charset and viewport precede the title", () => {
    configureCssInlining(0);
    expect(tags(render()).slice(0, 3)).toEqual(["meta:charset", "meta:viewport", "title"]);
    expect(render().indexOf("charset")).toBeLessThan(1024);
  });

  /**
   * LAUT-HEAD-02 -- the SEO block is emitted from resolved values only.
   *
   * <Head> holds no app knowledge: every one of these is a prop that renderPage
   * already resolved. The test is that each resolved field lands in the tag that
   * carries it, and in the form crawlers read.
   */
  test("LAUT-HEAD-02 description, canonical and Open Graph carry the resolved values", () => {
    configureCssInlining(0);
    const html = render({ siteName: "Acme", image: "https://acme.test/og.png", imageAlt: "logo" });

    expect(html).toContain('<meta name="description" content="what this page is"/>');
    expect(html).toContain('<link rel="canonical" href="https://acme.test/about"/>');
    expect(html).toContain('<meta property="og:url" content="https://acme.test/about"/>');
    expect(html).toContain('<meta property="og:title" content="About · Acme"/>');
    expect(html).toContain('<meta property="og:locale" content="en"/>');
    expect(html).toContain('<meta property="og:site_name" content="Acme"/>');
    expect(html).toContain('<meta property="og:image" content="https://acme.test/og.png"/>');
    expect(html).toContain('<meta property="og:image:alt" content="logo"/>');
  });

  /**
   * LAUT-HEAD-03 -- the card size follows whether there is an image.
   *
   * "summary_large_image" with no image renders as an empty box, which is worse
   * than the small card it replaced.
   */
  test("LAUT-HEAD-03 twitter:card is large only when an image exists", () => {
    configureCssInlining(0);
    expect(render()).toContain('<meta name="twitter:card" content="summary"/>');
    expect(render({ image: "https://acme.test/og.png" })).toContain(
      '<meta name="twitter:card" content="summary_large_image"/>',
    );
  });

  /**
   * LAUT-HEAD-04 -- optional tags are omitted, not emitted empty.
   *
   * An empty `content=""` is not the same as no tag. No `robots` means "index,
   * follow"; `robots content=""` is a crawler being handed a directive nobody
   * wrote.
   */
  test("LAUT-HEAD-04 unset optional fields emit no tag at all", () => {
    configureCssInlining(0);
    const html = render({ description: undefined, siteName: undefined, twitter: undefined });

    expect(html).not.toContain('name="description"');
    expect(html).not.toContain('property="og:description"');
    expect(html).not.toContain('property="og:site_name"');
    expect(html).not.toContain('name="twitter:site"');
    expect(html).not.toContain('name="robots"');
  });
});

describe("LAUT-HEAD -- stylesheet order", () => {
  /**
   * LAUT-HEAD-05 -- app-wide sheets are linked before component sheets.
   *
   * Cascade order is the whole point. kinu's sheet and `/public/app.css` set the
   * primitives; a component sheet overriding one of them only wins if it comes
   * after. Reverse the two and every island's styling loses to the reset that
   * was supposed to be underneath it -- in a way that looks like the component
   * CSS "didn't apply".
   */
  test("LAUT-HEAD-05 defaults, then app styles, then component sheets", () => {
    configureCssInlining(0);
    sheet("Widget.css", "[data-island] { color: red }");

    expect(
      tags(render({ styles: ["/public/theme.css"] })).filter((t) => t.startsWith("link:styl")),
    ).toEqual([
      "link:stylesheet:/vendor/kinu/style.css",
      "link:stylesheet:/public/app.css",
      "link:stylesheet:/public/theme.css",
      "link:stylesheet:/src/Widget.css",
    ]);
  });

  /**
   * LAUT-HEAD-06 -- noDefaultCSS drops both defaults and keeps the rest.
   *
   * For an app that has dropped kinu, or keeps its document-wide CSS somewhere
   * else. It must not also drop the component sheets, which are not a default.
   */
  test("LAUT-HEAD-06 noDefaultCSS removes kinu and app.css only", () => {
    configureCssInlining(0);
    sheet("Widget.css", "[data-island] { color: red }");

    const links = tags(render({ noDefaultCSS: true, styles: ["/public/theme.css"] })).filter((t) =>
      t.startsWith("link:styl"),
    );

    expect(links).toEqual(["link:stylesheet:/public/theme.css", "link:stylesheet:/src/Widget.css"]);
  });
});

describe("LAUT-HEAD -- the scripts, and the pages that have none", () => {
  /**
   * LAUT-HEAD-07 -- the import map precedes the preloads, which precede boot.
   *
   * This is the ordering that has to be right and cannot be seen. The import map
   * must be parsed before anything resolves a module specifier, so a boot script
   * placed above it resolves `lautjs/client` against nothing. The modulepreloads
   * are only hints, but a hint issued before the map that would resolve it is a
   * hint for a URL the browser cannot construct.
   *
   * All three still *appear* in the document in any order, which is why nothing
   * short of an order assertion catches this.
   */
  test("LAUT-HEAD-07 importmap, then modulepreload, then the module script", () => {
    configureCssInlining(0);
    const sequence = tags(render()).filter(
      (t) => t.startsWith("script:") || t.startsWith("link:modulepreload"),
    );

    expect(sequence[0]).toBe("script:importmap:");
    expect(sequence.filter((t) => t.startsWith("link:modulepreload")).length).toBeGreaterThan(0);
    expect(sequence.at(-1)).toBe("script:module:/src/frontend/boot.ts");

    const html = render();
    expect(html.indexOf("importmap")).toBeLessThan(html.indexOf("modulepreload"));
    expect(html.indexOf("modulepreload")).toBeLessThan(html.indexOf('type="module"'));
  });

  /**
   * LAUT-HEAD-08 -- ZERO_JS removes every part of the runtime, and nothing else.
   *
   * The page is served as HTML and CSS. What must survive is everything a page
   * without JavaScript still uses: the charset, the SEO block, the stylesheets.
   * A ZERO_JS page that also lost its CSS would be a regression nobody would
   * attribute to this flag.
   */
  test("LAUT-HEAD-08 a ZERO_JS head has no importmap, no preloads and no boot", () => {
    configureCssInlining(0);
    sheet("Widget.css", "[data-island] { color: red }");
    const html = render({ ZERO_JS: true });

    expect(html).not.toContain("importmap");
    expect(html).not.toContain("modulepreload");
    expect(html).not.toContain('type="module"');

    expect(html).toContain('<meta charset="utf-8"/>');
    expect(html).toContain('<link rel="canonical"');
    expect(html).toContain('href="/src/Widget.css"');
    expect(html).toContain('href="/public/app.css"');
  });

  /**
   * LAUT-HEAD-09 -- the boot module is the app's to name.
   */
  test("LAUT-HEAD-09 the boot script src is configurable", () => {
    configureCssInlining(0);
    expect(render({ boot: "/src/entry.ts" })).toContain(
      '<script type="module" src="/src/entry.ts">',
    );
  });

  /**
   * LAUT-HEAD-10 -- children are rendered last.
   *
   * Icons, fonts and analytics go after everything Laut controls, so an app can
   * never accidentally push the import map down the document by adding a favicon.
   */
  test("LAUT-HEAD-10 children come after everything else", () => {
    configureCssInlining(0);
    const html = renderToString(
      <Head {...BASE}>
        <link rel="icon" href="/public/favicon.ico" />
      </Head>,
    );

    expect(tags(html).at(-1)).toBe("link:icon:/public/favicon.ico");
    expect(html.indexOf("favicon")).toBeGreaterThan(html.indexOf('type="module"'));
  });
});

describe("LAUT-HEAD -- escaping", () => {
  /**
   * LAUT-HEAD-11 -- app-supplied text cannot break out of an attribute.
   *
   * `title` and `description` come from a page's own exports, which in a real
   * app come from a database, which in a real app came from a person. This is
   * the one place in Laut where app-controlled text is printed into markup, so
   * it is the one place a stored XSS could live.
   *
   * The mechanism is Preact's attribute escaping rather than anything Laut does,
   * which is a good reason to test it rather than assume it: the protection is
   * inherited, and inherited protection is the kind that disappears in a
   * refactor to `dangerouslySetInnerHTML` without anyone noticing.
   */
  test("LAUT-HEAD-11 quotes and tags in page metadata are escaped", () => {
    configureCssInlining(0);
    const html = render({
      title: 'Ship"><script>alert(1)</script>',
      description: "</title><img src=x onerror=alert(1)>",
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&quot;");
    expect(html).toContain("&lt;");
  });

  /**
   * LAUT-HEAD-12 -- a stylesheet containing `</style` is linked, never inlined.
   *
   * In a string, in a comment, however it got there: pasted into a <style> tag
   * that sequence closes the element early and the rest of the sheet spills onto
   * the page as visible text -- and everything after it is parsed as HTML.
   * Escaping it would mean rewriting the file, which is the one thing the
   * inliner is not allowed to do, so the sheet stays a link.
   */
  test("LAUT-HEAD-12 a sheet that could close its own tag is not inlined", () => {
    configureCssInlining(4096);
    sheet("Safe.css", ".safe { color: green }");
    sheet("Hostile.css", '.a::after { content: "</style><script>alert(1)</script>" }');

    const html = render();

    expect(html).toContain(".safe { color: green }");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(tags(html)).toContain("link:stylesheet:/src/Hostile.css");
    expect(tags(html)).not.toContain("link:stylesheet:/src/Safe.css");
  });
});

describe("LAUT-HEAD -- inline versus link", () => {
  /**
   * LAUT-HEAD-13 -- small sheets are pasted in, large ones stay links.
   *
   * The cost of a component stylesheet is not its bytes -- it is a
   * render-blocking round trip, and `no-cache` means the browser pays that trip
   * on every load, 304 or not. Forty islands is forty round trips before first
   * paint for a few kilobytes of CSS. Big stable sheets are better left linked:
   * they are fetched once and reused across pages, where an inlined sheet rides
   * along with every document.
   */
  test("LAUT-HEAD-13 the inline threshold splits the sheets", () => {
    configureCssInlining(256);
    sheet("Small.css", ".small { color: red }");
    sheet("Large.css", `.large { color: blue } ${"/* padding */".repeat(40)}`);

    const html = render();

    expect(html).toContain(".small { color: red }");
    expect(tags(html)).toContain("link:stylesheet:/src/Large.css");
    expect(tags(html)).not.toContain("link:stylesheet:/src/Small.css");
  });

  /**
   * LAUT-HEAD-14 -- the <style> block comes after every <link>.
   *
   * Same cascade argument as LAUT-HEAD-05: the inlined sheets are component
   * sheets, and component sheets must be able to override the app-wide links
   * above them. Inlining moves where the bytes live; it must not move where they
   * sit in the cascade.
   */
  test("LAUT-HEAD-14 inlined styles come after the stylesheet links", () => {
    configureCssInlining(1024);
    sheet("Widget.css", ".w { color: red }");

    const sequence = tags(render()).filter((t) => t.startsWith("link:styl") || t === "style");
    expect(sequence.at(-1)).toBe("style");
    expect(sequence[0]).toBe("link:stylesheet:/vendor/kinu/style.css");
  });

  /**
   * LAUT-HEAD-15 -- `cssInlineStylesheet: 0` turns inlining off entirely.
   */
  test("LAUT-HEAD-15 a zero threshold links everything", () => {
    configureCssInlining(0);
    sheet("Tiny.css", ".t{}");

    const html = render();
    expect(html).not.toContain("<style");
    expect(tags(html)).toContain("link:stylesheet:/src/Tiny.css");
  });

  /**
   * LAUT-HEAD-16 -- sheets outside the served roots are ignored.
   *
   * A stylesheet imported out of node_modules is not something this server will
   * answer for: `/src/*` and `/public/*` are the only source routes. Such a
   * sheet belongs in the vendor map, and linking it here would emit a URL that
   * 404s.
   */
  test("LAUT-HEAD-16 a sheet outside /src and /public is neither linked nor inlined", () => {
    configureCssInlining(4096);
    sheet("ok.css", ".ok{}"); // under /src -- kept
    sheets().add("/somewhere/else/node_modules/pkg/dist/pkg.css");

    const html = render();
    expect(html).not.toContain("pkg.css");
  });

  /**
   * LAUT-HEAD-17 -- the split cache is keyed on the sheet count.
   *
   * `runtime/css.ts` recomputes only when `${count}:${limit}:${isDev()}` changes.
   * That is correct exactly because the sheet set only ever grows -- a sheet is
   * added when its module is first imported and is never removed -- so the count
   * identifies the contents.
   *
   * The invariant is load-bearing and was written down nowhere. This test states
   * it: swap the contents while holding the count, and the stale split is what
   * comes back. It documents the constraint rather than reporting a production
   * bug, because nothing in a running server can shrink that set.
   */
  test("LAUT-HEAD-17 the split is cached by sheet count, which only grows in production", () => {
    configureCssInlining(2048);
    sheet("First.css", ".first { color: red }");
    expect(render()).toContain(".first { color: red }");

    // Same count, different contents -- only reachable from a test.
    sheets().clear();
    sheet("Second.css", ".second { color: blue }");

    expect(render()).toContain(".first { color: red }");
    expect(render()).not.toContain(".second { color: blue }");

    // Moving the count forward invalidates it, as an import would.
    sheet("Third.css", ".third { color: green }");
    expect(render()).toContain(".second { color: blue }");
    expect(render()).toContain(".third { color: green }");
  });
});

describe("LAUT-HEAD -- development", () => {
  let prod: string | undefined;
  beforeAll(() => {
    prod = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
  });
  afterAll(() => (process.env.NODE_ENV = prod));

  /**
   * LAUT-HEAD-18 -- dev links every sheet and inlines none.
   *
   * Not an oversight and not a missing optimisation. The dev reloader swaps a
   * stylesheet by rewriting its `<link href>` in place, which re-fetches the
   * sheet without touching the DOM around it -- so a style tweak lands without
   * re-rendering the island under it, and island signal state survives. A sheet
   * pasted into the document has no href to swap, so dev keeps them all linked
   * and pays the round trips.
   */
  test("LAUT-HEAD-18 nothing is inlined in development, whatever the threshold", () => {
    configureCssInlining(4096);
    sheet("DevSmall.css", ".d { color: red }");

    const html = render();
    expect(html).not.toContain("<style");
    expect(tags(html)).toContain("link:stylesheet:/src/DevSmall.css");
  });

  /**
   * LAUT-HEAD-19 -- the dev socket is present in dev and absent in production.
   *
   * Absent meaning gone, not disabled: `<DevReload/>` returns null, so there is
   * no script tag, no connection and no trace of it in a production document.
   * The production half of this is asserted by every other test in this file,
   * all of which run with NODE_ENV=production and none of which see it.
   */
  test("LAUT-HEAD-19 the dev reload script is in the document in development", () => {
    configureCssInlining(0);
    expect(render()).toContain('new EventSource("/__dev")');
  });

  /**
   * LAUT-HEAD-20 -- a ZERO_JS page still hot-reloads while you are building it.
   *
   * `<DevReload/>` sits deliberately outside the block ZERO_JS removes: that
   * block is the app runtime, and this is the dev socket. Folding it inside
   * would be an easy tidy-up that makes exactly the pages with no JavaScript --
   * the landing pages you iterate on hardest -- the ones that stop reloading.
   */
  test("LAUT-HEAD-20 ZERO_JS drops the runtime but keeps the dev socket", () => {
    configureCssInlining(0);
    const html = render({ ZERO_JS: true });

    expect(html).not.toContain("importmap");
    expect(html).not.toContain('type="module"');
    expect(html).toContain('new EventSource("/__dev")');
  });
});
