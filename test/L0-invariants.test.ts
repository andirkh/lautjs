/**
 * L0 -- architecture invariants.
 *
 * These are the rules the framework is built on. Every one of them was a
 * comment in `src/` before it was a test: prose asking a future reader to
 * remember something, with nothing to notice when they don't. A rule that only
 * exists in a comment is a rule that is already broken somewhere you haven't
 * looked yet.
 *
 * Nothing here starts a server or renders anything -- these read the repository
 * as data. They are the cheapest tests in the suite and the ones most likely to
 * catch a change that breaks a published tarball rather than a running app.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const abs = (...p: string[]) => join(ROOT, ...p);

const sources = (dir: string) =>
  [...new Bun.Glob("**/*.{ts,tsx}").scanSync({ cwd: abs(dir), absolute: true })].sort();

const scanner = new Bun.Transpiler({ loader: "tsx" });

/**
 * The real imports of a module, as the runtime sees them.
 *
 * Two things are deliberately not done here. It is not a regex over the text:
 * `src/` discusses its own imports in prose constantly -- `transpile.ts` writes
 * out the exact import string an app should *not* write -- and a regex cannot
 * tell a rule from a sentence about a rule. scanImports reads the parsed module
 * and ignores comments entirely.
 *
 * And its output is intersected back against the source text, because
 * scanImports reports the JSX runtime import the transpiler *would* inject
 * ("react", "react/jsx-dev-runtime") as though the file had written it -- for
 * every .tsx file, whatever the configured pragma. Laut compiles with the
 * classic pragma and transformSync emits no such import, so it is an artifact
 * of the scanner rather than a dependency. Requiring the specifier to appear
 * literally in the file drops the injection and still catches a real
 * `import ... from "react"`, which would.
 */
function importsOf(file: string): string[] {
  const code = readFileSync(file, "utf8");
  return scanner
    .scanImports(code)
    .map((i) => i.path)
    .filter((spec) => code.includes(`"${spec}"`) || code.includes(`'${spec}'`));
}

const pkg = JSON.parse(readFileSync(abs("package.json"), "utf8"));

/** A bare specifier's package name: "preact/hooks" -> "preact", "@a/b/c" -> "@a/b". */
const packageOf = (spec: string) =>
  spec
    .split("/")
    .slice(0, spec.startsWith("@") ? 2 : 1)
    .join("/");

const isRelative = (spec: string) => spec.startsWith("./") || spec.startsWith("../");

describe("LAUT-ARCH -- what the framework is allowed to depend on", () => {
  /**
   * LAUT-ARCH-01 -- `src/` never imports app code.
   *
   * This is the one rule in the README, and it is what lets Laut live in
   * `node_modules` and still know nothing about the app around it. Everything
   * the framework needs arrives through `createServer(config)`: the island
   * registry, the layout map and the locale tables all stay on the app side,
   * and the framework only ever sees a string it hands back.
   *
   * Concretely: a module under `src/` may import a sibling by relative path, a
   * Node builtin, Bun's own module, or a package it actually declares as a
   * peer. Anything else is either app code or an undeclared dependency, and
   * both of those break the same way -- at the app's install, not here.
   */
  const allowedBare = new Set([
    ...Object.keys(pkg.peerDependencies ?? {}),
    "bun", // Bun's builtin module, always present on the runtime we require
  ]);

  test.each(sources("src"))("LAUT-ARCH-01 %s imports only siblings, builtins and peers", (file) => {
    const offenders = importsOf(file)
      .filter((spec) => !isRelative(spec))
      .filter((spec) => !spec.startsWith("node:"))
      .filter((spec) => !allowedBare.has(packageOf(spec)));

    expect({ file: relative(ROOT, file), offenders }).toEqual({
      file: relative(ROOT, file),
      offenders: [],
    });
  });

  /**
   * LAUT-ARCH-02 -- the browser half stays loadable by a browser.
   *
   * `src/client/*` is served to the browser as ESM through `/lautjs/*` and
   * resolved by the import map. There is no bundler and no polyfill layer, so a
   * client module that reaches for a Node builtin, for Bun, or for anything the
   * import map does not name is not a type error or a slow path -- it is a page
   * that renders and then fails to hydrate, with the failure showing up in a
   * browser console rather than in this process.
   *
   * `preact-render-to-string` is excluded on purpose even though it is a peer:
   * it is the server renderer, and pulling it into the client would ship the
   * whole SSR path to every visitor.
   */
  const browserSafe = new Set(["preact", "preact/hooks", "preact/jsx-runtime", "@preact/signals"]);

  test.each(sources("src/client"))("LAUT-ARCH-02 %s is browser-resolvable", (file) => {
    const offenders = importsOf(file)
      .filter((spec) => !isRelative(spec))
      .filter((spec) => !browserSafe.has(spec));

    expect({ file: relative(ROOT, file), offenders }).toEqual({
      file: relative(ROOT, file),
      offenders: [],
    });
  });

  /**
   * LAUT-ARCH-03 -- the server surface never reaches the browser.
   *
   * `src/index.ts` is server-only: it touches Bun APIs and the filesystem. The
   * import map deliberately leaves the bare `lautjs` specifier out so that an
   * island importing it fails loudly instead of half-working -- which only
   * holds as long as no client module imports it either.
   */
  test.each(sources("src/client"))("LAUT-ARCH-03 %s does not import the server surface", (file) => {
    const escapes = importsOf(file).filter((spec) => spec === "lautjs" || spec.startsWith("../"));
    expect({ file: relative(ROOT, file), escapes }).toEqual({
      file: relative(ROOT, file),
      escapes: [],
    });
  });
});

describe("LAUT-VENDOR -- the import map is the dependency system", () => {
  /**
   * LAUT-VENDOR-01 -- `CLIENT_MODULES` lists exactly the files in `src/client`.
   *
   * That list drives `<link rel="modulepreload">` for the client runtime. It is
   * static by construction, and `vendor.ts` used to carry a comment asking
   * whoever adds a file to `src/client` to remember to add it here too.
   *
   * Both directions are failures, and they fail differently. A module in
   * `src/client` that is missing from the list is a silent latency regression:
   * the browser discovers it a round trip late and everything still works, so
   * nothing ever tells you. A name in the list with no file behind it is a
   * preload for a URL that 404s -- visible only in a network panel nobody is
   * looking at.
   */
  test("LAUT-VENDOR-01 the modulepreload list matches src/client on disk", async () => {
    const { clientPreloads } = await import("../src/runtime/vendor.ts");

    const onDisk = [...new Bun.Glob("*.ts").scanSync({ cwd: abs("src/client") })]
      .map((f) => `/lautjs/client/${f}`)
      .sort();

    expect(clientPreloads().sort()).toEqual(onDisk);
  });

  /**
   * LAUT-VENDOR-02 -- every specifier Laut ships resolves to a real file.
   *
   * The vendor map is a hand-written table of bare specifier -> path inside
   * `node_modules`, and those paths are internal to packages Laut does not
   * control. A dependency reorganising its `dist/` is not a type error and not
   * an install failure: the entry simply stops resolving, `/vendor/preact`
   * starts answering 404, and the app renders and never hydrates.
   *
   * This is the test that turns a silent upgrade into a red test run.
   */
  test("LAUT-VENDOR-02 every built-in vendor entry exists in node_modules", async () => {
    const { configureVendor, resolveVendor, getImportMap } =
      await import("../src/runtime/vendor.ts");
    configureVendor({}, ROOT);

    const missing = Object.keys(getImportMap().imports)
      .filter((spec) => !spec.startsWith("lautjs"))
      .filter((spec) => resolveVendor("/vendor/" + spec) === null);

    expect(missing).toEqual([]);
  });

  /**
   * LAUT-VENDOR-03 -- the framework's own client routes resolve on disk.
   *
   * `lautjs/client` and the `lautjs/` prefix are baked into the import map and
   * served out of `import.meta.dir`. The map is a string table with nothing
   * checking it against the filesystem, so a renamed file leaves an import map
   * that is still valid JSON and still wrong.
   */
  test("LAUT-VENDOR-03 the lautjs/* import map entries point at real files", async () => {
    const { getImportMap } = await import("../src/runtime/vendor.ts");

    const missing = Object.entries(getImportMap().imports)
      .filter(([spec]) => spec.startsWith("lautjs"))
      .map(([, url]) => url)
      .filter((url) => url.endsWith(".ts"))
      .filter((url) => !existsSync(abs("src", url.replace("/lautjs/", ""))));

    expect(missing).toEqual([]);
  });
});

describe("LAUT-PKG -- what actually ships", () => {
  /**
   * LAUT-PKG-01 -- every path in `files` exists.
   *
   * `files` decides the tarball. An entry that no longer exists is not an
   * error at pack time -- npm just leaves it out -- so the first person to
   * find out is whoever installs the package and hits a missing module.
   */
  test("LAUT-PKG-01 every entry in package.json#files is on disk", () => {
    const missing = (pkg.files as string[]).filter((f) => !existsSync(abs(f)));
    expect(missing).toEqual([]);
  });

  /**
   * LAUT-PKG-02 -- every concrete `exports` target exists.
   *
   * These are the specifiers an app writes. A broken one is a resolution error
   * in someone else's project, phrased in terms of our internal paths.
   * Wildcard subpaths are skipped: `"./*"` names no single file.
   */
  test("LAUT-PKG-02 every exports target resolves", () => {
    const missing = Object.entries(pkg.exports as Record<string, string>)
      .filter(([sub]) => !sub.includes("*"))
      .filter(([, target]) => !existsSync(abs(target)));
    expect(missing).toEqual([]);
  });

  /**
   * LAUT-PKG-03 -- the scaffolder's vendored copy has not drifted.
   *
   * `create/template` is generated from `template/` by scripts/sync-create.ts
   * and is gitignored, so it is absent in a fresh clone and stale the moment
   * `template/` is edited. Publishing `create-lautjs` with a stale copy hands
   * every new app an old starter, which is invisible from this repository --
   * everything here still points at the real `template/`.
   *
   * Absent is fine (nothing has been vendored yet). Present and different is
   * the bug.
   */
  test("LAUT-PKG-03 create/template matches template when it has been vendored", () => {
    if (!existsSync(abs("create/template"))) return;

    const list = (dir: string) =>
      [...new Bun.Glob("**/*").scanSync({ cwd: abs(dir), dot: true })]
        .filter((f) => !f.endsWith(".DS_Store"))
        .sort();

    expect(list("create/template")).toEqual(list("template"));

    const differing = list("template").filter(
      (f) =>
        Bun.hash(readFileSync(abs("template", f))) !==
        Bun.hash(readFileSync(abs("create/template", f))),
    );
    expect(differing).toEqual([]);
  });

  /**
   * LAUT-PKG-04 -- the template still declares the preload.
   *
   * `import "./Foo.css"` on the server works only because `bunfig.toml`
   * preloads `lautjs/preload.ts`; a plugin registered from an ordinary import
   * lands after the module graph it should intercept is already resolved.
   * Drop that line from the starter and every scaffolded app throws on its
   * first component stylesheet.
   */
  test("LAUT-PKG-04 the scaffolded bunfig.toml preloads the css plugin", () => {
    expect(readFileSync(abs("template/_bunfig.toml"), "utf8")).toContain("lautjs/preload.ts");
  });
});

describe("LAUT-TRACE -- every pointer in src/ resolves", () => {
  /**
   * LAUT-TRACE-01 -- no `LAUT-…` tag in `src/` points at a test that is not
   * there.
   *
   * This is the test that makes the others readable. The comments in `src/` were
   * replaced by these tags on the understanding that the description moved into
   * the test, so a tag with no test behind it is worse than the comment it
   * replaced: it is a promise that there is an explanation somewhere, made to
   * someone who is about to go looking for it.
   *
   * It is also the closest thing here to DO-178C's traceability objectives
   * (Table A-7, objectives 3 and 4), which require a demonstrated link between
   * requirements and the tests that verify them. The tags are the link, and this
   * is the demonstration -- checked mechanically rather than asserted in a
   * document, which is the whole reason to prefer objectives over DIDs.
   *
   * Ranges are expanded: a file header reading `LAUT-HEAD-01..20` is a claim
   * about twenty tests, and all twenty are checked.
   */
  test("LAUT-TRACE-01 every LAUT- tag in src/ names a test that exists", () => {
    const id = (prefix: string, n: number | string, suffix = "") =>
      `LAUT-${prefix}-${String(n).padStart(2, "0")}${suffix}`;

    // Declared IDs: the leading token of a test's name.
    const declared = new Set<string>();
    for (const file of [
      ...new Bun.Glob("*.test.{ts,tsx}").scanSync({ cwd: abs("test"), absolute: true }),
    ]) {
      for (const [, name] of readFileSync(file, "utf8").matchAll(
        /["'`](LAUT-[A-Z0-9]+-\d+[a-z]?) /g,
      )) {
        declared.add(name!);
      }
    }
    expect(declared.size).toBeGreaterThan(50); // the scan itself still works

    // Referenced IDs: every tag written into the framework.
    const referenced = new Map<string, string>();
    for (const file of sources("src")) {
      const code = readFileSync(file, "utf8");
      for (const [, prefix, from, to, suffix] of code.matchAll(
        /LAUT-([A-Z0-9]+)-(\d+)(?:\.\.(\d+))?([a-z])?/g,
      )) {
        if (to) {
          for (let n = Number(from); n <= Number(to); n++) {
            referenced.set(id(prefix!, n), relative(ROOT, file));
          }
        } else {
          referenced.set(id(prefix!, from!, suffix ?? ""), relative(ROOT, file));
        }
      }
    }
    expect(referenced.size).toBeGreaterThan(20); // src/ is actually tagged

    const dangling = [...referenced.entries()]
      .filter(([name]) => !declared.has(name))
      .map(([name, file]) => `${name} (referenced by ${file})`);

    expect(dangling).toEqual([]);
  });
});
