/**
 * L1 -- the import map, the JSON plumbing and the translation engine.
 *
 * All three are module-level state by design: one vendor table, one set of
 * locale tables, one config. That is right for a server process and means these
 * tests have to put the state back when they are done.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureVendor, getImportMap, resolveVendor, vendorURL } from "../src/runtime/vendor.ts";
import { HttpError, badRequest, notFound } from "../src/runtime/api.ts";
import { configureLocales, isLocale, locale, t } from "../src/i18n/index.ts";

const REPO = join(import.meta.dir, "..");

describe("LAUT-VENDOR -- bare specifier to file on disk", () => {
  afterAll(() => configureVendor({}, REPO));

  /**
   * LAUT-VENDOR-04 -- an app's own node_modules wins over Laut's.
   *
   * The browser must be handed the *same* copy of preact the app's components
   * were compiled against. Two copies is not a duplicated download -- it is two
   * module instances, two signal registries, and islands that hydrate against a
   * preact that knows nothing about the one that rendered them.
   *
   * Laut's own node_modules is the fallback and exists for `bun link`, where the
   * app has no copy at all.
   */
  test("LAUT-VENDOR-04 the app's node_modules takes precedence over Laut's", () => {
    const app = mkdtempSync(join(tmpdir(), "laut-app-"));
    try {
      const dist = join(app, "node_modules", "preact", "dist");
      mkdirSync(dist, { recursive: true });
      writeFileSync(join(dist, "preact.module.js"), "// the app's own copy\n");

      configureVendor({}, app);
      expect(resolveVendor("/vendor/preact")).toBe(join(dist, "preact.module.js"));

      // Nothing the app has: falls through to Laut's own install.
      expect(resolveVendor("/vendor/kinu")).toContain(join(REPO, "node_modules"));
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  /**
   * LAUT-VENDOR-05 -- an app can add specifiers, and override Laut's.
   */
  test("LAUT-VENDOR-05 app entries merge over the built-in table", () => {
    configureVendor({ "date-fns": "date-fns/index.js" }, REPO);
    expect(getImportMap().imports["date-fns"]).toBe("/vendor/date-fns");

    configureVendor({ preact: "somewhere/else.js" }, REPO);
    expect(getImportMap().imports["preact"]).toBe("/vendor/preact");
    expect(resolveVendor("/vendor/preact")).toBeNull(); // the override points nowhere
  });

  /**
   * LAUT-VENDOR-06 -- configuring again replaces, it does not accumulate.
   *
   * The table is rebuilt from the built-ins on every call. If it merged into
   * whatever was there before, a second `createServer` in one process -- which
   * is what `bun --hot` does on every save -- would inherit the previous app's
   * entries.
   */
  test("LAUT-VENDOR-06 a later configureVendor drops the earlier extras", () => {
    configureVendor({ "date-fns": "date-fns/index.js" }, REPO);
    expect(getImportMap().imports).toHaveProperty("date-fns");

    configureVendor({}, REPO);
    expect(getImportMap().imports).not.toHaveProperty("date-fns");
  });

  /**
   * LAUT-VENDOR-07 -- the bare `lautjs` specifier is deliberately unmapped.
   *
   * `src/index.ts` is the server surface: it reaches for Bun APIs and the
   * filesystem. Leaving it out of the import map means an island that imports it
   * fails loudly in the browser rather than resolving to something that
   * half-works. The prefixed entries -- `lautjs/client`, `lautjs/i18n` and the
   * `lautjs/` prefix -- are the ones the browser is allowed to have.
   */
  test("LAUT-VENDOR-07 the import map exposes lautjs/* but never bare lautjs", () => {
    configureVendor({}, REPO);
    const { imports } = getImportMap();

    expect(imports).not.toHaveProperty("lautjs");
    expect(imports["lautjs/client"]).toBe("/lautjs/client/index.ts");
    expect(imports["lautjs/i18n"]).toBe("/lautjs/i18n/index.ts");
    expect(imports["lautjs/"]).toBe("/lautjs/");
  });

  /**
   * LAUT-VENDOR-08 -- a specifier's URL is its name under /vendor.
   *
   * The server and the browser have to agree on this string exactly: the import
   * map is generated from one side and requested from the other.
   */
  test("LAUT-VENDOR-08 vendorURL and the /vendor route agree", () => {
    configureVendor({}, REPO);
    expect(vendorURL("kinu/style.css")).toBe("/vendor/kinu/style.css");
    expect(resolveVendor(vendorURL("kinu/style.css"))).not.toBeNull();
  });

  /**
   * LAUT-VENDOR-09 -- a percent-encoded specifier resolves the same.
   *
   * `@preact/signals` contains an `@` and a `/`; a client that encodes either
   * is asking for the same module.
   */
  test("LAUT-VENDOR-09 percent-encoded specifiers resolve", () => {
    configureVendor({}, REPO);
    expect(resolveVendor("/vendor/%40preact%2Fsignals")).toBe(
      resolveVendor("/vendor/@preact/signals"),
    );
  });

  /**
   * LAUT-VENDOR-10 -- robustness: an unknown specifier is null, not a path.
   *
   * The route is a table lookup. If an unmapped name ever became a path join,
   * `/vendor/../../etc/passwd` would be a file read.
   */
  test("LAUT-VENDOR-10 unmapped and traversing specifiers resolve to null", () => {
    configureVendor({}, REPO);
    expect(resolveVendor("/vendor/lodash")).toBeNull();
    expect(resolveVendor("/vendor/../package.json")).toBeNull();
    expect(resolveVendor("/vendor/preact/dist/preact.module.js")).toBeNull();
    expect(resolveVendor("/vendor/")).toBeNull();
  });
});

describe("LAUT-API -- what a backend route may say", () => {
  /**
   * LAUT-API-04 -- the error constructors carry the status they name.
   */
  test("LAUT-API-04 badRequest and notFound build the statuses they are named for", () => {
    expect(badRequest("no id").status).toBe(400);
    expect(badRequest("no id").message).toBe("no id");
    expect(notFound("widget").status).toBe(404);
    expect(notFound("widget").message).toBe("widget not found");
    expect(new HttpError(418, "teapot")).toBeInstanceOf(Error);
  });
});

describe("LAUT-I18N -- translation, on both sides of the wire", () => {
  afterAll(() => configureLocales({}, "en"));

  const TABLES = {
    en: { greeting: "Hello", cart: "{n} items, {n} of them new", only: "English only" },
    id: { greeting: "Halo" },
  };

  /**
   * LAUT-I18N-01 -- the active locale's table answers first.
   */
  test("LAUT-I18N-01 a key resolves against the active locale", () => {
    configureLocales(TABLES, "en");
    expect(t("greeting")).toBe("Hello");

    locale.value = "id";
    expect(t("greeting")).toBe("Halo");
  });

  /**
   * LAUT-I18N-02 -- a key missing from the active locale falls back per key.
   *
   * Per key, not per table: a partially translated locale should show its own
   * strings where it has them and the default language where it does not.
   * Falling back a whole table at a time would hide every translation a locale
   * *does* have the moment one key is missing.
   */
  test("LAUT-I18N-02 a missing key falls back to the default locale", () => {
    configureLocales(TABLES, "en");
    locale.value = "id";

    expect(t("greeting")).toBe("Halo"); // present in id
    expect(t("only")).toBe("English only"); // absent from id, taken from en
  });

  /**
   * LAUT-I18N-03 -- an unknown locale falls back to the default table.
   */
  test("LAUT-I18N-03 an unknown active locale still translates", () => {
    configureLocales(TABLES, "en");
    locale.value = "fr";
    expect(t("greeting")).toBe("Hello");
  });

  /**
   * LAUT-I18N-04 -- robustness: an untranslated key renders as itself.
   *
   * The alternatives are worse in every case. `undefined` renders the word
   * "undefined" into the page; an empty string renders a blank where a label
   * should be; a throw takes the whole render down over a missing string. The
   * key is at least legible and searchable.
   */
  test("LAUT-I18N-04 a key missing everywhere renders as the key", () => {
    configureLocales(TABLES, "en");
    expect(t("nope.not.here")).toBe("nope.not.here");
  });

  /**
   * LAUT-I18N-05 -- interpolation replaces every occurrence, not the first.
   */
  test("LAUT-I18N-05 a variable used twice is substituted twice", () => {
    configureLocales(TABLES, "en");
    expect(t("cart", { n: 3 })).toBe("3 items, 3 of them new");
  });

  /**
   * LAUT-I18N-06 -- values are stringified.
   *
   * Deliberate: stringifying a signal reads it, which is what subscribes the
   * calling island to it, so a translated string containing a signal re-renders
   * when the signal changes.
   */
  test("LAUT-I18N-06 non-string values are coerced", () => {
    configureLocales({ en: { n: "value: {v}" } }, "en");
    expect(t("n", { v: 42 })).toBe("value: 42");
    expect(t("n", { v: null })).toBe("value: null");
  });

  /**
   * LAUT-I18N-07 -- isLocale is a membership test over installed tables.
   *
   * It is what an app uses to validate a locale coming off a URL or a cookie,
   * so it has to be false for anything not installed -- including the values
   * that are not strings at all.
   */
  test("LAUT-I18N-07 isLocale accepts only installed locales", () => {
    configureLocales(TABLES, "en");
    expect(isLocale("en")).toBe(true);
    expect(isLocale("id")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });

  /**
   * LAUT-I18N-08 -- configuring sets the active locale.
   */
  test("LAUT-I18N-08 configureLocales makes the default locale active", () => {
    locale.value = "zz";
    configureLocales(TABLES, "id");
    expect(locale.value).toBe("id");
  });
});
