# Context 衛生（子 agent 結論 + 階段寫檔）— Design

## 背景與目標

長 session 的 context 幾乎全是 Messages。兩個事前規則可以少灌主線，但現行
`task-tracker` 沒寫進這個 repo 的 `CLAUDE.md`，`watch` 的建議也只叫 `/clear`，
沒叫人先把進度落地。

1. **子 agent 只交結論**：完整 diff / review 原文貼回主線，會一次灌肥 Messages。
   工具無法事後剪報告，只能靠這個 repo 裡跑 Claude Code 的模型遵守規則；過肥時
   `watch` 再給一句事後提醒。
2. **細節寫進檔案**：階段結束先寫 plan/report，再 `/clear`。下一條 session `Read`
   那份檔，不靠舊對話。`watch` 建議維持一句動作；完整可複製 prompt 只放 `CLAUDE.md`。

範圍是 **A + B**：本專案 session 遵守，且改產品建議文案。做法是最小改動：不新增
detector `kind`、不改 hook、不改門檻。

## 非目標

- 不強制停止 session、不從 `watch` 遠端執行 `/clear`。
- 不改 hook（維持 usage-advisor spec）。
- 不新增 advice `kind`、不改 200 則 / 90 分鐘 / 30,000 字元等門檻。
- 不做第 3 點（事前裁 Bash/Read）與第 5 點（佔窗 % 通知）。
- 不做成可安裝 skill、不改 `task-tracker init`。
- 版本維持 `0.10.0`（同一條未發佈的 `feat/usage-advisor`）。
- 不更新 README「升到 vX.Y.Z 後要再執行一次」那行。

## `CLAUDE.md`（A）

在現有「PR 發版」後面加一節，標題固定為 `## Context 衛生`。條文必須包含下列三塊，
順序與措辭以實作為準，但語意不可少。

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

必須原文收錄這三段（實作時整段貼進 `CLAUDE.md`，不要改寫）：

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

## `watch` 建議文案（B）

建議仍是**一句**，數字用 `.toLocaleString("en-US")`，與現有 detector 一致。

### `long-session`

`detect.ts` 的 `message` 改成（中間的數字仍由現有變數插入）：

```text
先把進度寫進 docs/superpowers/plans/（結論、檔案清單、未完成項），再執行 /clear 或另開新 session（這個 session 已經 {n} 則訊息、開了 {mins} 分鐘）。
```

`{n}` 是 `after.mainThreadMsgCount`，`{mins}` 是 `Math.round(elapsedMinutes(after))`。
觸發條件不變。

### `fat-tool-result`

`toolName` 為 `Agent` 或 `SubagentHandback` 時用：

```text
下次派子 agent 只讓它交回結論與檔案路徑，不要把完整 diff/review 貼回主線（剛剛回傳了 {n} 字元）。
```

其他工具名（含對不到而顯示「工具」）維持現有句子：

```text
重跑剛剛那個 {toolName} 呼叫，加上 head/grep/limit 把輸出縮小（原本回傳了 {n} 字元）。
```

門檻仍是 `> 30000` 字元。`Agent` 未過門檻時不額外提醒（事前規則只在 `CLAUDE.md`）。

不新增 `AdviceKind`。

## 測試

改 `src/usage/detect.test.ts`：

- 既有 `long-session` 跨 200 則的測試：繼續 `assert.match(..., /\/clear/)`，並加上能對到
  `docs\/superpowers\/plans\/` 的 match。
- 新增：`fat-tool-result` 且 `toolName === "Agent"`、字元 30001，message 對到
  `結論與檔案路徑`，且**不要**對到 `head/grep/limit`。
- 新增：`SubagentHandback` 同上。
- 既有 Bash / 「工具」fallback 測試維持舊句，確認不被 Agent 分支誤傷。

`CLAUDE.md` 沒有自動測試。

## README

`watch` 用量建議那段（目前列四種狀況與「`/clear`、開新 session、或加 `head`/`limit` 重跑」）
改成與新文案一致：拖太長時先寫 plan 再 `/clear`；子 agent 回傳過肥時只交結論與路徑。
不新增獨立功能段落。不改版本號行（維持 v0.10.0）。

## 檔案

| 檔案 | 變更 |
|------|------|
| `CLAUDE.md` | 新增「Context 衛生」節 |
| `src/usage/detect.ts` | 兩處 `message` 字串；`fat-tool-result` 依工具名分支 |
| `src/usage/detect.test.ts` | 既有 long-session 補強；Agent / SubagentHandback 新測試 |
| `README.md` | 用量建議那句對齊新文案 |
| `docs/superpowers/specs/2026-09-15-usage-advisor-design.md` | **不改**（那是已落地的 advisor spec；本文是增量） |

## 實作順序

1. 先改 `detect.test.ts`（RED），再改 `detect.ts`（GREEN）。
2. 寫 `CLAUDE.md` 與 README。
3. 跑 `detect` 測試與完整 `npm test` / `typecheck`。
