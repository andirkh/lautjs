/**
 * Test harness: a real Bun.serve, on a real port, answering real requests.
 *
 * Nothing here mocks the framework. `createServer` is called exactly the way an
 * app's `server.ts` calls it, and the tests talk to it over HTTP with `fetch`.
 * The route table, the compression, the etag round trip and the traversal
 * defences all live in the gap between a URL and a Response, and that gap only
 * exists when something is actually listening.
 *
 * Two pieces of Laut are process-global by design -- `setConfig` holds one
 * config in a module slot, and the dev watcher parks its state on globalThis so
 * `bun --hot` cannot orphan it. That is right for a server process and awkward
 * for a test suite, so `serve()` refuses to start a second server while one is
 * running: overlapping servers would silently share one config and the failures
 * would land in whichever test ran second.
 */
import { createServer } from "../../src/server.ts";
import type { Config } from "../../src/config.ts";
import { App } from "./fixture/src/App.tsx";

export const FIXTURE_ROOT = new URL("./fixture", import.meta.url).pathname;

export type Mode = "development" | "production";

export type Fixture = {
  /** Origin of the running server, e.g. "http://localhost:53124". */
  readonly origin: string;
  /** GET a path on this server. Relative paths are resolved against the origin. */
  get(path: string, init?: RequestInit): Promise<Response>;
  /** Shut the server down and put NODE_ENV back the way it was found. */
  stop(): Promise<void>;
};

let running: string | null = null;

/**
 * Boot the fixture app.
 *
 * `mode` is not a convenience: production and development are two different
 * servers. Development registers `/__dev`, starts a file watcher, links every
 * stylesheet rather than inlining any, and revalidates public assets instead of
 * marking them immutable. A test that does not say which one it means is
 * testing whatever NODE_ENV happened to be.
 */
export async function serve(
  mode: Mode,
  overrides: Partial<Config> = {},
  label = "unnamed",
): Promise<Fixture> {
  if (running) {
    throw new Error(
      `A fixture server started by "${running}" is still running. Stop it before ` +
        `starting "${label}" -- Laut holds one config per process, so two servers ` +
        `would share it and the second would answer for the first.`,
    );
  }
  running = label;

  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = mode;

  // Imported after NODE_ENV is set: the page modules pull in the island
  // registry, which pulls in Widget.css, which the preloaded plugin records --
  // and `runtime/css.ts` decides link-vs-inline from isDev() at render time.
  const home = await import("./fixture/src/frontend/sea/pages/home/home.tsx");
  const bare = await import("./fixture/src/frontend/sea/pages/home/bare.tsx");
  const { page } = await import("../../src/render.tsx");
  const { route, notFound } = await import("../../src/runtime/api.ts");

  const server = createServer({
    App,
    root: FIXTURE_ROOT,
    // Port 0 asks the OS for a free one. A fixed port makes a test suite that
    // fails when you happen to have the dev server open.
    port: 0,
    site: { name: "Fixture", description: "site default description" },
    routes: {
      "/": page(home as any),
      "/bare": page(bare as any),
      "/api/ok": route(() => ({ ok: true })),
      "/api/missing": route(() => {
        throw notFound("widget");
      }),
      "/api/boom": route(() => {
        throw new Error("a detail that must stay server-side");
      }),
    },
    ...overrides,
  });

  const origin = server.url.origin;

  return {
    origin,
    get: (path, init) => fetch(new URL(path, origin), { redirect: "manual", ...init }),
    async stop() {
      await server.stop(true);
      if (previousEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnv;
      running = null;
    },
  };
}
