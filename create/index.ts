#!/usr/bin/env bun
//
// `bun create lautjs <dir>` — Bun resolves that to this package's bin and runs
// it with <dir> as the only argument. `bunx create-lautjs <dir>` is the same
// thing spelled out.
//
// The starter app lives next to this file, vendored in at pack time by
// `scripts/sync-create.ts`. `scripts/scaffold.ts` in the Laut repo calls
// `scaffold()` directly against the working tree's `template/`, so the copy
// logic has exactly one implementation.
import { cp, readdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Files npm and Bun refuse to ship under their real names. npm rewrites a
 * packed `.gitignore` to `.npmignore`, and a nested `bunfig.toml` would be
 * read by any `bun` command run inside the package, so both travel with an
 * underscore and get their real name back here.
 */
const RENAME: Record<string, string> = {
  "_bunfig.toml": "bunfig.toml",
  _gitignore: ".gitignore",
};

/** The framework, under the one name it goes by: npm package and import alike. */
const PKG = "lautjs";

/** How long a registry lookup gets before we fall back to the vendored range. */
const REGISTRY_TIMEOUT_MS = 3000;

const registry = () =>
  (process.env.npm_config_registry || "https://registry.npmjs.org").replace(/\/+$/, "");

/**
 * The version npm currently serves as `latest` for `pkg`, or null if the
 * registry is unreachable, slow, or has never heard of it. Never throws --
 * scaffolding offline has to still produce a working app.
 */
async function latestVersion(pkg: string): Promise<string | null> {
  try {
    const res = await fetch(`${registry()}/${encodeURIComponent(pkg)}/latest`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const version = ((await res.json()) as { version?: unknown })?.version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * Re-point the starter's `lautjs` dependency at whatever npm serves as
 * `latest`, in place on `manifest`. Returns the version it pinned, or null if
 * it left the vendored range alone.
 *
 * The range baked into this package goes stale the moment the framework
 * publishes again -- and bunx will happily reuse a cached create-lautjs for
 * weeks -- so the version an app is born on is decided here, at scaffold time,
 * not at the scaffolder's release time.
 */
async function pinFramework(manifest: {
  dependencies?: Record<string, string>;
}): Promise<string | null> {
  const vendored = manifest.dependencies?.[PKG];
  if (typeof vendored !== "string") return null;

  const latest = await latestVersion(PKG);
  if (!latest) return null;

  // The vendored range is a floor, not just a fallback. A template is written
  // against a specific framework -- during the window between a breaking
  // template change and the release that carries it, npm's `latest` is *older*
  // than what these files need, and pinning to it would scaffold an app that
  // installs cleanly and then fails to hydrate.
  const floor = vendored.match(/\d+\.\d+\.\d+[^\s|]*/)?.[0];
  if (floor && Bun.semver.order(latest, floor) < 0) return null;

  manifest.dependencies[PKG] = `^${latest}`;
  return latest;
}

export type ScaffoldOptions = {
  /**
   * Ask npm for the newest `lautjs` and pin the new app to it. On by default;
   * pass false to keep whatever range the template already carries.
   */
  resolveLatest?: boolean;
};

/** Copy `template` into `target`, naming the app after the directory. */
export async function scaffold(template: string, target: string, options: ScaffoldOptions = {}) {
  if (await Bun.file(join(target, "package.json")).exists()) {
    throw new Error(`${target} already holds a package.json -- refusing to overwrite it.`);
  }

  await cp(template, target, { recursive: true });
  for (const name of await readdir(target)) {
    if (RENAME[name]) await rename(join(target, name), join(target, RENAME[name]!));
  }
  await rm(join(target, "bun.lock"), { force: true });

  const pkg = join(target, "package.json");
  const manifest = await Bun.file(pkg).json();
  manifest.name = target.split("/").filter(Boolean).pop()!;
  const pinned = options.resolveLatest === false ? null : await pinFramework(manifest);
  await Bun.write(pkg, JSON.stringify(manifest, null, 2) + "\n");

  return { pinned };
}

/**
 * bunx keeps a lockfile for `create-lautjs@latest` under $TMPDIR and re-runs
 * whatever it resolved the first time, so a machine can sit on an old
 * scaffolder indefinitely. The app is on the latest framework either way --
 * `pinFramework` saw to that -- but the starter *files* may have moved on, and
 * naming an exact version is the one spec bunx caches under a fresh key.
 */
async function stalenessNotice(): Promise<string | null> {
  const self = await Bun.file(join(import.meta.dir, "package.json"))
    .json()
    .catch(() => null);
  const mine = self?.version;
  if (typeof mine !== "string") return null;

  const latest = await latestVersion("create-lautjs");
  if (!latest || Bun.semver.order(latest, mine) <= 0) return null;

  return (
    `create-lautjs ${mine} is behind ${latest} -- bunx is reusing a cached copy.\n` +
    `For the newest starter files: bunx create-lautjs@${latest} <dir>\n`
  );
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: bun create lautjs <dir>");
    process.exit(1);
  }

  const notice = stalenessNotice(); // runs against the network while we copy

  const target = resolve(process.cwd(), dir); // `dir` may be absolute
  let pinned: string | null = null;
  try {
    ({ pinned } = await scaffold(join(import.meta.dir, "template"), target));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const stale = await notice;
  if (stale) console.warn(`\n${stale}`);

  console.log(
    `Created ${dir}${pinned ? ` on lautjs ${pinned}` : ""}\n\n` +
      `  cd ${dir}\n  bun install\n  bun dev\n`,
  );
}
