import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "./fs-atomic.js";

test("writeFileAtomic 寫完只留下最終檔案，不留 tmp 檔", () => {
  const dir = mkdtempSync(join(tmpdir(), "tt-atomic-"));
  try {
    const path = join(dir, "state.json");
    writeFileAtomic(path, JSON.stringify({ a: 1 }));
    assert.equal(readFileSync(path, "utf-8"), JSON.stringify({ a: 1 }));
    assert.deepEqual(readdirSync(dir), ["state.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeFileAtomic 覆寫既有檔案時新內容完全取代舊內容", () => {
  const dir = mkdtempSync(join(tmpdir(), "tt-atomic-overwrite-"));
  try {
    const path = join(dir, "state.json");
    writeFileAtomic(path, "old");
    writeFileAtomic(path, "new-content-that-is-longer-than-old");
    assert.equal(readFileSync(path, "utf-8"), "new-content-that-is-longer-than-old");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
