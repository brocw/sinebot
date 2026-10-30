import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// The release version lives in package.json; bump it there (see DEPLOY.md).
const root = new URL("..", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

export const VERSION = pkg.version;

// The commit identifies exactly what is running between version bumps. The
// droplet deploys with `git pull`, so the checkout is there to ask; GIT_COMMIT
// overrides it for environments without one. Null if neither is available.
function readCommit() {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export const COMMIT = readCommit();

/** e.g. "v0.2.0 (26c4b78)", or "v0.2.0" when the commit is unknown. */
export function versionString(version = VERSION, commit = COMMIT) {
  return commit ? `v${version} (${commit})` : `v${version}`;
}
