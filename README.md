# claude-code-task-tracker

終端機 TUI，即時追蹤 Claude Code 自己開出來的 task（`TodoWrite` 工具）。

## 運作原理

1. `task-tracker init` 會在目前專案的 `.claude/settings.json` 註冊一個 `PostToolUse` hook，matcher 設為 `TodoWrite`。
2. 之後 Claude Code 每次呼叫 `TodoWrite` 更新 task 清單，hook 會把當下的 task 狀態寫進
   `~/.claude-task-tracker/<session_id>.json`。
3. `task-tracker watch` 啟動一個 Ink 打造的 TUI，watch 這個檔案，task 一有變化就即時重繪。

```
Claude Code (TodoWrite) → PostToolUse hook → ~/.claude-task-tracker/<session>.json → TUI (watch)
```

## 安裝與使用（npx）

不需要事先安裝，`npx` 每次都會用最新版本執行。依照套件目前是否已發布到 npm，有三種跑法：

| 情境 | 指令 |
|---|---|
| 已發布到 npm registry | `npx claude-code-task-tracker init` |
| 還沒發布，直接用 GitHub repo | `npx github:<你的帳號>/claude-code-task-tracker init` |
| 還沒發布，本機路徑（開發中測試用） | 在專案目錄下執行 `npx . init` |

三種情況下，npx 第一次執行都會觸發 `prepare` script（`npm run build`），自動把 TypeScript 編譯成 `dist/`，不用手動 `npm run build`。

```bash
cd 你的專案
npx claude-code-task-tracker init     # 只需要做一次，會寫入 .claude/settings.json
claude                                 # 照常開始你的 Claude Code session
```

另開一個終端機視窗：

```bash
npx claude-code-task-tracker watch
```

如果你比較常用，也可以額外裝一次全域指令，之後直接打 `task-tracker` 不用打 `npx`：

```bash
npm install -g claude-code-task-tracker
```

若同時有多個 session 在跑，`watch` 會列出選單讓你選；也可以直接指定：

```bash
task-tracker watch --session <session_id>
```

畫面內按 `q` 離開。

## 重要注意事項

- **新版模型預設沒有 TodoWrite**：Sonnet 5、Opus 4.8、Fable 5、Mythos 5 等模型，Claude Code
  預設不會提供 `TodoWrite` / Task 系列工具（避免佔用 context）。如果你用的是這些模型，
  要先設定環境變數才抓得到資料：

  ```bash
  export CLAUDE_CODE_ENABLE_TODO_TOOLS=1
  ```

- **hook payload 結構可能隨版本調整**：`src/schema.ts` 裡的 `HookPayloadSchema` 是依官方
  hooks 文件整理的欄位，用 `.passthrough()` 保留未知欄位以求穩健，但正式串接前建議對照
  當下版本的 [Claude Code hooks 文件](https://docs.claude.com/en/docs/claude-code/hooks)
  再確認一次欄位名稱。
- hook 腳本任何時候都不會讓 process 以非 0 結束，避免因為 tracker 的問題打斷你正在跑的
  Claude Code session；所有錯誤會寫進 `~/.claude-task-tracker/hook-debug.log`。

## 發布到 npm（讓 `npx claude-code-task-tracker` 直接可用）

`.github/workflows/publish.yml` 已經設定好：push 一個 `v*` 開頭的 tag 就會自動 build 並
`npm publish`。使用前要做兩件事：

1. 到 npmjs.com 建立帳號（或用既有帳號），產生一組 **Automation 類型**的 access token
2. 把 token 存成 repo 的 GitHub secret，名稱要叫 `NPM_TOKEN`

之後發新版就是：

```bash
npm version patch   # 或 minor / major，會自動 bump 版本號 + 建 git tag
git push --follow-tags
```

`claude-code-task-tracker` 這個名字目前在 npm 上還沒人用，但如果你想改成自己 scope 底下的
名字（例如 `@你的帳號/claude-code-task-tracker`），也可以，好處是不用擔心撞名，發布時要加
`--access public`（workflow 裡已經加了）。改名字的話記得同步改 `package.json` 的 `name`。

## 專案結構

```
src/
├── cli.tsx                  # commander 進入點（init / watch 指令）
├── schema.ts                 # zod schema：TodoWrite 格式、hook payload、狀態檔
├── store.ts                  # 狀態檔案讀寫（write-then-rename 避免讀到半份資料）
├── commands/
│   └── init.ts                # 寫入 .claude/settings.json 的 hook 設定
├── hook/
│   └── task-tracker-hook.ts   # Claude Code 實際呼叫的 hook 腳本
└── ui/
    ├── App.tsx                # 主畫面，負責 session 偵測與檔案監控
    ├── SessionPicker.tsx       # 多 session 時的選單
    └── TaskList.tsx            # task 清單 + 進度條渲染
```

## 之後可以擴充的方向

- 支援新版 Tasks API（`TaskCreate` / `TaskUpdate` / `TaskList`），不只 `TodoWrite`
- 歷史紀錄（每個 session 結束後保留一份完成率統計）
- 多 session 同時並排顯示（split view）
