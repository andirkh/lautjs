// Shared island state. Both the browser and the server import this exact module
// (same URL in the browser => one module instance => one shared signal), so two
// islands on the same page see the same value without talking to each other.
import { computed, signal } from "@preact/signals";

export const count = signal(0);
export const doubled = computed(() => count.value * 2);

export const inc = (by = 1) => (count.value += by);
export const reset = () => (count.value = 0);
