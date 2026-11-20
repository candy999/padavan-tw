# 交接單：後台介面（本機工作階段）

> 寫給：在使用者電腦上執行的 Claude Code（本機工作階段）。
> 目的：本機可以用瀏覽器直接連路由器後台除錯，所以**後台介面改由本機負責**。
> 一律用**繁體中文（台灣用語）**跟使用者溝通，包括程式註解與 commit 訊息。

---

## 0. 分工與流程（先讀這段）

> **2026-11-17 起前端、後端、實機測試、編譯發布全部由本機負責**（見 HANDOFF-LOCAL），下文提到「雲端」「B 階段交給雲端」的地方，現在都是本機自己做。硬體 QoS（頻寬管理）已在 2026-11-18 捨棄，頁面已移除。

| 階段 | 在哪裡 | 做什麼 |
|---|---|---|
| **U：介面全面重做** | **本機**（就是你） | 依第 5 節的使用者目的重新設計後台，**連未來功能的介面一起做**；未來功能的資料先用模擬資料（第 6 節的資料介面約定），預覽工具與實機都要能跑 |
| B：後端 | 本機（原本是雲端工作階段） | 依第 6 節的約定實作資料來源（`twstats` 取樣器、漫遊資料、黑潮狀態轉接等），把模擬資料換成真的 |
| P：精修 | 本機 | 前後端接上後，回到本機在實機上精修 UI 細節（文案、間距、手機操作、錯誤狀態） |

**原則：前後端只透過第 6 節的「資料介面約定」溝通。** 介面需要新資料時，先在第 6 節新增或修改約定（含欄位、單位、更新頻率、沒有資料時的表示法），再做模擬資料。不要直接改後端 C 程式去產生資料，那是 B 階段的工作。例外：純前端需要、而且只是把**現有** nvram 變數或現有 ej 函式包成 JSON 的小改動，可以做，但要在第 6 節註明。

---

## 1. 要準備的專案與工具

使用者只會指定一個本機資料夾（以下稱 `<工作區>`）。請在裡面準備：

### 1.1 主專案（必要）
```bash
cd <工作區>
git clone https://github.com/candy999/padavan-tw.git
cd padavan-tw
git checkout claude/zealous-feynman-bhwrbf
git pull
```
- 開發分支：`claude/zealous-feynman-bhwrbf`（**每次開工前先 `git pull`**；2026-11-17 起只有本機在用）
- `main` 目前只合併到 PR #1；之後由使用者決定何時再開 PR 合併

### 1.2 參考專案（唯讀，需要時再拉）
| 專案 | 用途 | 指令 |
|---|---|---|
| `TurBoTse/padavan` | 上游；比對我們改了什麼、同步上游 | `git clone --filter=blob:none https://github.com/TurBoTse/padavan.git upstream-padavan` |
| `candy999/kuroshio-dns` | 黑潮 DNS（DNS 頁、儀表板的 DNS 統計會用到它的 `/api/status`、`/api/dashboard`） | `git clone --depth 1 https://github.com/candy999/kuroshio-dns.git` |

不需要編譯工具鏈，**本機不編韌體**（韌體由 GitHub Actions 編，見 2.4）。

### 1.3 本機工具
| 工具 | 用途 |
|---|---|
| Python 3 | 預覽伺服器 `tools/ui-preview/serve.py` |
| Node.js ＋ Playwright（`npm i -D playwright && npx playwright install chromium`） | 截圖 `tools/ui-preview/shoot.js`（桌機 1440、手機 390、亮／暗色） |
| ssh、scp | 連路由器（實機即時測試） |
| 瀏覽器 | 直接開路由器後台 |

---

## 2. 開發與測試流程

### 2.1 預覽工具（不需要路由器）
```bash
python3 tools/ui-preview/serve.py            # http://127.0.0.1:8088/
node tools/ui-preview/shoot.js ui-shots index.asp Advanced_WAN_Content.asp
SCHEME=dark node tools/ui-preview/shoot.js ui-shots index.asp
```
- `serve.py` 會把 `.asp` 裡的 `<% ... %>` 換成範例資料、`<#key#>` 換成 `TW.dict`，並注入跟韌體相同的 viewport 與 `tw.css`
- 範例 nvram 在 `serve.py` 的 `NVRAM`；ej 函式的模擬在同一個檔案
- **未來功能的模擬資料**：請新增 `tools/ui-preview/mock/<名稱>.json`，並讓 `serve.py` 依第 6 節的網址回傳（建議同時提供「正常」「有問題」「沒有資料」三種情境，用網址參數 `?scenario=` 切換）
- `shoot.js` 會印出 `scrollWidth`，**手機版出現橫向溢出就是錯**

### 2.2 實機即時測試（不用重刷韌體）
路由器：Newifi D3，後台 `http://192.168.2.1/`，帳號密碼預設 `admin`／`admin`（使用者可能已改），SSH 預設開啟（帳號同後台）。

`/www` 是唯讀的 squashfs，用記憶體裡的副本蓋上去就能直接改：
```bash
ssh admin@192.168.2.1 'cp -a /www /tmp/www-dev && mount -o bind /tmp/www-dev /www'
scp -r trunk/user/www/n56u_ribbon_fixed/state.js admin@192.168.2.1:/www/
```
- **建議直接用 `python3 tools/ui-preview/push.py`**：自動掛上記憶體副本、重啟 httpd、照 Makefile 注入後推送 git 有變更的 www 檔案（要先設定 SSH 金鑰登入）
- 改完的檔案直接放進 `/www`（其實是 `/tmp/www-dev`），瀏覽器強制重新整理即可（`tw.css` 會被快取，要 Ctrl＋Shift＋R）
- **注意 0**：httpd 啟動時已經 chdir 到原本的 `/www`，掛上副本後要 `killall httpd; httpd` 才會讀到新檔案
- **注意 1**：韌體編譯時會在每個 `.asp` 注入 viewport 與 `tw.css`（`trunk/user/www/Makefile`）。從專案直接複製 `.asp` 上去，要自己做同樣的注入（或寫一個小腳本：照 Makefile 的 sed 處理後再上傳）
- **注意 2**：語言檔（`TW.dict`）由 httpd 載入後快取在記憶體。改了字典要到「系統管理」切換一次語言再切回來，或在 SSH 執行 `killall httpd; httpd`（重啟 httpd）
- **注意 3**：路由器重開機後 `/www` 會恢復成韌體內建的版本，`/tmp` 的副本也會消失
- **不要**在實機上試「韌體更新」「恢復原廠設定」「清除 Flash」之類的動作，除非使用者同意

### 2.3 送出表單會真的改設定
實機上按「套用」會寫入 nvram 並重啟服務。改到網路、Wi-Fi、管理密碼、LAN IP 之前先跟使用者確認，避免把自己（和使用者）斷線。

### 2.4 編韌體與發布
- 推送到 `claude/zealous-feynman-bhwrbf` 會觸發 GitHub Actions（`.github/workflows/build.yml`），編 NEWIFI3、CR660x 的標準版與 `-oc1000` 版，約 8～12 分鐘
- **同一分支新的推送會取消正在跑的編譯**（concurrency 設定）。正在等某次編譯結果時，先確認再推送
- 只改 `*.md`、`docs/**` 不會觸發編譯
- Commit 訊息用繁體中文，第一行「範圍: 摘要」（例如 `www: 總覽儀表板第一版`），內文寫為什麼這樣改

---

## 3. 程式碼地圖

### 3.1 網頁（`trunk/user/www/`）
| 路徑 | 說明 |
|---|---|
| `n56u_ribbon_fixed/*.asp` | 106 個頁面（上游 84 頁＋台灣版新增）。`<% ej函式() %>` 由 httpd 執行，`<#字典鍵#>` 依語言替換 |
| `n56u_ribbon_fixed/state.js` | **框架**：頂部狀態列、左側選單、手機抽屜與底部分頁、`show_banner()`／`show_menu()`／`show_footer()`；選單結構在 `menuL1_*`、`menuL2_*`、`tablink` |
| `n56u_ribbon_fixed/bootstrap/css/tw.css` | **台灣版主題**：設計語彙的 CSS 變數（亮／暗色自動）、覆寫舊 Bootstrap 2 class、RWD、手機表格卡片化 |
| `n56u_ribbon_fixed/general.js` | 共用函式（台灣版加了 `tw_channel_hint`、`tw_roam_show` 等） |
| `n56u_ribbon_fixed/wg.js`、`qrcode.js` | WireGuard 金鑰（瀏覽器產生 X25519）與 QR 碼 |
| `dict/TW.dict`、`dict/EN.dict` | 字典。**新增字串時兩個都要加**（EN 是後備語言） |
| `Makefile` | 安裝時注入 viewport 與 `tw.css` 到每個 `.asp` |
| `n56u_ribbon_fixed/jquery.js`、`bootstrap/` | jQuery 1.8.3、Bootstrap 2.0.3（2012 年，舊頁面依賴，不能拿掉） |

台灣版新增或大改過的頁面：`Advanced_kuroshio.asp`（DNS 服務）、`Advanced_wireguard.asp`（WireGuard 伺服器）、`Advanced_WAN_Content.asp`（MTU 自動偵測）、`Advanced_Wireless_Content.asp`／`Advanced_Wireless2g_Content.asp`（台灣頻道標示、功率說明、每日自動選頻、漫遊）。

### 3.2 httpd（`trunk/user/httpd/src/`）
| 檔案 | 說明 |
|---|---|
| `web_ex.c` | ej 函式（頁面裡 `<% %>` 呼叫的 C 函式）、套用表單的處理、`*_status` 狀態函式 |
| `variables.c` | **nvram 變數白名單**：表單能寫入的變數要在這裡登記，並指定所屬群組與變更後要重啟的服務 |
| `ej.c`、`httpd.c` | 範本引擎、字典載入（字典載入後會快取） |

### 3.3 表單送出的運作方式（新頁面要沿用）
1. 頁面用 `<form method="post" action="/start_apply.htm">`，帶隱藏欄位 `current_page`、`next_page`、`action_mode`（`" Apply "`）、`action_script`、`sid_list`（變數群組，例如 `General;LANHostConfig;`）
2. httpd 只會寫入 `variables.c` 登記過、而且屬於 `sid_list` 群組的變數
3. 依變數登記的事件旗標，`rc` 重啟對應服務（`notify_rc`）
4. 讀取用 `<% nvram_get_x("","變數") %>`；列表類用 `nvram_get_list_x`、`get_nvram_list`

**新頁面一律沿用這套機制寫 nvram**，不要另外開寫入通道。需要新的 nvram 變數時，在 `variables.c` 登記、在 `trunk/user/shared/src/defaults.c` 給預設值（這兩個是小改動，可以在本機做，但要寫進第 6 節）。

### 3.4 現有的資料來源（可以直接用）
| 資料 | 來源 |
|---|---|
| CPU、記憶體、運作時間、Wi-Fi 開關 | `system_status_data.asp`（`json_system_status`） |
| 各介面流量計數（前端算速率） | `netdev()` |
| 24 小時／每日流量 | `bandwidth()`（rstats） |
| WAN 狀態、IP、連線時間 | `status_wanlink.asp`（`wanlink()`） |
| LAN 連接埠連線狀態 | `status_lanlink.asp` |
| 網際網路是否通 | `detect_internet` |
| 線上裝置 | `lan_clients.asp`、`get_static_client` |
| Wi-Fi 用戶端與訊號 | Main_WStatus*（無線資訊頁）的資料 |
| 交換器各埠計數 | `status_eth_mib.asp`（`dump_eth_mib`） |
| 系統記錄 | `log_content.asp` |
| 黑潮 DNS 狀態 | `kuroshio_status` |
| 漫遊觀察 | 路由器上的 `/tmp/tw-roamd.status`、`/tmp/tw-roamd.events`（目前由 `Advanced_Wireless_Content.asp` 的「查看漫遊紀錄」讀取） |

### 3.5 設計稿
<https://claude.ai/artifact/RiS7HfJN96jE2s71p3gKXH>（總覽、診斷、裝置詳情、設定頁、手機版、設計語彙）。這是第一版設計，**第 5 節的使用者目的優先於設計稿**；兩者衝突時以第 5 節為準，並更新設計稿或在這份文件記下差異。

---

## 4. 限制（不能違反）

1. **不載入任何外部資源**（CDN、Google Fonts 都不行）：路由器常常還沒連上網就要用後台
2. **不用前端建置工具**：純 HTML／CSS／JS，可以用到 ES2017（現代瀏覽器），但不要用需要編譯的語法
3. **上游頁面盡量不改**：上游 `.asp` 保留在「進階」區，方便同步 TurBoTse；新體驗用**新檔案**做
4. **路由器資源有限**：httpd 是單一程序，請求要少而小；輪詢間隔至少 2 秒，頁面不在前景時停止輪詢（`document.visibilityState`）
5. **手機**：可點區域至少 44 px；不能橫向捲動；表格在手機改成卡片
6. **亮色／暗色**都要正確（`tw.css` 的 CSS 變數）
7. **不疊特效**：沒有漸層、厚陰影、裝飾動畫
8. **硬體 NAT 會繞過流量計數**：不做「每台裝置流量排行」，只顯示 Wi-Fi 驅動自己統計的數字
9. **憑證與金鑰**：WireGuard 裝置私鑰只在瀏覽器產生並只顯示一次，不送到路由器（沿用 `wg.js`）

---

## 5. UX 設計：從使用者目的出發

> 現況的問題：目前是「換皮」——新主題與框架套在 Padavan 原本的技術分類上（無線 2.4GHz、區域網路、廣域網路、防火牆…）。使用者必須先懂技術名詞，才知道去哪裡做事。
> 目標：**依「使用者想完成什麼」來組織**，技術頁面退到「進階」。

### 5.1 使用者是誰
| 角色 | 特徵 | 主要需求 |
|---|---|---|
| **家中的網管**（主要使用者，像這個專案的維護者） | 會設定、會刷機，但不想每次都查文件 | 一次設定好、出問題時快速定位、遠端連回家、多台 AP 管理 |
| **家人**（偶爾打開後台） | 不懂技術 | 「網路是不是壞了？」「誰在用網路？」「Wi-Fi 密碼是多少？」「給客人用的 Wi-Fi」 |
| **進階玩家** | 懂 Padavan | 完整設定、記錄、SSH、自訂腳本——保留原本的進階頁面即可 |

### 5.2 使用者想完成的事（依頻率與重要性排序）
1. **確認網路正常／找出哪裡有問題**：「是 ISP 的問題、路由器的問題、還是 Wi-Fi 太遠？」
2. **看誰在用網路、管理裝置**：幫裝置取名、暫停某台的網路、固定 IP、看某台裝置為什麼常斷線
3. **Wi-Fi**：改名稱密碼、分享給客人（QR 碼、訪客網路）、訊號涵蓋與多台 AP 漫遊
4. **第一次設定**：依業者（中華電信光世代 PPPoE、有線電視 DHCP…）帶入、MTU、管理密碼、Wi-Fi
5. **外出連回家**：WireGuard 新增手機、看誰連著
6. **讓外面連進來**：連接埠轉送（遊戲、NAS、監視器）、網域（黑潮 DNS DDNS）、**偵測 CGNAT**（業者沒給公網 IP 時轉送不會通，要明說）
7. ~~**網路順暢**：頻寬管理（硬體 QoS）——「視訊會議、遊戲不卡」~~（2026-11-18 捨棄：實測沒有改善）
8. **維護**：韌體更新、設定備份與還原、定時重開機、匯出記錄給別人幫忙看
9. **DNS 服務**：黑潮 DNS 的過濾、加密、CDN 台灣節點、統計

### 5.3 設計原則
1. **先回答問題，再給數字**：每個區塊先用一句話說結論（「網路正常」「5G 頻道擁擠」），數字放在下面當證據
2. **狀態 → 原因 → 行動**：有問題時一定附上「為什麼」和「可以怎麼做」，而且說清楚每個做法的**代價**（例如「換頻道：Wi-Fi 會中斷約 10 秒」）
3. **漸進揭露**：預設只顯示多數人需要的設定；進階選項收在「進階」折疊區；完整的原始頁面放在「進階設定」選單
4. **套用前說清楚影響**：哪些服務會重啟、會不會斷線、要多久。改 LAN IP、管理密碼這類會把使用者「鎖在外面」的設定，要再確認一次並告訴使用者新的網址
5. **用台灣日常用語**：「網際網路」而不是「外網／WAN」，「裝置」而不是「用戶端／客戶端」。技術名詞第一次出現時附白話說明（例如「MTU（每個封包的最大大小）」）。統一用語表見 5.7
6. **每個數字都有參考**：例如「延遲 18 ms（平常 12 ms）」「訊號 -71 dBm（偏弱，建議靠近或加 AP）」
7. **不嚇人**：警告分等級（正常／注意／問題），只有真的影響使用才用紅色
8. **手機上能完成常用工作**：查狀態、看裝置、改 Wi-Fi 密碼、分享 Wi-Fi、暫停裝置、新增 VPN 裝置都要在手機上順手
9. **功能還沒好時誠實顯示**：未來功能的介面先做好，但資料來源還沒有時，顯示「這個功能需要更新韌體後才能使用」或「資料收集中（約需 10 分鐘）」，**不要顯示假資料**（模擬資料只用在預覽工具）

### 5.4 新的資訊架構（主選單）
桌機左側選單、手機底部分頁（前 4 個）＋「更多」。

| 選單 | 回答的問題 | 內容 | 舊頁面對應 |
|---|---|---|---|
| **總覽** | 網路現在好不好？要注意什麼？ | 健康路徑（裝置 → Wi-Fi → 路由器 → 業者 → 網際網路 → DNS）、值得注意的事、網際網路速度、路由器負載、Wi-Fi 概況、線上裝置數、快速動作（重新連線、重開機、分享 Wi-Fi） | 取代 `index.asp`（網路地圖保留為子頁） |
| **裝置** | 誰在用網路？某台怎麼了？ | 裝置清單（名稱、類型、連線方式、訊號、IP、上線時間）、取名、固定 IP、暫停上網、喚醒（WOL）；點進去看裝置詳情（訊號歷史、斷線紀錄、連過哪台 AP、建議） | lan_clients、DHCP 固定 IP、MAC 過濾 |
| **Wi-Fi** | Wi-Fi 好不好？怎麼分享？ | 名稱密碼（2.4G／5G 同名）、分享 QR 碼、訪客網路（可設時效）、頻道與干擾（目前頻道、鄰近 AP、每日自動選頻的紀錄）、**多台 AP 與漫遊**（各 AP 狀態、漫遊事件、建議） | 無線 2.4G／5G、訪客、漫遊紀錄 |
| **網際網路** | 連線方式對不對？ | 業者精靈（光世代 PPPoE、有線電視、固定 IP…）、MTU 自動偵測、IPv6、DNS（黑潮 DNS 的白話設定）、**CGNAT 偵測**、MOD 接法（✅ 2026-11-20「MOD／IPTV 接法」卡片，見 11.2） | 廣域網路、IPv6、DNS 服務、IPTV |
| **遠端與分享** | 外出怎麼連回家？外面怎麼連進來？ | WireGuard 伺服器（裝置、QR、誰在線）、連接埠轉送（依用途：遊戲、NAS、監視器，自動帶入裝置）、UPnP 狀態、網域（黑潮 DDNS）與憑證 | WireGuard、虛擬伺服器、UPnP、DDNS |
| ~~**頻寬管理**~~（2026-11-18 捨棄，頁面已移除） | 怎麼讓視訊、遊戲不卡？ | 硬體 QoS 模式（關閉／固定／自動）、申裝方案、目前狀態、最近介入紀錄與前後延遲 | （新） |
| **診斷** | 哪裡出問題？怎麼辦？ | 一鍵檢查（逐段：Wi-Fi → 路由器 → 業者 → DNS → 網站）、延遲與丟包歷史、事件時間軸、測速、匯出診斷報告 | 系統記錄、網路工具 |
| **系統** | 路由器本身 | 韌體更新（目前版本、最新版本、更新說明）、備份還原、管理密碼與存取、時間、定時重開機、LED、語言 | 系統管理 |
| **進階設定** | （專家） | 保留所有原始 Padavan 頁面，原樣可用 | 全部上游頁面 |

手機底部分頁建議：**總覽、裝置、Wi-Fi、診斷、更多**。

### 5.5 各頁規格（未來功能一起做）
每頁請依這個格式設計：**目的 → 首屏要回答的問題 → 區塊 → 主要動作 → 資料來源（第 6 節）→ 沒有資料時的樣子**。

#### 總覽
- 首屏：一句話結論（「一切正常」／「網路變慢：業者那段延遲偏高」）＋健康路徑圖（每一段一個狀態點，點下去看原因）
- 值得注意：最多 3 則，每則有建議動作（例如「客廳的 iPad 訊號偏弱，最近 1 小時斷線 4 次 → 查看」）
- 網際網路：即時上下行速度、與方案頻寬的比例、24 小時曲線、延遲（閒置 vs 目前）
- 路由器：CPU、記憶體、溫度（若有）、運作時間、連線追蹤表用量
- Wi-Fi：各頻段頻道、裝置數、忙碌程度；多台 AP 時顯示每台
- DNS：查詢數、過濾數、CDN 換到台灣節點的次數（黑潮）
- 快速動作：重新連線網際網路、分享 Wi-Fi、重開機
- 資料：`health`、`latency`、`wan`、`router`、`wifi`、`dns`

#### 裝置
- 清單預設依「最近活動」排序，可篩選（Wi-Fi／有線／訪客／離線），可搜尋
- 每台：自訂名稱與圖示（手機、電腦、電視、遊戲機、IoT…）、連線方式（2.4G／5G／有線＋哪台 AP）、訊號（白話等級＋dBm）、IP（固定 IP 標記）、上線時間
- 動作：取名、固定 IP、**暫停上網**（可設時間，例如「到晚上 10 點」）、喚醒、封鎖
- 裝置詳情：24 小時訊號與速率曲線、斷線紀錄、漫遊紀錄（換過哪台 AP）、建議
- 資料：`devices`、`device?mac=`

#### Wi-Fi
- 分享：顯示 QR 碼（手機相機掃描即可連線），可切換主網路／訪客網路
- 訪客網路：開關、名稱密碼、時效（2 小時／今天／永久）、是否能連到家裡的裝置
- 頻道與干擾：目前頻道、鄰近 AP 數與最強的幾個、每日自動選頻的上次結果與原因；手動選頻道時沿用現有的台灣頻道標示
- 多台 AP：AP 清單（型號、IP、在線、各頻段裝置數）、漫遊事件時間軸、中控的建議（觀察模式），之後的引導開關（CR6608：11k＋11v、不踢除）
- 資料：`wifi`、`roam`

#### 網際網路
- 業者精靈：選業者 → 只顯示該業者需要的欄位（光世代：帳號密碼＋建議 MTU 1480；有線電視：DHCP；固定 IP：位址遮罩閘道 DNS）
- 連線狀態白話化：「已連線 3 天，公網 IP 1.163.x.x」；**若偵測到 CGNAT**：「你的業者沒有給公網 IP，外面無法直接連進來；WireGuard 與連接埠轉送需要向業者申請公網 IP」
- MTU：沿用自動偵測按鈕
- DNS：黑潮 DNS 的白話開關（過濾廣告、加密 DNS、CDN 台灣節點）＋目前狀態；原本的完整設定頁放進階
- 資料：`wan`、`cgnat`、`dns`

#### 遠端與分享
- WireGuard：裝置列表（名稱、最後連線時間、流量）、新增裝置（QR）、連線位址說明（網域優先）、CGNAT 提醒
- 連接埠轉送：「我要讓外面連到…」→ 選裝置 → 選用途（遊戲主機、NAS、監視器、自訂）→ 自動帶入常見埠；清單顯示是否真的有在用（UPnP 也列在這裡）
- 網域與憑證：黑潮 DDNS 網域、憑證到期日
- 資料：`vpn`、`portfwd`（現有 nvram）、`dns`

#### 頻寬管理（硬體 QoS）——2026-11-18 捨棄，`tw_qos.asp` 已移除（見 docs/WIFI-STABILITY.md）
- 模式：關閉／固定／自動，每個模式一句白話說明與代價
- 申裝方案：下載／上傳 Mbps（光世代常見方案可選）
- 狀態：自動模式目前在哪一步（平常／確認中／控制中／判斷／結束），目前限速值
- 最近介入紀錄：時間、原因（延遲 +45 ms、流量 92%）、做了什麼、前後延遲
- 資料：`qos`

#### 診斷
- 一鍵檢查：逐段跑，每段顯示「正常／注意／問題」＋證據＋建議（含代價）
- 延遲與丟包歷史（多個目標：業者閘道、HiNet DNS、TWNIC、Cloudflare）
- 事件時間軸：WAN 重連、換頻道、裝置斷線、QoS 介入、DNS 故障轉移
- 匯出診斷報告（文字檔，自動隱藏密碼與 Token，可以貼給別人看）
- 資料：`health`、`latency`、`events`、`diag`

#### 系統
- 韌體更新：目前版本、最新版本（GitHub Release）、更新說明；更新前提醒先備份設定
- 備份還原、管理密碼、時間（自動）、定時重開機、LED、語言

### 5.6 共用元件（請先做這些，再做頁面）
狀態點（正常／注意／問題／未知）、結論卡、指標卡（數字＋參考值＋迷你曲線）、時間序列圖（純 SVG，不用外部圖表庫）、清單／卡片（桌機表格、手機卡片）、事件時間軸、「套用」確認對話框（列出影響）、空狀態／載入中／錯誤／功能未提供四種狀態、QR 碼、可複製的文字欄位。

### 5.7 統一用語
| 用 | 不用 |
|---|---|
| 網際網路 | 外網、WAN（進階頁可以括號附註） |
| 區域網路 | 內網、LAN |
| 裝置 | 用戶端、客戶端、終端 |
| Wi-Fi | 無線網路（標題用 Wi-Fi，說明可用無線） |
| 業者 | ISP、運營商 |
| 套用 | 應用、提交 |
| 訊號強／普通／弱 | 只寫 dBm |
| 路由器 | 主機、設備 |

---

## 6. 資料介面約定（前後端的契約）

所有新資料都用 **JSON**，前端統一透過一個函式取得（例如 `twApi('health')`），網址集中在一處，方便之後調整。

- 網址：`/tw_api.asp?q=<名稱>[&<參數>]`（2026-11-18 起有：`tw_api.asp` 呼叫 web_ex.c 的 ej `tw_api`；前端只依賴 `TW.api()`，在 `tw_ui.js`）
- **有 `tw_api.asp`、但名稱還沒實作**：回 `{"_fallback":true}`，前端只對這個名稱改用後備資料（空白則會讓整個工作階段都不再問 API，所以新名稱不能回空白）
- **還沒有 API 時**：httpd 對不存在的檔案回 **200 空白**（實機確認）。前端把空白視為「API 不存在」，改用 `tw_status.asp`／`tw_rstats.asp`（把現有 ej 函式包成一次請求的純前端檔案）組出能給的部分，並帶 `partial: true`、`_source: "base"`；組不出來的回 `available: false`，畫面顯示「需要更新韌體後才有」。B 階段做好 `tw_api.asp` 後，前端自動改用 API，不用改頁面
- 預覽工具：回傳 `tools/ui-preview/mock/<名稱>[.<情境>].json`；頁面網址加 `?scenario=` 切換：`normal`（預設）、`problem`（有問題）、`empty`（資料收集中）、`none`（現在的韌體＝沒有 API，走上面的後備資料）
- 共同欄位：每個回應都有 `ok`（布林）、`ts`（Unix 秒）、`available`（這個功能目前韌體是否提供）、`warming_up`（資料收集中）
- 時間序列：`{"step": 秒, "start": Unix 秒, "values": [...]}`，缺資料用 `null`
- 單位寫在欄位名稱：`_ms`、`_kbps`、`_dbm`、`_pct`、`_bytes`、`_s`（秒）、`_ts`（Unix 秒）
- 狀態值：`ok`／`warn`／`bad`／`unknown`／`off`
- 完整範例：`tools/ui-preview/mock/*.json`（B 階段照著輸出即可；欄位以範例為準）

| 名稱 | 內容（欄位） | 更新頻率 | 狀態 |
|---|---|---|---|
| `health` | `headline`、`level`；`segments[{id: device/wifi/router/isp/internet/dns, label, state, summary, evidence, actions[{label, cost, href}]}]`（`href: "#reconnect"` 代表「重新連線網際網路」）；`notices[{level, title, evidence, href, action}]` 最多 3 則（總覽的「值得注意」） | 10 秒 | B 階段（依 twstats）；現在前端用現有資料組出簡化版 |
| `latency` | `baseline_ms`、`current_ms`、`loss_pct`；`targets[{id: gw/hinet/twnic/cf, label, host, current_ms, baseline_ms, loss_pct, series, loss}]`（`series`、`loss` 是時間序列，loss 單位 %） | 10 秒 | ✅ `tw-stats`（D1）；時鐘對時前 `series`／`loss` 是 null，找不到閘道時 gw 的 `host` 是空字串 |
| `wan` | `connected`、`internet`（狀態值）、`proto`（pppoe/dhcp/static）、`proto_label`、`isp`、`ip4`、`gw4`、`ip6`、`dns[]`、`uptime_s`、`ether`、`rx_kbps`、`tx_kbps`、`plan_down_kbps`、`plan_up_kbps`、`mtu`、`last_error`；`series{step, start, down_kbps[], up_kbps[]}` | 2 秒（即時）／60 秒（序列） | 現在由 wanlink、netdev、rstats 組出（序列 120 秒一筆；速率與序列都取 WAN 介面與 `ESW_P0` 大的，硬體 NAT 也準）；`isp`、方案頻寬 B 階段 |
| `router` | `cpu_pct`、`mem_used_pct`、`mem_total_kb`、`uptime_s`、`load[]`、`conntrack_count`、`conntrack_max`、`temp_c`（可能 null）、`cpu_series`（選用） | 5 秒 | 現在由 json_system_status、nf_values 組出 |
| `devices` | `devices[{mac（有冒號）, name, hostname, type: phone/computer/tv/game/iot/nas/camera/router/other, conn: wifi/wired/guest, band: "2.4"/"5", ap, signal_dbm, tx_rate_mbps, rx_rate_mbps, ip, static_ip, online, since_s, last_seen_ts, paused, disconnects_today, usage_today_bytes}]` | 10 秒 | 現在由 get_static_client、wl_auth_list 組出：分不出有線或剛離開 Wi-Fi（`conn: "wired_guess"`），沒有頻段、AP、上線時間；整合 B 階段 |
| `device?mac=` | `signal`、`rate`（時間序列）、`disconnects[{ts, reason}]`、`roams[{ts, from, to, rssi_from, rssi_to}]`、`advice[{title, detail, action, href}]`、`usage_today_bytes` | 60 秒 | **2026-11-20 已實作（Wi-Fi 裝置）**：tw-roamd 每分鐘寫 `/tmp/tw-roamd.devices`（每台一行「MAC JSON」），`signal{step:900,start,values[96]}`（沒資料的格子 null）、`disconnects`（離開 20 秒後沒出現在任何 AP 才算斷線；理由「訊號太弱（-83 dBm）」或「離線（最後 -70 dBm）」）、`roams`（換 AP、換頻段）；`rate`、`advice`、`usage_today_bytes` 還沒有。漫遊中控關閉時回 `_fallback` |
| `wifi` | `bands[{id, ssid, enabled, channel, auto_channel, width_mhz, txpower_pct, clients, busy_pct, neighbors{count, by_channel{頻道: 數量}, strongest[{ssid, channel, rssi_dbm}]}, acs_last{ts, from, to, reason}}]`；`guest{enabled, ssid, expires_ts, clients}` | 30 秒 | 部分現有；**鄰近 AP 要 B 階段**（見第 12 節：現有的 `wl_scan_*` 在 D3 輸出壞掉） |
| `roam` | `mode: off/observe/steer`、`mode_cfg`、`weak_dbm`；`driver{name, b24/b5{ask, report, steer, neighbor}}`；`stats{ask, report, suggest, moved, back5, ignored, rejected, hour, hour_max}`；`aps[{name, model, ip, online, self, clients_24, clients_5, steer_capable, ft}]`；`events[{ts, mac, name, from, to, rssi_from, rssi_to, type: roam/band/sticky}]`；`advice[{level, title, detail}]`；`clients[{mac, name, band, rssi, psm, seen5, k, v, state: pending/backoff/stopped, suggested, moved}]` | 30 秒 | **2026-11-20 已實作**：tw-roamd 每 5 秒寫 `/tmp/tw-roamd.json`；關閉時回 `available:false, reason:disabled`；剛啟動回 `warming_up` |
| `events` | `events[{ts, type: wan/channel/device/qos/dns/system/roam/vpn, level, text, device}]`，新的在前 | 30 秒 | B 階段（D5） |
| ~~`qos`~~（捨棄） | `mode: off/fixed/auto`、`plan_down_kbps`、`plan_up_kbps`、`state: idle/probing/limiting/deciding/ending`、`limit_down_kbps`、`limit_up_kbps`、`interventions[{ts, reason, action, latency_before_ms, latency_after_ms, duration_s}]` | 5 秒 | B 階段（E4～E8）。**設定寫入**（後端 E1 已登記，2026-11-13 更正）：`hw_qos_mode`（0 關閉／1 固定／2 自動）、`hw_qos_wlan`（Wi-Fi 也套用，預設 1）、`hw_qos_down`、`hw_qos_up`（Mbps）、`hw_qos_tech`、`hw_qos_over`、`hw_qos_under`、`hw_qos_method`，頁面用 `sid_list=IPConnection;` 送出。見 `docs/LOCAL-NEXT.md` 第二件 |
| `dns` | `enabled`、`running`、`healthy`、`zone_mode`、`filter_ads`、`encrypted`、`cdn_tw`、`queries`、`blocked`、`cdn_rewrites`、`cache_hit_pct`、`avg_ms`、`upstreams[{name, addr, ok, ms}]`、`domain`、`cert_expiry_ts`、`queries_series` | 30 秒 | 現在由 kuroshio_status 組出啟用與健康；統計 B 階段（G9） |
| `vpn` | `enabled`、`running`（設定開著但 wg1 沒起來＝false）、`listen_port`、`peers[{name, ip, last_handshake_ts, rx_bytes, tx_bytes, endpoint}]`（`name` 對應 WGSPeerList 的名稱；`last_handshake_ts` 0＝從未連線、null＝不知道；rx／tx 是路由器端收／送；`endpoint` 只有 IP）；伺服器關閉回 `available:false, reason:"disabled"` | 10 秒 | ✅ `tw_api_vpn.c`（J4，`wg show wg1 dump`＋nvram）；遠端與分享頁、總覽「外出連回家」使用 |
| `cgnat` | `cgnat`（true/false/null）、`kind: public/cgnat/double_nat`、`wan_ip`、`public_ip`、`reason`、`method: stun/wan_ip` | 開頁時 | 現在前端依 WAN 位址判斷（`method: "wan_ip"`，分得出公網／私人／100.64），比對對外位址是 B 階段 |
| `diag` | 同 `health` 的 `headline`、`level`、`segments`（每段多 `metric`，段落 id：wifi/router/isp/load/dns/web）＋`duration_s`、`report`（文字） | 按下時（約 30～40 秒） | B 階段；現在用 `health` 的後備資料 |
| `speedtest` | `running`、`plan_down_kbps`、`last{ts, down_kbps, up_kbps, latency_ms, server}`；`speedtest&run=1` 開始測速 | 按下時 | **新增**，B 階段 |
| ~~`firmware`~~ | — | — | **取消**（使用者 2026-11-13 決定）：韌體更新由瀏覽器直接查 GitHub Release（`api.github.com/repos/candy999/padavan-tw/releases/latest`），路由器不用連外 |

本機在設計時如果需要新欄位或新名稱：**直接修改這張表**（並在 commit 訊息說明），B 階段會依表實作。

### 6.1 需要新的後端功能（B 階段）
- **暫停上網可設時間**（「1 小時」「到今晚 10 點」）：現在只做「直到我恢復」（MAC 過濾封鎖清單 MFList），時間選項顯示「需要更新韌體」。需要一次性排程規則（到時自動從 MFList 移除）
- **訪客網路時效**（2 小時／到今天結束）：現在只有「一直開著」；Padavan 原有的每日時段（`rt_guest_time_x`）在原始頁面
- ~~**漫遊引導模式**（11k＋11v）~~：2026-11-20 完成（Wi-Fi 頁可切換關閉／觀察／建議）
- **Wi-Fi 鄰近 AP 掃描**：見第 12 節

---

## 7. U 階段的建議順序與驗收

| 步驟 | 內容 | 驗收 |
|---|---|---|
| U0 | 讀第 5 節，跟使用者確認資訊架構與手機分頁（用問題卡，附建議選項） | 使用者同意 |
| U1 | 共用元件＋`twApi()`＋模擬資料機制（`serve.py` 的 mock 與情境切換） | 預覽工具三種情境都正常 |
| U2 | 新選單與框架（`state.js`）：新的 9 個選單、手機底部分頁；舊頁面全部收進「進階設定」且可用 | 106 頁都能從選單到達；桌機／手機、亮／暗色截圖 |
| U3 | 總覽、裝置、Wi-Fi（含分享、訪客、多台 AP） | 實機上用現有資料能顯示的部分要真的顯示；其餘顯示「功能未提供」 |
| U4 | 網際網路（業者精靈、CGNAT 提示）、遠端與分享、~~頻寬管理~~（已移除）、診斷、系統 | 同上；所有寫入都走 3.3 的表單機制 |
| U5 | 實機走一遍：套用、重開機、登出、語言切換、手機操作 | 使用者確認 |

每一步都：截圖（桌機 1440／手機 390、亮／暗色）、`shoot.js` 沒有橫向溢出與 JS 錯誤、推送前 `git pull`。

---

## 8. B 階段（後端）的待辦（2026-11-17 起由本機做）

1. ~~實作 `/tw_api.asp`~~：2026-11-18 完成（`d230446`）；還沒做的名稱回 `{"_fallback":true}`
2. `twstats` 取樣器：D1、D2 完成；D3、D5、D6 不做，D4 併入 KVR R1（ROADMAP D 章）
3. ~~硬體 QoS 固定／自動模式（E4～E8）~~：2026-11-18 捨棄，頻寬管理頁已移除
4. `tw-roamd` 資料轉 JSON、WireGuard 狀態、CGNAT 偵測（比對對外位址）
5. ~~黑潮 DNS 統計轉接（G9）~~：完成（黑潮頁「儀表板」分頁）
6. 本機在第 6 節新增的約定：`speedtest`、6.1 的排程功能（暫停上網時間、訪客時效、漫遊引導）
7. ~~修 `ralink.c` 的 Wi-Fi 掃描解析~~：d8c9062 完成並實機確認
8. ~~韌體版本檢查~~：已改由瀏覽器查 GitHub，不用做

## 9. 目前硬體與韌體狀態（2026-11-20）

- Newifi D3：刷 `1f7ff9e` 前後的版本（黑潮 3.4.0、5G 混合模式、MOD 自動偵測），有線、重開機、黑潮資料區、Wi-Fi 掃描都已實機確認，夜間長測通過。這台就是實機測試機
- 小米 CR6608：使用者正在使用中，**不能動**，等 D3 接手後才刷；尚未實機測試
- 小米 MI-MINI：暫緩（若做，會用 3.4 核心另外處理）
- 黑潮 DNS：3.4.0 已整合並在 D3 實機驗證（HANDOFF-LOCAL 5.7）
- 路線圖總表：`docs/ROADMAP.md`；舊的 UI 計畫：`docs/UI-PLAN.md`（本文件取代它的階段規劃）

## 10. 使用者確認的結果（2026-11-13，U0）

1. 9 個主選單與手機底部分頁（總覽、裝置、Wi-Fi、診斷、更多）：**照交接單**
2. 首頁：**直接換成新的總覽**；原本的網路地圖移到 `Main_NetMap.asp`（進階設定 › 狀態與工具、裝置頁的「網路地圖」按鈕）。舊網路地圖的 iframe 送出後會回 `/?flag=…`，新首頁會轉回網路地圖
3. 暫停上網的時間、訪客網路時效：**列入 B 階段**（見 6.1），介面先做好、時間選項停用並標示「需要更新韌體」
4. 韌體更新檢查：**由瀏覽器查 GitHub**（路由器不用連外）；第 6 節的 `firmware` 約定取消
5. 舊頁面套用 5.7 用語：**還沒問**（問題卡一次只能 4 題），目前沒有改字典

## 11. U 階段進度（2026-11-13，本機工作階段）

| 步驟 | 狀態 | 說明 |
|---|---|---|
| U0 | ✅ | 第 10 節 |
| U1 | ✅ | `tw_ui.js`（`TW.api()`、後備資料、元件）、`tw.css` 新元件、`serve.py` 模擬資料與 4 種情境；預覽三種情境＋`none` 都正常 |
| U2 | ✅ | `state.js`：9 個新主選單、手機底部 5 格；上游頁面一律標成「進階設定」，側欄列出原始選單；`tw_advanced.asp` 依上游選單表列出全部原始頁面（可搜尋）。爬蟲檢查：所有導覽頁都到得了，到不了的只有資料／動作端點，以及原本就隱藏的頁面（有黑潮 DNS 時的 SmartDNS／AdGuard／DDNS、非 AP 模式的 AP LAN） |
| U3 | ✅ 預覽＋實機讀取 | 總覽、裝置（清單、詳情、取名並固定 IP、暫停／恢復、WOL）、Wi-Fi（名稱密碼、分享 QR、訪客、頻道與每日選頻、多台 AP） |
| U4 | ✅ 預覽＋實機讀取 | 網際網路（業者精靈、MTU 偵測、CGNAT／雙層 NAT、黑潮 DNS 開關）、遠端與分享（WireGuard 新增裝置、依用途的連接埠轉送、UPnP、網域）、頻寬管理、診斷（一鍵檢查、延遲、事件、測速、匯出報告）、系統 |
| U5 | ✅（除下列例外） | 使用者授權在測試機（D3）上全部自己測（2026-11-13）。每項都用 SSH 確認 nvram 與實際生效（iptables、iwconfig、wg、syslog），測完全部還原成測試前的 nvram 備份（逐鍵比對一致）。**通過**：燈號；固定 IP（中文名稱、MAC 無冒號、dnsmasq 重載）；暫停／恢復上網（MFList＋iptables mac-source 規則）；WOL；Wi-Fi 名稱（中文 SSID 廣播正確、密碼未被動到）；訪客網路開關（ra1／rai1、與家用網路隔離）；頻道 6 ↔ 自動；重新連線（syslog：manual reconnect → WAN down/up）；連線方式 DHCP ↔ 固定 IP（沒有變更時只提示「沒有變更」）；黑潮 DNS 關／開；MTU 偵測（實測 1492）；WireGuard 開啟＋新增裝置（wg1 載入 peer）；連接埠轉送（vserver DNAT 規則）；UPnP 關／開；定時重開機排程；語言 EN ↔ TW；GitHub 檢查更新；診斷報告與遮蔽。**例外**：①重開機——UI 送出正確，但**韌體本身無法重開機**（第 12 節），原始按鈕也一樣；②管理密碼、輸入新的 Wi-Fi／PPPoE 密碼、登出後再登入——要在欄位輸入密碼，AI 不代打，請使用者自己測；③手機實際操作（只有 390 寬截圖） |

截圖：`node tools/ui-preview/shoot.js` 桌機 1440／手機 390、亮／暗色，全部頁面沒有橫向溢出、沒有 JS 錯誤。

**跑版檢查**（使用者回報流量圖表被切、頂部列換行、網路地圖圖示跑版後加上）：`node tools/ui-preview/layout-check.js`，每個頁面 × 10 種寬度（360～1920），`RESIZE=1` 另測「寬視窗載入後再縮小」。抓三種問題：整頁橫向溢出、頂部列換成兩行、內容欄裡有元素超出右緣（被 `overflow: hidden` 切掉也算，只有可捲動的容器算正常）。目前 83 頁全部歸零。**改版面後請跑一次。**
- 頂部列：任何寬度一行；狀態區先縮，依寬度收起平均負載 → 韌體版本 → 運作時間 → Wi-Fi 按鈕；1240 以下收起釋放記憶體、關機（系統頁有）；手機的狀態列固定在第二行
- 內容欄寬螢幕置中
- Highcharts（流量監控）：所在表格 `table-layout: fixed`、圖表最多 100%，載入後 reflow 一次
- 網路地圖（`Main_NetMap.asp`）：左側固定高度的點陣圖示欄 → 上方磚塊（線條圖示用 CSS mask、文字、狀態標籤），手機一排兩塊；iframe 內的裝置清單窄畫面收起 MAC 欄。JS 的 id／class 沒改
- 原本的「進階設定」網站地圖 `as.asp` 轉到 `tw_advanced.asp`（同一份選單資料），側欄不再重複列出

### 11.1 新增與修改的檔案
- 新頁面：`index.asp`（總覽，取代原首頁）、`tw_devices.asp`、`tw_wifi.asp`、`tw_internet.asp`、`tw_remote.asp`、~~`tw_qos.asp`~~（2026-11-18 移除）、`tw_diag.asp`、`tw_system.asp`、`tw_advanced.asp`；頁面邏輯在 `tw_p_<頁>.js`
- 保留舊首頁：`Main_NetMap.asp`（原 `index.asp`，只改 `current_page`）
- 共用：`tw_ui.js`、`bootstrap/css/tw.css`（後半段「新介面元件」）
- 後備資料（純前端，把現有 ej 函式包成一次請求）：`tw_status.asp`（wanlink、nf_values、kuroshio_status、netdev、json_system_status、get_static_client、wl_auth_list、ManualDHCPList、MFList、幾個 nvram）、`tw_rstats.asp`（`bandwidth("speed")`）
- `state.js`：新主選單（`tw_nav_items`、`tw_show_menu()`）、手機底部分頁、頂部列 Wi-Fi 按鈕改到新 Wi-Fi 頁、`tw_table_cards` 略過新清單
- 工具：`tools/ui-preview/serve.py`（mock、`?scenario=`、`--all-apps`、更多 ej 模擬）、`tools/ui-preview/mock/*.json`、`tools/ui-preview/push.py`（推到實機）
- 新頁面沒有 C 程式改動；`variables.c`、`defaults.c` 都沒動

### 11.2 寫入設定（全部走 3.3 的表單機制）
| 頁面動作 | sid_list | 變數 |
|---|---|---|
| Wi-Fi 名稱密碼 | `WLANConfig11b;WLANConfig11a;` | `rt_ssid`、`wl_ssid`、`rt_wpa_psk`、`wl_wpa_psk`（原本沒密碼時加 `*_auth_mode=psk`、`*_wpa_mode=2`、`*_crypto=aes`） |
| 訪客網路 | 同上 | `rt_guest_enable`、`rt_guest_ssid`、`rt_guest_wpa_psk`、`rt_guest_auth_mode`、`rt_guest_lan_isolate`（5G 同名 `wl_guest_*`） |
| 頻道、每日選頻 | 同上 | `rt_channel`、`wl_channel`、`tw_acs_daily`、`tw_acs_hour` |
| 取名並固定 IP | `LANHostConfig;` 清單 `ManualDHCPList` | `dhcp_staticmac_x_0`（無冒號）、`dhcp_staticip_x_0`、`dhcp_staticname_x_0`；未開啟時一起送 `dhcp_static_x=1` |
| 暫停／恢復上網 | `FirewallConfig;` 清單 `MFList` | 新增 `macfilter_list_x_0`、`macfilter_time_x_0=00002359`、`macfilter_date_x_0=1111111`（未開啟時 `macfilter_enable_x=2`）；恢復用 `MFList_s=<索引>` 刪除。白名單模式時不提供 |
| 連線方式 | `Layer3Forwarding;IPConnection;PPPConnection;` | `wan_proto`、`wan_pppoe_username`、`wan_pppoe_passwd`（留空不送）、`wan_pppoe_mtu`／`mru`、靜態 IP 的 `wan_ipaddr` 等、`wan_dnsenable_x` |
| 黑潮 DNS 開關 | `KuroshioConf;` | `kuroshio_enable` |
| WireGuard 開啟／新增裝置 | `WIREGUARD;` 清單 `WGSPeerList` | `wgs_enable`；`wgs_name_x_0`、`wgs_pub_x_0`、`wgs_psk_x_0`、`wgs_ip_x_0`（私鑰只在瀏覽器） |
| 連接埠轉送 | `IPConnection;` 清單 `VSList` | `vts_port_x_0` 等 7 欄，未開啟時 `vts_enable_x=1` |
| UPnP | `IPConnection;` | `upnp_enable_x` |
| 管理密碼、定時重開機、燈號 | `General;` | `http_passwd`；`reboot_schedule_enable`、`reboot_schedule`（7 碼星期＋HHMM）；`front_led_all` |
| MOD 專用孔（網際網路頁「MOD／IPTV 接法」，40a9205） | `Layer3Forwarding;` | `wan_stb_x`（MOD 孔，0＝沒有）、`wan_stb_iso=1`；MOD＋VLAN 時另送 `vlan_filter`、`vlan_vid_cpu`、`vlan_pri_cpu`、`vlan_vid_lan<孔>`（`vlan_tag_lan<孔>`、`vlan_pri_lan<孔>` 設 0）；取消時只關掉這張卡片設的 VLAN |
| MOD 自動偵測 | `Layer3Forwarding;` | `tw_mod_auto`（預設 1） |
| 群播（IGMP 代理、udpxy） | `RouterConfig;LANHostConfig;` | `mr_enable_x`（預設開）、`udpxy_enable_x`（連接埠，0＝關）。中華電信 MOD 走交換器橋接、用不到這兩個 |
| 自動 NAT66 | `IP6Connection;` | `ip6_nat66_auto` |
| Wi-Fi 迴圈保護（診斷頁，d29b6bf） | `LANHostConfig;` | `tw_wifi_bpdu`（勾選＝2，原本是 1 就保留；不勾＝0）、`tw_wifi_fast`； 攔截紀錄：頁面載入時以 SystemCmd 執行唯讀的 `tw-bpdu-status`（讀 ebtables 計數、`/tmp/tw-bpdu-conflict`、`/etc/storage/tw-diag/bpdu-events.log` 最近 5 次）|
| ~~頻寬管理~~（2026-11-18 捨棄，頁面與 `hw_qos_*` 已移除，以下留作紀錄） | `IPConnection;` | `hw_qos_mode`、`hw_qos_wlan`、`hw_qos_down`、`hw_qos_up`、`hw_qos_tech`、`hw_qos_over`、`hw_qos_under`、`hw_qos_method`（後端已登記；限速控制器 E4～E8 還沒做，見 `docs/LOCAL-NEXT.md`）。**2026-11-14 頁面已改用並實機驗證**（6f3e3df）：切到自動 → `hnat_qos=1`、`hnat_qos_wlan=1`，syslog「Hardware QoS: on (wired), on (wlan)」；進階區關掉「Wi-Fi 裝置也套用頻寬管理」→ `hnat_qos_wlan=0`、「on (wired), off (wlan)」；關閉 → 兩個都 0。頁面在模式不是關閉時明寫「限速功能尚未提供，只會經過排程、不限速」 |

清單類先送 `action_mode=" Add "`（或 `" Del "`），等 `start_apply.htm` 呼叫 `parent.done_validating()` 後再送 `" Restart "`，與舊頁面相同（`TW.listAdd()`）。

## 12. 實機發現（2026-11-13，給之後的工作階段）

- **`wanlink_status()` 是 0 才代表已連線**，其他數字是原因代碼（1 沒接網路線、5 正在取得 IP、6 等待 PPP、9 網段衝突…，對照 `InetState*` 字典）。預覽工具原本寫成 1，已更正
- `link_internet` nvram：1＝連得到外面、2＝偵測中或不穩定、0＝連不到
- **httpd 啟動時就 chdir 到 `/www`**：bind mount 記憶體副本後要 `killall httpd; httpd` 才會讀到新檔案（`push.py` 會自動做）
- **Wi-Fi 鄰近 AP 掃描壞掉**：`wds_aplist_2g.asp`（`ej_wl_scan_2g`）在 D3 回傳的 JS 字串裡有換行、欄位錯位（`ralink.c` 用固定欄寬解析驅動的掃描表，跟這版驅動的輸出不合）。原始的 WDS 頁應該也受影響。新 Wi-Fi 頁偵測到就顯示「需要更新韌體」。**B 階段**：修 `ralink.c` 的解析，或直接在 `wifi` API 提供 `neighbors`
  - **2026-11-13 雲端已修，d8c9062 實機確認**：原因是台灣版替 MT7603 開了 802.11k，驅動掃描表多一欄「BcnRept」，而且表頭與資料列欄寬不同；`ralink.c` 改成逐行解析、欄位位置從表頭找，BSSID 不是 MAC 的行直接跳過。輸出格式不變（`[["SSID","BSSID","頻道","訊號"],…]`，SSID 一樣經過 `char_to_ascii`）。新 Wi-Fi 頁可以拿掉「需要更新韌體」的判斷，或保留給舊韌體
- 實機的 D3 前面還有一台路由器（WAN 拿到 10.0.0.x）：網際網路頁正確顯示「雙層 NAT」
- `get_nvram_list` 的欄位順序就是 `variables.c` 的順序、不附索引；指定隱藏欄位會輸出 `"*"`；MAC 不含冒號
- 新介面目前只有繁體中文（字串寫在 `tw_p_*.js`，跟現有的台灣版頁面一樣），切換語言只影響原始頁面
- **【高優先，B 階段】D3 無法重開機**：後台（新舊介面都一樣）按重開機 → httpd `sys_reboot()` 走 `MTD_FLASH_32M_REBOOT_BUG` 路徑：`mtd_storage.sh save` 後執行 `/bin/mtd_write -r unlock mtd1`，回 `Could not open mtd device: mtd1`，所以不會重開。SSH 下 `reboot` 更糟：服務與區網全部關掉後停住（網路線有連線但不回 ARP），**要拔電源**。`/dev/mtd1` 存在；MTD 表有重複的項目（mtd7「ALL」、mtd8 第二個「Bootloader」、mtd9「Kuroshio」、mtd10 整顆晶片），黑潮 DNS 自己也記錄「資料區跟其他分割區重疊」。推測跟台灣版加的分割區有關，要查 `mtd_write` 怎麼找裝置名稱與 D3 的分割表
  - **2026-11-13 雲端已修，d8c9062 實機確認**：跟分割區無關，是上游 4.4 在 D3 上本來就壞的。4.4 的 `mtd_write` 依「分割區名稱」找裝置，沒有叫 mtd1 的分割區 → 開啟失敗就結束、不重開（3.4 的 mtd_write 會忽略失敗照樣重開）。D3 改關掉 `CONFIG_32M_REBOOT_FIXUP`（`configs/tw/NEWIFI3.config`），走一般流程：後台 `kill(1, SIGTERM)` → init 停服務、存設定 → `reboot()`；4.4 的 SPI Flash 驅動關機時會把 Flash 切回 3-byte 模式並重置。MTD 的重複項目（ALL、第二個 Bootloader、整顆晶片）是上游 dtsi 與 dts 重複定義，本來就有，無害
- **黑潮 DNS 開機後長時間吃滿 CPU**（2026-11-13 實測，見下面「黑潮 DNS 用量」）：學習資料因為分割區重疊只放記憶體，每次開機都重跑 cdn-pool、cdn-scan、dns-benchmark，開機後 40 分鐘仍佔全機約 80～97% CPU
  - **2026-11-13 雲端已修，764938b 實機確認（另修了資料區掛載）**：「重疊」是誤判——分割區沒有重疊，是 `kuroshio.sh` 用 `find /proc/device-tree` 讀分割表，但那是捷徑，busybox find 預設不跟進，一個分割區都沒讀到。改成 `/proc/device-tree/`，並把「讀不到分割表」與「真的重疊」分開顯示。另外黑潮 DNS 改用 `nice -n 10` 執行。修好後學習資料存在 mtd9，只有第一次開機會跑重工作
- 中等寬度（900～1240 px）頂部列放不下：已收起「釋放記憶體」「關機」圖示

### 12.1 黑潮 DNS 用量（2026-11-13，D3，韌體 4.4.198.9-100_ff54088，開機約 40 分鐘）
| 項目 | 數值 |
|---|---|
| 程序 | `/usr/bin/kuroshio run --uci`（另有 2 個 `kuroshio.sh` start／guard 殼程序，各約 1.6 MB） |
| 記憶體 | RSS 約 78～80 MB（VmHWM 78.7 MB、VmSize 109 MB、VmData 99.5 MB），全機 438 MB，可用約 281 MB；6 個執行緒、317 個 fd |
| CPU | 開機後 40 分鐘內持續佔全機（4 執行緒）約 80～97%，top 顯示全機 0% idle；同一天另一次開機 5 小時後量到全機 CPU 約 1% |
| 背景工作（jobs.json） | 開機 17:46；cdn-pool 17:47～17:55（原因「azure 節點不足」）；cdn-ranges 17:55（9 秒，首次執行）；cdn-scan 17:55～18:05（補跑）；dns-benchmark 18:05 開始，18:27 仍在跑（補跑） |
| 執行檔 | `/usr/bin/kuroshio` 9.5 MB（squashfs，根目錄 13 MB 已 100%） |
| 執行時資料 | `/tmp/kuroshio` 2.8 MB（state/cdn 1.5 MB、state/filter-lists 1.2 MB），`/tmp` 24 MB 用了 3.5 MB |
| 資料區 | mtd9「Kuroshio」7.5 MB，模式 `ram`；area_note：「資料區跟其他分割區重疊，為了保護設定不使用，學習資料暫時放記憶體」→ 重開機就消失 |
| 開機到量測時的統計 | 查詢 548、命中快取 324、未命中 184、擋下 43（廣告）、CDN 改寫 13、servfail 0 |

---

## 13. 黑潮 DNS 3.1.0：把 LuCI 版的介面全部移植過來（交給本機，2026-11-13）

黑潮 DNS 3.1.0 提供了給其他平台用的穩定整合介面（`PORTING.md`、`docs/integration.md`）。雲端已經完成後端：
- `595300527d`：韌體改用 3.1.0 官方 Linux 通用包（執行檔＋同版 `data/`）
- `b07cbb0ac8`：`kuroshio health` 保護、WAN 上線 `notify wan-changed`、**管理 API 轉接 `/kuroshio_api.cgi`**

**要在實機測，請刷 `b07cbb0` 或之後的韌體**（GitHub Actions 的 `padavan-tw-NEWIFI3-<日期>-<commit>`）。之前的韌體沒有 `/kuroshio_api.cgi`。

### 13.1 參考來源
- 黑潮 DNS 原始碼（標籤 v3.1.0）：`git clone --depth 1 --branch v3.1.0 https://github.com/candy999/kuroshio-dns.git`
- LuCI 介面：`openwrt/luci-app-kuroshio/htdocs/luci-static/resources/view/kuroshio/*.js`（9 頁，約 2,900 行）與 `resources/kuroshio/common.js`
- LuCI 的後端轉接：`openwrt/kuroshio/files/rpcd.sh`（我們的 `/kuroshio_api.cgi` 對應它）
- 設定欄位：`openwrt/kuroshio/files/kuroshio.config`（UCI 預設檔，跟韌體裡的 `/usr/share/kuroshio/kuroshio.uci.default` 相同）

### 13.2 要移植的頁面（LuCI「服務 → 黑潮 DNS」）
| LuCI 頁 | 內容 | 資料來源 |
|---|---|---|
| 狀態 | 執行狀態、上游、快取、過濾、儲存、時間對時、data 版本、憑證；按鈕：清快取、更新過濾清單、執行排程工作、立即更新 DDNS | `op=status`、`op=action` |
| 儀表板 | 查詢量、命中率、擋下、CDN 改寫等統計與圖表 | `op=api&path=/api/dashboard` |
| 基本設定 | 服務、記憶體與儲存、區網網域、允許來源、日誌；DoH／DoT／DoQ；憑證（ACME）；DDNS；DDR／DNR | UCI 檔＋nvram（見 13.4）、`op=api&path=/api/ddns`、`op=dnr`、`op=acme` |
| 連線來源 | 「只開放台灣」等模式、允許／封鎖名單、測試 IP、台灣 IP 資料 | UCI、`op=api&path=/api/access` |
| 廣告過濾 | 開關、訂閱清單、自訂規則、規則檢查、立即更新 | UCI、`op=api&path=/api/filter/check`、`op=action&path=/api/filter/update` |
| CDN 台灣節點 | 節點置換、各家 CDN、ECS、台灣節點池、網域工具（追蹤、驗證、策略） | UCI、`/api/cdn/pools`、`/api/trace`、`/api/cdn/verify`… |
| 社群 | 身分、好友邀請、好友與請求、自動規則、事件 | `/api/community/*` |
| 進階 | 上游（固定、備援、Bootstrap）、解析行為、IP 測速、排程工作、評測、掃描、節點池；**學習資料匯出** | UCI、`op=backup-export` |
| 日誌 | 最近的執行紀錄 | `op=log&n=200` |

放在新後台的哪裡：建議「網際網路 → DNS」維持白話的開關與狀態，另外做「黑潮 DNS」子頁組（上面 9 個分頁）。設計原則照第 5 節：先給結論、說明代價、手機可用。

**Padavan 不適用、要隱藏或固定的 LuCI 設定**：
- `main.redirect`（DNS 接管方式）：固定 `dnsmasq-upstream`
- `main.dns_port`、`main.admin_port`、`main.data_dir`：由 `kuroshio.sh` 決定（5335、8054、依資料區自動）
- OpenWrt 防火牆（nftables）相關的說明：Padavan 的對外埠由韌體的 iptables 規則處理（`kuroshio_wan` 等 nvram）
- 學習資料**匯入**（要上傳檔案）：後端還沒做，先不放；需要時告訴雲端

### 13.3 `/kuroshio_api.cgi`
需要登入（跟其他後台頁一樣）。回應一律是 JSON。

| `op` | 方法 | 參數 | 回應 |
|---|---|---|---|
| `status` | GET | — | `{"enabled","running","use"（kuroshio／fallback）,"mode"（jffs2／rwfs／ram）,"area_note","version","core":<kuroshio status --json>}` |
| `api` | GET | `path`、`q` | `{"ok":true,"result":<管理 API 的 JSON>}` 或 `{"ok":false,"error":"…"}` |
| `defaults` | GET | — | `kuroshio defaults --json` 的內容 |
| `about` | GET | — | 版本、授權、原始碼（含 QR 碼） |
| `dnr` | GET | — | DNR 會發布什麼、沒發的原因 |
| `log` | GET | `n`（行數，預設 200） | `{"ok":true,"lines":[…]}` |
| `action` | **POST** | `path`、`q` | 同 `api` |
| `backup-export` | **POST** | `q=share`（分享檔）或空（完整備份） | `{"ok":true,"size":…}`，接著用瀏覽器下載 `/kuroshio_backup.kuroshio`（下載後路由器端刪除） |
| `notify` | **POST** | — | 立即更新 DDNS、重新偵測對外 IP |
| `flush` | **POST** | — | 立即把學習資料寫進 Flash |
| `acme` | **POST** | `q=force`（強制重新申請）或空 | 背景申請憑證；進度看狀態或日誌 |

- `path` 白名單跟 OpenWrt 的 `rpcd.sh` 相同（查看類與動作類分開），不在名單內回 `{"ok":false,"error":"不允許的路徑"}`
- **`q` 的編碼**：`q` 本身是要轉給管理 API 的查詢字串。先把每個值 `encodeURIComponent`、用 `&` 串起來，**整串再 `encodeURIComponent` 一次**放進 `q`。httpd 解開一層後只接受 `A-Z a-z 0-9 . _ = & % : , ~ -`
  ```js
  function kuroApi(op, path, params, post) {
    var inner = Object.keys(params || {}).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    var body = 'op=' + op + (path ? '&path=' + encodeURIComponent(path) : '') + (inner ? '&q=' + encodeURIComponent(inner) : '');
    return post ? fetch('/kuroshio_api.cgi', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body }).then(function (r) { return r.json(); })
                : fetch('/kuroshio_api.cgi?' + body).then(function (r) { return r.json(); });
  }
  ```
- 動作類只接受 POST，而且要從區網登入（`login_safe`）；GET 呼叫會回「這個操作需要用 POST」
- 管理 API 每個路徑的參數與回應格式：看黑潮原始碼的 LuCI 頁怎麼呼叫（`callApi` / `callAction`），我們的回應包裝跟 rpcd.sh 一樣（`{"ok":true,"result":…}`）

### 13.4 設定的讀寫
黑潮 DNS 的設定是 UCI 文字檔 `/etc/storage/kuroshio/kuroshio.uci`。每次啟動時，`kuroshio.sh` 會把它複製到記憶體，**再用下面這些 nvram 覆蓋對應的 UCI 選項**：

| nvram | UCI | 說明 |
|---|---|---|
| `kuroshio_enable` | （啟停） | 1＝啟用 |
| `kuroshio_domain` | `tls.domain` | 網域 |
| `kuroshio_cf_token` | `cf_account.api_token` | Cloudflare Token（**不寫進 UCI 檔**，只在記憶體） |
| `kuroshio_acme_email` | `tls.acme_email` | |
| `kuroshio_ddns` | `ddns.enabled` | DDNS 的 IP 來源由腳本依 WAN 自動決定 |
| `kuroshio_dot`、`kuroshio_doq`、`kuroshio_doh` | `dot.enabled`、`doq.enabled`、`doh.enabled`（`doh.http3` 跟著 DoH） | |
| `kuroshio_doh_port`、`kuroshio_doh_wan_port` | `doh.port`、`doh.wan_port` | |
| `kuroshio_wan` | `dot.open_wan`、`doh.open_wan` | 開放外網（同時決定韌體防火牆規則） |
| `kuroshio_access` | `access.mode` | |
| `kuroshio_log` | （環境變數 `KUROSHIO_LOG`） | |

規則：
- **上表的設定用 nvram 改**（表單群組 `KuroshioConf;`），改 UCI 檔裡的同名選項沒有用（會被 nvram 蓋掉）
- **其他所有 LuCI 設定都寫在 UCI 檔**：頁面讀取 UCI 檔內容（`<% nvram_dump("kuroshio.kuroshio.uci",""); %>`），在 JS 裡解析成區段／選項，畫成 LuCI 同樣的表單；送出時把整份 UCI 文字放進表單欄位 `kuroshio.kuroshio.uci`（群組 `KuroshioConf;`）一起送出。httpd 會寫回檔案並重新啟動黑潮 DNS。現有的 `Advanced_kuroshio.asp` 就是這樣寫 UCI 檔的（文字框版本）
- UCI 檔不要超過 60 KB（表單上限）；保留檔案裡不認得的區段與選項，不要因為介面沒有那一項就把它刪掉
- 欄位名稱、合法值、預設值以 LuCI 的 `*.js` 與 `kuroshio.config` 為準；`op=defaults` 可以拿來顯示「預設值：…」

### 13.5 預覽工具
`/kuroshio_api.cgi` 在預覽工具裡要用模擬資料（`tools/ui-preview/mock/`）。建議刷好 `b07cbb0` 之後的韌體，從實機抓各 `op`／`path` 的真實回應存成模擬檔（記得遮掉 Token、網域、IP 等個人資料）。

### 13.6 驗收
- 9 個分頁在桌機與手機（390 寬）都能用，亮／暗色正確
- 狀態頁的按鈕（清快取、更新清單、執行工作、更新 DDNS）在實機上會真的執行，結果顯示在頁面上
- 改一個 UCI 設定（例如過濾清單開關）→ 套用 → 重開機後設定還在、`op=status` 反映新狀態
- 匯出學習資料能下載
- 不認得的 UCI 選項存檔後仍然保留

### 13.6.1 黑潮 DNS 3.2.0 新增的功能
立即儲存學習資料、恢復預設清單、恢復預設自訂規則，做法見 `docs/LOCAL-NEXT.md` 第三件。雲端升級 3.2.0 時會把 `/api/persist/flush`、`/api/filter/reset-rules` 加進 `/kuroshio_api.cgi` 的動作白名單。

### 13.7 雲端之後可以補的（需要時告訴雲端）
- 學習資料匯入（上傳檔案）
- UCI 改動不重新啟動、改用 SIGHUP 重新載入（較快、不中斷 DNS）
- 憑證申請進度（`acme-log`）的 API

### 13.8 實作進度（本機，2026-11-14，韌體 6f3e3df、黑潮 DNS 3.2.0）
**已完成**，入口：「網際網路」→ DNS 卡片的「黑潮 DNS 完整設定」，或直接開 `tw_kuroshio.asp`（`#status`、`#dashboard`、`#settings`、`#access`、`#filter`、`#cdn`、`#community`、`#advanced`、`#log`）。「進階設定」裡原本的黑潮 DNS 連結也改到新頁；舊的 `Advanced_kuroshio.asp`（整份 UCI 文字框、CR6608 的 RWFS 啟用）保留，從「進階」分頁連過去。

| 檔案 | 內容 |
|---|---|
| `tw_kuroshio.asp` | 外殼：nvram（`KuroshioConf`，Token 只傳「有沒有設定」）、UCI 檔與自訂規則、評測名單原文（`<xmp>`，不解析 HTML 實體） |
| `tw_kuro.js` | 框架：`/kuroshio_api.cgi`（13.3 的雙層編碼，同時最多 2 個請求）、UCI 讀寫（沒改的行原樣輸出，保留註解與不認得的區段／選項）、表單產生器（欄位描述、檢查、依賴、簡易／專業模式）、區段清單（新增、刪除、上下移）、儲存列（一次送出 UCI＋nvram，超過 60 KB 擋下）；狀態、儀表板、日誌三頁 |
| `tw_kuro_conf.js` | 基本設定、連線來源、廣告過濾（含 3.2.0 恢復預設清單、恢復預設自訂規則）、CDN 台灣節點、進階（含學習資料匯出） |
| `tw_kuro_comm.js` | 社群（身分、邀請碼、加好友、好友與請求、事件、自動規則） |
| `trunk/user/www/Makefile` | `/www/kuroshio` → `/usr/share/kuroshio/dashboard`（儀表板直接用韌體裡黑潮 DNS 附帶的 dashboard.js／css，不另外複製一份） |
| `tools/ui-preview/serve.py`、`mock/kuroshio/` | `/kuroshio_api.cgi` 模擬（從 D3 抓的真實回應，已遮掉 IPv6 前綴、MAC、瀏覽過的網域；社群是示範資料）；`--kuroshio-data <黑潮原始碼>/data/dashboard` 讓儀表板分頁也能預覽 |

Padavan 跟 LuCI 不同的地方（照 13.2、13.4）：網域、Token、DDNS 開關、DoT／DoQ／DoH、DoH 埠、開放外網、來源模式、日誌等級改 nvram；DNS 接管方式、DNS／管理 API 埠、資料目錄、憑證來源與金鑰類型、DDNS 的 IP 來源由 `kuroshio.sh` 決定，不顯示；DoT／DoQ 埠號固定 853（防火牆規則跟著它）。憑證申請進度沿用舊頁的 `SystemCmd kuroshio.sh acme-log`（只限區網登入）。

**驗收（13.6）**
- 預覽：9 頁 × 360／390／768／1024／1440 寬跑版檢查 0 個問題；亮／暗色、手機底部選單下的儲存列位置正確
- 實機（D3）：9 頁都讀到真實資料；清除快取、立即儲存學習資料（「寫了 31 份快照，共 89 KB」）、執行排程工作（排進佇列）都有效
- UCI：關掉「blocklistproject smart-tv」→ 儲存並套用 → 檔案只變那一行；事先手動加進檔案的不認得選項（`main.tw_unknown_opt`）與區段（`config tw_unknown_section`＋兩個 `list`）都保留；服務重新啟動後 `op=status` 的過濾清單 10 → 9
- 恢復預設自訂規則：檔案換成 `/usr/share/kuroshio/default-custom-rules.txt`（12,946 位元組），舊的備份成 `custom-rules.txt.bak`
- 恢復預設清單：預覽測過（停用一份、刪一份、加一份自己的 → 列出「會新增／啟用改回／保留自己加的」，套用後順序與內容回到預設，自己的清單排最後）
- 匯出：分享檔 247 KB 下載成功（zstd），第二次開是空的（下載後刪除）
- **重開機後設定還在**（2026-11-17 重測）：在新頁關掉 smart-tv＋恢復預設自訂規則（檔案裡事先加了不認得的選項與區段）→ `kuroshio.sh flush` → 後台重開機（約 50 秒回來）→ `kuroshio.uci` 雜湊值不變（smart-tv 仍是 `enabled '0'`、`tw_unknown_*` 都在）、`custom-rules.txt` 是 12,946 位元組的新預設＋`.bak`、`op=status` 過濾清單 9 份、學習資料 299 個檔都在；cdn-scan／cdn-ranges／dns-benchmark 沒有重跑（cdn-pool 照樣重跑，13.9 第 5 點）。測完用「恢復預設清單」改回，再刪掉測試用的兩段，UCI 檔跟韌體預設一模一樣
- **但斷電會不見**：11/14 第一次測完沒有重開機，3 天後路由器斷過電，那之後在後台改的黑潮設定、恢復的自訂規則**全部不見**（`/etc/storage/system_time` 停在 11/14 07:06，就是最後一次正常重開機）。見 13.9 第 8 點

### 13.9 後端問題（2026-11-14 實機；**2026-11-17 已在 613323c 處理完**，見 13.11）
1. **`kuroshio.sh` 的 `api_fetch` 用 `curl -f`，管理 API 的錯誤原因被吃掉**：DDNS 沒開時按「立即更新 DDNS」，管理 API 回 `HTTP 400 {"error":"DDNS 未啟用"}`，轉接後變成 `{"ok":false,"error":"黑潮 DNS 沒有回應"}`。建議拿掉 `-f`、用 `-w '%{http_code}'` 判斷：2xx 包成 `{"ok":true,"result":…}`，其他回 `{"ok":false,"error":<回應的 error>}`。前端先把 DDNS 沒開時的按鈕停用
2. **`/api/filter/update` 超過轉接的 60 秒上限**：D3 實測 68 秒（`curl -m 280` 直接打管理 API，回 `{"changed":true}`），轉接的 `curl -m 60` 先逾時，頁面看到「沒有回應」但其實有更新。建議這個路徑放寬到 180 秒，或改成背景執行。前端先改成提示「已送出，約 1～2 分鐘後看過濾規則數」 **3.3.0（2026-11-17）**：黑潮改成背景執行（管理 API 版本 2，立刻回 `runId`，結果在 `/api/status` 的 `filter.update`），前端已改成等到這一次結束才通知（3.2.x 照舊）；韌體換成 3.3.0 後這點就解決，轉接不用放寬逾時
3. **自訂規則、評測名單不能從後台寫入**：`KuroshioConf` 只有 `kuroshio.kuroshio.uci` 一個檔案欄位。需要 `kuroshio.custom-rules.txt`（存檔後黑潮 DNS 3 秒內自己重新載入，不用重新啟動）與 `kuroshio.benchmark/{iplist,dohlist,dotlist,doqlist,web,blacklist}.txt`（`benchmark` 子資料夾要先建立）。前端目前唯讀顯示，標明「這一版還不能修改」
4. **`/etc/storage/kuroshio/backup.kuroshio`（303 KB）在 jffs2 模式下還留著**：是之前放記憶體時的每日備份，第一次開機已經匯入（syslog「已匯入學習資料備份」），之後沒用了，卻佔掉 Storage 分割區（512 KB）的大半：整個 `/etc/storage` 壓縮後 333 KB，再大就會超過 `mtd_storage.sh save` 的上限、**所有設定都存不進去**（存檔失敗只記 log）。建議資料區是 jffs2／rwfs 時，匯入成功後刪掉這個檔
5. **黑潮核心：`cdn-pool` 每次重新啟動都重跑**：工作設定 `runIfMissing: state/cdn/pools.json`，但學習資料寫到 Flash 的是 `pools.json.zst`，所以每次啟動都判斷「首次執行（缺少 state/cdn/pools.json）」，即使 07:24 剛成功過。在後台改任何黑潮設定都會重新啟動服務，接著重跑約 20 分鐘的節點池重建（CPU 很高）。要回報黑潮 DNS 專案（檢查時也認 `.zst`）。**更新（2026-11-17）**：黑潮 DNS main 的 376f560 已修（3.2.1，`runIfMissing` 也認 `.zst`），但**還沒發 Release**（最新仍是 v3.2.0）；用 CI 產出的 3.2.1 mipsel 執行檔在 D3 暫時替換測試，重新啟動 3 分鐘後（`startDelaySec` 120）`cdn-pool` 沒有重跑。韌體的 `trunk/user/kuroshio/Makefile` 從 Release 下載，等 v3.2.1 發佈後改 `KUROSHIO_VER`、`KUROSHIO_COMMIT` 與兩個 SHA256 **3.3.0 已包含這個修正**（Release 有發佈）
6. 黑潮核心：長時間運作每 15 秒左右一行 `WARN duplicate reset token`，會洗掉日誌緩衝區（請黑潮 DNS 確認）。**更新（2026-11-17）**：這行出自 QUIC 函式庫 quinn-proto（`quinn-proto/src/endpoint.rs`），3.2.1 沒有處理（quinn-proto 仍是 0.11.19）；可以請黑潮把 `quinn_proto` 的日誌層級調成 error **3.3.0 已修**：預設只記 `quinn_proto` 的錯誤（`KUROSHIO_LOG` 可以改）
7. 小問題：`/etc/storage/kuroshio/.migrate_note` 與（3.2.0 之前寫的）`custom-rules.txt` 權限是 0666；13.7 的三項（匯入、SIGHUP 重新載入、憑證進度 API）照舊需要
8. **【重要】後台存的設定要到正常重開機才寫進 Flash**：`/etc/storage` 只有在正常關機／重開機（rc 的 `write_storage_to_mtd`）時才存到 Storage 分割區；httpd 套用時寫了 `kuroshio.uci` 卻不存，`rstats_stored=1` 也沒有定時存。所以在後台改了黑潮 DNS 設定（新頁或舊的 `Advanced_kuroshio.asp` 都一樣）、或黑潮 DNS 自己寫進 `/etc/storage/kuroshio` 的東西（恢復預設自訂規則、`.bak`、`.migrate_note`），**斷電就全部回到上次重開機前的樣子**。D3 上已經實際發生（13.8）。建議：httpd 寫入 `File` 類欄位有變更時呼叫 `mtd_storage.sh save`（或 `kuroshio.sh` 重新啟動前存一次），黑潮 DNS 寫 `/etc/storage` 的動作完成後也存一次；注意第 4 點的 303 KB 會讓每次存檔變慢、也更容易超過上限 **3.3.0（2026-11-17）**：黑潮新增環境變數 `KUROSHIO_ON_CONFIG_WRITE`（寫入設定目錄後合併執行一次，結束服務前也會先跑完），但 **Padavan 上目前不會觸發**（見 13.10），已回報黑潮；httpd 自己寫入 `kuroshio.uci` 的部分仍然要 Padavan 處理

### 13.10 黑潮 DNS 3.3.0（2026-11-17 實機；後端升級已在 613323c 完成，見 13.11）
測法：把 Release 的 `kuroshio-linux-mipsel-unknown-linux-musl.tar.gz`（SHA256 與 `SHA256SUMS` 相符）解到 D3 的 `/tmp`，用 bind mount 蓋過 `/usr/bin/kuroshio` 與 `/usr/share/kuroshio`（重開機就恢復成韌體的 3.2.0），新頁面用 `push.py` 推上去。

| 項目 | 結果 |
|---|---|
| Release 檔案 | 通用包多了 `data/kuroshio.config`（跟 `openwrt/kuroshio/files/kuroshio.config` 一模一樣，SHA256 `2acf7cb391f48ebe79b4e5432055158e16e93f33f7296382ff0f4513b785beb0`）與 `data/shared/ui-core.js`；`data/` 底下的 .js／.css 都沒有 ej 標記；另附 `kuroshio-dns-3.3.0-source.tar.xz` |
| 管理 API 版本 | `op=about`、`/api/status` 都是 `"api": 2` |
| 立即更新過濾清單 | `POST /api/filter/update` 0.5 秒就回 `runId`；再按一次回 `started:false` 和同一個 `runId`；18 秒後 `filter.update` 變成 `idle`、`changed:true`。新頁從按下到通知「已重新下載過濾清單」20 秒，不再出現「沒有回應」 |
| `kuroshio notify trim` | 3.2 秒，釋出約 1.7 MB（CDN 網域資料庫從 1.7 MB 降到 16 KB、DNS 快取上限縮成 256），`memory.holdUntil` 有值。要帶 `kuroshio.sh` 的環境變數（`KUROSHIO_UCI_FILE` 等），直接執行回結束碼 2 |
| `KUROSHIO_ON_CONFIG_WRITE` | **不會觸發**：黑潮監看的是「快照目錄的上一層」（D3 是 `/media/kuroshio/kuroshio`）與 UCI 檔所在的 `/tmp/kuroshio`，沒有 `KUROSHIO_ETC`（`/etc/storage/kuroshio`）。恢復預設自訂規則寫了 `custom-rules.txt` 與 `.bak`，測試指令（`logger`）15 秒內都沒有執行。已回報黑潮 |
| 恢復預設清單 | 新頁載入韌體的 `/kuroshio-shared/ui-core.js`（`KuroshioUiCore`），列出 3.3.0 新增的 4 份大清單（預設不勾選）。頁面自己留的那份比對程式跟 ui-core 用黑潮附的 14 組測試資料比對，結果完全一樣 |
| 每日評測記憶體 | 手動執行 dns-benchmark：1147 個候選、同時 32 個，30 分鐘完成（成功）。每 30 秒取樣，黑潮的 RSS 從 20 MB 慢慢升到最高 **45.5 MB**（3.2.0 是 96 MB），系統可用記憶體一直在 288 MB 以上。HWM 46.5 MB 是中途按「立即更新過濾清單」那一下（下載、解析清單） |
| 排程進度 | 狀態頁的排程表直接顯示「執行中：測完 553 / 1147 個候選（開著 32 條連線）」（黑潮的 `jobs.detail`，新頁不用改） |
| 儀表板 | 3.3.0 的 `dashboard.js` 正常顯示，主控台沒有錯誤 |

前端（這次一起推）：
- `tw_kuro.js`：更新過濾清單看回應有沒有 `runId`（API 2）。有就每 3 秒讀 `/api/status` 的 `filter.update`，等這一次結束才通知；等待期間按鈕停用（從別的分頁再按只提示「還在更新中」），不會重複送出；3.2.x 照舊。狀態頁「過濾規則」顯示「清單更新中…」，「系統記憶體」顯示 trim 的暫停時間。新增 `K.core()` 載入 `KuroshioUiCore`
- `tw_kuro_conf.js`：恢復預設清單優先用 `KuroshioUiCore`，讀不到（3.2.x 韌體）才用自己的一份；比對出錯時說明原因並停用按鈕（同 LuCI 3.2.1）
- `www/Makefile`：多一個連結 `/www/kuroshio-shared` → `/usr/share/kuroshio/shared`
- `tools/ui-preview/serve.py`：模擬 API 2 的背景更新（8 秒），並提供 `/kuroshio-shared/`

**後端要做的（613323c 已全部完成，不用再交給雲端）：**
1. `trunk/user/kuroshio/Makefile`：`KUROSHIO_VER := v3.3.0`、`KUROSHIO_COMMIT := 23db5a1a5aaaff43579fcc5c6600bb274c7cf832`、`KUROSHIO_PKG_SHA256 := 3b8167cbab4997d13f8fab8ff0a79c7727c6a385bf79aad68a2b4fc249d1ba3a`。預設 UCI 改用通用包裡的 `dl/kuroshio/data/kuroshio.config` 安裝成 `kuroshio.uci.default`，可以拿掉 `KUROSHIO_RAW` 的下載與 `KUROSHIO_UCI_SHA256`。`cp -a data/.` 會一起裝進 `shared/`（新頁要用）；`shared/ui-core.tests.json`（33 KB）是測試資料，可以不裝
2. `.github/workflows/build.yml`：原始碼改附 Release 的 `kuroshio-dns-${ver}-source.tar.xz`（SHA256 `711e6bfb1f5c9a0da1db20dd56cc10007d4d456894432191cd92545ccf66ac96`，在 `SHA256SUMS` 裡；含全部依賴套件、可以離線編譯），不要再用 `archive/refs/tags/*.tar.gz`
3. `kuroshio.sh`：
   - `UCI_OLD_DEFAULTS` 加上 3.2.0 預設檔的 SHA256 `2d1a9a7ce393269243957adb124d31a2bf66e70e0098e29c830be6bce31d47b6`：沒改過設定的人升級後會換成 3.3.0 的預設，多出 4 份不勾選的大清單（D3 目前的設定檔就是 3.2.0 預設）。改過的照舊只提示，後台「恢復預設清單」會列出這 4 份
   - `export KUROSHIO_ON_CONFIG_WRITE="mtd_storage.sh save"`：現在設了也不會觸發（上表），黑潮修正後就有效；先設好沒有副作用
   - `notify` 加 `trim`（`$BIN notify trim --uci`，環境變數照 `kuroshio.sh` 的）
   - 停止服務已經等 15 秒，符合黑潮的建議，不用改
4. httpd `upload.c`：收韌體映像（寫進 `/tmp/linux.trx`，tmpfs）之前呼叫 `kuroshio.sh notify trim`，失敗就略過
5. 13.9 第 8 點 httpd 存 Flash 的部分照舊要做

**實機刷機（2026-11-17）**：D3 刷了 `170a85d` 的 `NEWIFI3-oc1000`（SHA256 `1df6ed32…a401`，uImage 標頭與 kernel CRC 都核對過），用 SSH 走跟後台升級同一條路（`/tmp/linux.trx` ＋ rc 的 `flash_firmware`），約 111 秒開機。韌體版本 `4.4.198.9-100_170a85d`，新頁與 `/www/kuroshio`、`/www/kuroshio-shared` 連結都在韌體裡；設定檔、自訂規則、SSH 金鑰都保留。黑潮仍是 3.2.0：恢復預設清單改用頁面自己的一份（13 份，沒有變更）、更新過濾清單 18 秒完成、狀態頁與儀表板正常、頻寬管理頁正常，主控台都沒有錯誤。

### 13.11 完成事項與交接（2026-11-17，613323c，D3 實機）
黑潮 DNS 3.3.0 整合完成，13.9 與 13.10 的後端項目都在這次處理，雲端不用再做。

| 項目 | 做法 | D3 實機結果 |
|---|---|---|
| 升級到 3.3.0 | `trunk/user/kuroshio/Makefile`：v3.3.0、通用包 SHA256；預設 UCI 改用通用包的 `data/kuroshio.config`（不再另外下載）；`build.yml` 改附 Release 的 `kuroshio-dns-3.3.0-source.tar.xz`（核對 Makefile 的 `KUROSHIO_SRC_SHA256`） | 四個機型編譯成功；原始碼附加步驟在本機照樣跑過，雜湊值相符（Release 只在打標籤時建立） |
| 升級時換成新預設 | `kuroshio.sh` 的 `UCI_OLD_DEFAULTS` 加上 3.2.0 預設檔 | D3 開機時「設定檔是舊版預設值，已換成這一版的預設」，過濾清單 17 份（新增的 4 份不勾選） |
| 設定存進 Flash（13.9 第 8 點） | `kuroshio.sh storage-save`：背景執行、2 秒內合併、內容沒變不寫。呼叫的時機：黑潮啟動（後台改設定一定會重新啟動）、每個後台動作之後（恢復預設自訂規則、社群等）、`KUROSHIO_ON_CONFIG_WRITE`、httpd 寫入黑潮的檔案欄位之後 | 開機、存自訂規則、存評測名單、恢復預設自訂規則之後，`bzcat /dev/mtdblock6` 裡都是新內容 |
| 自訂規則、評測名單可以在後台修改（13.9 第 3 點） | httpd 新增 `kuroshio.custom-rules.txt`、`kuroshio.benchmark/*.txt` 檔案欄位（不重新啟動），寫入後 0600；前端改成可編輯的文字框，跟其他設定一起「儲存並套用」，存檔列算一處變更 | 新增一條規則：黑潮沒有重新啟動，`filter/check` 立刻回 `tier: custom`；評測名單寫進 `benchmark/iplist.txt` |
| 恢復預設自訂規則 | 完成後重新讀檔（重抓頁面取 xmp），文字框直接換成新內容 | 測試規則消失、備份 `.bak` |
| 管理 API 的錯誤原因（13.9 第 1 點） | `api_fetch` 不用 `curl -f`，4xx／5xx 取出回應的 `error`；逾時另外說明 | DDNS 沒開時回「DDNS 未啟用」（HTTP 400），不再是「沒有回應」 |
| 立即更新過濾清單（13.9 第 2 點） | 3.3.0 背景執行（API 2），前端等這一次結束才通知 | 15 秒後通知「已重新下載過濾清單」 |
| 舊的 303 KB 備份（13.9 第 4 點） | 學習資料在 Flash（rwfs／jffs2）而且已經有資料、這次開機沒有匯入 → 刪掉 `backup.kuroshio` | 已刪除；Storage 從 333 KB 降到 86 KB |
| 節點池重跑、日誌洗版（13.9 第 5、6 點） | 黑潮 3.3.0 修正 | 開機 290 秒後節點池沒有重跑；`duplicate reset token` 3.3.0 預設不記（觀察時間只有幾分鐘，長時間運作請再看日誌） |
| 檔案權限（13.9 第 7 點） | `.migrate_note` 用 umask 077 寫；啟動時把設定目錄的 .txt／.bak／.migrate_note 改成 0600、benchmark 資料夾 0700 | `.migrate_note` 從 0666 變成 0600 |
| 上傳韌體前讓出記憶體 | httpd `upload.c` 收映像檔之前呼叫 `kuroshio.sh notify trim 600` | 用 1 KB 的假檔案打 `upgrade.cgi`（標頭檢查不過、不會刷入）：日誌「已先讓出記憶體（600 秒內不長大）」，`memory.holdUntil` 有值 |

**驗證的方式**：D3 用 SSH 走跟後台升級同一條路刷 `613323c` 的 `NEWIFI3-oc1000`（`/tmp/linux.trx` ＋ rc 的 `flash_firmware`），刷之前核對 SHA256、uImage 標頭與 kernel CRC。刷之前的 `170a85d`（3.2.0 ＋ 新頁）也刷過一次，確認新頁在 3.2.x 韌體上會用自己的比對程式。測試用的規則、評測名單、`.bak` 都已清掉並存進 Flash；D3 現在是 3.3.0 的預設設定。

**還沒做（不影響使用，之後要再開）：**
- 學習資料匯入（上傳 .kuroshio 檔）：頁面上的按鈕停用中，要在 httpd 加上傳處理（同韌體上傳）再呼叫 `kuroshio import`
- UCI 改動改用 SIGHUP 重新載入、不重新啟動（13.7）：目前改設定會重新啟動黑潮（約 5～10 秒由業者 DNS 暫代）
- 黑潮的 `KUROSHIO_ON_CONFIG_WRITE` 在 Padavan 上不會觸發（監看的資料夾不含 `KUROSHIO_ETC`），已回報黑潮；Padavan 這邊用「每個後台動作之後存一次」補上，黑潮修好後兩邊都會呼叫，沒有副作用
- Padavan 其他檔案欄位（腳本、dnsmasq 設定等）照上游的做法，還是只在正常重開機時寫進 Flash；要一起改的話，在 `web_ex.c` 的檔案欄位處理後面同樣呼叫 `mtd_storage.sh save`
- CR6608 還沒在實機上測過 3.3.0（RWFS 模式、128 MB 記憶體）

> 上面「還沒做」的前三項已在 13.12（黑潮 DNS 3.3.2）完成。

### 13.12 黑潮 DNS 3.3.2 整合（2026-11-18，D3 實機）
3.3.1 沒有單獨發布，3.3.0 回報的五點與 3.3.1 審查的修正都在 3.3.2。設定格式與 API 跟 3.3.0 相同；預設 UCI 也跟 3.3.0 一模一樣（sha256 `2acf7cb3…`），所以 D3 升級時不會動設定檔。

| 項目 | 做法 | D3 實機結果 |
|---|---|---|
| 升級到 3.3.2 | `Makefile`：v3.3.2、通用包與原始碼包的 SHA256 | CI 四個機型都成功；D3 用 SSH 刷 `0bb30a1` 的 `NEWIFI3-oc1000`（SHA256 `78ecebad…3992`，uImage 標頭與資料 CRC 都核對過），約 115 秒開機，`kuroshio 3.3.2`；設定檔等於預設，沒有遷移；開機 2 秒接管 DNS |
| 改設定不重新啟動 | rc 的 `restart_kuroshio` 先呼叫 `kuroshio.sh reload`：還在執行、日誌等級沒改 → 重寫 UCI 後送 SIGHUP，在同一個行程裡重新載入，不改用業者 DNS、不重啟 dnsmasq；`reload` 回非 0（例如改了日誌等級、黑潮沒在跑）才照舊 stop／start。等新的一輪跑滿 8 秒、有回答才結束，這段期間保護程式不算沒回應（`$RUN/reloading`，最多 2 分鐘） | 同一個 PID、`uptimeSec` 歸零、`use` 一直是 kuroshio、dnsmasq 沒重啟。新設定有錯（同名區段型別不同）時黑潮繼續用上一份設定，`/api/status` 的 `reload.usingPrevious=true`、warnings 有原因，狀態頁顯示「新設定無法套用」；改回來再存就清掉。經 rc（改 `kuroshio_access` 後通知 `restart_kuroshio`）約 10 秒套用；改 `kuroshio_log` 則照舊完整重新啟動（PID 換了） |
| 檢查用小設定檔 | `kuroshio health／status` 改讀 `$RUN/probe.uci`（只有 DNS 埠與管理埠）：使用者存了一份讀不進來的 UCI 時，用 `$UCI` 會讀不到設定、保護程式以為黑潮沒回應而改用業者 DNS | 壞設定期間保護程式沒有切換 |
| 升級遷移 | 設定檔等於舊版預設 → 整份換新（加上 3.3.0 的雜湊值）；改過的 → `kuroshio uci-migrate <使用者設定檔> -o 暫存檔`，比對內容有變才換上（看不懂的 lists_version 會印說明但不改檔，不能看輸出判斷）。不再留 `.migrate_note` 提示 | 3.1.0／3.2.0 預設 → 整份換成 3.3.2 預設；3.2.0 改過（停用 OISD、加自己的清單）→ 最後加 4 份不勾選的清單、lists_version 3.3，OISD 仍停用、自己的清單還在；再跑一次不改檔；CRLF＋BOM 的檔照樣遷移；`lists_version 'abc'` 不動並記一行說明 |
| 寫入設定後存 Flash | 3.3.2 起黑潮連社群金鑰與邀請也會呼叫 `KUROSHIO_ON_CONFIG_WRITE`，`api_action` 不再每個動作都存一次 | 恢復預設自訂規則後 3 秒內執行一次，`KUROSHIO_CONFIG_FILES` 帶 custom-rules.txt 與 .bak |
| `storage_save` 的鎖 | 鎖裡記 PID，程式不在了就接手；最後一次檢查之後才進來的呼叫會再搶一次鎖接著存 | 殘留的鎖（PID 不存在）會被接手、做完清掉；活著的程式拿著鎖時不重複開 |
| 程式辨識 | `main_pid` 只認 `kuroshio run`：`pidof` 會把 `kuroshio health／export／notify` 也算進去，`stop` 以前會連 04:41 的每日匯出一起殺掉 | 啟停、保護、flush 都用它 |
| 停止 | 只對服務本體送 SIGTERM，最多等 30 秒（以前 15 秒；結束了就不等），被強制停止會記一行 | 2 秒停完；黑潮日誌「關機前寫出 0 份快照，0 KB，9 ms」 |
| 保護程式 | 平常每 10 秒檢查；沒回答過一次就改成每秒檢查，約 5 秒內決定要不要改用業者 DNS（以前要 30 秒） | |
| dnsmasq 額外設定 | busybox 沒有 `cmp`，以前每次比對都當成不同、每次啟動都重啟一次 DHCP／dnsmasq；改用 md5sum | `kuroshio.sh restart` 前後 dnsmasq 的啟動次數不變 |
| 開機匯入備份 | 3.3.2 起部分項目失敗時結束碼是 1：失敗不建 `imported`，下次啟動再試，日誌記一行 | |
| 學習資料匯入（G12） | httpd 新增 `kuroshio_import.cgi`：multipart 上傳到 `/tmp/kuroshio/import.kuroshio`（檢查開頭是 zstd、最大 16 MB、0600），要 login_safe 與同一個來源才交給 `kuroshio.sh import-upload` → `curl --data-binary` 到黑潮的 `/api/backup/import`；前端「進階」頁的匯入按鈕打開，送出後等 `/api/backup/last-import` 的 `importedAt` 變了就顯示每一項的結果 | 匯出 305 KB 的完整備份再匯入：十項都是「保留本機」（「CDN 候選 IP」也正確判斷成本機已有，這是 3.3.2 的修正）；不是 zstd 的檔案回「不是黑潮 DNS 的備份檔」；「進階」頁的匯入按鈕與說明都在，主控台沒有錯誤 |
| 後台存檔被截斷 | httpd 的表單緩衝只有 64 KB，超過的部分直接丟掉、照樣存進 Flash。前端改成算整份表單編碼後的大小（換行是 CRLF、中文一個字 9 bytes），超過 64000 就擋下並提示分次存 | 自訂規則加 450 行中文（檔案 35.9 KB，以前 60 KB 的檢查會放行、送出後被截斷）：提示「送出時約 97 KB」，沒有送出 |
| 跨站請求（CSRF） | httpd 解析 `Host`、`Origin`、`Referer`；`kuroshio_api.cgi` 會改變狀態的操作與匯入，要 Origin（沒有就看 Referer）的主機等於 Host 才執行 | 從 `http://127.0.0.1:8088` 的網頁送表單到 `kuroshio_api.cgi`（瀏覽器有帶登入資訊）：回「來源網頁不符」、沒有執行；後台頁面自己的 flush、匯出、匯入照常 |
| 狀態頁 | 顯示 `warnings`（清單下載失敗、存取控制資料讀不到、時間沒對時等）與 `reload.error`（結論改成「新設定無法套用」），「本程式記憶體」顯示 `memory.jobs`（評測中的原始答案、連線） | |
| 其他 | UCI 值改用環境變數傳給 awk（反斜線不會被吃掉）；網域只收英數字、點、連字號；DoH 埠號 1～65535 以外用預設；UCI 去掉 BOM 與 CR；`/api/cdn/domains` 一次最多 2000 筆；日誌 JSON 濾掉控制字元；匯出檔只有有權限的請求才刪；「直接編輯設定檔」卡片以前因為多一個分號從沒顯示 | |
| dhcp6c 洗日誌 | busybox dhcp6c：Solicit 帶 rapid commit、Reply 裡要的 IA 一個前綴都沒有（業者回 NoPrefixAvail）時，以前會 `remove_ia → client6_start` 立刻重來，每秒送 2～5 次、syslog 整個被洗掉；改成跟 Advertise 一樣忽略，照 Solicit 的重送間隔逐次加倍 | 刷機後 5 分鐘 dhcp6c 只有 19 行（以前每秒 2～5 行），重送間隔 36 → 16 → 33 → 68 → 132 秒；開機 5 分鐘 syslog 共 615 行 |

**實機觀察，已回報黑潮**：SIGHUP 之後新的一輪第 1 秒就會回答，接著約 4 秒忙著載入（過濾清單、CDN 資料庫）不回答 DNS、管理 API 也沒回應（`uptimeSec` 照樣在算，不是又重啟）。`reload` 因此等跑滿 8 秒才結束，避免保護程式誤判。

**記憶體三階段（3.3.2，D3，手動跑一次每日評測，已回報黑潮）**：

| 時間點 | RSS | memory.jobs | memory.sizes（快取／CDN／清單） |
|---|---|---|---|
| 評測前 | 19.9 MB | 沒有工作 | 4 KB／1.73 MB／2.95 MB |
| 開始 3 分鐘（資格賽） | 30.8 MB | rawBytes 0、連線 0 | 同上（清單補到 3.40 MB） |
| 評測中高點 | 44.7 MB（HWM 45.5 MB） | rawBytes 6.08 MB、連線 32 | 18 KB／1.73 MB／3.40 MB |
| 評測後 | 44.4 MB | 回到 null／0 | 同上 |
| `notify trim` 後 75 秒 | 43.4 MB | null／0 | 18 KB／**12 KB**／3.40 MB |

trim 把 CDN 冷資料移出記憶體（1.7 MB），RSS 只降 1 MB；評測後比評測前多約 24 MB，`memory.sizes` 只能解釋約 1 MB 的增加。資格賽階段 RSS 漲了約 11 MB，`rawBytes` 卻還是 0。

**之後補上（2026-11-18，`d92c48c`、`5771f9a`，D3 實機）**：

| 項目 | 做法 | D3 實機結果 |
|---|---|---|
| 登入來源每次請求判斷 | `get_login_safe()` 改看這次請求的 IP（每個請求只算一次）。以前 `http_login_check()` 讓別的 IP 用同一組帳密登入時回 3、不再呼叫 `http_login()`，`login_safe` 一直是第一個登入者的值 | 從區網：狀態、trace、paths、flush、匯出、匯入照常。**從外網登入還沒測**（要有外網連線與密碼） |
| 查看類請求擋跨站 | `kuroshio_api.cgi`（含 GET）與匯入只收帶 `X-TW-Request` 標頭的請求（後台的 fetch 都帶；別的網站的 `<img>`、表單、導覽帶不了，跨來源 fetch 帶自訂標頭要先 OPTIONS 預檢，httpd 不支援）；`Sec-Fetch-Site: cross-site` 也擋（瀏覽器只在 HTTPS 才送）。`/api/trace`、`/api/community/invite`、`/api/paths`、`/api/interfaces` 只給區網／VPN 登入的人 | 從 `127.0.0.1:8088` 的網頁用表單 GET 打 `op=api&path=/api/status`：回「請從路由器後台的頁面操作」；只靠 Sec-Fetch-Site 的第一版（`d92c48c`）在 HTTP 後台擋不住，所以改用標頭 |
| 其他檔案欄位存進 Flash | `write_textarea_to_file()` 有改到檔就記下來，`apply.cgi` 處理完呼叫 `kuroshio.sh storage-save`（沒有黑潮時直接 `mtd_storage.sh save`）：腳本、dnsmasq、crontab、憑證、OpenVPN 都算 | 後台存 `dnsmasq.conf` 加一行註解：套用後 `/dev/mtdblock6` 裡就是新內容；測完已還原（md5 與原本一致） |
| 記憶體模式停止時存進 Flash | `stop` 匯出備份後，等背景存檔做完，再同步執行 `mtd_storage.sh save`（重開機時 rc 接著也會存，兩個不能同時跑） | 暫時把模式標成 ram 後停止：11 秒，305 KB 的備份在 Flash 裡；回到 jffs2 啟動時刪掉用不到的備份並存回 |

**還沒做（不影響使用）**：
- CR6608 還沒實機測（RWFS、256 MB 記憶體）
- 從外網登入的權限判斷還沒實測

### 13.13 黑潮 DNS 3.3.3 發布前測試（2026-11-18，D3，CI 版 `bb11a6ee0`，從 /tmp 執行，韌體沒換）
| 項目 | 結果 |
|---|---|
| SIGHUP 停頓 | 3.3.2：每次 SIGHUP 後 15 秒內 13～14 次沒回答、最慢約 200 ms。3.3.3：4 次沒回答，全部是 SIGHUP 後 0.23～0.36 秒的 `Connection refused`（新舊兩輪換監聽的空窗），最慢 18 ms。**整合 3.3.3 時 `kuroshio.sh reload` 的「跑滿 8 秒」可以縮到 2 秒** |
| 評測子程序 | 評測前主程式 21.8 MB；評測中主程式 21.8～23.0 MB，子程序 11.9 MB → 最高約 37 MB（`processPeakRssBytes` 38,825,984），`rawBytes` 最多 6.0 MB；評測後主程式 23.1 MB（3.3.2 會多約 24 MB 降不下來） |
| 停止 | 評測進行中 `stop`：1 秒停完，子程序一起結束 |
| 清單副本 | 10 份啟用清單都有副本（3.3.0 時 6 份），Kuroshio 資料區用 63%；其中 4 份的索引規則數是 0（3.3.2 寫的），`memory-plan` 因此說「還沒有本機副本」並高估規則數（429,825 對實際 369,652） |
| `memory-plan` | 推算子程序最高約 18 MB，實測約 37 MB；其他欄位合理 |
| 開機日誌 | 沒有「分片不見了」洗版 |

**之後（`8ca57dc`）**：憑證申請進度改走 `kuroshio_api.cgi` 的 `op=acme-log`（`kuroshio.sh acme-log-json`：`{ok, running, log}`，只給區網／VPN 登入的人），拿掉前端借 `apply.cgi` SystemCmd 的 `sysCmd()`；`kuroshio.sh reload` 依黑潮版本決定要等新的一輪跑滿幾秒（3.3.3 起 2 秒、以前 8 秒）。D3：`op=acme-log` 回 `{ok:true, running:false, log:""}`，沒帶 X-TW-Request 的被擋；3.3.2 的 reload 照舊約 12 秒（含重寫設定）

### 13.14 黑潮 DNS 3.3.3～3.4.0（2026-11-18～20，摘要）
- 韌體依序升到 3.3.3（25beed5）、3.3.6（e7588c5；路由器 IPv6 關閉時帶 `upstream.ipv6=0`）、3.3.7（6432347）、**3.4.0**（ace2df1）
- 3.4.0 串接模式（預設開）：黑潮頁面適配串接狀態與設定（fdc4446）。D3 已驗證串接狀態、共用結果、重新載入不斷線（400 筆 0 失敗）、每秒 40 筆查詢 0 逾時；作者要的 ③④（要動主路由器）、⑥補跑時段 `catchup_window` 還沒做（HANDOFF-LOCAL 5.7）
- 記憶體隨快取長大、閒置不回落（約 110 MB），已回報作者，不擋 B6

### 13.15 網際網路頁「MOD／IPTV 接法」卡片（2026-11-20，40a9205、1f7ff9e，D3 實機）
- 內容：自動偵測開關（`tw_mod_auto`）、沒有接 MOD／中華電信 MOD（選孔）／中華電信 MOD＋VLAN、MOD 孔連線狀態、群播（IGMP 代理、udpxy）設定；寫入的變數見 11.2
- 後端 `tw_mod.c` 偵測到機上盒會自動設成 MOD 專用孔並寫系統記錄；有 MOD 孔時 WAN 設成交換器 IGMP 的固定上游孔（修正直播黑畫面）
- D3 實測：機上盒重開後約 1～2 分鐘偵測到 LAN1；直播約 10 Mbps 只送到 LAN1，接電腦的 LAN2 沒有被灌群播；換台正常（實測多台）
- 限制：機上盒沒重新要位址（例如只重開路由器）時偵測不到，要重開機上盒；偵測到不會自動取消（在這張卡片改回）
- 頁面與文件不要顯示或記錄機上盒的 MAC、序號、位址
