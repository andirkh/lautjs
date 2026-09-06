// bun run scaffold <dir>
//
// Copy `template/` into a new app, straight out of this working tree. Same copy
// logic `bun create lautjs <dir>` runs -- it is literally the same function,
// pointed at `template/` here and at the vendored copy inside the create-lautjs
// tarball there.
import { join, resolve } from "node:path";
import { scaffold } from "../create/index.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: bun run scaffold <dir>");
  process.exit(1);
}

const root = join(import.meta.dir, "..");
const target = resolve(process.cwd(), dir); // `dir` may be absolute

let pinned: string | null = null;
try {
  ({ pinned } = await scaffold(join(root, "template"), target));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

console.log(
  `Created ${dir}${pinned ? ` on lautjs ${pinned}` : ""}\n\n` +
    `  cd ${dir}\n` +
    `  bun install\n` +
    `  bun dev\n\n` +
    `That installs the published Laut. To run the app against this working tree\n` +
    `instead -- from the Laut repo:\n\n` +
    `  bun run link ${dir}\n`,
);
