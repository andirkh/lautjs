// bun run link <app-dir>
//
// Point an app at this working tree, so you can develop Laut and the app that
// uses it side by side. Idempotent -- re-run it after any `bun install` in the
// app, which is what puts the duplicate copies back.
//
// Why it is not just `bun link lautjs`:
//
// Bun resolves a linked package's own imports from the package's real location,
// not from the app that linked it. So `node_modules/lautjs -> ../../lautjs` leaves
// Laut importing *its* preact while your components import *yours* -- two
// module instances, two `options` objects. Rendering half-works and signals
// silently stop crossing the boundary, which is a miserable thing to debug.
//
// The fix is to leave exactly one copy on disk: this points the app's shared
// runtime deps at the framework's, so both sides resolve to the same files.
import { existsSync } from "node:fs";
import { rm, symlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

/** Everything both halves must agree on -- anything with module-level state. */
const SHARED = ["preact", "@preact", "preact-render-to-string", "kinu"];

const arg = process.argv[2];
if (!arg) {
  console.error("usage: bun run link <app-dir>");
  process.exit(1);
}

const root = join(import.meta.dir, "..");
const app = isAbsolute(arg) ? arg : resolve(process.cwd(), arg);

if (!existsSync(join(app, "package.json"))) {
  console.error(`No package.json in ${app}`);
  process.exit(1);
}

const run = (cmd: string[], cwd: string) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: new TextDecoder().decode(p.stdout) };
};

// 1. register this working tree, and link it into the app
run(["bun", "link"], root);
if (!existsSync(join(app, "node_modules"))) run(["bun", "install"], app);
const linked = run(["bun", "link", "lautjs"], app);
if (!linked.ok && !existsSync(join(app, "node_modules", "lautjs"))) {
  console.error("bun link lautjs failed:\n" + linked.out);
  process.exit(1);
}

// 2. collapse the shared deps onto this tree's copies
for (const dep of SHARED) {
  const from = join(app, "node_modules", dep);
  const to = join(root, "node_modules", dep);
  if (!existsSync(to)) {
    console.error(`Missing ${to} -- run \`bun install\` in the Laut repo first.`);
    process.exit(1);
  }
  await rm(from, { recursive: true, force: true });
  await symlink(to, from);
}

console.log(
  `Linked ${app} to ${root}\n` +
    `  lautjs + ${SHARED.join(", ")} now resolve to one copy.\n\n` +
    `Edit Laut and the app together; \`bun --hot\` picks up both.\n` +
    `Re-run this after any \`bun install\` in the app.\n`,
);
