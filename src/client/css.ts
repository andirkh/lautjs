// `import "./Foo.css"` -- the browser half. LAUT-TRANSP-03, LAUT-ARCH-02

let seen: Set<string> | null = null;

const path = (href: string) => new URL(href, location.href).pathname;

/**
 * Link a stylesheet in <head>, once per document. Returns the new <link>, or
 * null when the sheet was already there -- the router waits on what comes back
 * before swapping a shell in, so a sheet this document has never seen cannot
 * paint the new chrome unstyled. See client/nav.ts.
 */
export function linkStylesheet(href: string): HTMLLinkElement | null {
  seen ??= new Set(
    [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((l) =>
      // by path, not by URL: the dev reloader re-fetches a sheet by appending
      // ?v=..., and that must not read as a second stylesheet
      path(l.getAttribute("href") ?? ""),
    ),
  );

  const url = path(href);
  if (seen.has(url)) return null;
  seen.add(url);

  const el = document.createElement("link");
  el.rel = "stylesheet";
  el.href = url;
  document.head.append(el);
  return el;
}

/** What `import "./Foo.css"` compiles to. */
export function css(href: string) {
  linkStylesheet(href);
}
