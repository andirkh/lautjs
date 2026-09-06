// Dev-only browser reload -- the half `bun --hot` doesn't do.
// LAUT-DEV-01, LAUT-DEV-02, LAUT-HEAD-19, LAUT-HEAD-20
//
// Assurance tier L-C in TESTING.md: dev-only, so a fault here never reaches a
// production user. Covered by smoke tests, not exhaustively -- the notes below
// are the ones no test carries.
import { watch } from "node:fs";

export const isDev = () => process.env.NODE_ENV !== "production";

/** A stylesheet swaps its <link> in place; anything else is a full reload. */
export type DevMessage =
  { kind: "css"; href: string } | { kind: "reload" } | { kind: "hello"; bootId: string };

/** Frontend trees, as URL prefixes -- exactly what the browser can ask for. */
const ROOTS = ["/src", "/public"];

// Root modules that shape every page: the route table and the wiring. They are
// not served to the browser, but changing one changes what a render produces,
// so the tab in front of you is stale until it asks again.
const ENTRIES = new Set(["routes.ts", "server.ts"]);

// Only extensions the browser actually fetches. An editor swapfile or a stray
// .md landing in src/ is not a reason to throw the page away.
const WATCHED = new Set(["tsx", "ts", "jsx", "js", "mjs", "json", "css"]);

// `bun --hot` re-evaluates this module whenever the server graph changes, which
// would orphan every open stream and start a second watcher. Bun's answer to
// that is globalThis, so the live state lives there and the module body stays
// free to re-run.
const state = ((globalThis as any).__lautDev ??= {
  clients: new Set<ReadableStreamDefaultController<Uint8Array>>(),
  // Identifies this *process*. `--hot` never changes it; a real restart does,
  // which is how a reconnecting page knows it is looking at stale HTML.
  bootId: Date.now().toString(36),
  watching: false,
}) as {
  clients: Set<ReadableStreamDefaultController<Uint8Array>>;
  bootId: string;
  watching: boolean;
  /** Set by watchFrontend; see serverReloaded() below. */
  flush?: () => void;
};

const encoder = new TextEncoder();
const frame = (msg: DevMessage) => encoder.encode(`data: ${JSON.stringify(msg)}\n\n`);

function broadcast(msg: DevMessage) {
  const bytes = frame(msg);
  for (const client of state.clients) {
    try {
      client.enqueue(bytes);
    } catch {
      state.clients.delete(client); // closed under us; the abort listener may not have run yet
    }
  }
}

/** Watch the frontend trees and push one message per save. Idempotent. */
export function watchFrontend(root: string, ignore: string[]) {
  if (state.watching) return;
  state.watching = true;

  let pending: DevMessage | null = null;
  let pendingKey = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Telling the browser to reload before `bun --hot` has finished swapping the
  // server's modules would hand it the old render. The timer below is the
  // fallback; serverReloaded() is the real signal, and usually beats it.
  const send = () => {
    if (!pending) return;
    clearTimeout(timer);
    const next = pending;
    pending = null;
    pendingKey = "";
    broadcast(next);
  };
  state.flush = send;

  const queue = (msg: DevMessage) => {
    // One save fires two or three fs events. Coalesce them -- and when a batch
    // touches more than one thing, fall back to a reload: swapping a stylesheet
    // while a changed module stays on the page is a lie.
    const key = msg.kind === "css" ? "css:" + msg.href : "reload";
    if (pending && pendingKey !== key) {
      pending = { kind: "reload" };
      pendingKey = "reload";
    } else {
      pending = msg;
      pendingKey = key;
    }

    clearTimeout(timer);
    timer = setTimeout(send, 60);
  };

  // Root entries, non-recursively: this directory holds node_modules and .git.
  watch(root, { recursive: false }, (_event, filename) => {
    if (filename && ENTRIES.has(filename.toString())) queue({ kind: "reload" });
  });

  for (const dir of ROOTS) {
    watch(root + dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      // The path the browser would use for this file -- which is also what the
      // <link> in the document says, so the css case can match on it directly.
      const href = `${dir}/${filename.toString().replaceAll("\\", "/")}`;
      if (!WATCHED.has(href.split(".").pop() ?? "")) return;
      // Server-only subtrees. They are never served, and `--hot` already swaps
      // them; a browser reload would show nothing new.
      if (ignore.some((prefix) => href.startsWith(prefix))) return;

      queue(href.endsWith(".css") ? { kind: "css", href } : { kind: "reload" });
    });
  }
}

/**
 * Called by createServer once the new module graph is live. `bun --hot` re-runs
 * the entry on every server-side change, so this is the moment a queued reload
 * becomes safe to send -- the browser will be answered by the new code.
 */
export function serverReloaded() {
  state.flush?.();
}

/** GET /__dev -- one long-lived SSE stream per open tab. LAUT-DEV-01 */
export function devEvents(req: Request): Response {
  let self: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      self = controller;
      state.clients.add(controller);
      controller.enqueue(
        encoder.encode(
          // A short retry keeps the reconnect after a restart feeling instant.
          `retry: 500\ndata: ${JSON.stringify({ kind: "hello", bootId: state.bootId })}\n\n`,
        ),
      );
      req.signal.addEventListener("abort", () => {
        state.clients.delete(controller);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      if (self) state.clients.delete(self);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      // Nothing here should ever be buffered by a proxy in front of dev.
      "x-accel-buffering": "no",
    },
  });
}

/** The listener, inlined into the sea by <DevReload/>. */
export const DEV_CLIENT = `
(() => {
  let boot = null;
  const path = (l) => new URL(l.href, location.href).pathname;
  new EventSource("/__dev").onmessage = (e) => {
    const msg = JSON.parse(e.data);

    if (msg.kind === "hello") {
      // Reconnected to a server that isn't the one that rendered this page.
      if (boot && boot !== msg.bootId) location.reload();
      boot = msg.bootId;
      return;
    }

    if (msg.kind === "css") {
      const links = [...document.querySelectorAll('link[rel="stylesheet"]')]
        .filter((l) => path(l) === msg.href);
      // No <link> for it yet -- a stylesheet that did not exist when this page
      // was rendered. Only a render puts one in <head>, so this needs the
      // round trip; the import that pulls it in is already live server-side.
      if (!links.length) return location.reload();
      // Swapping the href re-fetches the sheet without touching the DOM around
      // it, so island signal state survives a style tweak.
      for (const l of links) l.href = msg.href + "?v=" + Date.now();
      return;
    }

    location.reload();
  };
})();
`.trim();
