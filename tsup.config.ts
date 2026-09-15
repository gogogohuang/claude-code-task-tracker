import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.tsx",
    "hook/task-tracker-hook": "src/hook/task-tracker-hook.ts",
  },
  format: ["esm"],
  target: "node18",
  splitting: false,
  sourcemap: true,
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  // hook 會被複製到 ~/.claude-task-tracker/，那邊沒有套件 node_modules。
  noExternal: ["zod"],
});
