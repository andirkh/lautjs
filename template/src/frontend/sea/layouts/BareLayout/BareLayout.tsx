import type { LayoutProps } from "../layoutRegistry.ts";

// No chrome at all. A page asks for it with `export const layout = "bare"`, and
// the router swaps the whole shell when a navigation crosses between the two.
export function BareLayout({ children }: LayoutProps) {
  return <main>{children}</main>;
}
