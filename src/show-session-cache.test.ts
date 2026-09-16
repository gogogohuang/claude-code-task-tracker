import assert from "node:assert/strict";
import test from "node:test";
import {
  filterSessionHints,
  formatSessionListLine,
  resolveSessionId,
  serializeSessionCache,
} from "./show-session-cache.js";
import { SessionHint } from "./session-preference.js";

test("resolveSessionId 完整 id 或唯一短 id 前綴", () => {
  const ids = ["e9efe088-aaaa-bbbb-cccc-ddddeeeeffff", "353f2a18-1111-2222-3333-444455556666"];
  assert.equal(resolveSessionId("e9efe088-aaaa-bbbb-cccc-ddddeeeeffff", ids), ids[0]);
  assert.equal(resolveSessionId("e9efe088", ids), ids[0]);
  assert.equal(resolveSessionId("353f", ids), ids[1]);
  assert.equal(resolveSessionId("e9efe088", [ids[0], "e9efe088-dead-beef"]), undefined);
});

test("filterSessionHints 預設只留 cwd 對得上的 session", () => {
  const hints: SessionHint[] = [
    { sessionId: "a", cwd: "/proj/a", updatedAt: "2026-01-02T00:00:00.000Z" },
    { sessionId: "b", cwd: "/proj/b", updatedAt: "2026-01-01T00:00:00.000Z" },
  ];
  const filtered = filterSessionHints(hints, "/proj/a", false);
  assert.deepEqual(filtered.map((h) => h.sessionId), ["a"]);
  assert.deepEqual(filterSessionHints(hints, "/proj/a", true).map((h) => h.sessionId), ["a", "b"]);
});

test("formatSessionListLine 含短 id、相對時間、活動", () => {
  const line = formatSessionListLine(
    {
      sessionId: "e9efe088-aaaa-bbbb-cccc-ddddeeeeffff",
      cwd: "/Users/me/proj",
      updatedAt: new Date(Date.now() - 120_000).toISOString(),
      activitySummary: "正在讀取 src/foo.ts",
    },
    Date.now(),
  );
  assert.match(line, /e9efe088/);
  assert.match(line, /2 分鐘前/);
  assert.match(line, /正在讀取 src\/foo.ts/);
});

test("serializeSessionCache 輸出 pretty JSON", () => {
  const json = serializeSessionCache({ sessionId: "s1", updatedAt: "2026-01-01T00:00:00.000Z" });
  assert.match(json, /"sessionId": "s1"/);
  assert.match(json, /\n/);
});
