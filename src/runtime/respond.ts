// LAUT-RESP-01..12
import { isDev } from "./dev.ts";

// LAUT-RESP-09
let minSize = 1024;

/** Set by createServer() from `config.compressMin`. */
export const configureCompression = (min: number) => void (minSize = min);

const encoder = new TextEncoder();

// TS models Buffer / TextEncoder output as ArrayBufferLike-backed, which both
// Response and Bun.gzipSync reject. One cast, in one place.
const bytesOf = (b: string | Uint8Array) =>
  (typeof b === "string" ? encoder.encode(b) : b) as Uint8Array<ArrayBuffer>;

function pickEncoding(req: Request): "zstd" | "gzip" | null {
  const accept = req.headers.get("accept-encoding") ?? "";
  if (accept.includes("zstd")) return "zstd";
  if (accept.includes("gzip")) return "gzip";
  return null;
}

/** Build a Response, compressing the body when the client supports it.
 *  LAUT-RESP-06, LAUT-RESP-07, LAUT-RESP-08, LAUT-RESP-09, LAUT-RESP-10 */
export function send(
  req: Request,
  body: string | Uint8Array,
  init: ResponseInit & { type?: string } = {},
): Response {
  const { type = "text/html; charset=utf-8", headers, ...rest } = init;
  const h = new Headers(headers);
  h.set("content-type", type);
  h.set("vary", "accept-encoding");

  let bytes = bytesOf(body);
  const enc = bytes.byteLength >= minSize ? pickEncoding(req) : null;

  if (enc === "gzip") bytes = bytesOf(Bun.gzipSync(bytes));
  else if (enc === "zstd") bytes = bytesOf(Bun.zstdCompressSync(bytes));
  if (enc) h.set("content-encoding", enc);

  return new Response(bytes, { ...rest, headers: h });
}

/** Same, for files on disk (vendor + public assets). */
export async function sendFile(req: Request, path: string, type?: string) {
  const file = Bun.file(path);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });

  const body = () => file.arrayBuffer().then((b) => new Uint8Array(b));
  const mime = type ?? file.type;

  // LAUT-RESP-11, LAUT-RESP-12
  if (isDev()) {
    const etag = await etagFor(path);
    const headers = { "cache-control": "no-cache", ...(etag && { etag }) };
    if (etag && req.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    return send(req, await body(), { type: mime, headers });
  }

  return send(req, await body(), {
    type: mime,
    headers: { "cache-control": "public, max-age=31536000, immutable" },
  });
}

/** Weak validator for a file on disk. LAUT-RESP-01, LAUT-RESP-04, LAUT-RESP-05 */
export async function etagFor(path: string): Promise<string | null> {
  const stat = await Bun.file(path)
    .stat()
    .catch(() => null);
  return stat && `W/"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
}
