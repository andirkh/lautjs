import { h, hydrate } from "preact";

// Islands are hydrated on the schedule the sea asked for -- see `When` in
// Island.tsx. The markup is already on screen either way; all that moves is the
// module fetch and the hydrate() call, which is the expensive half.

// Islands waiting on the viewport. One observer for all of them: a page with
// twenty deferred islands should not pay for twenty observers.
const pending = new Set<HTMLElement>();

const seen =
  typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver(
        (entries, io) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            io.unobserve(e.target);
            pending.delete(e.target as HTMLElement);
            mount(e.target as HTMLElement);
          }
        },
        // Start a little before the reader arrives, so the island is already
        // interactive by the time it is looked at.
        { rootMargin: "200px" },
      );

/** Fetch the island's module and hydrate the server-rendered markup in place. */
function mount(el: HTMLElement) {
  const props = JSON.parse(el.dataset.props || "{}");
  // The wrapper carries its own module URL -- islands are plain ES modules,
  // transpiled on demand by the server.
  import(el.dataset.src!).then((mod) => {
    hydrate(h(mod.default, props), el);
  });
}

function schedule(el: HTMLElement) {
  switch (el.dataset.when) {
    case "visible":
      // No IntersectionObserver -- an old engine, or a test environment.
      // Hydrating now is the wrong trade-off, never the wrong result.
      if (!seen) return mount(el);
      pending.add(el);
      return seen.observe(el);

    case "idle":
      return "requestIdleCallback" in window
        ? void requestIdleCallback(() => mount(el))
        : void setTimeout(() => mount(el));

    case "media": {
      // A drawer that only exists below 60rem ships no JavaScript to a desktop
      // that will never open it -- until the window is resized, and then it does.
      if (!el.dataset.media) return mount(el);
      const mq = matchMedia(el.dataset.media);
      if (mq.matches) return mount(el);
      return mq.addEventListener("change", function once() {
        mq.removeEventListener("change", once);
        mount(el);
      });
    }

    default:
      return mount(el);
  }
}

/** Hydrate every island inside `root` that isn't hydrated yet. */
export function hydrateIslands(root: ParentNode = document) {
  // A navigation replaced <main>, and anything still waiting inside it is gone.
  // An IntersectionObserver holds its targets alive, so they have to be handed
  // back; a detached island never intersects and would wait forever.
  for (const el of pending) {
    if (el.isConnected) continue;
    pending.delete(el);
    seen?.unobserve(el);
  }

  for (const el of root.querySelectorAll<HTMLElement>("[data-island]")) {
    if (el.dataset.hydrated || !el.dataset.src) continue;
    // Claimed, not necessarily mounted: a deferred island is spoken for from
    // here on, so a second pass -- the router's, after a swap -- skips it.
    el.dataset.hydrated = "1";
    schedule(el);
  }
}
