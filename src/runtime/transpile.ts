// "No build": source is transpiled per request and cached in memory.
// LAUT-TRANSP-01, LAUT-TRANSP-02, LAUT-TRANSP-10
const PRELUDE = 'import{h as __h,Fragment as __Fragment}from"preact";\n';

// LAUT-TRANSP-03, LAUT-TRANSP-04, LAUT-TRANSP-05
const CSS_IMPORT = /import\s*"([^"]+\.css)";?/g;
const CSS_RUNTIME = 'import{css as __css}from"/lautjs/client/css.ts";\n';

// LAUT-TRANSP-06
const CSS_BINDING_IMPORT = /import\s[^;]*?\bfrom\s*"([^"]+\.css)"/;

function linkStylesheets(code: string, absPath: string): string {
  const binding = CSS_BINDING_IMPORT.exec(code);
  if (binding) {
    throw new Error(
      `${absPath} imports "${binding[1]}" for a value. A stylesheet exports ` +
        `nothing -- write it as a side-effect import: import "${binding[1]}";`,
    );
  }

  if (!CSS_IMPORT.test(code)) return code;
  CSS_IMPORT.lastIndex = 0; // LAUT-TRANSP-11
  return (
    CSS_RUNTIME +
    code.replace(
      CSS_IMPORT,
      (_, spec) => `__css(new URL(${JSON.stringify(spec)},import.meta.url).href);`,
    )
  );
}

const transpiler = new Bun.Transpiler({
  target: "browser",
  loader: "tsx",
  tsconfig: {
    compilerOptions: { jsx: "react", jsxFactory: "__h", jsxFragmentFactory: "__Fragment" },
  },
});

type Entry = { code: string; mtime: number };
const cache = new Map<string, Entry>();

// prettier-ignore
const LOADERS: Record<string, "tsx" | "ts" | "jsx" | "js"> = {
  tsx: "tsx", ts: "ts", jsx: "jsx", js: "js", mjs: "js",
};

/** Transpile a source file to browser-ready ESM. Null if unsupported/missing.
 *  LAUT-TRANSP-08, LAUT-TRANSP-09, LAUT-TRANSP-10 */
export async function transpileFile(absPath: string): Promise<string | null> {
  const file = Bun.file(absPath);
  const stat = await file.stat().catch(() => null);
  if (!stat) return null;

  const cached = cache.get(absPath);
  if (cached && cached.mtime === stat.mtimeMs) return cached.code;

  const ext = absPath.split(".").pop() ?? "";
  if (ext !== "json" && !LOADERS[ext]) return null;

  const source = await file.text();
  // LAUT-TRANSP-07
  const out =
    ext === "json"
      ? `export default ${source};\n`
      : PRELUDE + linkStylesheets(transpiler.transformSync(source, LOADERS[ext]!), absPath);

  cache.set(absPath, { code: out, mtime: stat.mtimeMs });
  return out;
}
