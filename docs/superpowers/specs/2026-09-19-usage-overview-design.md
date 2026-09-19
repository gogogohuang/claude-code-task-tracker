# 用量總覽 panel 設計

日期：2026-09-19　狀態：設計已與使用者確認，待審 spec；實作排在 Codex 用量計畫（`docs/superpowers/plans/2026-09-19-codex-usage-plan.md`）之後

## 問題

`watch` 只顯示每個 session「最近一輪」的 context 佔用量，看不出各 session 累計花了多少，也無法比較誰最吃資源。
使用者希望在 panel 看到每個 session 佔據了多少 usage。

## 結論

新增「用量總覽」panel：列出所有已知 session（Claude 與 Codex 混合，標示來源），依累計用量由大到小排序，
每列顯示累計 token、占全部的百分比與一條比例條。

決策（使用者已確認）：

- **usage 的定義**：每個 session 累計的「新增工作量」token，不含 cache 讀取。
  - Claude：`input + cache_creation + output`
  - Codex：`input_tokens − cached_input_tokens + output_tokens`（由 Codex 解析器對應成同樣欄位，見 Codex 用量 spec）
  - 不含 cache 讀取，是因為 Claude 每輪都重讀整個 context，累加會讓數字被灌爆、失去比較意義。
- **不做**：帳號額度（Codex `rate_limits.primary.used_percent`，是整個帳號的數字，無法拆到 session）、
  每列直接加在 session 列表（另案）、含 cache 讀取的總量欄位。

## 設計

### 統計

`SessionUsageStats` 新增 optional `workTokensTotal?: number`。`accumulate` 在處理每個「通過去重、非 sidechain」的 usage 事件時：

```
workTokensTotal += usage.input + usage.cacheCreation + usage.output
```

Claude 與 Codex 共用這一條公式：Codex 解析器已把 `input` 固定為 0、`cacheCreation = input_tokens − cached`，
所以不需要依來源分流。累計值由 `prime`／`refresh` 讀 transcript 得出，每次啟動 `watch` 重算，不另外存檔。

限制：`accumulate` 會略過 sidechain（子 agent）事件，所以 Claude 的累計不含子 agent 花的 token。
第一版接受此限制，並在 README 註明。

### 總覽計算（純函式，新檔 `src/usage-overview.ts`）

```typescript
export interface UsageOverviewInput {
  sessionId: string;
  label: string;          // 專案名稱（cwd 的 basename）
  agent: Agent;
  workTokens: number | undefined; // undefined = 還沒有用量資料
}
export interface UsageOverviewRow extends UsageOverviewInput {
  sharePct: number | undefined;   // 占「有資料的 session 總和」的百分比，四捨五入到整數；無資料為 undefined
}
export function buildUsageOverview(inputs: UsageOverviewInput[]): UsageOverviewRow[];
export function formatTokenCount(tokens: number): string; // 999 → "999"、12_345 → "12.3K"、2_345_678 → "2.3M"
```

- 排序：有資料者依 `workTokens` 由大到小，同值依 `sessionId` 穩定排序；無資料者排在最後。
- `sharePct = round(workTokens / total × 100)`，`total` 為所有有資料的 session 的 `workTokens` 總和；
  `total` 為 0 時所有 `sharePct` 為 0。
- `formatTokenCount`：< 1,000 原數字；< 1,000,000 以 K、一位小數（去掉尾端 `.0`）；其餘以 M、一位小數。

### 畫面（`src/ui/UsagePanel.tsx`）

- 由 `watch` 內按 `u` 開啟（實作前須確認 `u` 在 `src/ui/App.tsx` 尚未被占用；若已占用改用未使用的鍵並在 README 說明），
  按 `b` 回上一層，行為比照現有 advice／history 面板。
- 每列：`[Claude|Codex] 專案名  2.3M  41%  ████████░░░░`，比例條寬 12 格，依 `sharePct` 填滿。
  無資料的 session 顯示 `—`，不畫比例條。
- 資料來源：所有已知 session（不限目前分頁），`workTokens = peek(sessionId)?.workTokensTotal`，
  `label` 取狀態檔 `cwd` 的 basename（沒有 cwd 的 session 依現有規則不列出）。
- 用量統計在記憶體（`tail-runtime`），所以要等對應 session 的 transcript 已被 `prime` 才有數字；
  尚未 prime 的顯示 `—`。

### 錯誤處理

沿用現有慣例：用量分析出錯不拖垮主畫面；缺欄位視為無資料。

### 測試

- `accumulate`：`workTokensTotal` 逐事件累加、去重事件不重複累加、sidechain 不累加、沒有 usage 的事件不影響；
  既有測試若整份比對 stats 物件須確認不因新鍵失敗（新鍵只在有 usage 事件後出現）。
- `buildUsageOverview`／`formatTokenCount`：排序、同值穩定、無資料排最後、百分比四捨五入、`total = 0`、邊界值（999／1,000／999,999／1,000,000）。
- 整合：以 Claude 與 Codex 兩份 fixture 走 `parse → accumulate`，確認同一公式得出預期累計值。
- `pnpm typecheck`、`pnpm test`。

## 風險

- Claude 累計不含子 agent，重度使用子 agent 的 session 會被低估。
- 「新增工作量」不是帳單金額：不同來源的 token 單價不同，跨 Claude／Codex 比較的是工作量而不是花費。
- Codex 的 `input − cached` 是推論（見 Codex 用量 spec），數字可能與 Codex 內部計費略有出入。

## 實作順序（交給 writing-plans 細化）

1. `SessionUsageStats.workTokensTotal` 與 `accumulate` 累加（含測試）。
2. `src/usage-overview.ts` 純函式（含測試）。
3. `src/ui/UsagePanel.tsx`、`App.tsx` 接鍵與資料。
4. README 更新（新 panel、限制）。
