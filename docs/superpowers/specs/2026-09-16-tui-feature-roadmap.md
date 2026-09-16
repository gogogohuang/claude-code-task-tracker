# TUI 功能總 Roadmap

日期：2026-09-16（切片重評後再整合）  
狀態：進行中（感知 P1–P5 ✅；v0.17 進度／status ✅；v0.18 Context 衛生實作中；C1 ❌）  
基準版本：v0.17.1（功能合入後再依 release 規則 bump）  

## 問題／目標

把先前對照 [claude-view](https://github.com/tombelieber/claude-view) 產出的 21 項靈感，收成一條可分批交付的路線圖：每一項都有**驗收條件**、建議**發版切片**、以及與現有模組的依賴。

產品定位不變：

> 終端機 sidecar —— 「現在這一支（或幾支）Claude Code session 在做什麼」，加上可執行的 context 衛生建議。

## 非目標（整條 roadmap 期間維持）

- 全文搜尋歷史對話、週報／heatmap／ROI 報表
- 完整聊天瀏覽、加密分享、網頁 Mission Control
- 給 Claude 用的大型 MCP plugin 平台（85 tools 級）
- 系統 CPU／RAM dashboard、本機 LLM phase 分類
- 可調門檻的複雜設定 UI（沿用 Usage Advisor：固定預設；若某項需要開關，僅允許 env／單一 CLI flag）
- **C1 建議一鍵複製**（已取消；複製需求若要做走 E4）

對照文件：`docs/superpowers/specs/2026-09-16-claude-view-comparison.md`

## 原則

1. **單一職責**：每項要能回答「這讓我更快知道 Claude 在幹嘛／該不該清 context」；否則砍掉或降級。
2. **資料優先用既有管線**：hooks 狀態檔、`journal.jsonl`、transcript tail、`inspect`；新增持久化要寫進該項的 design。
3. **Hook 永不拖垮 Claude**：hook 非 0 exit 禁止；錯誤只進 debug log。
4. **版號**：功能進 `main` 的 PR 不強制 bump；下表的 `v0.15+` 是**建議切 release 的邊界**，實際發版時再改 `package.json`／README。
5. **每一切片**：先寫該切片的 design（`*-design.md`）→ plan → 實作 → 測試；本 roadmap 只當目錄，不取代設計。

## 現況能力（已有，不重複發明）

| 能力 | 位置 |
|------|------|
| 活動句（Pre/PostToolUse） | `describe-activity.ts` + hook |
| Task／Todo／TaskCreated·Completed | hook + `schema` / `store` |
| Workflow phases | `workflow/` + watch |
| Usage Advisor + 響鈴 | `usage/` + `AdvicePanel` |
| Tools／MCP 摘要 | `ToolsPanel` + inventory |
| Session 暫存 show／clear／delete | commands + `d`／`s` |
| Prompt 表面 `inspect` | `inspect/` |
| 多 session 選單、新 session 提示 | `App` / `SessionPicker` |

---

## 路線圖總表（2026-09-16 重評 · 再整合）

重評原則不變；**再整合**：同主題盡量同一版出貨，減少「一版只有一項」的碎片。C1 維持取消；T3／語系／複製當收尾或暫緩。

| ID | 靈感 | 線 | 建議 release | 備註 |
|----|------|----|--------------|------|
| P1–P5 | 感知包 | 感知 | ✅ v0.15–0.16 | 已合入 |
| C1 | 建議一鍵複製 | Context | ❌ 不做 | |
| E1 | `status` 一行 | CLI | ✅ v0.17 | |
| T1 | Phase 進度條 | 進度板 | ✅ v0.17 | |
| T2 | Session 結束摘要 | 進度板 | ✅ v0.17 | |
| T4 | 「下一個該做」 | 進度板 | ✅ v0.17 | 不依賴 T3 |
| C2 | `inspect` 熱力 | Context | **v0.18** | 實作中 |
| C3 | Session 減肥清單 | Context | **v0.18** | 實作中 |
| C4 | 開場底子對照 | Context | **v0.18** | 實作中 |
| M1 | Picker 資訊密度 | 多 session | **v0.19** | |
| M3 | 釘選 session | 多 session | **v0.19** | |
| M2 | 跨 session 鈴彙總 | 多 session | **v0.19** | |
| E2 | 桌面通知（可選） | CLI | **v0.19** | 搭 M2 |
| M4 | 雙欄 split | 多 session | **v0.20** | 單獨一版（最重） |
| T3 | Task 依賴圖 | 進度板 | **v0.21／暫緩** | blocks 不穩；可跳過 |
| E3 | 活動句語系 | CLI | **v0.21** | 可提早插 patch |
| E4 | 複製 id／路徑 | CLI | **v0.21** | 可提早插 patch |

### 整合後的版本長相

```text
✅ v0.15–0.16   感知（P1–P5）
✅ v0.17        進度板 + status（E1 + T1 + T2 + T4）
❌ C1

→  v0.18  Context 衛生一整包（實作中）
         C2 + C3 + C4

→  v0.19  多 session 監控（不含 split）
         M1 + M2 + M3 + E2

→  v0.20  雙欄 split
         M4

→  v0.21  收尾／可選
         T3（可暫緩）+ E3 + E4
```

### 為什麼這樣捆

| 版本 | 捆什麼 | 理由 |
|------|--------|------|
| v0.17 | E1+T1+T2+T4 | 都是「進度／狀態摘要」；T4 不需 T3；E1 無 Ink 可同 PR 或同 release |
| v0.18 | C2+C3+C4 | 整條 Context 線一次做完；C4 本來就要 C2 |
| v0.19 | M1+M2+M3+E2 | 列表可讀 + 釘住 + 跨 session 提醒；E2 是 M2 的 OS 延伸 |
| v0.20 | 只 M4 | split 互動／寬度／雙焦點，單獨測較穩 |
| v0.21 | T3+E3+E4 | 打磨；T3 可整項跳過不擋發版 |

相對於前一版切片：少掉「C2 獨占一版」「M 拆三版」的碎片，從約 **9 個待做 minor** 收成 **4 個主線 + 1 個收尾**。

並行／插隊：

- E3／E4 仍可在任何時候當 patch 插。
- T3 上游不穩就標暫緩，不必硬做 v0.21。
- M4 仍建議在 M1 之後。
- **C1 已取消**。

## 線 1 — 感知（P1–P5）

### P1 等待高亮（v0.15）

**做什麼**：當活動句判定為「正在詢問…」或「正在等待核准計畫」時，主畫面頂部固定 banner（與新 session notice 同級），並響鈴一次（同一等待事件不洗版）。

**驗收**

- [x] `AskUserQuestion` PreToolUse → banner 出現且響鈴
- [x] `ExitPlanMode` running → 同樣行為
- [x] PostToolUse／活動離開等待態 → banner 消失
- [x] 同一等待期間不重複響鈴；新的一次等待可再響
- [x] 非 TTY／不支援鈴時不崩潰

### P2 Context 血條（v0.15）

**做什麼**：主畫面顯示一條相對填滿度（例如基於累積 cache／粗估 context 壓力的代理指標）。**不**宣稱精確的「還剩多少 token 到上限」（除非有可信來源）；UI 文案用「壓力／相對用量」。

**驗收**

- [x] 有 usage 資料的 session 顯示血條；無資料時隱藏或 dim「尚無用量」
- [x] 數值隨 transcript tail 更新
- [x] 不引入可調設定 UI；閾值若需要則寫死並在 design 註明

### P3 Picker 忙碌色點（v0.15）

**做什麼**：專案／session 列表每一列有狀態點：跑工具／等你／閒置（例如 N 秒無活動更新）。

**驗收**

- [x] 列表可見三態（或文件定義的等價集合）
- [x] 等你態與 P1 一致
- [x] 選到 session 進主畫面後色點定義不變（同源狀態機）

### P4 活動 timeline（v0.16）

**做什麼**：保留最近 N 筆活動句（建議預設 30～50），主畫面可捲動或獨立快捷鍵面板；**不**存工具全文／prompt。

**驗收**

- [x] Pre→Post 各產生可讀條目（或合併為一條「已…」策略在 design 定案）
- [x] 超過 N 丟最舊；重啟 watch 是否保留：design 二選一寫死（建議：僅記憶體，重啟清空）
- [x] 快捷鍵不與現有 `q/b/a/s/t/d` 衝突（建議 `h` history）

### P5 卡住計時（v0.16）

**做什麼**：同一 `activity.summary`（或同一 tool 進行中）持續超過閾值（建議 120s）時標「可能卡住」。

**驗收**

- [x] 進行中超過閾值出現提示；活動變更後清除
- [x] 不誤判「等你」為卡住（等待態走 P1）
- [x] 閾值固定；文件說明

---

## 線 2 — 進度板（T1–T4）

### T1 Phase 進度條（v0.17）

**做什麼**：有 workflow phases 時，一行 `完成 k／共 n`（可加簡易 bar）。

**驗收**

- [ ] 與現有 phase 列狀態一致
- [ ] 無 workflow 時不顯示
- [ ] 巢狀 `▸` phase 規則與現況一致（不另開列）

### T2 Session 結束摘要（v0.17）

**做什麼**：偵測 session 不再活躍（定義寫進 design：例如狀態檔過舊 + 無進行中活動，或 Claude 結束訊號若可得）時，可看完成率與最後活動；可選寫入簡短摘要檔（不碰 Claude transcript）。

**驗收**

- [ ] 結束判定有明確規則與測試
- [ ] 摘要含：task 完成／總數（若有）、最後活動句、時間
- [ ] 清除暫存（`d`／`clear`）行為與摘要持久化策略在 design 寫清

### T3 Task 依賴圖（文字）（v0.21／暫緩）

**做什麼**：若 payload 有 `blocks`／`blockedBy`（或等價），用縮排或 `A → B` 顯示；欄位對不上時降級為平鋪列表（不炸 hook）。

**驗收**

- [ ] 有依賴時可讀；無依賴時與現況相同
- [ ] schema 不匹配 → debug log + 平鋪，狀態檔不壞
- [ ] 單元測試覆蓋拓撲／環（環則標「循環依賴」並平鋪）

### T4 「下一個該做」（v0.17）

**做什麼**：從 pending 且未 blocked 的 task 推一句建議（取第一個或優先級規則寫死）。

**驗收**

- [ ] 有可執行 pending → 顯示一句
- [ ] 全部 blocked／無 task → 隱藏
- [ ] 不呼叫外部 LLM

---

## 線 3 — Context 衛生（C2–C4；C1 已取消）

### C1 建議一鍵複製 — ❌ 不做

2026-09-16 決定拿掉：不在 Advice 面板做 clipboard 一鍵複製（平台差異／快捷鍵佔用不值得）。若之後要複製文字，只走 E4（session id／路徑）即可。

### C2 `inspect` 熱力（v0.18）

**做什麼**：清單依「預估體積」（檔案 byte 或行數）排序或標示最大的 N 項；「會載入」與「此目錄不會載入」仍分組。

**驗收**

- [x] 可看出最大貢獻者
- [x] 不讀檔案全文進 UI（只 metadata／預覽既有邏輯）
- [x] 測試覆蓋排序穩定

### C3 Session 減肥清單（v0.18）

**做什麼**：從 transcript tail 點名「過肥 tool_result／重複讀大檔」等具體項目（可接在既有偵測器上），列表可捲動。

**驗收**

- [x] 至少涵蓋：單次 tool_result 過肥；可選：同 path 反覆 Read
- [x] 建議動作具體（例如加 `limit`／`head`）
- [x] 範圍仍限 watch 已知 sessionIds

### C4 開場底子對照（v0.18）

**做什麼**：當 advisor 判定「開場底子重」時，鏈到 `inspect` 熱力摘要（最大的 skills／CLAUDE.md），說明「可能是這些」。

**驗收**

- [x] 開場 advice 出現時能看到對照摘要（同面板或一鍵跳轉策略在 design 定）
- [x] 無 inspect 資料時降級為純 advice 文案
- [x] 不自動改使用者的 CLAUDE.md

---

## 線 4 — 多 session（M1–M4）

### M1 Picker 資訊密度（v0.19）

**做什麼**：每列加最後活動截斷 + 可選相對用量／血條縮略。

**驗收**

- [ ] 窄終端不爆版（truncate）
- [ ] 資料缺失時優雅降級
- [ ] 與 P3 色點並存

### M2 跨 session 鈴彙總（v0.19）

**做什麼**：頂列彙總「誰在等你／誰有新 advice」，避免只看得到目前 session。

**驗收**

- [ ] 非目前 session 的等待／advice 會出現在彙總
- [ ] 響鈴策略：合併去重，不瘋狂響
- [ ] 按鍵可跳到對應 session 或打開 advice（design 定一種）

### M3 釘選 session（v0.19）

**做什麼**：明確釘住目前觀看的 session；新 session 只提示、永不自動切走（強化現有行為 + 可顯示「已釘選」）。

**驗收**

- [ ] 釘選態可見
- [ ] 新 session 不切焦點
- [ ] `b` 回列表後行為有文件說明

### M4 雙欄 split（v0.20）

**做什麼**：同時顯示兩個 session 的活動句＋精簡 task／血條；寬度不足時拒絕進入並提示。

**驗收**

- [ ] 兩欄獨立更新
- [ ] 快捷鍵：選左／右焦點、退出 split
- [ ] 終端寬度 &lt; 閾值 → 不可進 split
- [ ] 不做完整對話並排

---

## 線 5 — CLI 小而美（E1–E4，可隨時插入）

### E1 `task-tracker status`（tmux）（v0.17）

**做什麼**：stdout 一行（或固定欄位）輸出目前 cwd 對應 session 的狀態摘要，供 tmux／starship。非 Ink。

**驗收**

- [ ] 無 session 時 exit 0 + 明確空狀態字串
- [ ] 適合腳本解析（建議穩定前綴或 `--json` 二選一，design 定案）
- [ ] 不啟動 TUI、不寫狀態檔

### E2 桌面通知（可選）（v0.19）

**做什麼**：env 開啟時（例如 `TASK_TRACKER_NOTIFY=1`），P1／新 advice 走 OS 通知。

**驗收**

- [ ] 預設關閉
- [ ] 失敗静默降級
- [ ] 與終端響鈴可並存、不重複洗版（同一事件）

### E3 活動句語系（v0.21）

**做什麼**：`TASK_TRACKER_LOCALE=en|zh`（或 `LANG` 推斷）切換 `describe-activity` 模板。

**驗收**

- [ ] en／zh 覆蓋主要工具句
- [ ] 未知 locale 回退 zh（或 en，design 寫死）
- [ ] hook 與 TUI 顯示一致

### E4 複製 session id／路徑快捷鍵（v0.21）

**做什麼**：主畫面快捷鍵複製 `session_id` 或暫存 JSON path。

**驗收**

- [ ] 說明列有鍵位
- [ ] clipboard 失敗有 notice
- [ ] 快捷鍵不與既有 `q/b/a/s/t/d/h` 衝突

---

## 每一切片開工儀式

1. 從本表複製該 release 的 ID → 新檔 `docs/superpowers/specs/YYYY-MM-DD-<slice>-design.md`
2. 寫清楚：資料流、快捷鍵、非目標、測試清單
3. `writing-plans` 產出 plan
4. 實作（TDD）→ review →（發版時才）bump version

## 成功標準（整條 roadmap 完成時）

- [ ] 上表剩餘 ID（不含已取消的 C1）皆有對應 design／實作／測試或文件化的「不做了」決定
- [ ] README 快捷鍵與畫面說明與實作一致
- [ ] 產品仍可一句话解释：終端追蹤 Claude 在做什麼 + context 衛生
- [ ] 未引入網頁 dashboard／全文搜尋／預設 telemetry

## 待審核問題（寫進切片 design 前可再定）

1. T2 「session 結束」的操作型定義  
2. E1 輸出要純文字一行還是另加 `--json`  
3. T3 是否直接暫緩、不進 v0.21  

## 核准／下一步

本檔已整合成 4 個主線 minor + 1 個收尾。若同意，下一個動作：

- 「開 v0.17 design」（E1 + T1 + T2 + T4）

**在你明確點名切片之前，不寫該切片的 plan、不動 code。**
