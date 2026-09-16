import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_TAG = /^v?(\d+\.\d+\.\d+)$/;
const README_VERSION = /目前版本：\*\*v?\d+\.\d+\.\d+\*\*/;

export function parseReleaseTag(tag: string): string {
  const match = tag.trim().match(RELEASE_TAG);
  if (!match) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
  return match[1];
}

export function applyReleaseVersion(input: {
  version: string;
  packageJson: string;
  readme: string;
}): { packageJson: string; readme: string; changed: boolean } {
  if (!README_VERSION.test(input.readme)) {
    throw new Error('README 缺少「目前版本」行');
  }
  const nextReadme = input.readme.replace(
    README_VERSION,
    `目前版本：**v${input.version}**`,
  );
  const pkg = JSON.parse(input.packageJson) as { version: string };
  if (pkg.version === input.version && nextReadme === input.readme) {
    return {
      packageJson: input.packageJson,
      readme: input.readme,
      changed: false,
    };
  }
  pkg.version = input.version;
  return {
    packageJson: `${JSON.stringify(pkg, null, 2)}\n`,
    readme: nextReadme,
    changed: true,
  };
}

export function syncReleaseFiles(
  cwd: string,
  tag: string,
): { version: string; changed: boolean } {
  const version = parseReleaseTag(tag);
  const pkgPath = resolve(cwd, "package.json");
  const readmePath = resolve(cwd, "README.md");
  const result = applyReleaseVersion({
    version,
    packageJson: readFileSync(pkgPath, "utf8"),
    readme: readFileSync(readmePath, "utf8"),
  });
  if (result.changed) {
    writeFileSync(pkgPath, result.packageJson);
    writeFileSync(readmePath, result.readme);
  }
  return { version, changed: result.changed };
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isCliEntry()) {
  const tag = process.argv[2];
  if (!tag) {
    console.error("usage: tsx scripts/sync-release-version.ts <tag>");
    process.exit(1);
  }
  const { version, changed } = syncReleaseFiles(process.cwd(), tag);
  console.log(`${version}${changed ? " (updated)" : " (unchanged)"}`);
}
