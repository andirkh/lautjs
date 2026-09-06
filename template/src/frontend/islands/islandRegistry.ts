// Server-side lookup so the sea can render an island by name, and the binding
// that turns it into a typed <Island>. The browser needs no registry: each
// wrapper carries its own module URL.
import { createIsland } from "lautjs";
import type { ComponentType } from "preact";
import Counter from "./Counter/Counter.tsx";
import Deferred from "./Deferred/Deferred.tsx";

// prettier-ignore
export const registry = {
  Counter,
  Deferred,
} satisfies Record<string, ComponentType<any>>;

export type IslandName = keyof typeof registry;

/** `<Island name="Counter" props={{ step: 1 }} />` -- `name` is typed, so a
 *  typo fails in the editor. Add an island by adding it above; that is all. */
export const Island = createIsland(registry);
