import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSessionLock } from "./store.js";

test("withSessionLock 序列化同一 session_id 的並行 critical section，不會重疊", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tt-lock-"));
  try {
    const events: string[] = [];
    const worker = (label: string) =>
      withSessionLock(
        "abc",
        () => {
          events.push(`${label}-start`);
          const until = Date.now() + 20;
          while (Date.now() < until) {
            // 忙等，模擬拿到鎖之後的 read-modify-write
          }
          events.push(`${label}-end`);
        },
        { dir },
      );

    await Promise.all([worker("A"), worker("B")]);

    const aStart = events.indexOf("A-start");
    const aEnd = events.indexOf("A-end");
    const bStart = events.indexOf("B-start");
    const bEnd = events.indexOf("B-end");
    assert.ok(aEnd < bStart || bEnd < aStart, `critical sections overlapped: ${events.join(",")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("withSessionLock 不同 session_id 用各自的鎖檔，不會被彼此卡住", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tt-lock-diff-"));
  try {
    // 模擬另一個 process 正握著 "other" session 的鎖（剛建立，還沒過期）
    writeFileSync(join(dir, "other.lock"), "");

    const start = Date.now();
    let ran = false;
    await withSessionLock(
      "abc",
      () => {
        ran = true;
      },
      { dir },
    );
    const elapsed = Date.now() - start;

    assert.equal(ran, true);
    assert.ok(elapsed < 200, `不同 session 被 other.lock 卡住了: ${elapsed}ms`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("withSessionLock 偵測到過期鎖檔會直接搶下，不用等到 timeout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tt-lock-stale-"));
  try {
    const lockPath = join(dir, "abc.lock");
    writeFileSync(lockPath, "");
    const staleTime = new Date(Date.now() - 10_000);
    utimesSync(lockPath, staleTime, staleTime);

    const start = Date.now();
    let ran = false;
    await withSessionLock("abc", () => {
      ran = true;
    }, { dir });
    const elapsed = Date.now() - start;

    assert.equal(ran, true);
    assert.ok(elapsed < 2000, `等太久才搶到過期的鎖: ${elapsed}ms`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
