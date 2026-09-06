// The document's <head> -- the element and everything in it.
// LAUT-HEAD-01..20
import type { ComponentChildren } from "preact";
import { DevReload } from "./DevReload.tsx";
import { inlineStyles, stylesheets } from "./runtime/css.ts";
import { clientPreloads, getImportMap, vendorURL } from "./runtime/vendor.ts";

/** The two sheets every Laut app links. LAUT-HEAD-05, LAUT-HEAD-06 */
const DEFAULT_STYLES = [vendorURL("kinu/style.css"), "/public/app.css"];

/** What a page's <head> says about itself, already resolved by renderPage.
 *  LAUT-RENDER-06..20 */
export type HeadData = {
  /** The document title, template already applied -- print it as it is. */
  title: string;
  /** Document language. `<html lang>` is yours; this is what og:locale gets. */
  lang: string;
  description?: string;
  /** Absolute URL of this page: `<link rel="canonical">` and og:url. */
  canonical: string;
  /** Absolute URL of the share image. */
  image?: string;
  /** Alt text for that image, for the crawlers that show it. */
  imageAlt?: string;
  /** e.g. "noindex, nofollow". Omitted when unset. LAUT-HEAD-04 */
  robots?: string;
  /** og:type -- "website" unless the page says otherwise ("article", …). */
  type: string;
  siteName?: string;
  /** The site's @handle, for twitter:site. */
  twitter?: string;
  /** The page asked for no client runtime. LAUT-HEAD-08, LAUT-BUDGET-04 */
  ZERO_JS: boolean;
};

export type HeadProps = HeadData & {
  /** Extra app-wide stylesheets, linked after Laut's defaults and before the
   *  component sheets. LAUT-HEAD-05 */
  styles?: string[];
  /** Link neither of Laut's default sheets. LAUT-HEAD-06 */
  noDefaultCSS?: boolean;
  /** Your client entry, the one module the document loads. LAUT-HEAD-09 */
  boot?: string;
  /** Anything else you want in every document. Rendered last. LAUT-HEAD-10 */
  children?: ComponentChildren;
};

export function Head({
  title,
  lang,
  description,
  canonical,
  image,
  imageAlt,
  robots,
  type,
  siteName,
  twitter,
  ZERO_JS,
  styles = [],
  noDefaultCSS = false,
  boot = "/src/frontend/boot.ts",
  children,
}: HeadProps) {
  const inlined = inlineStyles();

  return (
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>

      {/* LAUT-HEAD-02, LAUT-HEAD-04, LAUT-RENDER-10 */}
      {description && <meta name="description" content={description} />}
      {robots && <meta name="robots" content={robots} />}
      <link rel="canonical" href={canonical} />

      {/* LAUT-HEAD-02 */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={title} />
      {description && <meta property="og:description" content={description} />}
      <meta property="og:url" content={canonical} />
      <meta property="og:locale" content={lang} />
      {siteName && <meta property="og:site_name" content={siteName} />}
      {image && <meta property="og:image" content={image} />}
      {image && imageAlt && <meta property="og:image:alt" content={imageAlt} />}

      {/* LAUT-HEAD-03 */}
      <meta name="twitter:card" content={image ? "summary_large_image" : "summary"} />
      {twitter && <meta name="twitter:site" content={twitter} />}

      {/* LAUT-HEAD-05, LAUT-HEAD-06 */}
      {(noDefaultCSS ? styles : [...DEFAULT_STYLES, ...styles]).map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      {/* LAUT-HEAD-05, LAUT-HEAD-16 */}
      {stylesheets().map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      {/* LAUT-HEAD-12, LAUT-HEAD-13, LAUT-HEAD-14, LAUT-HEAD-15, LAUT-HEAD-18,
          LAUT-BUDGET-05 */}
      {inlined && <style dangerouslySetInnerHTML={{ __html: inlined }} />}

      {/* LAUT-HEAD-08, LAUT-BUDGET-04 */}
      {!ZERO_JS && (
        <>
          {/* LAUT-HEAD-07, LAUT-VENDOR-07 */}
          <script
            type="importmap"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(getImportMap()) }}
          />
          {/* LAUT-HEAD-07, LAUT-BUDGET-03 */}
          {clientPreloads().map((href) => (
            <link key={href} rel="modulepreload" href={href} />
          ))}

          <script type="module" src={boot} />
        </>
      )}
      {/* LAUT-HEAD-19, LAUT-HEAD-20 */}
      <DevReload />

      {children}
    </head>
  );
}
