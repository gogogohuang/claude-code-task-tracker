import assert from "node:assert/strict";
import test from "node:test";
import { copyText, type ClipboardSpawn } from "./clipboard.js";

test("copyText：darwin 用 pbcopy；成功回 true", () => {
  const calls: Array<{ cmd: string; input: string }> = [];
  const spawn: ClipboardSpawn = (command, _args, options) => {
    calls.push({ cmd: command, input: String(options?.input ?? "") });
    return { status: 0, error: undefined };
  };
  assert.equal(copyText("hello", { platform: "darwin", spawn }), true);
  assert.equal(calls[0]?.cmd, "pbcopy");
  assert.equal(calls[0]?.input, "hello");
});

test("copyText：spawn 失敗回 false", () => {
  assert.equal(
    copyText("x", {
      platform: "darwin",
      spawn: () => {
        throw new Error("nope");
      },
    }),
    false,
  );
  assert.equal(
    copyText("x", {
      platform: "darwin",
      spawn: () => ({ status: 1, error: new Error("fail") }),
    }),
    false,
  );
});

test("copyText：非 darwin 無 xclip 時回 false", () => {
  assert.equal(
    copyText("x", {
      platform: "linux",
      spawn: () => ({ status: 1, error: new Error("missing") }),
    }),
    false,
  );
});
