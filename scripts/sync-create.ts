// bun scripts/sync-create.ts
//
// Vendor `template/` into `create/template/`, so the create-lautjs tarball is
// self-contained. Runs from create-lautjs's `prepack`, which means `npm publish`
// and `bun pm pack` inside `create/` both refresh it on their own -- but run it
// by hand if you want to inspect the copy first.
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dest = join(root, "create", "template");

await rm(dest, { recursive: true, force: true });
await cp(join(root, "template"), dest, { recursive: true });
await rm(join(dest, "bun.lock"), { force: true });
await rm(join(dest, "node_modules"), { recursive: true, force: true });

console.log(`Synced template/ -> create/template/`);
