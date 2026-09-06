// Client-side navigation with the View Transition API.
//
// looks familiar with Turbo Drive, rebuilt around islands.
// Turbo intercepts same-origin link clicks, fetches the destination,
// swaps the body, merges the head and drives history itself; so does this, and
// the pieces that match are marked "like Turbo Drive" below. It parts company
// in exactly two places, both marked too: what gets swapped, which is the next
// paragraph, and whether the head merge waits for stylesheets -- Turbo does
// not, this does. See adoptStyles.
//
// Normal navigation swaps only <main>, so the sea around it -- the sidebar and
// the islands living there -- is never re-rendered and never flashes. A
// navigation that lands on a page with *different* chrome cannot do that, so it
// swaps the whole shell instead; the server decides which of the two you get.
//
// None of that depends on the browser having a view transition. The swap is one
// synchronous DOM write, made only once the response is already in hand: the
// page is never half-replaced, never blank, and never shows a spinner where the
// old page used to be. A view transition only cross-fades on top of that, and
// where there is none -- Firefox, Safari before 18 -- `transition` fades by
// hand, from content that is already painted. See "Navigation" in the README.
import { linkStylesheet } from "./css.ts";
import { hydrateIslands } from "./hydrate.ts";

const isBrowser = typeof document !== "undefined";

/** How the router is allowed to animate. Every field has a working default;
 *  pass the ones you want to change to `start()` or `configureRouter()`. */
export type RouterOptions = {
  /**
   * Use the platform's View Transition API where there is one. Off by default:
   * the two paths are meant to look identical, and the by-hand fade is the one
   * that behaves the same in every engine. Turn it on when you want named
   * transitions (`view-transition-name`) between pages, and check Safari.
   * The navigation itself does not depend on either path.
   */
  viewTransitions?: boolean;
  /** Duration of the by-hand fade, in ms. Match whatever your app.css gives
   *  `::view-transition-*`, so the two paths agree. `0` disables the fade. */
  fade?: number;
  /**
   * Opacity the by-hand fade starts from, 0..1. High enough that the new page
   * is legible from the first frame -- never 0, or you get a blank frame.
   */
  fadeFrom?: number;
  /**
   * Honour `prefers-reduced-motion: reduce` by skipping the fade entirely.
   * On by default; there is rarely a good reason to turn it off.
   */
  respectReducedMotion?: boolean;
};

const options: Required<RouterOptions> = {
  viewTransitions: false,
  fade: 120,
  fadeFrom: 0.55,
  respectReducedMotion: true,
};

/**
 * Adjust the router's animation to your app. Call it before `start()` -- from
 * your `boot.ts` -- or pass the same object straight to `start()`.
 *
 *   configureRouter({ viewTransitions: true, fade: 200 });
 */
export function configureRouter(next: RouterOptions = {}) {
  Object.assign(options, next);
}

/** What we keep on a history entry: where the page was scrolled to. */
type NavState = { scroll?: number };

// Which navigation is the current one. A slow response that lands after a newer
// click must not paint -- two swaps in a row is the flicker people mean when
// they say a router flickers.
let nav = 0;

// The page on screen, fragment ignored. Browsers fire popstate for fragment
// navigations too -- clicking an in-page anchor is one -- and refetching the
// page the reader is already standing on is a swap, and a cross-fade, for
// nothing.
let here = isBrowser ? location.pathname + location.search : "";

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Run `apply` inside a view transition, or the closest thing the browser has.
 *
 * `shell` says the chrome is being replaced too, which app.css needs to know:
 * <main> gets new geometry in that case, so it gives up its transition name and
 * the document cross-fades whole instead.
 */
async function transition(apply: () => void, shell = false) {
  const root = document.documentElement;
  if (shell) root.dataset.shellSwap = "1";
  try {
    if (options.viewTransitions && document.startViewTransition) {
      // A transition the browser skips -- because a newer one started, or
      // because the tab went to the background mid-way -- rejects here. The
      // callback has already run either way, so the page is where it should be
      // and there is nothing to report.
      await document.startViewTransition(apply).finished.catch(() => { });
      return;
    }
    // No view transition here. Cut straight to the new page -- one frame, no
    // in-between state to catch -- and then fade it in from *visible* rather
    // than from zero, so there is no blank frame either.
    apply();
    if (!options.fade || (options.respectReducedMotion && reduceMotion())) return;
    const el = shell ? document.querySelector(".shell") : document.querySelector("main");
    await el
      ?.animate({ opacity: [options.fadeFrom, 1] }, { duration: options.fade, easing: "linear" })
      .finished.catch(() => { }); // cancelled by the next navigation, not an error
  } finally {
    delete root.dataset.shellSwap;
  }
}

/** The chrome this document has, named by the page that rendered it. */
const currentLayout = () => document.querySelector(".shell")?.getAttribute("data-layout") ?? "";

/** Give up on the soft swap and let the browser do the navigation itself.
 *  Like Turbo Drive falling back to a full page visit on a non-HTML or failed
 *  response -- the browser's own error page beats a half-swapped one. */
function hard(url: string, push: boolean) {
  // On popstate the address bar has already moved, so there is nothing to
  // assign -- the entry just has to be loaded for real.
  if (push) location.assign(url);
  else location.reload();
}

/** Move the address bar, remembering where the page we are leaving was. */
function commit(url: string, push: boolean) {
  if (push) {
    history.replaceState(
      { ...(history.state as NavState), scroll: scrollY } satisfies NavState,
      "",
    );
    history.pushState({ scroll: 0 } satisfies NavState, "", url);
  }
  // On a popstate the address bar moved before we were told; either way this is
  // the page from now on.
  here = location.pathname + location.search;
}

/**
 * Where this navigation should leave the page, as something to call *inside*
 * the swap: scrolling after it is the jump that reads as a flicker, and inside
 * a view transition it is also what keeps both snapshots aligned.
 */
function scrollFor(url: string, push: boolean) {
  const hash = new URL(url, location.href).hash.slice(1);
  if (hash) return () => document.getElementById(hash)?.scrollIntoView();
  const y = push ? 0 : ((history.state as NavState | null)?.scroll ?? 0);
  return () => scrollTo(0, y);
}

/**
 * Link every stylesheet the fetched document has and this one does not, and
 * wait for them. Usually there are none: the server links every sheet its
 * module graph imported, so the document on screen already has them all. One
 * added while dev is running is the exception, and swapping before it loads
 * paints the new chrome unstyled.
 *
 * Like Turbo Drive's head merge :
 */
async function adoptStyles(doc: Document) {
  const links = [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
    .map((l) => linkStylesheet(new URL(l.getAttribute("href") ?? "", location.href).href))
    .filter((el): el is HTMLLinkElement => el !== null);

  await Promise.all(
    links.map((el) => new Promise<void>((done) => void (el.onload = el.onerror = () => done()))),
  );
}

/**
 * Replace the whole shell -- chrome included -- from a parsed document. Island
 * state survives: it lives in signal modules, not in the DOM.
 */
function replaceShell(doc: Document, next: Element, scroll: () => void) {
  // Only .shell is adopted: the <head> the server just sent is thrown away,
  // styles included, because adoptStyles has already taken anything from it
  // this document was missing.
  document.title = doc.title;
  document.querySelector(".shell")!.replaceWith(next);
  scroll();
  hydrateIslands(document);
}

// The Turbo Drive loop -- click, fetch, swap, push history -- with one
// departure: Turbo replaces the whole <body>, this replaces <main>. Turbo can
// afford the bigger swap because a Rails page has no client state to lose; a
// sidebar island here would be torn down and rebuilt on every navigation, and
// its signals with it. So the server decides how much to send (fragment or
// document) and this only ever swaps what it was given.
async function swapMain(url: string, push: boolean) {
  const mine = ++nav;
  const root = document.documentElement;
  // The old page stays on screen for the whole fetch, so this attribute is the
  // only sign a click landed. app.css hangs a cursor off it; a slow route can
  // hang a progress bar off the same hook.
  root.dataset.navigating = "1";

  let res: Response;
  let html: string;
  try {
    res = await fetch(url, {
      // What chrome is already on screen. The server sends the <main> fragment
      // when the target page agrees, and the whole document when it doesn't.
      headers: { "x-fragment": "1", "x-layout": currentLayout() },
    });
    html = await res.text();
  } catch {
    // Offline, or the server went away mid-flight. Better the browser's own
    // error page than the old one standing there with no explanation.
    return hard(url, push);
  }

  if (mine !== nav) return; // a newer navigation started while this was in flight
  delete root.dataset.navigating;

  // Not a page we can splice in -- a 404, a 500, anything that isn't HTML.
  // Hand it to the browser instead of painting an error string in the chrome.
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) {
    return hard(url, push);
  }

  // The target page uses a different layout, so <main> alone would leave the
  // wrong sidebar or topbar standing.
  if (res.headers.get("x-shell")) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const next = doc.querySelector(".shell");
    if (!next || !document.querySelector(".shell")) return hard(url, push);

    await adoptStyles(doc);
    if (mine !== nav) return;

    commit(url, push);
    const scroll = scrollFor(url, push);
    return transition(() => replaceShell(doc, next, scroll), true);
  }

  // A whole document where a fragment was expected: a proxy error page, or a
  // dev server that restarted. Not something to put inside <main>.
  if (/^\s*<!doctype/i.test(html)) return hard(url, push);

  commit(url, push);
  const scroll = scrollFor(url, push);
  const title = res.headers.get("x-title");

  await transition(() => {
    const main = document.querySelector("main")!;
    main.innerHTML = html;
    if (title) document.title = decodeURIComponent(title);
    scroll();
    hydrateIslands(main);
  });
}

/** Navigate without a full page load. Safe to call from islands. */
export function navigate(url: string, opts: { push?: boolean } = {}) {
  if (!isBrowser) return;
  return swapMain(url, opts.push ?? false);
}

/**
 * Re-render the whole shell (chrome + main) in place -- used when the locale
 * changes, because sea markup outside <main> needs re-translating too.
 */
export async function reload() {
  if (!isBrowser) return;
  const mine = ++nav;

  let doc: Document;
  try {
    const res = await fetch(location.href);
    if (!res.ok) throw new Error(String(res.status));
    doc = new DOMParser().parseFromString(await res.text(), "text/html");
  } catch {
    return location.reload();
  }

  const next = doc.querySelector(".shell");
  if (!next || !document.querySelector(".shell")) return location.reload();

  await adoptStyles(doc);
  if (mine !== nav) return; // a navigation started meanwhile -- it wins

  // Same page in another language: stay exactly where the reader was.
  const y = scrollY;
  await transition(() => replaceShell(doc, next, () => scrollTo(0, y)), true);
}

export function startRouter() {
  // These are not real navigations, so the browser cannot restore scroll for
  // them -- and left on "auto" it would restore *after* the swap, which is the
  // jump this is trying to avoid. The router does it instead, from
  // history.state, in the same frame as the swap. Turbo Drive takes scroll
  // manual for the same reason.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  // Link interception, like Turbo Drive's. The opt-outs are the same set Turbo
  // honours -- a modified click, a target, a download, another origin -- except
  // that they are read off the link the browser already gives us rather than
  // out of a `data-turbo="false"` attribute, so there is nothing to remember to
  // put on a link that should navigate normally.
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const a = (e.target as Element).closest?.("a");
    if (!a || a.target || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    // Same page, different anchor: the browser's own jump is instant and
    // correct. Refetching the page to land on it would be a swap for nothing.
    if (url.hash && url.pathname === location.pathname && url.search === location.search) return;
    e.preventDefault();
    if (url.href !== location.href) swapMain(url.href, true);
  });

  addEventListener("popstate", () => {
    // Same page, different fragment: the document is already right, and only
    // the scroll needs a hand -- the browser's own restoration is off.
    if (location.pathname + location.search === here) return void scrollFor(location.href, false)();
    swapMain(location.href, false);
  });

  // Reloading is a real navigation and scroll restoration is off, so the
  // position is written to the entry on the way out and put back on the way in.
  addEventListener("pagehide", () => {
    history.replaceState(
      { ...(history.state as NavState), scroll: scrollY } satisfies NavState,
      "",
    );
  });
  const y = (history.state as NavState | null)?.scroll;
  if (typeof y === "number") scrollTo(0, y);
}
