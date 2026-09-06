// `import "./Foo.css"` -- the server half.
// LAUT-HEAD-12..18, LAUT-BUDGET-05, LAUT-PKG-04
import { plugin } from "bun";
import { readFileSync, statSync } from "node:fs";
import { config } from "../config.ts";
import { isDev } from "./dev.ts";

// On globalThis so `bun --hot` re-evaluating this module cannot empty it.
const sheets: Set<string> = ((globalThis as any).__lautCSS ??= new Set());

plugin({
  name: "laut:css",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, (args) => ({
      loader: "js",
      contents: `globalThis.__lautCSS.add(${JSON.stringify(args.path)});`,
    }));
  },
});

// LAUT-HEAD-13, LAUT-BUDGET-05, LAUT-BUDGET-06
let inlineLimit = 4096;

/** Set by createServer() from `config.cssInlineStylesheet`. */
export const configureCssInlining = (bytes: number) => void (inlineLimit = bytes);

type Split = { links: string[]; inline: string };

// LAUT-HEAD-17
let cached: { key: string; split: Split } | null = null;

// Whether the app's Document has ever asked for the inlined half.
let linkCalls = 0;
let inlineCalls = 0;
let warned = false;

function urls(): { path: string; url: string }[] {
  const root = config().root ?? process.cwd();
  return (
    [...sheets]
      .map((path) => ({ path, url: path.slice(root.length) }))
      // LAUT-HEAD-16
      .filter(({ url }) => url.startsWith("/src/") || url.startsWith("/public/"))
  );
}

function split(): Split {
  const all = urls();
  const key = `${all.length}:${inlineLimit}:${isDev()}`;
  if (cached?.key === key) return cached.split;

  // LAUT-HEAD-15, LAUT-HEAD-18
  const result: Split =
    isDev() || inlineLimit <= 0
      ? { links: all.map((s) => s.url), inline: "" }
      : (() => {
          const links: string[] = [];
          const parts: string[] = [];
          for (const { path, url } of all) {
            // LAUT-SRV-08
            let css: string | null = null;
            try {
              if (statSync(path).size < inlineLimit) css = readFileSync(path, "utf8");
            } catch {
              css = null; // unreadable: fall back to the link, and let the browser 404
            }
            // LAUT-HEAD-12
            if (css == null || /<\/style/i.test(css)) links.push(url);
            else parts.push(css);
          }
          return { links, inline: parts.join("\n") };
        })();

  cached = { key, split: result };
  return result;
}

/** Every imported stylesheet that is *not* inlined, as `/src/...` URLs.
 *  LAUT-HEAD-05, LAUT-HEAD-15, LAUT-HEAD-16, LAUT-HEAD-18 */
export function stylesheets(): string[] {
  const { links } = split();
  linkCalls++;

  // A Document that links these but never renders inlineStyles() looks correct
  // in dev and loses every small sheet in production. LAUT-HEAD-13
  if (isDev() && !warned && linkCalls > 1 && inlineCalls === 0 && inlineLimit > 0) {
    warned = true;
    const small = urls().filter(({ path }) => {
      try {
        return statSync(path).size < inlineLimit;
      } catch {
        return false;
      }
    });
    if (small.length) {
      console.warn(
        `Document links stylesheets() but never renders inlineStyles(). In production ` +
          `${small.length} sheet(s) under ${inlineLimit} bytes are inlined instead of linked, ` +
          `so they would go missing: ${small.map((s) => s.url).join(", ")}. ` +
          `Add <style> with inlineStyles(), or set cssInlineStylesheet: 0 to turn inlining off.`,
      );
    }
  }

  return links;
}

/** Every stylesheet under `cssInlineStylesheet`, concatenated for one `<style>`
 *  tag. Empty in dev. LAUT-HEAD-13, LAUT-HEAD-14, LAUT-HEAD-18 */
export function inlineStyles(): string {
  inlineCalls++;
  return split().inline;
}
