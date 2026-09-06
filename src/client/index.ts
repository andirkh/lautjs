// The browser surface of Laut. Islands and the app's client entry import this;
// nothing in here touches Bun or the filesystem, so it is safe to ship.
//
// The import map sends `lautjs/client` to `/lautjs/client/index.ts`, which the
// server transpiles on demand like any other module -- same URL every time, so
// the browser keeps exactly one instance of it.

export { start } from "./boot.ts";
export { navigate, reload, startRouter, configureRouter, type RouterOptions } from "./nav.ts";
export { hydrateIslands } from "./hydrate.ts";
export { linkStylesheet } from "./css.ts";
