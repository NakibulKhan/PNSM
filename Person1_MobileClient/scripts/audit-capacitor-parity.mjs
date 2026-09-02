#!/usr/bin/env node
/**
 * Capacitor version parity audit.
 *
 * Quadrant I obstacle: "JavaScript Bridge Desynchronization". If
 * @capacitor/core, /cli, /ios and /android drift to different major versions,
 * IPC signals sent from the WebView get dropped by the native translation
 * layer — and the failure mode is silent: `npx cap sync` succeeds, the app
 * builds, and then camera or GPS calls simply never resolve. That is
 * extremely hard to debug from the JS side, so we check for it mechanically
 * instead of relying on someone noticing.
 *
 * Run: npm run audit:capacitor
 * Exits non-zero on drift so it can gate CI.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, "..", "package.json");

const CORE_PACKAGES = [
  "@capacitor/core",
  "@capacitor/cli",
  "@capacitor/ios",
  "@capacitor/android",
];

function majorOf(range) {
  if (!range) return null;
  const m = String(range).match(/(\d+)\./);
  return m ? Number(m[1]) : null;
}

function main() {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  const found = {};
  const missing = [];
  for (const name of CORE_PACKAGES) {
    if (all[name]) found[name] = all[name];
    else missing.push(name);
  }

  console.log("Capacitor core package versions:");
  for (const [name, range] of Object.entries(found)) {
    console.log(`  ${name.padEnd(22)} ${range}`);
  }

  let failed = false;

  if (missing.length) {
    console.log(`\nNOTE: not declared in package.json: ${missing.join(", ")}`);
    console.log("      (expected before `npx cap add ios` / `npx cap add android`)");
  }

  const majors = [...new Set(Object.values(found).map(majorOf).filter((m) => m !== null))];
  if (majors.length > 1) {
    console.error(
      `\nFAIL: Capacitor core packages span multiple major versions: ${majors.join(", ")}`
    );
    console.error("      This causes silent IPC message loss. Align them before building.");
    failed = true;
  } else if (majors.length === 1) {
    console.log(`\nOK: all declared Capacitor core packages are on major v${majors[0]}.`);
  }

  // Plugins should track the same major as core.
  const coreMajor = majors[0];
  if (coreMajor != null) {
    const pluginDrift = Object.entries(all)
      .filter(([n]) => n.startsWith("@capacitor/") && !CORE_PACKAGES.includes(n))
      .filter(([, r]) => majorOf(r) !== null && majorOf(r) !== coreMajor);

    if (pluginDrift.length) {
      console.warn("\nWARN: official plugins on a different major than core:");
      for (const [n, r] of pluginDrift) console.warn(`  ${n.padEnd(30)} ${r}`);
      console.warn(
        "      Official plugins are versioned in lockstep with core; verify these are intentional."
      );
    }
  }

  process.exit(failed ? 1 : 0);
}

main();
