import { Head } from "../../../../src/index.ts";
import type { AppProps } from "../../../../src/config.ts";

/**
 * The fixture's document root. Deliberately the thinnest thing that is still a
 * real Laut app: <Head> spread with what renderPage resolved, one wrapper
 * carrying the layout name, and the page body inside it.
 *
 * The framework is imported by relative path rather than as "lautjs" so the
 * suite exercises the source tree in front of it and never a stale copy under
 * node_modules.
 */
export function App({ Body, params, data, layout, head }: AppProps) {
  return (
    <html lang={head.lang}>
      <Head {...head}>
        <link rel="icon" href="/public/favicon.ico" />
      </Head>
      <body>
        <div class="shell" data-layout={layout || undefined}>
          <main>
            <Body params={params} data={data} />
          </main>
        </div>
      </body>
    </html>
  );
}
