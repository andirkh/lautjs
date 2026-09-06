/**
 * L1 -- the transpiler, which is what Laut has instead of a build step.
 *
 * DO-178C low-level testing (§6.4.3.c): these are the units, exercised
 * directly, with both normal-range and abnormal inputs. Everything here is a
 * pure function of a file on disk, so the tests write their own files and read
 * back exactly what the browser would have been sent.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transpileFile } from "../src/runtime/transpile.ts";

let dir: string;
beforeAll(() => (dir = mkdtempSync(join(tmpdir(), "laut-transpile-"))));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Write a source file and hand back its absolute path. */
const source = (name: string, code: string) => {
  const path = join(dir, name);
  writeFileSync(path, code);
  return path;
};

describe("LAUT-TRANSP -- source to browser ESM, per request", () => {
  /**
   * LAUT-TRANSP-01 -- the preact import is injected, not assumed.
   *
   * Laut compiles JSX with the classic pragma (`h` / `Fragment`) specifically so
   * that it can inject the import itself: `Bun.Transpiler` does not emit the
   * automatic-runtime import, so a file compiled with the automatic pragma would
   * reach the browser calling `jsx()` with nothing having imported it.
   */
  test("LAUT-TRANSP-01 a .tsx file gets the preact prelude", async () => {
    const out = await transpileFile(source("a.tsx", "export const A = () => <div>hi</div>;\n"));

    expect(out).toContain('import{h as __h,Fragment as __Fragment}from"preact"');
    expect(out).toContain("__h(");
  });

  /**
   * LAUT-TRANSP-02 -- TypeScript is erased.
   */
  test("LAUT-TRANSP-02 type annotations do not reach the browser", async () => {
    const out = await transpileFile(
      source("b.tsx", "type P = { n: number };\nexport const B = (p: P) => <i>{p.n}</i>;\n"),
    );

    expect(out).not.toContain("type P");
    expect(out).not.toContain(": P");
  });

  /**
   * LAUT-TRANSP-03 -- `import "./Foo.css"` becomes a call, not an import.
   *
   * ESM cannot import a stylesheet. The side-effect import is rewritten into a
   * runtime call that links the sheet, and the specifier is resolved against
   * `import.meta.url` so a relative path stays relative to the file that wrote
   * it rather than to whatever module happens to evaluate it.
   */
  test("LAUT-TRANSP-03 a side-effect css import is rewritten to a runtime call", async () => {
    const out = await transpileFile(
      source("c.tsx", 'import "./Foo.css";\nexport const C = () => <b/>;\n'),
    );

    expect(out).toContain('import{css as __css}from"/lautjs/client/css.ts"');
    expect(out).toContain('__css(new URL("./Foo.css",import.meta.url).href)');
    expect(out).not.toContain('import"./Foo.css"');
  });

  /**
   * LAUT-TRANSP-04 -- the css runtime is only added to files that need it.
   *
   * Every module that imported it would be a module the browser must fetch
   * `client/css.ts` before it can evaluate. Most modules import no stylesheet.
   */
  test("LAUT-TRANSP-04 a file with no stylesheet import does not pull in the css runtime", async () => {
    const out = await transpileFile(source("d.tsx", "export const D = () => <b/>;\n"));
    expect(out).not.toContain("/lautjs/client/css.ts");
  });

  /**
   * LAUT-TRANSP-05 -- every stylesheet import in a file is rewritten, not just
   * the first.
   *
   * A module rewritten only in part is the worst outcome available here: the
   * imports that were rewritten work, and the one that was not reaches the
   * browser as a real ESM import of a `text/css` file and fails there, in a
   * console, attributed to a URL rather than to a source file.
   *
   * One import cannot show that -- a partial rewrite needs a second one to have
   * something to skip -- so this test carries two.
   *
   * Note on the `CSS_IMPORT.lastIndex = 0` line in `transpile.ts`: it is
   * defensive but not load-bearing, and removing it does not fail this test.
   * `test()` on a global regex genuinely does park `lastIndex` after its match,
   * and `exec()` would resume from there -- but `String.prototype.replace` sets
   * `lastIndex` back to 0 itself before it starts (RegExp.prototype[@@replace],
   * step 5), so the offset `test()` left behind is discarded either way. See
   * LAUT-TRANSP-11, which pins that language behaviour directly.
   */
  test("LAUT-TRANSP-05 multiple stylesheet imports are all rewritten", async () => {
    const out = await transpileFile(
      source("e.tsx", 'import "./One.css";\nimport "./Two.css";\nexport const E = () => <b/>;\n'),
    );

    expect(out).toContain('__css(new URL("./One.css",import.meta.url).href)');
    expect(out).toContain('__css(new URL("./Two.css",import.meta.url).href)');
    expect(out).not.toMatch(/import\s*"\.\/(One|Two)\.css"/);
  });

  /**
   * LAUT-TRANSP-11 -- the regex-state assumption behind LAUT-TRANSP-05.
   *
   * `transpile.ts` resets `lastIndex` before its `replace`, guarding against a
   * hazard that is real for `exec` and not for `replace`. That is harmless, but
   * an untested belief about the language is still an untested belief, and the
   * next person to read that line should be able to find out which it is
   * without reasoning it out from the spec.
   */
  test("LAUT-TRANSP-11 String.replace with a global regex ignores a parked lastIndex", () => {
    const re = /import\s*"([^"]+\.css)";?/g;
    const code = 'import "./One.css";\nimport "./Two.css";';

    expect(re.test(code)).toBe(true);
    expect(re.lastIndex).toBeGreaterThan(0); // test() parked an offset...
    expect(code.replace(re, "X")).toBe("X\nX"); // ...and replace() discarded it
    expect(re.lastIndex).toBe(0);

    // The contrast: exec() does resume from where test() left off.
    const other = /a/g;
    other.test("aaa");
    expect(other.exec("aaa")!.index).toBe(1);
  });

  /**
   * LAUT-TRANSP-06 -- robustness: importing a stylesheet for a value fails here,
   * where the file has a name.
   *
   * `import styles from "./x.css"` is a CSS-modules habit, and there is no
   * bundler here to make it mean anything. Left alone it would reach the browser
   * as an ESM import of a text/css file and fail in a console, attributed to a
   * URL. Failing at transpile time puts the path and the correction in the
   * message instead.
   */
  test("LAUT-TRANSP-06 importing a stylesheet for a binding throws, naming the file", async () => {
    const path = source("f.tsx", 'import styles from "./x.css";\nexport const F = () => <b/>;\n');

    await expect(transpileFile(path)).rejects.toThrow(/f\.tsx/);
    await expect(transpileFile(path)).rejects.toThrow(/import "\.\/x\.css";/);
  });

  /**
   * LAUT-TRANSP-07 -- JSON is wrapped as a module rather than served raw.
   *
   * A raw JSON module needs `with { type: "json" }` at the import site, and
   * Bun's transpiler strips import attributes -- so the browser would be asked
   * to import JSON as JavaScript and would refuse. Wrapping it in an
   * `export default` makes it an ordinary module. This is how locale tables
   * reach the client.
   */
  test("LAUT-TRANSP-07 a .json file becomes an ESM default export", async () => {
    const out = await transpileFile(source("g.json", '{"hello":"world"}'));
    expect(out).toBe('export default {"hello":"world"};\n');
  });

  /**
   * LAUT-TRANSP-08 -- robustness: anything else is not a module.
   */
  test("LAUT-TRANSP-08 an unsupported extension returns null", async () => {
    expect(await transpileFile(source("h.md", "# not a module"))).toBeNull();
    expect(await transpileFile(source("i.txt", "plain"))).toBeNull();
  });

  /**
   * LAUT-TRANSP-09 -- robustness: a file that is not there returns null rather
   * than throwing.
   *
   * `serveSource` turns this null into a 404. A throw would become a 500, which
   * says "the server is broken" about a request for a file that simply does not
   * exist.
   */
  test("LAUT-TRANSP-09 a missing file returns null", async () => {
    expect(await transpileFile(join(dir, "absent.tsx"))).toBeNull();
  });

  /**
   * LAUT-TRANSP-10 -- the cache is keyed on mtime, and honours a change.
   *
   * Transpiling per request is only viable because the result is cached, and the
   * cache is only correct because it is invalidated by the file's mtime. Both
   * halves are asserted: an untouched file is not re-transpiled, and an edited
   * one is.
   *
   * The second write's timestamp is forced rather than left to the filesystem.
   * `mtimeMs` has millisecond resolution, two writes inside the same millisecond
   * are indistinguishable to it, and a test that depends on being slow enough is
   * a test that fails on a faster machine.
   */
  test("LAUT-TRANSP-10 output is cached by mtime and invalidated when it moves", async () => {
    const path = source("j.tsx", "export const V = 1;\n");

    const first = await transpileFile(path);
    expect(await transpileFile(path)).toBe(first!);

    writeFileSync(path, "export const V = 2;\n");
    const later = new Date(Date.now() + 5_000);
    utimesSync(path, later, later);

    const second = await transpileFile(path);
    expect(second).not.toBe(first!);
    expect(second).toContain("V = 2");
  });
});
