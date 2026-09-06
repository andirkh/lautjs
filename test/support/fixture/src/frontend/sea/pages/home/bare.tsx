import type { Params } from "../../../../../../../../src/config.ts";

/** A page that opts out of the client runtime entirely. See LAUT-HEAD-06. */
export const title = () => "Bare";
export const ZERO_JS = true;
export const layout = "bare";

export default function Bare(_props: { params: Params; data: unknown }) {
  return <p>no javascript here</p>;
}
