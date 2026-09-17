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

export function syncReadmeToVersion(readme: string, version: string): string {
  if (!README_VERSION.test(readme)) {
    throw new Error('README 缺少「目前版本」行');
  }
  return readme.replace(README_VERSION, `目前版本：**v${version}**`);
}

export function applyReleaseVersion(input: {
  version: string;
  packageJson: string;
  readme: string;
}): { packageJson: string; readme: string; changed: boolean } {
  const nextReadme = syncReadmeToVersion(input.readme, input.version);
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

export function assertTagMatchesFiles(input: {
  tag: string;
  packageJson: string;
  readme: string;
}): string {
  const version = parseReleaseTag(input.tag);
  const pkg = JSON.parse(input.packageJson) as { version: string };
  if (pkg.version !== version) {
    throw new Error(
      `package.json version ${pkg.version} does not match tag ${input.tag} (expected ${version})`,
    );
  }
  if (!input.readme.includes(`目前版本：**v${version}**`)) {
    throw new Error(`README 「目前版本」 does not match tag ${input.tag} (expected v${version})`);
  }
  return version;
}

/** pnpm version lifecycle：package.json 已改好，只同步 README。 */
export function syncReadmeFromPackageJson(cwd: string): string {
  const pkgPath = resolve(cwd, "package.json");
  const readmePath = resolve(cwd, "README.md");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  const readme = readFileSync(readmePath, "utf8");
  const next = syncReadmeToVersion(readme, pkg.version);
  if (next !== readme) writeFileSync(readmePath, next);
  return pkg.version;
}

/** CI：確認 checkout 的 tag 與檔案版號一致。 */
export function assertCheckoutMatchesTag(cwd: string, tag: string): string {
  return assertTagMatchesFiles({
    tag,
    packageJson: readFileSync(resolve(cwd, "package.json"), "utf8"),
    readme: readFileSync(resolve(cwd, "README.md"), "utf8"),
  });
}

/** @deprecated 僅供舊測試／手動；發版改走 local pnpm version。 */
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
  const mode = process.argv[2];
  if (mode === "--sync-readme") {
    const version = syncReadmeFromPackageJson(process.cwd());
    console.log(`readme → v${version}`);
    process.exit(0);
  }
  if (mode === "--assert") {
    const tag = process.argv[3];
    if (!tag) {
      console.error("usage: tsx scripts/sync-release-version.ts --assert <tag>");
      process.exit(1);
    }
    const version = assertCheckoutMatchesTag(process.cwd(), tag);
    console.log(`ok ${version}`);
    process.exit(0);
  }
  console.error(
    "usage:\n  tsx scripts/sync-release-version.ts --sync-readme\n  tsx scripts/sync-release-version.ts --assert <tag>",
  );
  process.exit(1);
}
