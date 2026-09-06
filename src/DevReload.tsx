import { DEV_CLIENT, isDev } from "./runtime/dev.ts";

/** Renders nothing at all in production. LAUT-HEAD-19, LAUT-HEAD-20 */
export function DevReload() {
  if (!isDev()) return null;
  return <script dangerouslySetInnerHTML={{ __html: DEV_CLIENT }} />;
}
