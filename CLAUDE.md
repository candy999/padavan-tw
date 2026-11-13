# padavan-tw 工作說明

- 一律使用**繁體中文（台灣用語）**：對話、程式註解、commit 訊息、文件
- 專案：台灣版 Padavan 韌體（Newifi D3、小米 CR6608），基於 TurBoTse/padavan，核心 4.4.198
- 原則：**穩定優先**；上游檔案盡量不改，台灣版差異集中在 `trunk/configs/tw/` 與新增檔案
- 開發分支：`claude/zealous-feynman-bhwrbf`，開工前先 `git pull`；推送會觸發 GitHub Actions 編譯，同分支新的推送會取消正在跑的編譯
- 總表：`docs/ROADMAP.md`
- **後台介面（www）的工作**：先讀 `docs/HANDOFF-UI.md`（分工、開發流程、UX 設計、資料介面約定）
