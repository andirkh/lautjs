/**
 * L6 -- resource budgets.
 *
 * The closest DO-178C has to this is Table A-6 objective 5, "compatible with the
 * target computer". Laut's target computer is a browser on a cold connection,
 * and its distinguishing claim is that it gets there with no build step. That
 * claim has a cost, and the cost is measurable: with no bundler there is no tree
 * shaking, no flattening, and every module is a request.
 *
 * So these tests measure what shipping actually costs and fail when it grows.
 * The numbers below are not aspirations -- they are the measured values with
 * headroom, and a failure here is a prompt to look at what was added, not to
 * raise the ceiling reflexively.
 *
 * The metric that matters most is not bytes. It is **depth**: the longest chain
 * of imports the browser must walk, each level a round trip it cannot start
 * until the previous one is parsed. A bundler's real product is a depth of 1.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serve, type Fixture } from "./support/harness.ts";

const scanner = new Bun.Transpiler({ loader: "tsx" });

type Graph = {
  /** Every module URL the browser would fetch, in discovery order. */
  modules: string[];
  /** Total bytes of JavaScript, uncompressed. */
  bytes: number;
  /**
   * Bytes on the wire, recomputed rather than observed.
   *
   * `fetch` decompresses transparently, so the body handed back here is always
   * the full-size one -- reading its length would report the uncompressed
   * figure and quietly claim compression was not happening. The server
   * compresses with `Bun.gzipSync`, so running the same function over the same
   * bytes reproduces exactly what it put on the wire.
   */
  wireBytes: number;
  /** Longest import chain: how many sequential round trips before the last
   *  module can run. */
  depth: number;
  /** Stylesheets the document links, each one render-blocking. */
  stylesheets: string[];
};

/**
 * Walk the module graph exactly as a browser would.
 *
 * Seeded from what the document names -- the boot script and the modulepreload
 * hints -- then followed transitively, resolving bare specifiers through the
 * page's own import map and relative ones against the importing module's URL.
 *
 * This is a real crawl rather than a count of `<script>` tags, because with no
 * bundler the document names only the first layer and the rest is discovered a
 * round trip at a time. Measuring only what the document mentions would report
 * the cheapest possible number for the architecture whose cost is precisely
 * everything the document does not mention.
 */
async function crawl(app: Fixture, path: string): Promise<Graph> {
  const res = await app.get(path);
  const html = await res.text();

  const importMap: Record<string, string> = JSON.parse(
    html.match(/<script type="importmap">(.*?)<\/script>/s)?.[1] ?? '{"imports":{}}',
  ).imports;

  const resolve = (spec: string, from: string): string | null => {
    if (spec.startsWith("/")) return spec;
    if (spec.startsWith(".")) return new URL(spec, "http://x" + from).pathname;
    if (importMap[spec]) return importMap[spec];
    // Prefix entries, e.g. "lautjs/": "/lautjs/"
    const prefix = Object.keys(importMap)
      .filter((k) => k.endsWith("/"))
      .find((k) => spec.startsWith(k));
    return prefix ? importMap[prefix] + spec.slice(prefix.length) : null;
  };

  const seeds = [
    ...[...html.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1]!),
    ...[...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]!),
    // An eager island's module: the runtime learns the URL from the DOM.
    ...[...html.matchAll(/data-src="([^"]+)"/g)].map((m) => m[1]!),
  ];

  const seen = new Set<string>();
  const modules: string[] = [];
  let bytes = 0;
  let wireBytes = 0;
  let depth = 0;

  let frontier = [...new Set(seeds)];
  while (frontier.length) {
    depth++;
    const next: string[] = [];

    for (const url of frontier) {
      if (seen.has(url)) continue;
      seen.add(url);

      const mod = await app.get(url, { headers: { "accept-encoding": "gzip, zstd" } });
      if (!mod.ok) continue;

      const body = new Uint8Array(await mod.arrayBuffer());
      const source = new TextDecoder().decode(body);
      modules.push(url);
      bytes += body.byteLength;
      wireBytes += mod.headers.get("content-encoding")
        ? Bun.gzipSync(body).byteLength
        : body.byteLength;

      for (const imported of scanner.scanImports(source)) {
        const target = resolve(imported.path, url);
        if (target && !seen.has(target)) next.push(target);
      }
    }
    frontier = [...new Set(next)];
  }

  return {
    modules,
    bytes,
    wireBytes,
    depth,
    stylesheets: [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]!),
  };
}

describe("LAUT-BUDGET -- what a cold load costs", () => {
  let app: Fixture;
  beforeAll(async () => (app = await serve("production", {}, "LAUT-BUDGET")));
  afterAll(() => app.stop());

  /**
   * LAUT-BUDGET-01 -- the JavaScript a first-time visitor downloads.
   *
   * Everything: the client runtime, preact, signals, and the island modules.
   * The ceiling is the measured figure plus headroom, and it exists so that a
   * dependency added to `src/client` shows up here as a number rather than as a
   * gradually worse first load nobody attributes to anything.
   */
  test("LAUT-BUDGET-01 a cold load stays inside its JavaScript budget", async () => {
    const graph = await crawl(app, "/");
    console.log(
      `  cold load: ${graph.modules.length} modules, ${graph.bytes} bytes ` +
        `(${graph.wireBytes} on the wire), depth ${graph.depth}`,
    );

    // Baseline measured 2026-09-04: 20,281 raw / 8,881 gzipped over 8 modules.
    expect(graph.bytes).toBeLessThan(28_000);
    expect(graph.wireBytes).toBeLessThan(13_000);
  });

  /**
   * LAUT-BUDGET-02 -- the number of requests before the page is interactive.
   *
   * With no bundler this is the count of modules, and it only goes up. It is the
   * number a bundler would have turned into 1.
   */
  test("LAUT-BUDGET-02 a cold load stays inside its request budget", async () => {
    const graph = await crawl(app, "/");
    // Baseline measured 2026-09-04: 8 modules.
    expect(graph.modules.length).toBeLessThanOrEqual(11);
  });

  /**
   * LAUT-BUDGET-03 -- graph depth, the number that a bundler actually buys you.
   *
   * Each level is a round trip that cannot begin until the previous level has
   * been fetched and parsed. Bytes can be compressed; depth is latency, and on a
   * slow connection it dominates. The modulepreload hints in <Head> exist purely
   * to flatten this -- they tell the browser about the runtime's five modules up
   * front instead of letting it discover them one layer at a time.
   *
   * If this number grows, the preload list in `runtime/vendor.ts` is the first
   * thing to look at.
   */
  test("LAUT-BUDGET-03 the module graph stays shallow", async () => {
    const graph = await crawl(app, "/");
    // Baseline measured 2026-09-04: depth 2 -- the document names the runtime's
    // five modules up front, so they all arrive in one wave rather than five.
    expect(graph.depth).toBeLessThanOrEqual(3);
  });

  /**
   * LAUT-BUDGET-04 -- a ZERO_JS page ships no JavaScript at all.
   *
   * Not "less" -- none. No import map, no preloads, no boot script, and so no
   * module graph to walk. This is the single strongest claim in the framework
   * and the easiest to break silently: adding one unconditional script tag to
   * <Head> would cost nothing visible and quietly end it.
   */
  test("LAUT-BUDGET-04 a ZERO_JS page fetches zero modules", async () => {
    const graph = await crawl(app, "/bare");

    expect(graph.modules).toEqual([]);
    expect(graph.bytes).toBe(0);
    expect(graph.depth).toBe(0);
  });

  /**
   * LAUT-BUDGET-05 -- render-blocking stylesheet requests do not scale with
   * island count.
   *
   * This is what `cssInlineStylesheet` is for, stated as a budget. A component
   * sheet is a few hundred bytes and a render-blocking round trip, and
   * `no-cache` means the browser pays that trip on every load, 304 or not. Forty
   * islands must not be forty round trips before first paint.
   *
   * So in production the count of `<link rel="stylesheet">` is bounded by the
   * app-wide sheets alone: everything small collapses into the single inlined
   * <style> block. The fixture's home page renders two islands and their sheet
   * is under the threshold, so it must not appear as a link.
   */
  test("LAUT-BUDGET-05 component sheets do not add render-blocking requests", async () => {
    const graph = await crawl(app, "/");

    expect(graph.stylesheets).toEqual(["/vendor/kinu/style.css", "/public/app.css"]);
    expect(graph.stylesheets.some((href) => href.includes("Widget.css"))).toBe(false);
  });

  /**
   * LAUT-BUDGET-06 -- the document itself stays small.
   *
   * Inlining moves bytes out of requests and into the document, so the document
   * is where that trade shows up. It is compressed on the wire, which is the
   * figure that matters, but an unbounded document means the inline threshold is
   * set wrong for this app.
   */
  test("LAUT-BUDGET-06 the rendered document stays inside its budget", async () => {
    const res = await app.get("/", { headers: { "accept-encoding": "gzip" } });
    const body = new Uint8Array(await res.arrayBuffer());
    const wire = res.headers.get("content-encoding")
      ? Bun.gzipSync(body).byteLength
      : body.byteLength;
    console.log(`  document: ${wire} bytes on the wire`);

    // Baseline measured 2026-09-04: 748 bytes gzipped.
    expect(wire).toBeLessThan(1_500);
  });
});
