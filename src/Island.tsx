import type { ComponentType } from "preact";

/**
 * When the browser should fetch an island's module and hydrate it. The markup
 * is server-rendered in every case -- this only moves the JavaScript.
 *
 * - `load`    hydrate as soon as the runtime starts. The default.
 * - `idle`    hydrate when the main thread is next free.
 * - `visible` hydrate just before the island scrolls into view.
 * - `media`   hydrate when a media query matches, now or later.
 */
export type When = "load" | "idle" | "visible" | "media";

/**
 * Bind a registry of components to an `<Island>`. The app owns the registry, so
 * the framework never imports it. LAUT-ARCH-01
 *
 *   export const Island = createIsland(registry);
 */
export function createIsland<R extends Record<string, ComponentType<any>>>(
  registry: R,
  dir = "/src/frontend/islands",
) {
  return function Island<N extends keyof R & string>({
    name,
    props = {},
    when = "load",
    media,
  }: {
    name: N;
    props?: Record<string, unknown>;
    /** Hydration strategy. See `When`. */
    when?: When;
    /** The query to wait on, e.g. `"(max-width: 60rem)"`. Required by
     *  `when="media"`, ignored by every other strategy. */
    media?: string;
  }) {
    const Component = registry[name] as ComponentType<any>;
    // One folder per island. LAUT-HEAD-05
    const src = `${dir}/${name}/${name}.tsx`;

    // `load` is the default, so it is the absence of an attribute.
    return (
      <>
        {/* LAUT-BUDGET-03 */}
        {when === "load" && <link rel="modulepreload" href={src} />}
        <div
          data-island={name}
          data-src={src}
          data-props={JSON.stringify(props)}
          data-when={when === "load" ? undefined : when}
          data-media={media}
        >
          <Component {...props} />
        </div>
      </>
    );
  };
}
