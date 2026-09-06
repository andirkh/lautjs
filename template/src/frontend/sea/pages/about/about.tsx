import { Card } from "kinu";
import type { Params } from "lautjs/config.ts";

type Data = { now: string };

/** Server-side load, awaited before the render. The result is server-rendered
 *  into the sea, so the browser gets HTML instead of a fetch on mount. */
export const load = (_params: Params, _req: Request): Data => ({
  now: new Date().toISOString(),
});

export const title = () => "About";

/** Only the fields this page has an opinion about: everything else -- the
 *  site name, the share image, og:type -- comes from `createServer({ site })`. */
export const meta = () => ({
  description: "What Laut is, and what it deliberately leaves out.",
});

/** No interaction anywhere on this page, so it is served without the client
 *  runtime: no boot script, no preact, no import map -- HTML and CSS. Add an
 *  island here and dev will warn that it can never hydrate; drop this line and
 *  it works again. */
export const ZERO_JS = true;

// A page with no islands at all: the browser fetches no component code for it.
export default function About({ data }: { params: Params; data: Data }) {
  return (
    <>
      <h1>About</h1>
      <Card class="panel">
        <p>
          Rendered on the server at {data.now}. This page really does ship zero JavaScript -- view
          source, there is not a script tag on it.
        </p>
      </Card>
    </>
  );
}
