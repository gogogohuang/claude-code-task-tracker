import assert from "node:assert/strict";
import test from "node:test";
import {
  IDLE_MS,
  PERMISSION_REQUEST_GRACE_MS,
  aggregatePresence,
  classifyPresence,
  isWaitingForUser,
  presenceColor,
  presenceLabelPrefix,
  shouldRingWaitingBell,
  waitingBannerMessage,
  waitingEdgeKey,
  waitingNoticeForActivity,
} from "./session-presence.js";

test("isWaitingForUser：AskUserQuestion／ExitPlanMode + running 才是 true", () => {
  assert.equal(isWaitingForUser({ toolName: "AskUserQuestion", phase: "running" }), true);
  assert.equal(isWaitingForUser({ toolName: "ExitPlanMode", phase: "running" }), true);
  assert.equal(isWaitingForUser({ toolName: "AskUserQuestion", phase: "done" }), false);
  assert.equal(isWaitingForUser({ toolName: "Read", phase: "running" }), false);
  assert.equal(isWaitingForUser(undefined), false);
  assert.equal(isWaitingForUser(null), false);
});

test("isWaitingForUser：PermissionRequest 要滿 5 秒寬限期才算 waiting", () => {
  const now = Date.parse("2026-09-16T12:00:00.000Z");
  assert.equal(
    isWaitingForUser(
      { toolName: "PermissionRequest", phase: "running", at: new Date(now - (PERMISSION_REQUEST_GRACE_MS - 1)).toISOString() },
      now,
    ),
    false,
  );
  assert.equal(
    isWaitingForUser(
      { toolName: "PermissionRequest", phase: "running", at: new Date(now - PERMISSION_REQUEST_GRACE_MS).toISOString() },
      now,
    ),
    true,
  );
  assert.equal(
    isWaitingForUser(
      { toolName: "PermissionRequest", phase: "done", at: new Date(now - 10_000).toISOString() },
      now,
    ),
    false,
  );
  assert.equal(isWaitingForUser({ toolName: "PermissionRequest", phase: "running" }, now), false);
});

test("classifyPresence：waiting／busy／idle 與 60s 邊界", () => {
  const now = Date.parse("2026-09-16T12:00:00.000Z");
  assert.equal(
    classifyPresence({
      activity: { toolName: "AskUserQuestion", phase: "running" },
      updatedAt: "2026-09-16T11:59:00.000Z",
      now,
    }),
    "waiting",
  );
  assert.equal(
    classifyPresence({
      activity: { toolName: "Read", phase: "running" },
      updatedAt: "2026-09-16T10:00:00.000Z",
      now,
    }),
    "busy",
  );
  assert.equal(
    classifyPresence({
      activity: { toolName: "Read", phase: "done" },
      updatedAt: "2026-09-16T11:59:50.000Z",
      now,
    }),
    "idle",
  );
  assert.equal(
    classifyPresence({
      activity: { toolName: "Read", phase: "done" },
      updatedAt: new Date(now - IDLE_MS).toISOString(),
      now,
    }),
    "idle",
  );
  assert.equal(
    classifyPresence({
      activity: undefined,
      updatedAt: new Date(now - IDLE_MS).toISOString(),
      now,
    }),
    "idle",
  );
});

test("aggregatePresence：waiting > busy > idle", () => {
  assert.equal(aggregatePresence(["idle", "busy", "waiting"]), "waiting");
  assert.equal(aggregatePresence(["idle", "busy"]), "busy");
  assert.equal(aggregatePresence(["idle"]), "idle");
  assert.equal(aggregatePresence([]), "idle");
});

test("presenceLabelPrefix 三態符號", () => {
  assert.equal(presenceLabelPrefix("waiting"), "! ");
  assert.equal(presenceLabelPrefix("busy"), "● ");
  assert.equal(presenceLabelPrefix("idle"), "○ ");
});

test("presenceColor：waiting 紅、busy 黃、idle 綠", () => {
  assert.equal(presenceColor("waiting"), "red");
  assert.equal(presenceColor("busy"), "yellow");
  assert.equal(presenceColor("idle"), "green");
});

test("waitingBannerMessage 依 toolName", () => {
  assert.equal(waitingBannerMessage("AskUserQuestion"), "正在等待你的回答 — 回到 Claude Code 視窗");
  assert.equal(waitingBannerMessage("ExitPlanMode"), "正在等待你核准計畫 — 回到 Claude Code 視窗");
  assert.equal(waitingBannerMessage("PermissionRequest"), "正在等你核可 — 回到 Codex 視窗");
  assert.equal(waitingBannerMessage("Read"), undefined);
});

test("waiting 邊沿響鈴：同一 key 不重響，換 key 再響", () => {
  const key = waitingEdgeKey("s1", { toolName: "AskUserQuestion", at: "t1" });
  assert.equal(shouldRingWaitingBell(undefined, key), true);
  assert.equal(shouldRingWaitingBell(key, key), false);
  assert.equal(shouldRingWaitingBell(key, undefined), false);
  assert.equal(shouldRingWaitingBell(key, waitingEdgeKey("s1", { toolName: "AskUserQuestion", at: "t2" })), true);
});

test("waitingNoticeForActivity：activity 為 undefined/null 不丟例外，回傳 undefined", () => {
  assert.equal(waitingNoticeForActivity(undefined), undefined);
  assert.equal(waitingNoticeForActivity(null), undefined);
});

test("waitingNoticeForActivity：running + AskUserQuestion 回對應提示", () => {
  assert.equal(
    waitingNoticeForActivity({ toolName: "AskUserQuestion", phase: "running" }),
    "正在等待你的回答 — 回到 Claude Code 視窗",
  );
});

test("waitingNoticeForActivity：不是 waiting 狀態回 undefined", () => {
  assert.equal(waitingNoticeForActivity({ toolName: "Read", phase: "running" }), undefined);
  assert.equal(waitingNoticeForActivity({ toolName: "AskUserQuestion", phase: "done" }), undefined);
});

test("waitingNoticeForActivity：PermissionRequest 寬限期內回 undefined，滿期後回提示", () => {
  const now = Date.parse("2026-09-16T12:00:00.000Z");
  const activity = { toolName: "PermissionRequest", phase: "running", at: new Date(now - 3_000).toISOString() };
  assert.equal(waitingNoticeForActivity(activity, now), undefined);
  assert.equal(waitingNoticeForActivity(activity, now + 3_000), "正在等你核可 — 回到 Codex 視窗");
});

test("classifyPresence：PermissionRequest 滿寬限期才算 waiting，之前算 busy", () => {
  const now = Date.parse("2026-09-16T12:00:00.000Z");
  const activity = { toolName: "PermissionRequest", phase: "running", at: new Date(now - 3_000).toISOString() };
  assert.equal(classifyPresence({ activity, updatedAt: "irrelevant", now }), "busy");
  assert.equal(classifyPresence({ activity, updatedAt: "irrelevant", now: now + 3_000 }), "waiting");
});
