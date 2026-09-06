// bun run unlink <app-dir> [--global]
//
// Undo `bun run link`. It removes the five symlinks that script created --
// `lautjs` plus the four runtime deps it collapsed onto this tree -- and reinstalls
// the app's own copies.
//
// --global also unregisters this working tree from Bun's link registry
// (`bun unlink`). Leave it off if other apps are still linked to Laut: the
// registry entry is one symlink in ~/.bun and harms nothing on its own.
import { existsSync, lstatSync } from "node:fs";
import { rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

/** Must match SHARED in link.ts. */
const SHARED = ["preact", "@preact", "preact-render-to-string", "kinu"];

const args = process.argv.slice(2);
const global = args.includes("--global");
const arg = args.find((a) => !a.startsWith("--"));

if (!arg && !global) {
  console.error("usage: bun run unlink <app-dir> [--global]");
  process.exit(1);
}

const root = join(import.meta.dir, "..");

const run = (cmd: string[], cwd: string) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    ok: p.exitCode === 0,
    out: new TextDecoder().decode(p.stdout) + new TextDecoder().decode(p.stderr),
  };
};

if (arg) {
  const app = isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
  if (!existsSync(join(app, "package.json"))) {
    console.error(`No package.json in ${app}`);
    process.exit(1);
  }

  // Only ever remove symlinks. A real directory here is the app's own install,
  // which is exactly what we are trying to get back to -- deleting it would be
  // destroying the thing we mean to restore.
  const removed: string[] = [];
  for (const dep of ["lautjs", ...SHARED]) {
    const path = join(app, "node_modules", dep);
    if (!existsSync(path) && !isLink(path)) continue;
    if (!isLink(path)) continue;
    await rm(path, { recursive: true, force: true });
    removed.push(dep);
  }

  // Put the app's own copies back -- `lautjs` included. This pulls the published
  // framework down over the symlink
  // `bun run link` left in its place.
  const installed = run(["bun", "install"], app);

  console.log(
    removed.length
      ? `Unlinked ${app}\n  removed symlinks: ${removed.join(", ")}`
      : `Nothing to unlink in ${app} -- no symlinks found.`,
  );
  if (!installed.ok) console.log(`\n\`bun install\` reported:\n${installed.out}`);

  console.log(
    `\nThe app's own copies of lautjs, ${SHARED.join(", ")} are back,\n` +
      `and it is back on the published release. To point it at this tree again:\n\n` +
      `  bun run link ${arg}\n`,
  );
}

if (global) {
  const r = run(["bun", "unlink"], root);
  console.log(
    r.ok ? "Unregistered lautjs from Bun's global link registry." : `bun unlink said:\n${r.out}`,
  );
}

function isLink(path: string) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
