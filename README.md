# LautJS

is a small & compact _islands architecture meta-framework_ for **Bun**, with **NO BUILD STEP AT ALL**. Built-in [Preact](https://preactjs.com/) + signals, [kinu](https://github.com/developit/kinu) UI, JSX, native ES modules and browser's import map.

**This is not a guide for building an app with LautJS. if you need it, see → [GUIDE.md](./GUIDE.md)**

## What Laut gives an app

|                    |                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| **Runtime**        | Bun 1.4 — one process, `Bun.serve`, `Bun.Transpiler`                                                     |
| **UI**             | Preact 10 + `@preact/signals`                                                                            |
| **Components**     | [kinu](https://github.com/developit/kinu) — wired up out of the box                                      |
| **Rendering Type** | Server-rendered HTML, islands hydrated on the client — on load, on idle, on visible, or on a media query |
| **Routing**        | An explicit route table + a client router that swaps `<main>`                                            |
| **Styling**        | Plain CSS, co-located with components, linked automatically                                              |
| **i18n**           | Optional, built in — JSON tables, one signal, works in sea and islands                                   |
| **Build**          | None. No bundler, no `dist/`, no manifest, no codegen                                                    |

The idea is: **server side MPA — in _sea_ —and modular CSR _islands_.**
[The full explanation is in the guide.](./GUIDE.md#islands-in-one-minute)

## Repo Map

```
laut/
├── src/              the framework — this is what ships, as `lautjs`
├── template/         the starter app `bun run scaffold` copies
├── create/           `create-lautjs` — what `bun create lautjs my-app` runs
├── scripts/          scaffold / sync-create / link / unlink — dev tooling, not published
├── GUIDE.md          how to build an app with Laut
└── README.md         you are here
```

### `src/` (framework)

| File                   | What is it?                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `index.ts`             | The server-side public surface. Everything an app imports from `lautjs`.                                         |
| `config.ts`            | The `Config` / `AppProps` contract, and the one module-level slot holding it.                                    |
| `server.ts`            | `createServer()` — the Bun routes: app source, `/lautjs/*`, `/vendor/*`, `/public/*`, `/__dev`.                  |
| `render.tsx`           | `page()` / `renderPage()` — full document vs. `<main>` fragment vs. shell swap.                                  |
| `Island.tsx`           | `createIsland(registry)` — stamps the `data-island` wrapper carrying its own module URL and its `when` strategy. |
| `Head.tsx`             | `<Head>` — _is_ the `<head>`: SEO and social tags, stylesheets, import map, preloads, boot script, dev socket.   |
| `DevReload.tsx`        | The dev script tag. Renders `null` in production.                                                                |
| `preload.ts`           | What `bunfig.toml` preloads: installs the `.css` loader.                                                         |
| `css.d.ts`             | Ambient `*.css` module, so `import "./Foo.css"` typechecks.                                                      |
| `runtime/transpile.ts` | Per-request `.tsx` → ESM, cached by mtime. Rewrites CSS imports.                                                 |
| `runtime/vendor.ts`    | Bare specifier → `node_modules` file, and the import map.                                                        |
| `runtime/css.ts`       | The Bun plugin that records which stylesheets the graph imported.                                                |
| `runtime/respond.ts`   | Compression, eTags, `304`s, file serving.                                                                        |
| `runtime/dev.ts`       | The file watcher and the `/__dev` SSE stream.                                                                    |
| `runtime/api.ts`       | `route()`, `HttpError` — the JSON endpoint plumbing.                                                             |
| `client/*`             | The browser half: `boot`, `hydrate` (island scheduling), `nav` (router), `css`. Served at `/lautjs/*`.           |
| `i18n/index.ts`        | The isomorphic translation engine. Holds no tables of its own.                                                   |

## Developing

```bash
bun install
bun run check      # tsc --noEmit over src/
bun run format
```

### Trying it in a real app

```bash
bun run scaffold ../my-app
bun run link ../my-app
cd ../my-app && bun install && bun dev
```

### Undoing that

```bash
bun run unlink ../my-app
bun run unlink ../my-app --global
bun run unlink --global
```

### Editing Laut while an app runs

`bun --hot` does not watch inside `node_modules`, so **restart the app's server** after changing Laut's _server_ code.

## Fits?

Whether Laut fits before finding out the hard way:

- **No file-based routing.** `routes.ts` is a hand-written object.
- **No nested layouts.** A page picks one layout, flat.
- **No streaming SSR / Suspense.** `load()` is awaited, then the page renders.
- **No CSS modules, no scoping compiler.** Convention only — `[data-island="Name"] .myClass`.
- **No islands inside islands** as a first-class concept — a nested interactive component is just a child of its island and hydrates with it.
- **No prefetch on hover.** Navigation starts on click.
- **The import map is the dependency system.** A package with deep internal imports or conditional exports may need several `vendor` entries, or may not work in the browser at all without a bundler.
- **Symlinks under `public/` are followed.** `/public/*` serves whatever path it resolves to; nothing re-checks that the real path is still inside the project. Placing a symlink there means already having write access to the repo -- which is exactly where a dependency's postinstall script stands. Covered as known behaviour by LAUT-SRV-11.

Testing Information are in [TESTING.md](./TESTING.md).

## License

MIT.
