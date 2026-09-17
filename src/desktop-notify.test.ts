import assert from "node:assert/strict";
import test from "node:test";
import {
  isNotifyEnabled,
  notifyAlert,
  shouldSendDesktopNotify,
  type NotifyAlertInput,
} from "./desktop-notify.js";

test("isNotifyEnabled：1／true／yes（大小寫不敏感）", () => {
  assert.equal(isNotifyEnabled({}), false);
  assert.equal(isNotifyEnabled({ TASK_TRACKER_NOTIFY: "0" }), false);
  assert.equal(isNotifyEnabled({ TASK_TRACKER_NOTIFY: "1" }), true);
  assert.equal(isNotifyEnabled({ TASK_TRACKER_NOTIFY: "TRUE" }), true);
  assert.equal(isNotifyEnabled({ TASK_TRACKER_NOTIFY: "Yes" }), true);
});

test("shouldSendDesktopNotify：需 enabled 且 edge 變化", () => {
  assert.equal(shouldSendDesktopNotify(undefined, "a", false), false);
  assert.equal(shouldSendDesktopNotify(undefined, "a", true), true);
  assert.equal(shouldSendDesktopNotify("a", "a", true), false);
  assert.equal(shouldSendDesktopNotify("a", "b", true), true);
  assert.equal(shouldSendDesktopNotify("a", undefined, true), false);
});

test("notifyAlert：非 darwin 或未啟用不上呼叫 spawn", () => {
  let calls = 0;
  const spawn = () => {
    calls += 1;
  };
  notifyAlert(
    { sessionId: "s", kind: "waiting", shortId: "s", projectLabel: "proj" },
    { enabled: false, platform: "darwin", spawn },
  );
  notifyAlert(
    { sessionId: "s", kind: "waiting", shortId: "s" },
    { enabled: true, platform: "linux", spawn },
  );
  assert.equal(calls, 0);
});

test("notifyAlert：darwin 啟用時 spawn osascript；失敗静默", () => {
  const calls: Array<[string, string[]]> = [];
  notifyAlert(
    { sessionId: "s", kind: "advice", shortId: "abcd1234", projectLabel: "app" },
    {
      enabled: true,
      platform: "darwin",
      spawn: (command, args) => {
        calls.push([command, args]);
      },
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![0], "osascript");

  notifyAlert(
    { sessionId: "s", kind: "waiting", shortId: "s" } satisfies NotifyAlertInput,
    {
      enabled: true,
      platform: "darwin",
      spawn: () => {
        throw new Error("boom");
      },
    },
  );
});
