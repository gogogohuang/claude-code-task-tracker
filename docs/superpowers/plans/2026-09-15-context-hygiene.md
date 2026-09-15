# Context 衛生 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓這個 repo 的 Claude Code session 遵守「子 agent 只交結論、階段結束先寫檔再 /clear」，並讓 `watch` 的 `long-session` / 子代理 `fat-tool-result` 建議改成同一套一句動作。

**Architecture:** 不新增 detector 或 hook。`detect.ts` 只改兩處 `message` 字串，並在 `fat-tool-result` 依 `toolName === "Agent" | "SubagentHandback"` 分支。完整交接範本只寫進本專案 `CLAUDE.md`；README 對齊那兩句建議。

**Tech Stack:** TypeScript、Node `node:test` + `node:assert/strict`（既有）。無新依賴。

**Spec:** `docs/superpowers/specs/2026-09-15-context-hygiene-design.md`

## Global Constraints

- 不新增 `AdviceKind`、不改 hook、不改 200 則 / 90 分鐘 / 30,000 字元門檻。
- 建議仍是一句；數字用 `.toLocaleString("en-US")`。
- 版本維持 `0.10.0`；不改 README「升到 vX.Y.Z 後要再執行一次」。
- 不改 `docs/superpowers/specs/2026-09-15-usage-advisor-design.md`。
- 不改 `src/hook/task-tracker-hook.ts`。

---

### Task 1: Detector 文案（TDD）

**Files:**
- Modify: `src/usage/detect.ts`
- Test: `src/usage/detect.test.ts`

**Interfaces:**
- Consumes: 既有 `detect(_prev, _next, steps)`、`Advice.kind === "long-session" | "fat-tool-result"`、`toolResultEvent(toolName, chars, timestamp)` helper。
- Produces: 不變的函式簽名；`long-session` / `fat-tool-result` 的 `message` 字串依 spec 鎖定。

- [ ] **Step 1: 改既有 long-session 測試，並新增 Agent / SubagentHandback 測試**

在 `src/usage/detect.test.ts` 的 `"detect：long-session 訊息數剛好跨過 200 才觸發一次"` 裡，`assert.match(longSession[0].message, /\/clear/);` 後面加一行：

```ts
  assert.match(longSession[0].message, /docs\/superpowers\/plans\//);
```

在檔案末尾、`"detect：fat-tool-result 對不到工具名稱時顯示「工具」"` 測試之後，新增：

```ts
test("detect：fat-tool-result 對 Agent 改叫只交結論與檔案路徑", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next, steps } = accumulate(stats0, [toolResultEvent("Agent", 30001, "t0")]);
  const advice = detect(stats0, next, steps);
  assert.equal(advice.length, 1);
  assert.equal(advice[0].kind, "fat-tool-result");
  assert.match(advice[0].message, /結論與檔案路徑/);
  assert.equal(/head\/grep\/limit/.test(advice[0].message), false);
  assert.match(advice[0].message, /30,001/);
});

test("detect：fat-tool-result 對 SubagentHandback 同樣只交結論與檔案路徑", () => {
  const stats0 = createSessionUsageStats("s1");
  const { next, steps } = accumulate(stats0, [toolResultEvent("SubagentHandback", 30001, "t0")]);
  const advice = detect(stats0, next, steps);
  assert.equal(advice[0].kind, "fat-tool-result");
  assert.match(advice[0].message, /結論與檔案路徑/);
  assert.equal(/head\/grep\/limit/.test(advice[0].message), false);
});
```

不要改 Bash 與「工具」那兩個既有測試。

- [ ] **Step 2: 跑測試，確認 RED**

Run: `node --import tsx --test src/usage/detect.test.ts`

Expected: FAIL — long-session 那則缺 `docs/superpowers/plans/`；兩個新測試的 `結論與檔案路徑` 對不到現有 `head/grep/limit` 句子。Bash / 「工具」測試仍應 PASS。

- [ ] **Step 3: 改 `src/usage/detect.ts`**

把 `checkLongSession` 的 `message` 換成：

```ts
      message: `先把進度寫進 docs/superpowers/plans/（結論、檔案清單、未完成項），再執行 /clear 或另開新 session（這個 session 已經 ${after.mainThreadMsgCount.toLocaleString("en-US")} 則訊息、開了 ${Math.round(elapsedMinutes(after)).toLocaleString("en-US")} 分鐘）。`,
```

把 `checkFatToolResult` 整段換成（門檻與 early-return 不變）：

```ts
function checkFatToolResult(stats: SessionUsageStats, step: AccumulateStep): Advice[] {
  const toolResultChars = step.event.toolResultChars;
  if (!toolResultChars) return [];
  if (toolResultChars.chars <= FAT_TOOL_RESULT_CHARS) return [];
  const chars = toolResultChars.chars.toLocaleString("en-US");
  const isSubagent = toolResultChars.toolName === "Agent" || toolResultChars.toolName === "SubagentHandback";
  const message = isSubagent
    ? `下次派子 agent 只讓它交回結論與檔案路徑，不要把完整 diff/review 貼回主線（剛剛回傳了 ${chars} 字元）。`
    : `重跑剛剛那個 ${toolResultChars.toolName ?? "工具"} 呼叫，加上 head/grep/limit 把輸出縮小（原本回傳了 ${chars} 字元）。`;
  return [
    {
      sessionId: stats.sessionId,
      kind: "fat-tool-result",
      at: step.event.timestamp ?? new Date().toISOString(),
      message,
    },
  ];
}
```

- [ ] **Step 4: 再跑 detect 測試**

Run: `node --import tsx --test src/usage/detect.test.ts`

Expected: PASS（含既有 9 則與新增 2 則）。

- [ ] **Step 5: Commit**

```bash
git add src/usage/detect.ts src/usage/detect.test.ts
git commit -m "$(cat <<'EOF'
Tell long sessions to write a plan before /clear

Agent and SubagentHandback fat results now ask for conclusions and
file paths instead of head/grep/limit, matching the context-hygiene spec.
EOF
)"
```

---

### Task 2: `CLAUDE.md` 與 README

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`（約第 70–73 行那一段）

**Interfaces:**
- Consumes: Task 1 已落地的建議文案。
- Produces: 本專案 session 可讀的 Context 衛生規則；README 與 `watch` 建議對齊。

- [ ] **Step 1: 在 `CLAUDE.md`「PR 發版」整節後面追加（含前面空行）**

從 `## Context 衛生` 起到檔案結尾，內容必須是：

````markdown
## Context 衛生

在這個 repo 跑 Claude Code 時遵守，用來少灌主線 Messages。

### 子 agent

派 `Agent` / 子任務時，交回主線只能有：

- 結論（≤15 行）
- 改了哪些路徑
- 測試指令與結果（通過/失敗各一行）
- 後續要 `Read` 的檔案路徑

禁止：完整 diff、完整 review 原文、整份檔案內容、長 log。細節寫進檔案，主線只給路徑。

### 階段交接

調查 / 實作 / review 結束時，先把進度寫進 `docs/superpowers/plans/` 或
`docs/superpowers/specs/`，再 `/clear` 或開新 session。下一條 session 只 `Read` 那份檔，
不要重讀整個舊對話。

### 可複製範本

**調查結束**

```text
把調查結果寫進 docs/superpowers/specs/<日期>-<主題>-design.md，
只保留：問題、結論、範圍內/外、下一步實作順序。然後 /clear。
```

**實作結束**

```text
把已改檔案、測試指令、剩餘風險寫進同一份 plan 的「完成條件」。
不要把 diff 貼進對話。然後 /clear。下一條 session 只 Read 那份 plan 做 review。
```

**Review 開始（新 session）**

```text
Read <plan 路徑>。只 review 清單裡的檔案。發現寫進 plan 的 Issues，不要把整份檔案 dump 進對話。
```
````

「PR 發版」原有四點不要改。三段範本必須與 spec 原文一致，不要改寫。

- [ ] **Step 2: 改 README 用量建議那句**

把：

```markdown
（例如 `/clear`、開新 session、或加 `head`/`limit` 重跑）。按 `a` 隨時查看目前所有建議，`b` 回上一頁。
```

換成：

```markdown
（例如先把進度寫進 plan 再 `/clear`、開新 session、子 agent 只交結論與路徑、或加 `head`/`limit` 重跑）。按 `a` 隨時查看目前所有建議，`b` 回上一頁。
```

不要改「目前版本」行、不要改「升到 vX.Y.Z 後要再執行一次」。

- [ ] **Step 3: 跑完整測試與 typecheck**

Run: `npm test && npm run typecheck`

Expected: 測試全過（detect 應為 11 則 focused；全套比改前多 2）、typecheck 乾淨。`package.json` version 仍是 `0.10.0`。

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "$(cat <<'EOF'
Document context hygiene for this repo and align README advice

CLAUDE.md now requires conclusion-only subagent handback and
write-then-clear handoff; README matches the new watch copy.
EOF
)"
```

---

## Self-review

- Spec「CLAUDE.md 三塊」→ Task 2 Step 1。
- Spec「long-session / Agent / SubagentHandback / 其他工具 message」→ Task 1 Step 3。
- Spec 測試清單 → Task 1 Step 1。
- Spec README → Task 2 Step 2。
- Spec 非目標（hook、kind、門檻、版本、usage-advisor spec）→ Global Constraints，計畫裡沒有對應改動。
- 無 TBD；兩句 `message` 與三段範本都是全文。
