import { Island } from "../../../islands/islandRegistry.ts";

// A page module is: a default component, a `title`, and optionally `load`,
// `meta` and `layout`. Nothing is registered anywhere -- routes.ts imports it
// by name.
export const title = () => "Home";

/** What this page says about itself in a search result and in a link preview.
 *  Optional, and merged over `createServer({ site })` -- write the fields this
 *  page has an opinion about and leave the rest to the site defaults. */
export const meta = () => ({
  description:
    "A tour of Laut: server-rendered HTML with islands of interactivity, and no build step anywhere.",
});

export default function Home() {
  return (
    <>
      <h1>Home</h1>
      <p class="muted">
        Everything on this page is HTML except the two boxes below, which are islands.
      </p>
      <Island name="Counter" props={{ step: 1 }} />

      {/* Only here so the island underneath starts off screen. */}
      <div class="spacer" />

      {/* `when` decides when the browser fetches an island's module: "load"
          (the default), "idle", "visible", or "media" with a query. The markup
          is server-rendered in every case. Watch the network panel -- this
          module is not requested until you scroll. */}
      <Island name="Deferred" when="visible" />
    </>
  );
}
