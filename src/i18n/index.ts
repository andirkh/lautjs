// Isomorphic translation engine. It holds no tables of its own.
// LAUT-ARCH-01, LAUT-I18N-01..08
import { signal } from "@preact/signals";

type Tables = Record<string, Record<string, string>>;

let tables: Tables = {};
let fallback = "en";

export const locale = signal<string>("en");

/** Install the app's locale tables. Call once, at module scope. LAUT-I18N-08 */
export function configureLocales(next: Tables, defaultLocale: string) {
  tables = next;
  fallback = defaultLocale;
  locale.value = defaultLocale;
}

export const isLocale = (v: unknown): v is string => typeof v === "string" && v in tables;

/** Translate. Reads the `locale` signal, so islands are reactive to it.
 *  LAUT-I18N-01, LAUT-I18N-02, LAUT-I18N-03, LAUT-I18N-04, LAUT-I18N-05,
 *  LAUT-I18N-06 */
export function t(key: string, vars?: Record<string, unknown>): string {
  const table = tables[locale.value] ?? tables[fallback] ?? {};
  let out = table[key] ?? tables[fallback]?.[key] ?? key;
  if (vars) for (const k in vars) out = out.replaceAll(`{${k}}`, String(vars[k]));
  return out;
}
