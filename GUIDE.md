# Building apps with Laut

This document is everything you need to write an app. However, for working on the framework itself, see [README.md](./README.md).

```bash
bun create lautjs my-app
cd my-app
bun install
bun dev                      # → http://localhost:3000
```

## Contents

- [Islands in one minute](#islands-in-one-minute) — the mental model
- [Directory layout](#directory-layout) — how a Laut app is composed
- [The five files that wire an app up](#the-five-files-that-wire-an-app-up)
- [Pages](#pages) · [Layouts](#layouts) · [Islands](#islands) — including [`ZERO_JS`](#zero_js--a-page-with-no-runtime-at-all)
- [The document head](#the-document-head) — titles, SEO and social cards
- [Styling](#styling) · [State](#state) · [Backend and API routes](#backend-and-api-routes)
- [Navigation](#navigation) · [Localization](#localization-optional)
- [Configuration](#configuration) — every knob
- [Do and don't](#do-and-dont) — read this one
- [Deploying](#deploying)

## Islands in one minute

What is MPA, SPA, and Islands?

**MPA:** the server sends HTML, the browser throws the whole page away on every click, and interactivity is bolted on with script tags. Fast first paint, sad interactions.

**SPA:** the server sends an empty `<div id="root">`, then a megabyte of JavaScript rebuilds the page the server could have written in the first place. Great interactions, and a loading spinner for a page of static text.

**Islands:** the server writes the whole page as HTML (_sea_) and then they drop a few interactive components (_islands_). Only islands ship JavaScript.

```
┌──────────────────────────────────────────┐
│  sea  — server-rendered HTML, 0 KB of JS │
│                                          │
│   ┌────────────┐        ┌─────────────┐  │
│   │ 🏝 island   │        │ 🏝 island    │  │
│   │  hydrated  │        │  hydrated   │  │
│   └────────────┘        └─────────────┘  │
│                                          │
│  more sea, still 0 KB of JS              │
└──────────────────────────────────────────┘
```

The mental flip: **interactivity is not the default.** Every component is plain HTML. only write interactive part as an island.

## Directory layout

Laut cares about exactly four paths. Everything else is yours.

```
my-app/
├── bunfig.toml            ← REQUIRED: preloads the .css loader
├── package.json
├── tsconfig.json
├── server.ts              ← createServer({ … }) — the only wiring file
├── routes.ts              ← the route table
├── public/                ← served verbatim at /public/*
│   └── app.css
└── src/
    ├── App.tsx            ← your document root
    ├── locales/           ← optional: en.json, id.json … (see Localization)
    ├── backend/           ← PRIVATE. never served to the browser
    │   └── <domain>/
    │       ├── routes.ts
    │       ├── service.ts
    │       └── repo.ts
    └── frontend/          ← served at /src/frontend/* , transpiled on demand
        ├── boot.ts        ← the one <script type="module"> the sea loads
        ├── core/          ← shared, non-island code
        │   ├── components/    reusable sea components (no JS shipped)
        │   └── state/         signal modules shared between islands
        ├── islands/       ← interactive components, one folder each
        │   ├── islandRegistry.ts
        │   └── <Name>/
        │       ├── <Name>.tsx
        │       └── <Name>.css
        └── sea/           ← everything that renders as plain HTML
            ├── Document.tsx
            ├── layouts/
            │   ├── layoutRegistry.ts
            │   └── <Name>/<Name>.tsx
            └── pages/
                └── <name>/<name>.tsx
```

The rules behind that shape:

- **`/src` is the browser's module graph.** Anything under it can be fetched and transpiled on demand, which is what replaces the build step.
- **`/src/backend` is the exception** — Laut refuses to serve it. Queries, secrets and server-only imports live there and nowhere else. (Change the list with `private: [...]` if you need more private subtrees.)
- **One folder per island**, holding the component, its stylesheet, and any sub-component only it uses.
- **`sea/` is the zero-JS half.** If a component under `sea/` needs an event handler, it is an island and belongs in `islands/`.

## The five files that wire an app up

### `bunfig.toml`

```toml
preload = ["lautjs/preload.ts"]
```

This installs the `.css` loader that makes `import "./Foo.css"` work on the server. A plugin registered from an ordinary import lands too late — the module graph it should intercept is already resolved — so it has to be preloaded.
**Delete this line and every stylesheet import becomes a runtime error.**

### `server.ts`

```ts
import { createServer } from "lautjs";
import { routes } from "./routes.ts";
import { App } from "./src/App.tsx";

const server = createServer({
  App,
  routes,
  port: 3000,
  site: { name: "Acme", url: "https://acme.com" }, // <head> defaults
});
console.log(`→ ${server.url}`);
```

### `routes.ts`

```ts
import { page } from "lautjs";
import { userRoutes } from "./src/backend/users/routes.ts";
import * as about from "./src/frontend/sea/pages/about/about.tsx";
import * as home from "./src/frontend/sea/pages/home/home.tsx";
import * as user from "./src/frontend/sea/pages/user/user.tsx";

export const routes = {
  "/": page(home),
  "/about": page(about),
  "/users/:id": page(user),

  ...userRoutes,

  "/api/ping": { GET: () => Response.json({ ok: true }) },
};
```

Routing is explicit, not file-based. Adding a page is one import and one line; in exchange, the route table is a thing you can read top to bottom.

### `src/App.tsx`

```tsx
import type { AppProps } from "lautjs/config.ts";
import { Document } from "./frontend/sea/Document.tsx";
import { pickLayout } from "./frontend/sea/layouts/layoutRegistry.ts";

export function App({ Body, params, data, path, layout, head }: AppProps) {
  const Layout = pickLayout(layout);
  return (
    <Document head={head} layout={layout}>
      <Layout path={path}>
        <Body params={params} data={data} />
      </Layout>
    </Document>
  );
}
```

`layout` is a name your app maps to a component. `head` is the opposite: title,
language, SEO and the `ZERO_JS` flag, all resolved by Laut — see
[The document head](#the-document-head).

### `src/frontend/sea/Document.tsx`

`<Head>` **is** the `<head>`: it renders the element and everything in it — the
charset, the SEO and social tags, the stylesheet links, the inlined sheets, the
import map, the module preloads, the boot script and the dev socket, in the
order they have to be in:

```tsx
import { Head, type HeadData } from "lautjs";

export function Document({ head, layout, children }) {
  return (
    <html lang={head.lang}>
      <Head {...head}>
        <link rel="icon" href="/public/favicon.ico" />
      </Head>
      <body>
        {/* the router replaces exactly this element when a navigation changes layout */}
        <div class="shell" data-layout={layout || undefined}>
          {children}
        </div>
      </body>
    </html>
  );
}
```

What is left is the part that is about your app:

| Prop           | What it is                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `{...head}`    | The `HeadData` Laut resolved for this render. Spread it; there is nothing to pick apart.                                         |
| `children`     | Anything else you want in every document: icons, fonts, analytics. Rendered last.                                                |
| `styles`       | **Extra** app-wide sheets, after the two defaults and **before** the component sheets — so a component can still override them.  |
| `noDefaultCSS` | Link neither default sheet. For an app that has dropped kinu, or that keeps its document CSS elsewhere and names it in `styles`. |
| `boot`         | Your client entry. Defaults to `/src/frontend/boot.ts`.                                                                          |

Two sheets are linked for you, because every Laut app links them: kinu's
(`/vendor/kinu/style.css`) and `/public/app.css`. They come first, so anything a
component imports can override them.

The import map, the preloads and the boot script are inside `{!ZERO_JS && ( … )}`
within `<Head>`, which is how [`export const ZERO_JS = true`](#zero_js--a-page-with-no-runtime-at-all)
gets a page served without a runtime. `<DevReload/>` sits outside that block on
purpose: it is the reload socket, not the app runtime, so a landing page still
hot-reloads while you build it.

### `src/frontend/boot.ts`

```ts
import { start } from "lautjs/client";

start();
```

## Pages

A page is a module with a default component and a `title`. Nothing is registered; `routes.ts` imports it by name.

```tsx
import type { Params } from "lautjs/config.ts";

type Data = { user: { name: string } };

/** Optional. Awaited before the render, so the result is server-rendered into
 *  the sea and the browser gets HTML instead of a fetch on mount. */
export const load = async (params: Params, req: Request): Promise<Data> => ({
  user: await findUser(params.id!),
});

export const title = (params: Params, data: Data) => data.user.name;

/** Optional. What a search result and a link preview say about this page.
 *  Merged over `createServer({ site })` — see The document head. */
export const meta = (params: Params, data: Data) => ({
  description: data.user.bio,
  image: data.user.avatar,
});

/** Optional. The chrome this page wants, by name. Omit it for the default. */
export const layout = "promo";

export default function User({ params, data }: { params: Params; data: Data }) {
  return <h1>{data.user.name}</h1>;
}
```

### `ZERO_JS` — a page with no runtime at all

A page with no interaction anywhere for a landing page arriving from an ad or a search result. Good for social media link & marketing page purpose.

```tsx
export const ZERO_JS = true;
```

The document is then served as HTML and CSS: no boot script, no module preloads, no import map. Stylesheets are untouched, and so is `<DevReload/>` — a landing page still hot-reloads while you build it.

Two things to know:

- **It's cold load.** Reaching the page through the client router
  leaves the runtime that is already running alone; leaving the page is a real
  browser navigation, which is what an `<a href>` does.
- **No islands, including the layout's.** An island on a `ZERO_JS` page is
  server-rendered markup that never hydrates.

## Layouts

A layout is the chrome around a page. Pages ask for one by name; mapping names to components is your app's business, so the map lives in your code.

```ts
// src/frontend/sea/layouts/layoutRegistry.ts
const layouts = {
  app: AppLayout, // the default
  bare: BareLayout,
} satisfies Record<string, ComponentType<LayoutProps>>;
```

**Every layout must render exactly one `<main>`.** That is the element the router swaps on a same-layout navigation. When a navigation crosses _between_ layouts, the server sends the whole document instead and the router replaces `.shell` — so island state outside `<main>` survives one case and not the other.

## Islands

An island is a plain Preact component with a default export, living in its own folder, listed in one registry.

```tsx
// src/frontend/islands/Counter/Counter.tsx
import { Button } from "kinu";
import { count, inc } from "../../core/state/counter.ts";
import "./Counter.css";

export default function Counter({ step = 1 }: { step?: number }) {
  return <Button onClick={() => inc(step)}>Value: {count}</Button>;
}
```

```ts
// src/frontend/islands/islandRegistry.ts
import { createIsland } from "lautjs";
import Counter from "./Counter/Counter.tsx";

export const registry = { Counter } satisfies Record<string, ComponentType<any>>;
export const Island = createIsland(registry);
```

Place one from anywhere in the sea. `name` is typed against the registry, so a typo fails in the editor:

```tsx
<Island name="Counter" props={{ step: 1 }} />
```

Props must be JSON-serialisable — they cross to the browser as an attribute. The wrapper Laut renders carries its own module URL, so the client never has to guess a layout and no manifest is needed.

`createIsland(registry, dir)` takes a second argument if your islands do not
live at `/src/frontend/islands`.

### TIMING when an island hydrates

By default an island hydrates as soon as the runtime starts. `when` moves that later — and only that. **The markup is server-rendered in every case**; what waits is the module fetch and the `hydrate()` call, which is the expensive half.

```tsx
<Island name="Counter" props={{ step: 1 }} />          {/* load — the default */}
<Island name="Comments" when="idle" />                 {/* the main thread is free */}
<Island name="Deferred" when="visible" />              {/* about to scroll into view */}
<Island name="MobileNav" when="media" media="(max-width: 60rem)" />
```

| `when`    | Hydrates when                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `load`    | The runtime starts. The default, and the right answer above the fold.                                                                            |
| `idle`    | `requestIdleCallback` fires, once the page has settled. Falls back to a `setTimeout` where there is none.                                        |
| `visible` | An `IntersectionObserver` says the island is within 200px of the viewport. One observer serves every island on the page.                         |
| `media`   | `media`'s query matches — now, or later when the window is resized. A drawer that only exists on small screens ships no JavaScript to a desktop. |

- Instant Load: If an island with when="visible" is near the top of the page (above the fold), it loads immediately on the first frame—just like using when="load". It is safe to use as your default strategy.

- No Unstyled Flash: CSS styles are server-rendered and linked right away, so the component never looks broken or unstyled while loading.

- Shared State Works Immediately: Shared state (like a global count) stays consistent across your app, even before the island finishes hydrating.

- Avoid Layout Shifts: Because the island is visible immediately, make sure the server-rendered HTML matches the final hydrated size. For example, render a disabled button on the server rather than hiding the button completely until JavaScript loads.

---

## The document head

**Site-wide** — the fallbacks in `server.ts`:

```ts
createServer({
  App,
  routes,
  site: {
    name: "Apple",
    url: "https://apple.com", // canonical origin
    description: "The fallback description.",
    image: "/public/og.png", // fallback share image
    twitter: "@apple",
    // titleTemplate: "%s · Acme",   // the default when `name` is set
  },
});
```

**Per page** — page/x.tsx:

```tsx
export const title = (params: Params, data: Data) => data.post.title;

export const meta = (params: Params, data: Data) => ({
  description: data.post.summary,
  image: data.post.cover,
  type: "article",
});
```

| `meta` field  | Goes to                                                    |
| ------------- | ---------------------------------------------------------- |
| `description` | `<meta name="description">`, `og:description`              |
| `image`       | `og:image`, `twitter:image` — made absolute for you        |
| `imageAlt`    | `og:image:alt`                                             |
| `robots`      | `<meta name="robots">` — omitted entirely when unset       |
| `canonical`   | `<link rel="canonical">`, `og:url` — defaults to this path |
| `type`        | `og:type` — `"website"` unless you say otherwise           |

---

## Styling

Global Styles `(public/app.css)`: Handles the main page setup, reset, and shared styles. It links automatically in `<Head>` unless you turn it off with noDefaultCSS.

Component Styles: Import CSS directly inside component files (e.g., import "./Counter.css"). Laut tracks all imported sheets across the app and links them in `<head>`. Since every imported sheet stays loaded in memory, swapping page sections works smoothly without missing styles.

Layout Styles: Scoped to specific layouts using data attributes, like .shell `[data-layout="bare"] { … }`.

**Island CSS is scoped by convention, not by a compiler.** Start every selector at the wrapper Laut already stamps, so nothing reaches another island or leaks into the sea, and your class names survive to the network tab unhashed.

```css
[data-island="Counter"] .row {
  gap: 10px;
}
```

`import styles from "./x.css"` stops with an error when you build the code. Laut has no bundler to support CSS modules, so it stops early to show you where the error is

### Small sheets are inlined, not linked

Laut puts small CSS files directly into a single <style> tag to keep your site fast:

The problem, linking many small CSS files forces the browser to make a round trip for every single file before it can display the page. Even with caching, these extra requests cause visible delay.

so the solution, in production, Laut combines every CSS file smaller than 4 KB (4,096 bytes) directly into one `<style>` tag in the HTML.

and the for the result, The browser receives the styles instantly with the initial HTML, completely skipping extra network requests for small stylesheets. Only files larger than 4 KB are linked separately.

```tsx
{
  stylesheets().map((href) => <link key={href} rel="stylesheet" href={href} />);
}
{
  inlined && <style dangerouslySetInnerHTML={{ __html: inlined }} />;
}
```

In production, tiny CSS files merge into the HTML page instead of loading as extra web requests.

Better Speed: Loading 40 small CSS files as 1 inline `<style>` block reduces page load delays. Compression keeps the extra HTML size small.

Smart Split: Large CSS files stay as separate links so browsers can save them in cache across pages. You can set cssInlineStylesheet: 0 to disable inlining.

Dev Mode Perks: In development, CSS files stay as separate links so live updates can swap styles without resetting page state.

Warning for Custom Headers: Custom `<head>` tags must render both `inlineStyles()` and `stylesheets()`. Laut alerts you if inline styles are missing in production.

Two hooks the router gives your CSS for free:

```css
[data-navigating] {
  cursor: progress;
} /* a click landed, response in flight */
```

---

## State

Shared state is a module that exports signals.

```ts
// src/frontend/core/state/counter.ts
import { computed, signal } from "@preact/signals";

export const count = signal(0);
export const doubled = computed(() => count.value * 2);
export const inc = (by = 1) => (count.value += by);
```

When two or more islands importing this, they see the same value without knowing about each other. State survives client-side navigation, because it lives in the module graph, not in the DOM.

---

## Backend and API routes

Everything under `src/backend/` is PRIVATE.

```ts
// src/backend/users/routes.ts
import { notFound, route } from "lautjs";
import { findUser } from "./service.ts";

export const userRoutes = {
  "/api/users/:id": {
    GET: route(async (req: Bun.BunRequest<"/api/users/:id">) => {
      const user = await findUser(req.params.id);
      if (!user) throw notFound("user");
      return user; // serialised to JSON
    }),
  },
};
```

---

## Navigation

Clicks on same-origin links are intercepted. The old page stays on screen for the whole fetch (no spinner, no blank frame) and the swap is one synchronous DOM write once the response is in hand.

```ts
import { navigate, reload } from "lautjs/client";

navigate("/about", { push: true }); // safe to call from an island
reload(); // re-render the whole shell in place
```

Tune the animation from your `boot.ts`:

```ts
import { start } from "lautjs/client";

start({
  viewTransitions: false, // use the View Transition API where available
  fade: 120, // ms for the by-hand fade; 0 disables it
  fadeFrom: 0.55, // opacity it starts from — never 0
  respectReducedMotion: true, // honour prefers-reduced-motion
});
```

`viewTransitions` is **off** by default (Safari is having ghosts issue unless you set up `mix-blend-mode: plus-lighter`). Turn it on when you want named transitions between pages — and check Safari.

---

## Localization (optional)

Laut ships an isomorphic translation that holds no tables of its own. You install yours, so the backend and the frontend end up with the same dictionaries and share a single locale signal.

The whole feature is five short files. Here it is end to end.

### 1. Locale tables

Plain JSON, under `/src` so the browser can fetch it. `{name}` is a placeholder.

```jsonc
// src/locales/en.json
{
  "nav.home": "Home",
  "nav.about": "About",
  "greeting": "Hello, {name}!",
  "counter.value": "Value: {n}",
  "lang.label": "Language",
}
```

```jsonc
// src/locales/id.json
{
  "nav.home": "Beranda",
  "nav.about": "Tentang",
  "greeting": "Halo, {name}!",
  "counter.value": "Nilai: {n}",
  "lang.label": "Bahasa",
}
```

### 2. Your i18n module

```ts
// src/frontend/core/i18n.ts
import { configureLocales, isLocale as isKnown, locale, t } from "lautjs/i18n";
import en from "../../locales/en.json";
import id from "../../locales/id.json";

export const LOCALES = ["en", "id"] as const;
export type Locale = (typeof LOCALES)[number];

configureLocales({ en, id }, "en"); // tables + fallback locale

export { locale, t };
export const isLocale = (v: unknown): v is Locale => isKnown(v);

const known = (v: string | null | undefined): Locale | null => (isLocale(v) ? v : null);

/** How a request picks a language: ?lang= wins, then the cookie, then the header. */
export function documentLocale(req: Request) {
  const query = new URL(req.url).searchParams.get("lang");
  const cookie = req.headers.get("cookie")?.match(/(?:^|;\s*)lang=([^;]+)/)?.[1];
  const header = req.headers.get("accept-language") ?? "";
  const lang = known(query) ?? known(cookie) ?? LOCALES.find((l) => header.includes(l)) ?? "en";

  // A ?lang= visit is a deliberate choice: remember it.
  return query
    ? { lang, headers: { "set-cookie": `lang=${lang};path=/;max-age=31536000` } }
    : { lang };
}
```

### 3. Wire it into the server

```ts
// server.ts
import { createServer } from "lautjs";
import { documentLocale, locale } from "./src/frontend/core/i18n.ts";

createServer({
  App,
  routes,
  locale: documentLocale,
  beforeRender: (lang) => {
    locale.value = lang; // set before every render; nothing awaits after this
  },
});
```

### 4. Adopt the language in the browser

```ts
// src/frontend/boot.ts
import { start } from "lautjs/client";
import { isLocale, locale } from "./core/i18n.ts";

const lang = document.documentElement.lang;
if (isLocale(lang)) locale.value = lang;

start();
```

### 5. Use `t()` — same call in the sea and in islands

```tsx
import { t } from "../../core/i18n.ts";

<h1>{t("greeting", { name: "Laut" })}</h1>       // → "Halo, Laut!"
<a href="/about">{t("nav.about")}</a>
```

A value may be a **signal**, and stringifying one subscribes the island to it — so this line re-renders on every increment _and_ on every language change:

```tsx
<p>{t("counter.value", { n: count })}</p> // → "Nilai: 3"
```

A missing key falls back to the default locale, then to the key itself. Nothing throws.

### 6. A language switcher

Switching language is an island, because it takes a click:

```tsx
// src/frontend/islands/LangSwitcher/LangSwitcher.tsx
import { Button } from "kinu";
import { reload } from "lautjs/client";
import { LOCALES, locale, t, type Locale } from "../../core/i18n.ts";

export default function LangSwitcher() {
  const pick = (l: Locale) => {
    locale.value = l; // islands re-render now
    document.cookie = `lang=${l};path=/;max-age=31536000`;
    document.documentElement.lang = l;
    reload(); // re-render the sea too
  };

  return (
    <div class="row">
      <span class="muted">{t("lang.label")}</span>
      {LOCALES.map((l) => (
        <Button
          key={l}
          size="sm"
          variant={locale.value === l ? null : "outline"}
          onClick={() => pick(l)}
        >
          {l.toUpperCase()}
        </Button>
      ))}
    </div>
  );
}
```

Register it like any island, then place it in your layout:

```tsx
<Island name="LangSwitcher" />
```

**Why `reload()`?** `t()` reads the `locale` signal, so islands re-translate the instant it changes. However the sea is HTML with no JS lifecycle, so its text cannot re-translate itself. `reload()` re-renders the whole shell from the server in the new language, in place. Island state survives it: signals live in the module graph, not in the DOM.

Without a switcher you need none of this, `?lang=id` and the cookie already work server-side on their own.

---

## Configuration

### `createServer(config)`

| Field                 | Default             | What it does                                                                                     |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `App`                 | —                   | **Required.** Your document root.                                                                |
| `routes`              | —                   | **Required.** Your route table; Laut's own routes go underneath.                                 |
| `site`                | `{}`                | Name, canonical origin and `<head>` fallbacks — see [The document head](#the-document-head).     |
| `port`                | `3000`              | Port to listen on.                                                                               |
| `root`                | `process.cwd()`     | Project root; sources are read relative to it.                                                   |
| `vendor`              | `{}`                | Extra bare specifier → file in `node_modules`, merged over Laut's.                               |
| `private`             | `["/src/backend/"]` | URL prefixes under `/src` that are never served.                                                 |
| `compressMin`         | `1024`              | Compress response bodies at or above this many bytes.                                            |
| `cssInlineStylesheet` | `4096`              | Paste stylesheets below this many bytes into the document instead of linking them. `0` disables. |
| `locale`              | —                   | `(req) => { lang, headers? }` — per-request document language.                                   |
| `beforeRender`        | —                   | Runs synchronously before the render; set your signals here.                                     |

**Adding a dependency your islands import** means adding it to `vendor`, so the
import map can point the browser at a real file:

```ts
vendor: { "date-fns": "date-fns/index.js" }
```

`preact`, `preact/hooks`, `preact/jsx-runtime`, `@preact/signals` and `kinu` are already there.

### `start(options)` / `configureRouter(options)`

See [Navigation](#navigation).

---

## Do and don't

**Do**

- Put every interactive component in `islands/`, one folder each.
- Co-locate a component's CSS and import it with a **side-effect** import.
- Scope island CSS under `[data-island="Name"]`.
- Keep server-only code — queries, secrets, SDK clients — under `src/backend/`.
- Share state through signal modules in `core/state/`, not through props drilled
  across islands.
- Render exactly one `<main>` per layout, inside the `.shell` wrapper.
- Load page data in `load()` so it is server-rendered, not fetched on mount.
- Add every new bare specifier to `vendor`.
- Set `site.url` in production, or every canonical tag points at whatever host
  the request happened to arrive on.
- Keep locale JSON under `/src` and call `configureLocales` from one module both
  halves import — two modules means two dictionaries.

**Don't**

- Don't import `lautjs` (bare) from browser code — it is server-only, and the
  import map deliberately does not map it. Use `lautjs/client`.
- Don't import anything from `src/backend/` into a frontend component. It will
  typecheck and then 404 in the browser.
- Don't `import styles from "./x.css"` — it is rejected. There are no CSS
  modules.
- Don't pass non-serialisable props to `<Island>`; they cross as JSON.
- Don't expect the sea to re-translate itself after a language change — it is
  HTML. Call `reload()`.
- Don't delete the `preload` line from `bunfig.toml`.
- Don't reach for a bundler, a `dist/`, or a codegen step. If something seems to
  need one, it probably wants to be plain source instead.
- Don't expect file-based routing, nested routes, or streaming SSR 😜

---

## Deploying

There is no build. THIS IS BY DESIGN. Just ship the source, install, run:

```bash
bun install --production
NODE_ENV=production bun server.ts
```

`NODE_ENV=production` turns off the file watcher, the `/__dev` route and
`<DevReload/>` entirely, and switches `/public/*` to immutable caching. Transpiled sources are cached in memory per file and revalidated by mtime, so the first request for a module pays for it and nothing after that does.

---

## Where to next

- [README.md](./README.md) — if you work on the framework itself
