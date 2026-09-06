// The entry point an app calls. LAUT-ARCH-01, LAUT-SRV-01..11
import { type Config, setConfig } from "./config.ts";
import { configureCssInlining } from "./runtime/css.ts";
import { devEvents, isDev, serverReloaded, watchFrontend } from "./runtime/dev.ts";
import { configureCompression, etagFor, send, sendFile } from "./runtime/respond.ts";
import { transpileFile } from "./runtime/transpile.ts";
import { configureVendor, resolveVendor } from "./runtime/vendor.ts";

const DEFAULT_PRIVATE = ["/src/backend/"];

// LAUT-SRV-02, LAUT-VENDOR-03
const LAUT_SRC = import.meta.dir;

export function createServer(config: Config) {
  setConfig(config);

  const root = config.root ?? process.cwd();
  const secret = config.private ?? DEFAULT_PRIVATE;

  configureVendor(config.vendor ?? {}, root);
  if (config.compressMin != null) configureCompression(config.compressMin);
  if (config.cssInlineStylesheet != null) configureCssInlining(config.cssInlineStylesheet);

  // LAUT-DEV-01
  if (isDev()) watchFrontend(root, secret);

  // `as {}`: a conditional spread would make the key optional, and Bun's Routes
  // type rejects a possibly-undefined handler. LAUT-DEV-02
  const devRoutes = isDev() ? { "/__dev": devEvents } : {};

  /** Transpile a file under `base` to browser-ready ESM, or serve a .css
   *  verbatim. LAUT-SRV-01, LAUT-SRV-07, LAUT-SRV-08 */
  async function serveSource(req: Request, prefix: string, base: string) {
    // LAUT-SRV-06, LAUT-SRV-06b
    const path = new URL(req.url).pathname;
    if (!path.startsWith(prefix)) return new Response("Not found", { status: 404 });
    // LAUT-SRV-05
    if (secret.some((p) => path.startsWith(p))) {
      return new Response("Not found", { status: 404 });
    }

    const file = base + path.slice(prefix.length - 1);

    // LAUT-RESP-01, LAUT-RESP-02
    const etag = await etagFor(file);
    if (!etag) return new Response("Not found", { status: 404 });
    const headers = { "cache-control": "no-cache", etag };
    if (req.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }

    // LAUT-SRV-08
    if (file.endsWith(".css")) {
      const css = await Bun.file(file)
        .text()
        .catch(() => null);
      if (css == null) return new Response("Not found", { status: 404 });
      return send(req, css, { type: "text/css; charset=utf-8", headers });
    }

    const code = await transpileFile(file);
    if (code == null) return new Response("Not found", { status: 404 });
    return send(req, code, { type: "text/javascript; charset=utf-8", headers });
  }

  const server = Bun.serve({
    port: config.port ?? 3000,

    routes: {
      ...(config.routes as {}),

      // LAUT-SRV-01, LAUT-SRV-05, LAUT-SRV-07
      "/src/*": (req: Request) => serveSource(req, "/src/", root + "/src"),

      // LAUT-SRV-02
      "/lautjs/*": (req: Request) => serveSource(req, "/lautjs/", LAUT_SRC),

      // LAUT-SRV-03, LAUT-SRV-04
      "/vendor/*": (req: Request) => {
        const file = resolveVendor(new URL(req.url).pathname);
        return file ? sendFile(req, file) : new Response("Not found", { status: 404 });
      },

      // LAUT-SRV-09, LAUT-SRV-11, LAUT-RESP-11, LAUT-RESP-12
      "/public/*": (req: Request) => sendFile(req, root + new URL(req.url).pathname),

      // LAUT-DEV-01, LAUT-DEV-02
      ...(devRoutes as {}),
    },

    fetch: () => new Response("Not found", { status: 404 }),
    error: (err: Error) => {
      console.error(err);
      return new Response("Internal error", { status: 500 });
    },
  });

  // LAUT-DEV-01
  if (isDev()) serverReloaded();

  return server;
}
