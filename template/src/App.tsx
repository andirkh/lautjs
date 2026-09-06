import type { AppProps } from "lautjs/config.ts";
import { Document } from "./frontend/sea/Document.tsx";
import { pickLayout } from "./frontend/sea/layouts/layoutRegistry.ts";

export type { AppProps };

/**
 * The document root. This is *your* top-level component: wrap pages in
 * providers, swap the document per route, add a footer -- all of it happens
 * here, not inside the framework.
 *
 * `layout` is the name the page asked for (`export const layout = "bare"`), or
 * "" when it asked for nothing. Mapping it to a component is app business, so
 * the map lives in sea/layouts and the framework never sees it.
 *
 * `head` is the opposite kind of thing: title, language, SEO and the ZERO_JS
 * flag, all resolved by Laut from the page's exports and `createServer({ site
 * })`. It travels straight through to <Head>.
 */
export function App({ Body, params, data, path, layout, head }: AppProps) {
  const Layout = pickLayout(layout);

  return (
    <Document head={head} layout={layout}>
      <Layout path={path}>
        <Body params={params} data={data} />
      </Layout>
    </Document>
  );
}
