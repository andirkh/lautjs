import { hydrateIslands } from "./hydrate.ts";
import { configureRouter, type RouterOptions, startRouter } from "./nav.ts";

/**
 * Start the client runtime. Your app calls this from its own entry module, so
 * anything app-specific (locale, analytics, theme) can run first.
 *
 *   start();                              // defaults
 *   start({ viewTransitions: true });     // see RouterOptions
 */
export function start(options: RouterOptions = {}) {
  configureRouter(options);
  hydrateIslands();
  startRouter();
}
