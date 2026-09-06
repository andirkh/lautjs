// Bare specifier -> file inside node_modules (browser ESM builds).
// LAUT-VENDOR-01..10
import { existsSync } from "node:fs";
import { join } from "node:path";

const BASE: Record<string, string> = {
  preact: "preact/dist/preact.module.js",
  "preact/hooks": "preact/hooks/dist/hooks.module.js",
  "preact/jsx-runtime": "preact/jsx-runtime/dist/jsxRuntime.module.js",
  "@preact/signals": "@preact/signals/dist/signals.module.js",
  "@preact/signals-core": "@preact/signals-core/dist/signals-core.module.js",
  kinu: "kinu/dist/index.js",
  "kinu/style.css": "kinu/dist/index.css",
};

let VENDOR: Record<string, string> = { ...BASE };

// LAUT-VENDOR-04
const SELF = join(import.meta.dir, "..", "..");
let ROOTS: string[] = [];

/** Merge the app's entries over Laut's. LAUT-VENDOR-05, LAUT-VENDOR-06 */
export function configureVendor(extra: Record<string, string>, appRoot: string) {
  VENDOR = { ...BASE, ...extra };
  ROOTS = [...new Set([appRoot, SELF])].map((dir) => join(dir, "node_modules") + "/");
}

/** URL the browser uses for a bare specifier. LAUT-VENDOR-08 */
export const vendorURL = (spec: string) => "/vendor/" + spec;

/** The import map injected into every page. LAUT-VENDOR-03, LAUT-VENDOR-07 */
export const getImportMap = () => ({
  imports: {
    ...Object.fromEntries(Object.keys(VENDOR).map((s) => [s, vendorURL(s)])),
    "lautjs/client": "/lautjs/client/index.ts",
    "lautjs/i18n": "/lautjs/i18n/index.ts",
    "lautjs/": "/lautjs/",
  },
});

/** "/vendor/preact/hooks" -> absolute path in node_modules, or null.
 *  LAUT-VENDOR-04, LAUT-VENDOR-09, LAUT-VENDOR-10 */
export function resolveVendor(pathname: string): string | null {
  const spec = decodeURIComponent(pathname.replace(/^\/vendor\//, ""));
  const file = VENDOR[spec];
  if (!file) return null;
  return ROOTS.map((root) => root + file).find(existsSync) ?? null;
}

// LAUT-VENDOR-01, LAUT-BUDGET-03
const CLIENT_MODULES = ["index", "boot", "nav", "hydrate", "css"];

/** Module URLs to hint with `<link rel="modulepreload">`. LAUT-BUDGET-03 */
export const clientPreloads = () => CLIENT_MODULES.map((m) => `/lautjs/client/${m}.ts`);
