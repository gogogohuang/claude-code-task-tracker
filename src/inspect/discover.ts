import { resolve } from "node:path";
import { expandImports } from "./expand-imports.js";
import { collectInstructionEntries } from "./instructions.js";
import { collectMemoryEntries } from "./memory.js";
import { findWorktreeRoot, resolveConfigDir } from "./paths.js";
import { readResolverSettings } from "./settings.js";
import { DiscoverOptions, InspectModel } from "./types.js";

function headerNotes(env: NodeJS.ProcessEnv): string[] {
  const notes: string[] = [];
  if (env.CLAUDE_CONFIG_DIR) notes.push(`CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}`);
  if (env.CLAUDE_CODE_DISABLE_AUTO_MEMORY) {
    notes.push(`CLAUDE_CODE_DISABLE_AUTO_MEMORY=${env.CLAUDE_CODE_DISABLE_AUTO_MEMORY}`);
  }
  if (env.CLAUDE_CONFIG_DIR && env.CLAUDE_CODE_PROJECT_DIR_NAME) {
    notes.push(`CLAUDE_CODE_PROJECT_DIR_NAME=${env.CLAUDE_CODE_PROJECT_DIR_NAME}`);
  }
  return notes;
}

export function discoverInspectModel(options: DiscoverOptions): InspectModel {
  const cwd = resolve(options.cwd);
  const configDir = resolveConfigDir(options.env, options.home);
  const projectRoot = findWorktreeRoot(cwd) ?? cwd;
  const settings = readResolverSettings({
    cwd,
    configDir,
    home: options.home,
    env: options.env,
    projectRoot,
  });
  const instructions = expandImports(
    collectInstructionEntries({
      cwd,
      configDir,
      managedPolicyPath: options.managedPolicyPath,
      excludes: settings.excludes,
    }),
    { cwd, configDir, home: options.home },
  );
  const entries = [
    ...instructions,
    ...collectMemoryEntries({ cwd, configDir, env: options.env, settings }),
  ];
  return {
    cwd,
    configDir,
    headerNotes: headerNotes(options.env),
    warnings: settings.warnings,
    entries,
  };
}
