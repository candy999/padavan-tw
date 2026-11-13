# 交接單：後台介面（本機工作階段）

> 寫給：在使用者電腦上執行的 Claude Code（本機工作階段）。
> 目的：本機可以用瀏覽器直接連路由器後台除錯，所以**後台介面改由本機負責**。
> 一律用**繁體中文（台灣用語）**跟使用者溝通，包括程式註解與 commit 訊息。

---

## 0. 分工與流程（先讀這段）

| 階段 | 在哪裡 | 做什麼 |
|---|---|---|
| **U：介面全面重做** | **本機**（就是你） | 依第 5 節的使用者目的重新設計後台，**連未來功能的介面一起做**；未來功能的資料先用模擬資料（第 6 節的資料介面約定），預覽工具與實機都要能跑 |
| B：後端 | 雲端工作階段 | 依第 6 節的約定實作資料來源（`twstats` 取樣器、硬體 QoS 控制器、漫遊資料、黑潮狀態轉接等），把模擬資料換成真的 |
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
- 開發分支：`claude/zealous-feynman-bhwrbf`（與雲端工作階段共用，**每次開工前先 `git pull`**，避免跟雲端的提交衝突）
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
- 推送到 `claude/zealous-feynman-bhwrbf` 會觸發 GitHub Actions（`.github/workflows/build.yml`），編 NEWIFI3、CR660x 的標準版與 `-oc1000` 版，約 10～15 分鐘
- **同一分支新的推送會取消正在跑的編譯**（concurrency 設定）。雲端工作階段在等編譯結果時，先跟使用者確認再推送
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
7. **網路順暢**：頻寬管理（硬體 QoS）——「視訊會議、遊戲不卡」
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
| **網際網路** | 連線方式對不對？ | 業者精靈（光世代 PPPoE、有線電視、固定 IP…）、MTU 自動偵測、IPv6、DNS（黑潮 DNS 的白話設定）、**CGNAT 偵測**、MOD 接法 | 廣域網路、IPv6、DNS 服務 |
| **遠端與分享** | 外出怎麼連回家？外面怎麼連進來？ | WireGuard 伺服器（裝置、QR、誰在線）、連接埠轉送（依用途：遊戲、NAS、監視器，自動帶入裝置）、UPnP 狀態、網域（黑潮 DDNS）與憑證 | WireGuard、虛擬伺服器、UPnP、DDNS |
| **頻寬管理** | 怎麼讓視訊、遊戲不卡？ | 硬體 QoS 模式（關閉／固定／自動）、申裝方案、目前狀態、最近介入紀錄與前後延遲 | （新） |
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

#### 頻寬管理（硬體 QoS）
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

- 網址：`/tw_api.asp?q=<名稱>[&<參數>]`（實作方式由 B 階段決定；前端只依賴 `TW.api()`，在 `tw_ui.js`）
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
| `latency` | `baseline_ms`、`current_ms`、`loss_pct`；`targets[{id: gw/hinet/twnic/cf, label, host, current_ms, baseline_ms, loss_pct, series, loss}]`（`series`、`loss` 是時間序列，loss 單位 %） | 10 秒 | B 階段（twstats D1） |
| `wan` | `connected`、`internet`（狀態值）、`proto`（pppoe/dhcp/static）、`proto_label`、`isp`、`ip4`、`gw4`、`ip6`、`dns[]`、`uptime_s`、`ether`、`rx_kbps`、`tx_kbps`、`plan_down_kbps`、`plan_up_kbps`、`mtu`、`last_error`；`series{step, start, down_kbps[], up_kbps[]}` | 2 秒（即時）／60 秒（序列） | 現在由 wanlink、netdev、rstats 組出（序列 120 秒一筆）；`isp`、方案頻寬 B 階段 |
| `router` | `cpu_pct`、`mem_used_pct`、`mem_total_kb`、`uptime_s`、`load[]`、`conntrack_count`、`conntrack_max`、`temp_c`（可能 null）、`cpu_series`（選用） | 5 秒 | 現在由 json_system_status、nf_values 組出 |
| `devices` | `devices[{mac（有冒號）, name, hostname, type: phone/computer/tv/game/iot/nas/camera/router/other, conn: wifi/wired/guest, band: "2.4"/"5", ap, signal_dbm, tx_rate_mbps, rx_rate_mbps, ip, static_ip, online, since_s, last_seen_ts, paused, disconnects_today, usage_today_bytes}]` | 10 秒 | 現在由 get_static_client、wl_auth_list 組出：分不出有線或剛離開 Wi-Fi（`conn: "wired_guess"`），沒有頻段、AP、上線時間；整合 B 階段 |
| `device?mac=` | `signal`、`rate`（時間序列）、`disconnects[{ts, reason}]`、`roams[{ts, from, to, rssi_from, rssi_to}]`、`advice[{title, detail, action, href}]`、`usage_today_bytes` | 60 秒 | B 階段（D4） |
| `wifi` | `bands[{id, ssid, enabled, channel, auto_channel, width_mhz, txpower_pct, clients, busy_pct, neighbors{count, by_channel{頻道: 數量}, strongest[{ssid, channel, rssi_dbm}]}, acs_last{ts, from, to, reason}}]`；`guest{enabled, ssid, expires_ts, clients}` | 30 秒 | 部分現有；**鄰近 AP 要 B 階段**（見第 12 節：現有的 `wl_scan_*` 在 D3 輸出壞掉） |
| `roam` | `mode: off/observe/steer`、`weak_dbm`；`aps[{name, model, ip, online, self, clients_24, clients_5, steer_capable}]`；`events[{ts, mac, name, from, to, rssi_from, rssi_to, type: roam/sticky}]`；`advice[{level, title, detail}]` | 30 秒 | 資料已有（/tmp/tw-roamd.*），轉 JSON 是 B 階段；現在頁面提供「查看漫遊紀錄」文字 |
| `events` | `events[{ts, type: wan/channel/device/qos/dns/system/roam/vpn, level, text, device}]`，新的在前 | 30 秒 | B 階段（D5） |
| `qos` | `mode: off/fixed/auto`、`plan_down_kbps`、`plan_up_kbps`、`state: idle/probing/limiting/deciding/ending`、`limit_down_kbps`、`limit_up_kbps`、`interventions[{ts, reason, action, latency_before_ms, latency_after_ms, duration_s}]` | 5 秒 | B 階段（E4～E8）。**設定寫入**：`tw_qos_mode`（0 關閉／1 固定／2 自動）、`tw_qos_down`、`tw_qos_up`（Mbps），頁面用 `sid_list=General;` 送出 → B 階段在 variables.c 的 General 登記、defaults.c 給預設值 |
| `dns` | `enabled`、`running`、`healthy`、`zone_mode`、`filter_ads`、`encrypted`、`cdn_tw`、`queries`、`blocked`、`cdn_rewrites`、`cache_hit_pct`、`avg_ms`、`upstreams[{name, addr, ok, ms}]`、`domain`、`cert_expiry_ts`、`queries_series` | 30 秒 | 現在由 kuroshio_status 組出啟用與健康；統計 B 階段（G9） |
| `vpn` | `enabled`、`listen_port`、`peers[{name, ip, last_handshake_ts, rx_bytes, tx_bytes, endpoint}]`（`name` 對應 WGSPeerList 的名稱） | 10 秒 | B 階段（J4）；現在裝置清單來自 nvram |
| `cgnat` | `cgnat`（true/false/null）、`kind: public/cgnat/double_nat`、`wan_ip`、`public_ip`、`reason`、`method: stun/wan_ip` | 開頁時 | 現在前端依 WAN 位址判斷（`method: "wan_ip"`，分得出公網／私人／100.64），比對對外位址是 B 階段 |
| `diag` | 同 `health` 的 `headline`、`level`、`segments`（每段多 `metric`，段落 id：wifi/router/isp/load/dns/web）＋`duration_s`、`report`（文字） | 按下時（約 30～40 秒） | B 階段；現在用 `health` 的後備資料 |
| `speedtest` | `running`、`plan_down_kbps`、`last{ts, down_kbps, up_kbps, latency_ms, server}`；`speedtest&run=1` 開始測速 | 按下時 | **新增**，B 階段 |
| ~~`firmware`~~ | — | — | **取消**（使用者 2026-11-13 決定）：韌體更新由瀏覽器直接查 GitHub Release（`api.github.com/repos/candy999/padavan-tw/releases/latest`），路由器不用連外 |

本機在設計時如果需要新欄位或新名稱：**直接修改這張表**（並在 commit 訊息說明），B 階段會依表實作。

### 6.1 需要新的後端功能（B 階段）
- **暫停上網可設時間**（「1 小時」「到今晚 10 點」）：現在只做「直到我恢復」（MAC 過濾封鎖清單 MFList），時間選項顯示「需要更新韌體」。需要一次性排程規則（到時自動從 MFList 移除）
- **訪客網路時效**（2 小時／到今天結束）：現在只有「一直開著」；Padavan 原有的每日時段（`rt_guest_time_x`）在原始頁面
- **漫遊引導模式**（11k＋11v）：頁面的「引導」按鈕先停用
- **Wi-Fi 鄰近 AP 掃描**：見第 12 節

---

## 7. U 階段的建議順序與驗收

| 步驟 | 內容 | 驗收 |
|---|---|---|
| U0 | 讀第 5 節，跟使用者確認資訊架構與手機分頁（用問題卡，附建議選項） | 使用者同意 |
| U1 | 共用元件＋`twApi()`＋模擬資料機制（`serve.py` 的 mock 與情境切換） | 預覽工具三種情境都正常 |
| U2 | 新選單與框架（`state.js`）：新的 9 個選單、手機底部分頁；舊頁面全部收進「進階設定」且可用 | 106 頁都能從選單到達；桌機／手機、亮／暗色截圖 |
| U3 | 總覽、裝置、Wi-Fi（含分享、訪客、多台 AP） | 實機上用現有資料能顯示的部分要真的顯示；其餘顯示「功能未提供」 |
| U4 | 網際網路（業者精靈、CGNAT 提示）、遠端與分享、頻寬管理、診斷、系統 | 同上；所有寫入都走 3.3 的表單機制 |
| U5 | 實機走一遍：套用、重開機、登出、語言切換、手機操作 | 使用者確認 |

每一步都：截圖（桌機 1440／手機 390、亮／暗色）、`shoot.js` 沒有橫向溢出與 JS 錯誤、推送前 `git pull`。

---

## 8. 回到雲端（B 階段）時的待辦（給雲端工作階段）

1. 實作 `/tw_api.asp`（web_ex.c）或等效機制，依第 6 節逐一提供資料（格式照 `tools/ui-preview/mock/*.json`；還沒做的名稱維持回空白，前端會自動用後備資料）
2. `twstats` 取樣器（ROADMAP D1～D5），資料只存記憶體
3. 硬體 QoS 固定／自動模式（E4～E8），並在 variables.c 的 General 登記 `tw_qos_mode`、`tw_qos_down`、`tw_qos_up`
4. `tw-roamd` 資料轉 JSON、WireGuard 狀態、CGNAT 偵測（比對對外位址）
5. 黑潮 DNS 統計轉接（G9）
6. 本機在第 6 節新增的約定：`speedtest`、6.1 的排程功能（暫停上網時間、訪客時效、漫遊引導）
7. 修 `ralink.c` 的 Wi-Fi 掃描解析（第 12 節），或在 `wifi` API 提供 `neighbors`
8. ~~韌體版本檢查~~：已改由瀏覽器查 GitHub，不用做

## 9. 目前硬體與韌體狀態（2026-11-13）

- Newifi D3：刷 `ff54088` 版，有線 LAN／WAN 正常（交換器單一 GMAC 修正已在實機確認）。這台就是實機測試機
- 小米 CR6608：使用者正在使用中，**不能動**，等 D3 接手後才刷
- 小米 MI-MINI：暫緩（若做，會用 3.4 核心另外處理）
- 黑潮 DNS：整合完成待實機；Lite／核心版與黑潮專案討論中，**本機不用處理**
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
| U5 | ⏳ 部分完成 | 實機已用 push.py 測過所有頁面的讀取（沒有 JS 錯誤、真實資料正確顯示）。**寫入已驗證**（使用者同意，2026-11-13）：系統頁「路由器燈號」關閉 → 確認框列出影響 → 套用後頁面自動重新載入、SSH 確認 `front_led_all=0`；再打開 → `front_led_all=1`（恢復原值）。**還沒做**：清單類寫入（固定 IP、暫停上網，`" Add "`＋`" Restart "` 兩段送出）、重開機、登出、語言切換、手機實際操作——要使用者在場確認 |

截圖：`node tools/ui-preview/shoot.js` 桌機 1440／手機 390、亮／暗色，全部頁面沒有橫向溢出、沒有 JS 錯誤。

### 11.1 新增與修改的檔案
- 新頁面：`index.asp`（總覽，取代原首頁）、`tw_devices.asp`、`tw_wifi.asp`、`tw_internet.asp`、`tw_remote.asp`、`tw_qos.asp`、`tw_diag.asp`、`tw_system.asp`、`tw_advanced.asp`；頁面邏輯在 `tw_p_<頁>.js`
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
| 頻寬管理 | `General;` | `tw_qos_mode`、`tw_qos_down`、`tw_qos_up`（**B 階段登記後才會生效**，現在頁面停用） |

清單類先送 `action_mode=" Add "`（或 `" Del "`），等 `start_apply.htm` 呼叫 `parent.done_validating()` 後再送 `" Restart "`，與舊頁面相同（`TW.listAdd()`）。

## 12. 實機發現（2026-11-13，給之後的工作階段）

- **`wanlink_status()` 是 0 才代表已連線**，其他數字是原因代碼（1 沒接網路線、5 正在取得 IP、6 等待 PPP、9 網段衝突…，對照 `InetState*` 字典）。預覽工具原本寫成 1，已更正
- `link_internet` nvram：1＝連得到外面、2＝偵測中或不穩定、0＝連不到
- **httpd 啟動時就 chdir 到 `/www`**：bind mount 記憶體副本後要 `killall httpd; httpd` 才會讀到新檔案（`push.py` 會自動做）
- **Wi-Fi 鄰近 AP 掃描壞掉**：`wds_aplist_2g.asp`（`ej_wl_scan_2g`）在 D3 回傳的 JS 字串裡有換行、欄位錯位（`ralink.c` 用固定欄寬解析驅動的掃描表，跟這版驅動的輸出不合）。原始的 WDS 頁應該也受影響。新 Wi-Fi 頁偵測到就顯示「需要更新韌體」。**B 階段**：修 `ralink.c` 的解析，或直接在 `wifi` API 提供 `neighbors`
- 實機的 D3 前面還有一台路由器（WAN 拿到 10.0.0.x）：網際網路頁正確顯示「雙層 NAT」
- `get_nvram_list` 的欄位順序就是 `variables.c` 的順序、不附索引；指定隱藏欄位會輸出 `"*"`；MAC 不含冒號
- 新介面目前只有繁體中文（字串寫在 `tw_p_*.js`，跟現有的台灣版頁面一樣），切換語言只影響原始頁面
