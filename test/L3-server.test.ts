/**
 * L3 -- integration, against a live server.
 *
 * DO-178C calls this software integration testing (§6.4.3.b): the units are
 * known to work, and what is under test is what happens between them. For Laut
 * that gap is the whole product -- a URL arrives and a Response leaves, and
 * every interesting decision (is this file public, has it changed, should it be
 * compressed, does this even exist) is made in between.
 *
 * Each block below pairs normal-range cases with robustness cases (§6.4.2.2):
 * what the route does with the request it expects, and what it does with the
 * request written to get past it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_ROOT, serve, type Fixture } from "./support/harness.ts";

describe("LAUT-SRV -- the route table and what it refuses", () => {
  let app: Fixture;
  beforeAll(async () => (app = await serve("production", {}, "LAUT-SRV")));
  afterAll(() => app.stop());

  /**
   * LAUT-SRV-01 -- app source is transpiled per request.
   *
   * This is the whole "no build step" claim, reduced to one assertion: a `.tsx`
   * file on disk is answered as browser-ready ESM, with no bundler, no `dist/`
   * and no manifest between the two.
   *
   * The response is checked for the injected preact prelude rather than just a
   * 200, because a misconfigured transpiler happily returns the *source* with a
   * JavaScript content type -- a 200 that fails in the browser.
   */
  test("LAUT-SRV-01 a .tsx under /src is served as browser ESM", async () => {
    const res = await app.get("/src/frontend/islands/Widget/Widget.tsx");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(body).toContain('from"preact"');
    // The TypeScript annotation is gone, so this went through the transpiler
    // rather than straight off disk.
    expect(body).not.toContain("{ label?: string }");
  });

  /**
   * LAUT-SRV-02 -- the framework's own browser modules are served from /lautjs/*.
   *
   * `import { start } from "lautjs/client"` is a bare specifier the import map
   * points here, and this route reads out of `import.meta.dir` -- wherever Laut
   * was installed. If it 404s, every document renders and nothing hydrates.
   */
  test("LAUT-SRV-02 /lautjs/* serves the client runtime", async () => {
    const res = await app.get("/lautjs/client/nav.ts");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });

  /**
   * LAUT-SRV-03 -- vendored bare specifiers resolve out of node_modules.
   */
  test("LAUT-SRV-03 /vendor/* serves a mapped dependency", async () => {
    const res = await app.get("/vendor/preact");
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  /**
   * LAUT-SRV-04 -- an unmapped specifier is not a file path.
   *
   * `/vendor/*` is a lookup in a table, never a path join. A specifier nobody
   * mapped has no answer, and must not become a walk of node_modules.
   */
  test("LAUT-SRV-04 an unmapped vendor specifier is 404, not a filesystem read", async () => {
    expect((await app.get("/vendor/lodash")).status).toBe(404);
    expect((await app.get("/vendor/preact/package.json")).status).toBe(404);
  });

  /**
   * LAUT-SRV-05 -- private subtrees are never served.
   *
   * Everything under `/src` is public by definition: it is the module graph the
   * browser imports. `config.private` -- `["/src/backend/"]` by default -- is
   * the exception, and it is the one that holds queries and, one day,
   * credentials.
   *
   * The body is asserted on, not just the status: a 404 that still carries the
   * file is the failure this test exists to catch.
   */
  test("LAUT-SRV-05 the private subtree is 404 and leaks no content", async () => {
    const res = await app.get("/src/backend/secret.ts");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("fixture-must-never-be-served");
  });

  /**
   * LAUT-SRV-06 -- robustness: no request escapes the served roots.
   *
   * `serveSource` relies on `new URL()` having already collapsed dot segments,
   * including the percent-encoded form, so a prefix check is sufficient --
   * "/src/../routes.ts" arrives as "/routes.ts" and fails the prefix rather
   * than reading the project root. That is a correct argument about someone
   * else's implementation, which is exactly the kind of argument that should
   * have a test under it: it holds until a runtime upgrade changes the
   * normalisation, and nothing in this repository would otherwise notice.
   *
   * Every case asserts on content, not only status. A 200 is not automatically
   * a leak and a 404 is not automatically safety -- what matters is that no
   * response ever contains a file from outside the roots.
   */
  const escapes = [
    "/src/../package.json",
    "/src/../../../../../../etc/passwd",
    "/src/%2e%2e/package.json",
    "/src/%252e%252e/package.json",
    "/src/..%2fpackage.json",
    "/src/....//package.json",
    "/public/../package.json",
    "/public/../../package.json",
    "/lautjs/../package.json",
    "/lautjs/../../package.json",
    "/vendor/../package.json",
  ];

  test.each(escapes)("LAUT-SRV-06 %s cannot read outside the served roots", async (path) => {
    const res = await app.get(path);
    const body = await res.text();

    expect(body).not.toContain('"name": "lautjs"');
    expect(body).not.toContain("root:x:");
    expect(body).not.toContain("peerDependencies");
  });

  /**
   * LAUT-SRV-06b -- the assumption underneath LAUT-SRV-06, asserted directly.
   *
   * `serveSource` does not itself collapse dot segments. It delegates that to
   * `new URL()` and then relies on a prefix check being sufficient. So the
   * defence is really two claims, and only one of them is ours.
   *
   * The battery above can pass for the wrong reason -- every one of those paths
   * would also 404 on a server with no defence at all, simply because the
   * mangled path names no real file. This pins the claim the defence actually
   * rests on, so a runtime that stopped normalising would fail here loudly
   * instead of failing there silently.
   */
  test.each([
    ["/src/../package.json", "/package.json"],
    ["/src/../../etc/passwd", "/etc/passwd"],
    ["/src/%2e%2e/package.json", "/package.json"],
    ["/src/a/../../package.json", "/package.json"],
  ])("LAUT-SRV-06b new URL() collapses %s before the prefix check", (raw, collapsed) => {
    expect(new URL(raw, "http://localhost").pathname).toBe(collapsed);
  });

  /**
   * LAUT-SRV-07 -- a file under /src that the browser could never use is 404.
   *
   * The transpiler answers for .ts/.tsx/.js/.jsx/.mjs and .json. A stray .md or
   * an editor swapfile under /src is not a module, and the route says so rather
   * than serving it as JavaScript.
   */
  test("LAUT-SRV-07 an unsupported extension under /src is 404", async () => {
    expect((await app.get("/src/notes.md")).status).toBe(404);
  });

  /**
   * LAUT-SRV-08 -- stylesheets are served byte-for-byte.
   *
   * No minifier, no comment strip, no scoping pass. Island CSS is scoped by the
   * `[data-island="Name"]` convention, not by a compiler, so anything that
   * rewrote the file would be changing meaning rather than form.
   */
  test("LAUT-SRV-08 a component stylesheet is served verbatim", async () => {
    const res = await app.get("/src/frontend/islands/Widget/Widget.css");
    const body = await res.text();
    const onDisk = await Bun.file(
      join(FIXTURE_ROOT, "src/frontend/islands/Widget/Widget.css"),
    ).text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(body).toBe(onDisk);
  });

  /**
   * LAUT-SRV-09 -- static assets are served from /public.
   */
  test("LAUT-SRV-09 /public/* serves a static asset", async () => {
    const res = await app.get("/public/asset.txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("plain asset");
  });

  /**
   * LAUT-SRV-10 -- a path that matches no route at all is 404.
   */
  test("LAUT-SRV-10 an unmatched path falls through to 404", async () => {
    expect((await app.get("/nope")).status).toBe(404);
    expect((await app.get("/src/does-not-exist.ts")).status).toBe(404);
    expect((await app.get("/public/does-not-exist.txt")).status).toBe(404);
  });

  /**
   * LAUT-SRV-11 -- robustness: a symlink in /public is followed.
   *
   * `sendFile` opens whatever path it is handed; nothing resolves the real path
   * and re-checks that it is still under the root. A symlink planted in
   * `public/` therefore serves its target, wherever that target lives.
   *
   * This is recorded as the framework's actual behaviour rather than asserted
   * as correct. The threat model is narrow -- placing a symlink in `public/`
   * means already having write access to the project -- but "already inside the
   * repo" is exactly the position a malicious dependency's postinstall script
   * is in. See the note in README's Known gaps.
   */
  test("LAUT-SRV-11 a symlink under /public escapes the root (known behaviour)", async () => {
    const link = join(FIXTURE_ROOT, "public", "escape.txt");
    if (existsSync(link)) unlinkSync(link);
    symlinkSync(join(FIXTURE_ROOT, "..", "..", "..", "package.json"), link);

    try {
      const res = await app.get("/public/escape.txt");
      const body = res.status === 200 ? await res.text() : "";
      // Documenting, not endorsing: if this ever starts failing because the
      // response no longer contains the target, the framework got stricter and
      // this test should be rewritten to demand that.
      expect({ status: res.status, escaped: body.includes('"name": "lautjs"') }).toEqual({
        status: 200,
        escaped: true,
      });
    } finally {
      unlinkSync(link);
    }
  });
});

describe("LAUT-RESP -- caching and compression", () => {
  let app: Fixture;
  beforeAll(async () => (app = await serve("production", {}, "LAUT-RESP")));
  afterAll(() => app.stop());

  const SOURCE = "/src/frontend/islands/Widget/Widget.tsx";

  /**
   * LAUT-RESP-01 -- module URLs are unhashed, so they must revalidate.
   *
   * There is no build step, so there is no content hash to put in a URL, so the
   * browser has to ask about every module on a cold load. `no-cache` plus an
   * etag is what makes that question cheap: an unchanged file answers 304 with
   * no body instead of resending the whole module graph.
   */
  test("LAUT-RESP-01 source responses carry an etag and revalidate", async () => {
    const res = await app.get(SOURCE);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toMatch(/^W\/"/);
  });

  /**
   * LAUT-RESP-02 -- a matching validator gets a bodiless 304.
   *
   * The whole point of RESP-01. A 304 that still carries a body, or that drops
   * the caching headers, turns the cheap question back into an expensive one.
   */
  test("LAUT-RESP-02 if-none-match on an unchanged file returns 304 with no body", async () => {
    const first = await app.get(SOURCE);
    const etag = first.headers.get("etag")!;
    await first.text();

    const second = await app.get(SOURCE, { headers: { "if-none-match": etag } });

    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("etag")).toBe(etag);
    expect(second.headers.get("cache-control")).toBe("no-cache");
  });

  /**
   * LAUT-RESP-03 -- a stale validator gets the file.
   */
  test("LAUT-RESP-03 a non-matching if-none-match returns the body", async () => {
    const res = await app.get(SOURCE, { headers: { "if-none-match": 'W/"stale-etag"' } });
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  /**
   * LAUT-RESP-04 -- the etag tracks both mtime and size.
   *
   * It is a weak validator built from `mtimeMs` and `size`. Either alone is
   * defeatable -- a same-size edit, or a touch with no edit -- and the pair is
   * what makes it usable. Asserting the shape keeps a "simplification" to one
   * field from silently serving stale modules.
   */
  test("LAUT-RESP-04 the etag is derived from mtime and size", async () => {
    const { etagFor } = await import("../src/runtime/respond.ts");
    const path = join(FIXTURE_ROOT, "src/frontend/islands/Widget/Widget.css");
    const stat = await Bun.file(path).stat();

    expect(await etagFor(path)).toBe(`W/"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`);
  });

  /**
   * LAUT-RESP-05 -- a missing file has no validator.
   */
  test("LAUT-RESP-05 etagFor returns null for a file that is not there", async () => {
    const { etagFor } = await import("../src/runtime/respond.ts");
    expect(await etagFor(join(FIXTURE_ROOT, "nope.ts"))).toBeNull();
  });

  /**
   * LAUT-RESP-06 -- bodies are compressed when the client says it can decode.
   *
   * `Bun.serve` does not compress for you. A framework that forgets this ships
   * every module uncompressed and nothing anywhere reports it.
   */
  test("LAUT-RESP-06 a large body is gzipped when gzip is accepted", async () => {
    const res = await app.get("/lautjs/client/nav.ts", {
      headers: { "accept-encoding": "gzip" },
    });
    expect(res.headers.get("content-encoding")).toBe("gzip");
  });

  /**
   * LAUT-RESP-07 -- zstd wins when the client offers both.
   *
   * Preference order is a deliberate choice, not an accident of header parsing.
   */
  test("LAUT-RESP-07 zstd is preferred over gzip", async () => {
    const res = await app.get("/lautjs/client/nav.ts", {
      headers: { "accept-encoding": "gzip, deflate, br, zstd" },
    });
    expect(res.headers.get("content-encoding")).toBe("zstd");
  });

  /**
   * LAUT-RESP-08 -- nothing is compressed for a client that did not ask.
   */
  test("LAUT-RESP-08 an identity-only client gets an uncompressed body", async () => {
    const res = await app.get("/lautjs/client/nav.ts", {
      headers: { "accept-encoding": "identity" },
    });
    expect(res.headers.get("content-encoding")).toBeNull();
  });

  /**
   * LAUT-RESP-09 -- boundary: the compression threshold.
   *
   * DO-178C §6.4.2.1 -- test at the edge of the partition, not in the middle.
   * The rule is `bytes >= minSize`, so `minSize` itself must compress and one
   * byte under it must not. Below a packet or so the CPU and the header bytes
   * cost more than the saving, which is the reason there is a threshold at all.
   */
  test("LAUT-RESP-09 the compressMin boundary is inclusive", async () => {
    const { send, configureCompression } = await import("../src/runtime/respond.ts");
    const req = new Request("http://x/", { headers: { "accept-encoding": "gzip" } });

    configureCompression(64);
    try {
      expect(send(req, "a".repeat(63)).headers.get("content-encoding")).toBeNull();
      expect(send(req, "a".repeat(64)).headers.get("content-encoding")).toBe("gzip");
      expect(send(req, "a".repeat(65)).headers.get("content-encoding")).toBe("gzip");
    } finally {
      configureCompression(1024);
    }
  });

  /**
   * LAUT-RESP-10 -- every response varies on accept-encoding.
   *
   * Without it a shared cache in front of the app can hand a gzipped body to a
   * client that cannot decode it. The header has to be there whether or not
   * *this particular* response was compressed, because the cache is keying on
   * the request, not the response.
   */
  test("LAUT-RESP-10 vary: accept-encoding is set even when nothing is compressed", async () => {
    const small = await app.get("/public/asset.txt", { headers: { "accept-encoding": "gzip" } });
    expect(small.headers.get("content-encoding")).toBeNull();
    expect(small.headers.get("vary")).toBe("accept-encoding");
  });

  /**
   * LAUT-RESP-11 -- production marks public assets immutable.
   *
   * A public asset has no hash in its URL, so `immutable` is a promise only
   * production can keep. See LAUT-RESP-12 for the other half.
   */
  test("LAUT-RESP-11 a public asset is immutable in production", async () => {
    const res = await app.get("/public/app.css");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });
});

describe("LAUT-RESP (development) -- the half production cannot have", () => {
  let app: Fixture;
  beforeAll(async () => (app = await serve("development", {}, "LAUT-RESP-dev")));
  afterAll(() => app.stop());

  /**
   * LAUT-RESP-12 -- dev revalidates public assets instead of freezing them.
   *
   * `immutable` means exactly what it says: no revalidation, not even on a
   * reload. Serve `/public/app.css` that way in dev and editing it does
   * nothing -- Safari is the strict one here, so the stylesheet change can look
   * like it simply had no effect. Dev serves the same file `no-cache` with an
   * etag, which the browser answers with a bodiless 304.
   */
  test("LAUT-RESP-12 a public asset revalidates in development", async () => {
    const res = await app.get("/public/app.css");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toMatch(/^W\/"/);
    expect(res.headers.get("cache-control")).not.toContain("immutable");
  });

  /**
   * LAUT-DEV-01 -- /__dev streams reload events in development.
   *
   * `bun --hot` re-evaluates the server's module graph and tells the browser
   * nothing. This is the other half: an SSE stream whose first frame identifies
   * the process, so a page that reconnects to a *different* process knows the
   * HTML it is showing came from a server that no longer exists.
   */
  test("LAUT-DEV-01 /__dev opens an event stream and announces the boot id", async () => {
    const res = await app.get("/__dev");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const frame = new TextDecoder().decode(value);

    expect(frame).toContain("retry:");
    expect(JSON.parse(frame.slice(frame.indexOf("{"), frame.lastIndexOf("}") + 1))).toMatchObject({
      kind: "hello",
    });

    await reader.cancel();
  });
});

describe("LAUT-DEV -- what production must not expose", () => {
  let app: Fixture;
  beforeAll(async () => (app = await serve("production", {}, "LAUT-DEV-prod")));
  afterAll(() => app.stop());

  /**
   * LAUT-DEV-02 -- /__dev does not exist in production.
   *
   * Not disabled, not guarded -- absent. The route is spread in conditionally,
   * `<DevReload/>` renders null and no watcher is ever started. A production
   * deployment still answering /__dev would hold an open stream per visitor and
   * hand out the process id, and it is the kind of thing that is only ever
   * discovered from the outside.
   */
  test("LAUT-DEV-02 /__dev is 404 in production", async () => {
    const res = await app.get("/__dev");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).not.toContain("event-stream");
  });
});

describe("LAUT-API -- JSON endpoints", () => {
  let app: Fixture;
  beforeAll(async () => (app = await serve("production", {}, "LAUT-API")));
  afterAll(() => app.stop());

  /**
   * LAUT-API-01 -- a returned value is serialised as JSON.
   */
  test("LAUT-API-01 a handler's return value becomes a 200 JSON body", async () => {
    const res = await app.get("/api/ok");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ ok: true });
  });

  /**
   * LAUT-API-02 -- an HttpError becomes its own status.
   */
  test("LAUT-API-02 a thrown HttpError keeps its status and message", async () => {
    const res = await app.get("/api/missing");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "widget not found" });
  });

  /**
   * LAUT-API-03 -- an unexpected throw does not become a disclosure.
   *
   * The distinction `route()` draws is the security-relevant one: an HttpError
   * was written to be shown to a caller, and anything else was not. A stack
   * trace or a driver message reaching the client is how an internal hostname,
   * a file path or a query ends up in someone's browser.
   */
  test("LAUT-API-03 an unexpected error is a generic 500, detail kept server-side", async () => {
    const res = await app.get("/api/boom");
    const body = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(body)).toEqual({ error: "Internal error" });
    expect(body).not.toContain("must stay server-side");
  });
});

describe("LAUT-RENDER -- documents, fragments and shells", () => {
  let app: Fixture;
  beforeAll(async () => (app = await serve("production", {}, "LAUT-RENDER")));
  afterAll(() => app.stop());

  /**
   * LAUT-RENDER-01 -- a normal request gets a whole document.
   */
  test("LAUT-RENDER-01 a plain GET returns a full HTML document", async () => {
    const res = await app.get("/");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<h1>hello</h1>");
  });

  /**
   * LAUT-RENDER-02 -- a router request gets only <main>'s contents.
   *
   * The sea around `<main>` is never touched on a same-layout navigation, which
   * is what lets island state living in the chrome survive it. A fragment
   * response that leaked a `<html>` would replace the document with a document.
   */
  test("LAUT-RENDER-02 x-fragment returns the body only, with the new title", async () => {
    const res = await app.get("/", { headers: { "x-fragment": "1", "x-layout": "" } });
    const html = await res.text();

    expect(html).not.toContain("<html");
    expect(html).not.toContain("<!doctype");
    expect(html).toContain("<h1>hello</h1>");
    expect(decodeURIComponent(res.headers.get("x-title")!)).toBe("Home · Fixture");
  });

  /**
   * LAUT-RENDER-03 -- an absent x-layout reads as the default layout.
   *
   * A client that drops an empty header value, or omits it entirely, is asking
   * for the page that wants no particular chrome. Treating "missing" as "some
   * other layout" would turn every such navigation into a full shell swap.
   */
  test("LAUT-RENDER-03 x-fragment with no x-layout still gets a fragment", async () => {
    const res = await app.get("/", { headers: { "x-fragment": "1" } });
    const html = await res.text();

    expect(html).not.toContain("<html");
    expect(res.headers.get("x-shell")).toBeNull();
  });

  /**
   * LAUT-RENDER-04 -- a layout change is answered with the whole document.
   *
   * `<main>` alone would leave the previous sidebar or topbar on screen around
   * the new page. The server notices the mismatch, sends the document instead,
   * and marks it `x-shell` so the router knows to swap the shell rather than
   * the main element.
   */
  test("LAUT-RENDER-04 a differing x-layout gets the document, marked x-shell", async () => {
    const res = await app.get("/bare", { headers: { "x-fragment": "1", "x-layout": "" } });
    const html = await res.text();

    expect(res.headers.get("x-shell")).toBe("1");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('data-layout="bare"');
  });

  /**
   * LAUT-RENDER-05 -- the title template is applied once, at the server.
   *
   * `%s · {name}` by default, and a page whose title already *is* the site name
   * is left alone so the home page does not read "Acme · Acme".
   */
  test("LAUT-RENDER-05 the document title has the site template applied", async () => {
    const html = await (await app.get("/")).text();
    expect(html).toContain("<title>Home · Fixture</title>");
  });
});
