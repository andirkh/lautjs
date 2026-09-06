import type { LayoutProps } from "../layoutRegistry.ts";

// The default chrome. Plain server-rendered HTML -- it ships no JavaScript, and
// a navigation between two `app` pages never re-renders it.
export function AppLayout({ path, children }: LayoutProps) {
  const link = (href: string, label: string) => (
    <a href={href} aria-current={path === href ? "page" : undefined}>
      {label}
    </a>
  );

  return (
    <>
      <header class="topbar">
        <strong>my-laut-app</strong>
        <nav class="row">
          {link("/", "Home")}
          {link("/about", "About")}
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
}
