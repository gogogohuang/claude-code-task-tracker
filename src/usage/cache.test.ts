import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprintOf, isWarmFingerprint } from "./cache.js";

test("fingerprintOf：讀得到 mtimeMs 與 size", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-cache-"));
  const path = join(dir, "a.jsonl");
  try {
    writeFileSync(path, "hello\n");
    const fp = fingerprintOf(path);
    assert.ok(fp);
    assert.equal(fp!.size, Buffer.byteLength("hello\n"));
    assert.equal(typeof fp!.mtimeMs, "number");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fingerprintOf：檔案不存在回 undefined", () => {
  assert.equal(fingerprintOf("/nonexistent/usage-cache-nope.jsonl"), undefined);
});

test("isWarmFingerprint：mtime 與 size 都相同才算 warm", () => {
  const a = { mtimeMs: 100, size: 10 };
  assert.equal(isWarmFingerprint(a, { mtimeMs: 100, size: 10 }), true);
  assert.equal(isWarmFingerprint(a, { mtimeMs: 101, size: 10 }), false);
  assert.equal(isWarmFingerprint(a, { mtimeMs: 100, size: 11 }), false);
  assert.equal(isWarmFingerprint(undefined, a), false);
});

test("改內容或 touch 後 fingerprint 不再 warm", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-cache-"));
  const path = join(dir, "b.jsonl");
  try {
    writeFileSync(path, "a\n");
    const first = fingerprintOf(path)!;
    writeFileSync(path, "ab\n");
    const grown = fingerprintOf(path)!;
    assert.equal(isWarmFingerprint(first, grown), false);

    writeFileSync(path, "ab\n"); // 同 size
    const sameSize = fingerprintOf(path)!;
    // 確保 mtime 可被區分：往未來推一秒
    utimesSync(path, sameSize.mtimeMs / 1000 + 2, sameSize.mtimeMs / 1000 + 2);
    const touched = fingerprintOf(path)!;
    assert.equal(isWarmFingerprint(sameSize, touched), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
