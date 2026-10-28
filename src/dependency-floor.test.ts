// Pins the minimum installed versions of next and sharp.
// Floors are set by these advisories:
//   next  16.4.1: GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r
//   sharp 0.35.5: CVE-2026-96889
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

// Some packages (sharp) don't export "./package.json", so resolve the entry
// point and walk up to the package's own package.json.
function installed(pkg: string): string {
  let dir = path.dirname(require.resolve(pkg));
  for (;;) {
    try {
      const json = JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf8"),
      ) as { name?: string; version: string };
      if (json.name === pkg) return json.version;
    } catch {
      // no package.json in this directory; keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`package.json for ${pkg} not found`);
    dir = parent;
  }
}

function atLeast(version: string, floor: string): boolean {
  const parse = (v: string) =>
    v
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10));
  const a = parse(version);
  const b = parse(floor);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

describe("dependency floors", () => {
  it("next is at least 16.4.1", () => {
    expect(atLeast(installed("next"), "16.4.1")).toBe(true);
  });
  it("sharp is at least 0.35.5", () => {
    expect(atLeast(installed("sharp"), "0.35.5")).toBe(true);
  });
  it("atLeast compares numerically", () => {
    expect(atLeast("16.10.0", "16.4.1")).toBe(true);
    expect(atLeast("16.3.6", "16.4.1")).toBe(false);
    expect(atLeast("0.35.5", "0.35.5")).toBe(true);
  });
});
