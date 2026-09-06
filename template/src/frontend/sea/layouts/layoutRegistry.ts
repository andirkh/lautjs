// The chrome a page can ask for. A page picks one by name --
// `export const layout = "bare"` -- and a page that says nothing gets the
// default. Names are yours, not the framework's: Laut passes the string
// through and only ever compares it to the one the browser already has.
import type { ComponentChildren, ComponentType } from "preact";
import { AppLayout } from "./AppLayout/AppLayout.tsx";
import { BareLayout } from "./BareLayout/BareLayout.tsx";

/** What every layout is handed: the current path, for nav state, and the page. */
export type LayoutProps = { path: string; children: ComponentChildren };

// Every layout must render exactly one <main>: that is the element the router
// swaps on a same-layout navigation, and where the page lands.
const layouts = {
  app: AppLayout, // header + page -- the default
  bare: BareLayout, // no chrome at all, for a landing page
} satisfies Record<string, ComponentType<LayoutProps>>;

/** Annotate a page's `layout` export with this to have a typo fail in the editor. */
export type LayoutName = keyof typeof layouts;

export function pickLayout(name: string): ComponentType<LayoutProps> {
  if (name && !(name in layouts)) console.warn(`Unknown layout "${name}" -- using the default.`);
  return layouts[name as LayoutName] ?? layouts.app;
}
