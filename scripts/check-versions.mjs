#!/usr/bin/env node
/**
 * Asserts the app version is identical across every manifest that ships it:
 *   package.json          → frontend (__APP_VERSION__) and npm metadata
 *   src-tauri/tauri.conf.json → installed package metadata
 *   src-tauri/Cargo.toml  → Rust binary / .deb metadata
 *
 * Run by CI on every push and by the release workflow before building, so a
 * forgotten bump can never produce an app that reports the wrong version.
 * Exit code 0 = in sync, 1 = drift (with a readable diff on stderr).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const packageVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const tauriVersion = JSON.parse(
  readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"),
).version;

const cargoToml = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
const cargoMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
if (!cargoMatch) {
  console.error("check-versions: could not find `version = \"…\"` in src-tauri/Cargo.toml");
  process.exit(1);
}
const cargoVersion = cargoMatch[1];

const versions = {
  "package.json": packageVersion,
  "src-tauri/tauri.conf.json": tauriVersion,
  "src-tauri/Cargo.toml": cargoVersion,
};

const unique = new Set(Object.values(versions));
if (unique.size > 1) {
  console.error("check-versions: version drift detected —");
  for (const [file, version] of Object.entries(versions)) {
    console.error(`  ${file}: ${version}`);
  }
  console.error("Bump all three manifests to the same version before releasing.");
  process.exit(1);
}

// Optional: when RELEASE_TAG=v1.3.0 is set (release workflow), the tag must match too.
const tag = process.env.RELEASE_TAG;
if (tag) {
  const tagVersion = tag.replace(/^v/, "");
  if (tagVersion !== packageVersion) {
    console.error(
      `check-versions: git tag ${tag} does not match manifest version ${packageVersion}`,
    );
    process.exit(1);
  }
}

console.log(`check-versions: all manifests agree on ${packageVersion}`);
