import { createIsland } from "../../../../../../../../src/Island.tsx";
import type { Params } from "../../../../../../../../src/config.ts";
import { registry } from "../../../islands/islandRegistry.ts";

const Island = createIsland(registry);

export const title = () => "Home";

export const meta = () => ({ description: "the fixture home page" });

export const load = () => ({ greeting: "hello" });

export default function Home({ data }: { params: Params; data: { greeting: string } }) {
  return (
    <div>
      <h1>{data.greeting}</h1>
      <Island name="Widget" props={{ label: "eager" }} />
      <Island name="Widget" props={{ label: "deferred" }} when="visible" />
    </div>
  );
}
