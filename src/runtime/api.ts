// JSON plumbing for backend routes. LAUT-API-01..04
import { send } from "./respond.ts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (why: string) => new HttpError(400, why);
export const notFound = (what: string) => new HttpError(404, `${what} not found`);

const json = (req: Request, body: unknown, status = 200) =>
  send(req, JSON.stringify(body), { status, type: "application/json; charset=utf-8" });

/** Wrap a handler. LAUT-API-01, LAUT-API-02, LAUT-API-03 */
export function route<R extends Request>(handler: (req: R) => unknown) {
  return async (req: R) => {
    try {
      return json(req, await handler(req));
    } catch (err) {
      if (err instanceof HttpError) return json(req, { error: err.message }, err.status);
      console.error(err);
      return json(req, { error: "Internal error" }, 500);
    }
  };
}
