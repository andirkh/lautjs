import { Head, type HeadData } from "lautjs";
import type { ComponentChildren } from "preact";

/**
 * The <html> document. Yours to edit -- and short, because the mechanical half
 * of a <head> is Laut's now: `<Head>` *is* the <head>, and renders the charset,
 * the SEO and social tags, the stylesheet links, the inlined sheets, the import
 * map, the module preloads, the boot script and the dev socket, in the order
 * they have to be in.
 *
 * What is left here is the part that is actually about your app: what else
 * belongs in every document, and the shape of the <body>.
 */
export function Document({
  head,
  layout,
  children,
}: {
  /** Everything <Head> needs, resolved by Laut -- title, language, SEO, and
   *  the ZERO_JS flag. Spread it; there is nothing to pick apart. */
  head: HeadData;
  layout: string;
  children: ComponentChildren;
}) {
  return (
    <html lang={head.lang}>
      {/* <Head> is the <head>. kinu's stylesheet and /public/app.css are
          linked for you, before the component sheets -- add more with
          `styles`, drop both with `noDefaultCSS`. Children come last: icons,
          fonts, analytics, anything you want in every document. */}
      <Head {...head}>
        <link rel="icon" href="/public/favicon.ico" />
      </Head>
      <body>
        {/* One wrapper whatever the chrome is: the router replaces exactly this
            element when a navigation changes layout, and `data-layout` is both
            what it compares against and what a layout's CSS scopes under. The
            default layout stamps nothing, so its rules stay unqualified. */}
        <div class="shell" data-layout={layout || undefined}>
          {children}
        </div>
      </body>
    </html>
  );
}
