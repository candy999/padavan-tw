# 完整交接單：padavan-tw 全部轉到本機工作階段（2026-11-17）

> 寫給：在使用者電腦上執行的 Claude Code（本機工作階段）。從這份文件開始，**前端、後端、實機測試、編譯發布全部由本機負責**，雲端工作階段不再參與。
> 一律用**繁體中文（台灣用語）**：對話、程式註解、commit 訊息、文件。
> 這份文件是總入口；細節分散在下面列的文件，請先讀這份，再依需要讀其他的。

---

## 0. 先讀哪些文件

| 文件 | 內容 | 什麼時候讀 |
|---|---|---|
| **本文件** | 專案現況、環境、流程、技術重點、所有待辦 | 一開始 |
| `CLAUDE.md` | 語言、原則、分支 | 每次開工自動載入 |
| `docs/ROADMAP.md` | 所有計畫的總表（A～J 章、H 測試、長遠計畫、不做的事） | 選下一件工作時 |
| `docs/HANDOFF-UI.md` | 後台介面：UX 設計、資訊架構、資料介面約定（第 6 節）、進度（第 11 節）、實機發現（第 12 節）、黑潮 DNS 整合紀錄（第 13 節） | 動後台介面或資料 API 時 |
| `docs/LOCAL-NEXT.md` | 上一批工作（驗證、頻寬管理接後端、黑潮移植）——**大部分已完成**，見第 3 節 | 參考 |
| `docs/VERIFY-*.md` | 每一版的實機驗證單與結果 | 寫新的驗證單時當範本 |
| `docs/PATCH-REVIEW.md` | 各分支修補的取捨 | 同步上游、評估別人的修補時 |
| `docs/KVR-3.4-REVIEW.md` | 3.4 版「KVR」做法調查（結論：對 D3 無效，4.4 比較完整） | 有人提 3.4 時 |
| `README.md` | 對外說明 | 發布前更新 |

---

## 1. 專案與環境

### 1.1 專案
- 台灣版 Padavan 路由器韌體，正式維護 **Newifi D3（NEWIFI3，MT7621，512 MB，32 MB SPI NOR）** 與 **小米 CR6608（CR660x，MT7621，256 MB，128 MB SPI NAND，MT7915 Wi-Fi 6）**
- 基底：TurBoTse/padavan（核心 4.4.198，聯發科閉源 Wi-Fi 驅動）
- 原則：**穩定優先**；上游檔案盡量不改，台灣版差異集中在 `trunk/configs/tw/`、新增的檔案與註明 `padavan-tw` 的修改
- **放棄的方向**（維護者已決定，不要再提）：OpenWrt 版、把整個專案換到 3.4 核心、軟體 SQM 當主線、雙 hw_nat 驅動
- **暫緩**：小米 MI-MINI（MT7620，只有 3.4 核心支援；若做，另外用 3.4 的 padavan-ng 做精簡版，見第 5.9 節）

### 1.2 Git
```bash
git clone https://github.com/candy999/padavan-tw.git
cd padavan-tw
git checkout claude/zealous-feynman-bhwrbf
git pull
```
- 開發分支：`claude/zealous-feynman-bhwrbf`。`main` 只合併到 PR #1（很早期）；要合併時由使用者決定、開 PR
- 推送前一律 `git pull --rebase`
- Commit 訊息：繁體中文，第一行「範圍: 摘要」（例如 `kuroshio: …`、`www: …`、`D3: …`、`docs: …`），內文寫原因與驗證方式

### 1.3 參考專案（需要時再拉）
| 專案 | 用途 |
|---|---|
| `TurBoTse/padavan` | 上游，同步與比對（`git remote add upstream https://github.com/TurBoTse/padavan.git`） |
| `candy999/kuroshio-dns` | 黑潮 DNS（Rust）。`PORTING.md`、`docs/integration.md` 是整合的穩定約定；`openwrt/` 有 LuCI 與 rpcd 參考 |
| `hanwckf/padavan-4.4`、`MeIsReallyBa/padavan-4.4`、`vb1980/padavan-4.4` | 其他 4.4 分支，查修補時用 |
| `hanwckf/rt-n56u`、`vb1980/Padavan-KVR`、`candy999/Padavan`、`candy999/padavan-4.4` | 3.4 與使用者舊的分支（比對用） |

### 1.4 編譯
- **建議用 GitHub Actions**（`.github/workflows/build.yml`）：推送到開發分支就會編 NEWIFI3、CR660x 的標準版（880 MHz）與 `-oc1000` 版，約 8～12 分鐘；Artifact 名稱 `padavan-tw-<機型>[-oc1000]-<台北日期>-<commit 7 碼>`，保留 14 天
  - **同一分支新的推送會取消正在跑的編譯**（concurrency）
  - 只改 `*.md`、`docs/**` 不會觸發編譯
  - 手動執行（workflow_dispatch）可以選任何上游機型
  - 推 `v*` 標籤才會建立 Release（附 SHA256 與黑潮 DNS 原始碼包，GPL）
- 本機編譯（Linux／WSL）：`make NEWIFI3`（會下載 TurBoTse Release 的預編工具鏈 `mipsel-linux-musl`；超頻版 `make NEWIFI3 OC=1000`）。只有要反覆編核心時才值得在本機編
- 台灣版設定的套用方式：頂層 `Makefile` 把 `configs/templates/<機型>.config` 複製成 `.config`，再接上 `configs/tw/common.config` 與 `configs/tw/<機型>.config`（後面覆蓋前面）；核心設定由 `trunk/configure` 套用 `configs/tw/kernel-<機型>.config`（機型設定裡沒有的選項會補上）

### 1.5 實機
- 測試機：**Newifi D3**，後台 `http://192.168.2.1/`，SSH 開啟（帳號 admin），Breed 可以救磚（拔電、按住 Reset 插電、`http://192.168.1.1`）
- 刷機：這幾版重開機正常，可以用後台「韌體更新」，或 SSH 走同一條路（`/tmp/linux.trx`＋rc 的 `flash_firmware`，見 HANDOFF-UI 第 13.10 節）。刷之前核對 SHA256
- **小米 CR6608 是使用者正在用的主路由器，不能動**；要等 D3 能接手後才刷（第 5.4 節）
- 使用者的網路：上游路由器發私有 IPv4（10.0.0.x），有部分 IPv6
- 改到網路、Wi-Fi、管理密碼、LAN IP、刷機之前要先問使用者；輸入密碼的動作由使用者自己做

### 1.6 工具（都在專案裡）
| 工具 | 用途 |
|---|---|
| `tools/ui-preview/serve.py` | 不用路由器預覽後台（模擬 httpd、`?scenario=`） |
| `tools/ui-preview/shoot.js`、`layout-check.js` | 截圖、多尺寸跑版檢查（改版面後要跑） |
| `tools/ui-preview/push.py` | 把改過的 www 檔案推到實機的記憶體副本（不用重刷） |
| 路由器上的 `tw-qos-check` | 硬體 QoS 驗證（`tw-qos-check guide` 有步驟） |
| 路由器上的 `switch vlan dump`、`switch reg r <位址>`、`cat /proc/mt7621/esw_cnt` | 交換器 VLAN 表、暫存器、各埠計數（D3 有線問題就是靠這些找到的） |
| 路由器上的 `/usr/bin/kuroshio.sh status`、`… api <路徑>`、`… flush` | 黑潮 DNS 狀態、管理 API、立即存學習資料 |

---

## 2. 技術重點（之前踩過的坑，改相關程式前一定要知道）

| 主題 | 重點 | 位置 |
|---|---|---|
| **D3 有線網路** | D3 是**單一 GMAC＋VLAN**（`USE_SINGLE_MAC`，eth2.1＝LAN、eth2.2＝WAN）。上游 `mtk_esw/esw_common.h` 把雙 GMAC 寫死，D3 因此全不通；修法是核心選項 `CONFIG_RAETH_ESW_SINGLE_GMAC`（只有 D3 開）。**不要改回雙 GMAC**：D3 的 GMAC2（RGMII2）在 4.4 不通（vb1980：要拆 C48 電容） | `linux-4.4.x/drivers/net/ethernet/raeth/mtk_esw/esw_common.h`、`raeth/Kconfig`、`configs/tw/kernel-NEWIFI3.config` |
| **D3 重開機** | 上游開了 `CONFIG_32M_REBOOT_FIXUP`（`mtd_write -r unlock mtd1`），4.4 的 mtd_write 找不到叫 mtd1 的分割區 → 不重開、SSH reboot 卡死。D3 已關掉，走一般流程（核心的 spi-nor 關機時會把 W25Q256 切回 3-byte） | `configs/tw/NEWIFI3.config` |
| **D3 分割區** | 真正存設定的 Storage 是 dtsi 的 `0x1f80000`（512 KB，/proc/mtd 第一個叫 Storage 的）。`0x1800000～0x1f80000`（7.5 MB）是黑潮 DNS 專用的 JFFS2 資料區 `Kuroshio`。MTD 表裡重複的 ALL、第二個 Bootloader、整顆晶片是上游 dtsi＋dts 重複定義，無害 | `linux-4.4.x/arch/mips/boot/dts/ralink/newifi3.dts` |
| **黑潮資料區** | `kuroshio.sh` 先讀裝置樹確認不重疊（`/proc/device-tree/` **一定要加斜線**，busybox find 不跟進捷徑），掛不上 JFFS2 就清除重建；CR6608 用 RWFS（UBIFS） | `trunk/user/kuroshio/kuroshio.sh` |
| **設定存進 Flash** | `/etc/storage` 是記憶體，只有正常重開機或 `mtd_storage.sh save` 才寫進 Flash。黑潮的設定已用 `kuroshio.sh storage-save` 處理（黑潮自己寫的由 `KUROSHIO_ON_CONFIG_WRITE` 觸發、httpd 寫的由 httpd 呼叫）；其他檔案欄位（腳本、dnsmasq 設定等）`d92c48c` 起套用完也會存 | `trunk/user/scripts/files/sbin/mtd_storage.sh`、`httpd/src/web_ex.c` |
| **Wi-Fi 掃描** | MT7603 開了 11k 後掃描表多一欄，表頭與資料欄寬不同；httpd 已改成依表頭逐行解析。改驅動選項後要確認掃描頁 | `httpd/src/ralink.c`（`ssurv_*`） |
| **QDMA／硬體 QoS** | **已捨棄（6959e79）**：實測 CPU 約 3 倍、沒有改善，介面與 `hw_qos_*` 都已移除，hw_nat 只帶 `wan_vid` 載入。不要再加回來 | `rc/src/net.c` |
| **QDMA／PDMA** | 核心選項 `CONFIG_RAETH_PDMA_TX` 可以改回 PDMA（預設關）。D3 的有線問題跟 QDMA 無關（實測過），維持 QDMA | `raeth/raeth_config.h` |
| **黑潮 DNS 整合** | 官方 Linux 通用包＋UCI 文字模式；dnsmasq 照常佔 53 埠、轉給 127.0.0.1:5335；保護程式用 `kuroshio health`（讀只有埠號的 `/tmp/kuroshio/probe.uci`，使用者存壞設定也不會誤判）；改設定走 rc `restart_kuroshio` → `kuroshio.sh reload`（SIGHUP）；後台經 `/kuroshio_api.cgi` 轉接管理 API（白名單同 OpenWrt 的 rpcd.sh，動作只收 POST＋login_safe）；nvram 覆蓋 UCI 的對照表在 HANDOFF-UI 第 13.4 節 | `trunk/user/kuroshio/`、`httpd/src/web_ex.c`（`kuroshio_api_*`） |
| **硬體 NAT 殘留標記** | raeth 送出時看 `skb->head`／尾端的 FOE 標記決定要不要送進 PPE；Wi-Fi 卸載的 ping-pong 回來時把 **VLAN ID 當介面編號**（`dst_port[]` 依註冊順序：0＝eth2、1＝ra0、2＝ra1…，D3 的 LAN＝VLAN 1）。新配置的 skb 原本不清這塊 → 本機送出的封包會被轉錯，BPDU 因此讓 2.4G 被 STP 封鎖。d333736 在 `__alloc_skb`／`__netdev_alloc_skb`／`__napi_alloc_skb` 清掉，ping-pong 遇到非 IP 框丟掉並記錄 `HNAT: drop non-IP frame`。改 skb 配置或 hw_nat 前先讀 WIFI-STABILITY「STP 誤判的根因」 | `linux-4.4.x/net/core/skbuff.c`、`net/nat/hw_nat/ra_nat.c` |
| **自動 NAT66** | 二級路由 WAN 有全球 IPv6、但上一層沒有可分配的前綴（DHCPv6-PD 要不到，例如 HiNet 只給主路由 /64）時，watchdog 等 60 秒後在 br0 加 ULA `fdXX:XXXX:XXXX::1/64`（由 MAC 算）＋ `ip6tables -t nat MASQUERADE`；dnsmasq `constructor:br0` 自動廣播。開關 `ip6_nat66_auto`（預設 1，網際網路頁可關），狀態在暫存 nvram `ip6_nat66_state`；防火牆重啟時 `ip6t_nat_rules()` 照狀態寫回規則。上游原本就有 `fc00:101:101::/64 FULLCONENAT`（手動設 LAN IPv6 用），兩者不衝突 | `rc/src/tw_nat66.c`、`firewall_ex.c` |
| **新增 nvram** | 要在 `httpd/src/variables.c` 登記（群組＋變更後要重啟的服務）、`shared/src/defaults.c` 給預設值；表單用 `sid_list` 指定群組 | HANDOFF-UI 第 3.3 節 |

---

## 3. 已完成（截至 2026-11-18，`0bb30a1`）

- 台灣化：繁中介面、台灣 Wi-Fi 頻道與功率標示、每日自動選頻、2.4G／5G 同名、802.11k/v 預設、PPPoE MTU 1480＋自動偵測、WireGuard 伺服器、漫遊中控觀察模式 `tw-roamd`
- 新後台（依使用者目的重做）：總覽、裝置、Wi-Fi、網際網路、遠端與分享、頻寬管理、診斷、系統、進階設定；黑潮 DNS 子頁組（LuCI 移植，含自訂規則與評測名單編輯）
- D3：有線網路、重開機、黑潮資料區、Wi-Fi 掃描都已修好並在實機驗證
- 黑潮 DNS 3.3.2（`0bb30a1`）：整合、儲存、設定存進 Flash、升級遷移（uci-migrate）、改設定用 SIGHUP 重新載入、後台匯入學習資料、跨站請求檢查；busybox dhcp6c 洗日誌修正
- 頻寬管理頁已接上後端 `hw_qos_*`，含「Wi-Fi 裝置也套用」開關（後端尚未限速，頁面有誠實標示）

詳細紀錄：HANDOFF-UI 第 11～13 節、`docs/VERIFY-*.md`。

**ROADMAP 已在 2026-11-18 跟實際進度同步**（C 章、E8、G、H1、I5、J6，並補上 A9～A12 的 D3 修正）。

---

## 4. 進行中、待使用者決定的事

| 事項 | 狀態 |
|---|---|
| D3 長時間穩定性測試（第 5.1 節） | 雲端提議、使用者還沒同意；使用者想確認「4.4 長期是否跟 3.4 一樣穩」 |
| D3 交換器 bug 回報上游 TurBoTse | 2026-11-18 使用者同意後已發 [TurBoTse/padavan#32](https://github.com/TurBoTse/padavan/issues/32)（繁體中文；連同無法重開機） |
| 第一個正式 Release | D3 長時間測試通過後，由使用者決定合併 main 與打標籤 |
| MI-MINI | 暫緩（第 5.9 節） |

---

## 5. 待辦清單（依建議優先順序）

### 5.1 【建議先做】D3 長時間穩定性測試
目的：用數據回答「4.4 在 D3 上長期是否穩定」（別人的分支推薦 3.4，但他們的 4.4 在 D3 上本來就有交換器與重開機的問題，見 `docs/KVR-3.4-REVIEW.md` 與 HANDOFF-UI 第 12 節）。
- 寫一個記錄腳本（例如 `trunk/user/scripts/files/usr/bin/tw-soak`，或先放在 `/etc/storage` 手動執行）：每小時記錄運作時間、可用記憶體（`/proc/meminfo`）、各程式 RSS（kuroshio、httpd、dnsmasq）、`nf_conntrack_count`、WAN 連線狀態與重連次數、Wi-Fi 裝置數、黑潮保護程式切換次數（syslog）、`dmesg` 的錯誤；寫到 `/tmp`，每天複製一份到 USB 或用 `scp` 拉回本機
- 標準：連續 7 天不重開、不當機；可用記憶體沒有持續下降；有線與 Wi-Fi 沒有異常斷線；黑潮很少或沒有切回業者 DNS
- D3 要當成主路由器實際使用（使用者決定何時換上）
- 已知 4.4 風險，順便確認：512 MB＋USB 硬碟用 Samba 讀檔可能當機（hanwckf/padavan-4.4 issue #34，關 HIGHMEM 可避開）——使用者有用 USB 硬碟才需要測
- 結果寫成 `docs/SOAK-<日期>.md`

### 5.2 硬體 QoS（ROADMAP E 章，主線）
1. **E3 實機驗證**（D3，`tw-qos-check guide`）：兩個方向、有線與 Wi-Fi 是否都經過 QDMA；開排程的效能損失；滿載時延遲；**Wi-Fi 下載是否真的被限速**（`hnat_qos_wlan=1`，決定這個功能值不值得做）；連續幾小時的穩定性
2. E4 固定模式：依方案頻寬 ×（1＋上限%）限速；D3 單一 GMAC 用 iptables 標記分方向（下載→佇列 1／SCH1、上傳→佇列 8／SCH2），CR6608 雙 GMAC 天生分開
3. E5 `hw_qos_method`（A：排程常開只調速率，預設；B：需要時才開並清表）
4. E6 自動模式控制器（ROADMAP「自動模式流程」：延遲 +30 ms 且流量 > 方案 70% → 確認 → 從 +15% 逐步降到 −15% → 判斷 → 結束；每小時最多 4 次）
5. E7 學習壅塞時段、E9 遊戲／語音優先、E11 MOD 不經過排程
6. 頻寬管理頁把「限速功能尚未提供」換成實際狀態（資料介面 `qos`，HANDOFF-UI 第 6 節）
- 已確認的決定：上下對稱 ±15%、加回上限就結束、觸發條件「延遲偏高＋流量 > 70%」、A／B 做成選項、Wi-Fi 跟著頻寬管理一起開（進階區可以關）

### 5.3 監測取樣器 `twstats`＋資料 API（ROADMAP D 章、HANDOFF-UI 第 6、8 節）
- 總覽、診斷、裝置詳情、頻寬管理自動模式都靠它。目前頁面用「後備資料」與誠實的「功能未提供」
- D1 延遲（多目標中位數、閒置基準）、D2 WAN 流量（交換器埠計數，硬體 NAT 開著也準）、D3 連線追蹤表、D4 每台 Wi-Fi 裝置訊號／速率 24 小時、D5 事件時間軸
- 資料只存記憶體（環形緩衝），不寫 Flash
- 2026-11-18 完成 D1、D2（`d230446`，HANDOFF-UI 第 13.14 節）：rc applet `tw-stats`（watchdog 依 `tw_stats_enable` 啟停，預設開）寫 `/tmp/twstats/latency.json`；`/tw_api.asp?q=<名稱>`，還沒實作的名稱回 `{"_fallback":true}`。下一步 D3～D5 加在 `tw-stats` 裡、各寫一個 `/tmp/twstats/<名稱>.json`，`ej_tw_api` 加白名單

### 5.4 CR6608（H2）
- 使用者的主路由器，**D3 接手後才刷**
- 要確認：有線（雙 GMAC＋QDMA，跟使用者舊版 PDMA 不同）、Wi-Fi 6、黑潮 RWFS 模式（UBIFS）與 256 MB 記憶體、超頻版
- CR6608 的設定與使用者舊倉庫的比對已做過（雲端紀錄）：裝置樹、機型、核心設定都相同

### 5.5 Wi-Fi 與漫遊（ROADMAP I 章）
- H4：三台 D3 多 AP 漫遊實測（同一 SSID、11k）；`tw-roamd` 觀察模式的資料轉 JSON 給 Wi-Fi 頁
- I5a CR6608 用 11k Beacon Report＋11v BTM 引導（不踢除）；I5b CR6608 5G 的 `WNMEnable` 要執行中補開
- I6 固定頻道也背景掃描；I7 D3 的 802.11r（ralinkiappd）確認 2.4G；I8 CR6608 頻段導引評估
- 11v 在 D3 列為長遠計畫

### 5.6 設定存進 Flash 的其餘部分
- ~~Padavan 其他檔案欄位存進 Flash~~：`d92c48c` 完成（套用完存一次，內容沒變不寫）
- 黑潮 `KUROSHIO_ON_CONFIG_WRITE`：3.3.2 已修好（含社群金鑰），`kuroshio.sh` 的 `api_action` 不再每個動作存一次

### 5.7 黑潮 DNS 剩下的
- ~~學習資料匯入、UCI 改用 SIGHUP 重新載入~~：2026-11-18 在 `0bb30a1` 完成（黑潮 3.3.2，HANDOFF-UI 第 13.12 節）
- ~~憑證申請進度 API~~：`8ca57dc` 完成（`op=acme-log`，以前前端借 SystemCmd 讀）
- 黑潮 3.3.3：作者已依 D3 實測校正、還沒發布；發布後升級 Makefile（`kuroshio.sh reload` 已依版本自動改成等 2 秒），並驗證 `memory.jobs.lastBenchmark`、副本補記規則數、`memory-plan`（HANDOFF-UI 13.13）
- 黑潮新版本：照 `trunk/user/kuroshio/Makefile` 開頭的說明升級；預設設定有變時把舊預設檔的 sha256 加進 `kuroshio.sh` 的 `UCI_OLD_DEFAULTS`（改過的設定檔由 `kuroshio uci-migrate` 處理）
- ~~查看類的 GET 擋跨站與外網登入~~：`5771f9a` 完成（`X-TW-Request` 標頭、登入來源每次請求判斷）
- J7 Cloudflare 以外的 DDNS（在黑潮專案做）

### 5.8 維護與發布（ROADMAP A、B 章）
- A6 miniupnpd 2.0 → 2.3.x（CVE-2019-12107～12111、CallStranger）
- A8 定期同步 TurBoTse（上游設定檔不改；衝突多在 `www`、`rc`）
- B4 預編工具鏈改放本專案 Release（目前抓 TurBoTse 的 `toolchain` 標籤，上游刪檔就編不了）
- ~~B5 Actions 升級 Node 24~~：`8ca57dc` 完成
- B6 第一個正式 Release：開 PR 合併到 main → 打 `v*` 標籤 → 更新 README
- 低優先：D3 裝置樹整理重複的 MTD 項目（改了 mtd 編號會影響 `mtd_storage.sh` 以外用編號的地方，先全專案搜尋）

### 5.9 MI-MINI（暫緩，使用者要求時再做）
- 只能用 3.4（4.4 沒有 MT7620 的有線、2.4G 驅動與硬體 NAT；移植估計一個月以上，不建議）
- 建議：用還在維護的 3.4 **padavan-ng**（GitLab hadzhioglu/padavan-ng，支援 MI-MINI、有核心版 WireGuard）做精簡版，只搬繁中介面、台灣 Wi-Fi 預設、WireGuard 伺服器頁
- 黑潮 DNS：黑潮專案提議做「核心版」（約 2 MB、記憶體 10～15 MB），padavan-tw 可以給 2 MB 韌體空間＋從 Flash 切 1 MB JFFS2 資料區（MI-MINI 韌體分割區約 15.2 MB，舊版只用 11.9 MB）；記憶體估計要用 D3 實測重新評估（3.2.0 閒置 25～32 MB；3.3.0 評測時高點 45.5 MB）
- 3.4 的 KVR：見 `docs/KVR-3.4-REVIEW.md` 第 5 節

### 5.10 效能與超頻（ROADMAP F 章）
- F2 硬體 NAT 關閉時 880／1000 MHz 的軟體轉送上限；F3 RPS／中斷分工；F4 OC 版 CPU 滿載 1 小時的穩定性與溫度（使用者目前 D3 刷的是 oc1000 版）

---

## 6. 外部依賴與聯絡

| 對象 | 怎麼互動 |
|---|---|
| 黑潮 DNS 專案 | 使用者轉達。回報格式：環境（機型、韌體 commit、黑潮版本）、現象、指令輸出、推測、建議。之前回報過：MIPS 記憶體、節點池重跑、日誌洗版、`KUROSHIO_ON_CONFIG_WRITE` |
| TurBoTse 上游 | 只讀；要回報或送 PR 先問使用者 |
| GitHub | 推送、Actions、PR；**不要自己開 PR 或發 issue／留言**，除非使用者要求 |

---

## 7. 工作方式

- 每件工作：讀相關文件 → 小步修改 → 預覽或模擬測試 → 推送編譯 → 寫驗證單（`docs/VERIFY-<commit>.md`，照之前的格式：修了什麼、韌體、步驟與預期、結果表）→ 實機驗證 → 更新 ROADMAP 與相關文件
- 使用者喜歡：用問題卡確認決定（附建議選項）、需要轉給別人（黑潮專案）的內容放在可以一鍵複製的區塊、先討論再動工的事要先討論
- 改後端時特別注意：D3 只有一台，刷壞了要用 Breed 救；改 Flash、分割區、開機流程、重開機相關程式之前先跟使用者確認，並準備好救援步驟
