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
| `docs/LOCAL-NEXT.md` | 2026-11-13 那一批工作（驗證、頻寬管理接後端、黑潮移植）——**已全部完成或捨棄，只當存檔** | 不用讀 |
| `docs/ROAM-COOP.md` | AP 互助漫遊：交換協定、決策規則、回 5G、D3／CR6608 驅動狀況、OpenWrt 對照 | 動漫遊、11k／v、tw-roamd 前 |
| `docs/COMPAT.md` | 社群機型相容度預測（`tools/compat/predict.py` 產生）與移植指南 | 有人問其他機型、改了跟硬體有關的程式後 |
| `docs/WIFI-STABILITY.md` | Wi-Fi 穩定性調查、STP 根因、5G／2.4G 參數測試、夜間長測 | 動 Wi-Fi、網橋、hw_nat 前 |
| `docs/RELEASE-NOTES-v2026.11.20.md` | 第一個正式版的發布說明（v2026.11.22 的說明只在 GitHub Release：`gh release view v2026.11.22`） | 發布時 |
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
- 測試機：**Newifi D3**，後台目前在 `http://192.168.1.1/`（預設是 192.168.2.1，這台被改過；跟 ONU 的 192.168.1.x 同網段，開機日誌會出現 MAN 位址衝突的錯誤，PPPoE 不受影響），SSH 開啟（帳號 admin），Breed 可以救磚（拔電、按住 Reset 插電、`http://192.168.1.1`）
- 刷機：這幾版重開機正常，可以用後台「韌體更新」，或 SSH 走同一條路（`/tmp/linux.trx`＋rc 的 `flash_firmware`，見 HANDOFF-UI 第 13.10 節）。刷之前核對 SHA256。2026-11-20 刷 aa56cfc 時寫入成功但沒自己重開起來（偶發，拔電重插後正常），刷完 5 分鐘沒回來就請使用者重插
- **小米 CR6608 是使用者正在用的主路由器，不能動**；要等 D3 能接手後才刷（第 5.4 節）
- 使用者的網路：上游路由器發私有 IPv4（10.0.0.x），有部分 IPv6
- 改到網路、Wi-Fi、管理密碼、LAN IP、刷機之前要先問使用者；輸入密碼的動作由使用者自己做

### 1.6 工具（都在專案裡）
| 工具 | 用途 |
|---|---|
| `tools/ui-preview/serve.py` | 不用路由器預覽後台（模擬 httpd、`?scenario=`） |
| `tools/ui-preview/shoot.js`、`layout-check.js` | 截圖、多尺寸跑版檢查（改版面後要跑） |
| `tools/ui-preview/push.py` | 把改過的 www 檔案推到實機的記憶體副本（不用重刷） |
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
| **Wi-Fi BPDU 擋法** | 第二層保險（根因已在 d333736 修掉），nvram `tw_wifi_bpdu` 0／1／2（預設 2＝收送都擋）。規則在 `tw_wifi_bpdu_rules()`（`restart_guest_lan_isolation` 清空 ebtables 後呼叫）；watchdog `tw_wifi_bpdu_check()` 看 ebtables 計數與 hw_nat 保險計數，增加就跑 `/sbin/tw-bpdu-snap` 寫 `/etc/storage/tw-diag/bpdu-events.log`。韌體的 ebtables 原本沒有 log 擴充，`extensions/ebt_log.c` 是補回的最小版（靜態編譯會改名每行第一個「底線 init」，檔案裡別再出現） | `rc/src/tw_wifibpdu.c`、`scripts/files/sbin/tw-bpdu-snap`、`ebtables-2.0.10-4/extensions/ebt_log.c` |
| **自動 NAT66** | 二級路由 WAN 有全球 IPv6、但上一層沒有可分配的前綴（DHCPv6-PD 要不到，例如 HiNet 只給主路由 /64）時，watchdog 等 60 秒後在 br0 加 ULA `fdXX:XXXX:XXXX::1/64`（由 MAC 算）＋ `ip6tables -t nat MASQUERADE`；dnsmasq `constructor:br0` 自動廣播。開關 `ip6_nat66_auto`（預設 1，網際網路頁可關），狀態在暫存 nvram `ip6_nat66_state`；防火牆重啟時 `ip6t_nat_rules()` 照狀態寫回規則。上游原本就有 `fc00:101:101::/64 FULLCONENAT`（手動設 LAN IPv6 用），兩者不衝突 | `rc/src/tw_nat66.c`、`firewall_ex.c` |
| **STP 計時／急速連線** | STP 計時 8 秒（hello 2、max_age 6、forward_delay 4，rc `tw_stp_timers()`）；急速連線 nvram `tw_wifi_fast`（預設 1）：Wi-Fi AP 介面（`ra` 開頭）一啟用就轉送（核心 `br_stp.c` 的 `br_tw_fast_port()`），只在 BPDU 擋法開著時有效；收到外部裝置 BPDU 的介面個別退回標準 STP（`brport/tw_slow`，清單 `/tmp/tw-bpdu-conflict`，只記在記憶體）。診斷頁「Wi-Fi 迴圈保護」卡片有兩個開關（d29b6bf） | `rc/src/tw_wifibpdu.c`、`linux-4.4.x/net/bridge/br_stp.c` |
| **Wi-Fi 出廠預設** | 5G：`wl_TxBurst=1`、`wl_HT_OpMode=0`（混合，關閉 Greenfield，1a9cbaf）、80 MHz、自動頻道；2.4G：`rt_HT_BW=0`（20 MHz）、`rt_TxBurst=1`、`rt_HT_OpMode=0`（0bf61c2 起；以前是 1）。D3 的 2.4G 預設是 g/n 混合（`rt_gmode=5`；以前文件寫 b/g/n 是錯的），這個模式下驅動本來就寫 HT_OpMode 0（iNIC／RT2860 dat 都是 `0;0`），Greenfield 只在純 N 模式生效。無線進階頁的「(*)」建議值跟出廠值一致；D3 不顯示沒作用的 5G 頻段導引、MU-MIMO（只有 7615／7915 有）與 2.4G 空中時間公平（rc 沒讀 `rt_airtimefairness`）。5G 40／80 MHz 時自動選頻不選 165（d29b6bf）。依據與還沒實測的參數見 WIFI-STABILITY | `shared/src/defaults.c`、`rc/src/ralink.c`、`httpd/src/web_ex.c` |
| **升級時換掉舊預設** | `nvram_restore_defaults()` 只補不存在的鍵，舊機器的舊預設會一直留著；`tw_defaults_ver`（defaults.c 給 1，新機器不跑）升級前不存在、又不是整份回復出廠時，值剛好等於舊預設的才換成新預設，每項寫一行系統記錄（只做一次）。目前只遷移 `wl_HT_OpMode`、`rt_HT_OpMode` 1→0；802.11r 照專案決定升級不改。分不出「刻意設成舊值」和「舊預設」，只放證據強的項目，Release 說明要寫 | `rc/src/tw_migrate.c`、`rc/src/rc.c` |
| **每日自動選頻** | `tw_acs_daily`、`tw_acs_hour`（預設 4 點起、Wi-Fi 閒置才換）；實測 04:01 執行，頻道沒變也會重啟 2.4G 約 5 秒。5G 選頻後避開強的緊鄰頻道 `tw_acs_adj`（0de393d 起出廠 1；ROADMAP I13） | `tw-wifi-acs` |
| **後台讀黑潮統計** | 總覽、網際網路、遠端頁經 `/kuroshio_api.cgi` 讀 `/api/status` 精簡版（`lite=1`，`tw_ui.js` 的 `kuroStatus()`，25 秒內重用）：今天查詢、擋下、CDN 置換、回應中位數、上游狀態、憑證到期日；診斷頁事件時間軸＝`latency.json` 的 `wan_watch.events`＋tw-roamd 的漫遊／換頻段紀錄（7 天內），不是另外的取樣器（076d405） | `www/.../tw_ui.js` |
| **中華電信 MOD** | `tw_mod.c`（`tw_mod_auto` 預設 1）：看門狗每 10 秒用 BPF 收區網 DHCP 封包，Vendor Class `CHT-` 開頭就是機上盒，比對各 LAN 孔收到的廣播計數（`phy_status_port_rx_bcast()`），連續 3 次只剩同一孔就設成 MOD 專用孔（`wan_stb_x`、`wan_stb_iso=1`）並寫系統記錄；已有 MOD 孔或 AP 模式時不監聽、不會自動取消。有 MOD 孔時 WAN 設成交換器 IGMP 的固定上游孔（1f7ff9e，修正直播黑畫面）。MOD 走交換器橋接，**不經過 igmpproxy**。限制：機上盒沒重新要位址就偵測不到（要重開機上盒）。文件與紀錄不要寫機上盒的 MAC、序號、位址 | `rc/src/tw_mod.c`、`rc/src/switch_mtk_esw.c`、`www/.../tw_p_internet.js` |
| **igmpproxy 0.3** | 兩個修補：`patches/001-…`（上游 PR #98，`internAgeRoute()` use-after-free；還沒實際觸發驗證）、`patches/002-…`（核心要求啟用路由時來源在下游介面就略過；已實測）；當掉時 watchdog 會重啟。IGMP 代理預設開 | `trunk/user/igmpproxy/patches/` |
| **連外中斷自動重新連線** | tw-stats 每 10 秒 ping HiNet DNS、TWNIC、Cloudflare（D1 同一份）；三個都不通 `tw_wan_watch_sec` 秒（預設 30）＋TCP（1.1.1.1:443、168.95.1.1:53、8.8.8.8:53）也不通才走 rc `auto_wan_reconnect`；沒有 IPv4 至少 90 秒；退避 2／5／10／30 分鐘、恢復 10 分鐘歸零；ping 不通但 TCP 通＝只是 ping 被擋，60 秒後再確認、ping 恢復就清掉。狀態在 latency.json 的 `wan_watch`，診斷頁卡片。測試法：`iptables -I OUTPUT -o ppp0 -j DROP`（重撥時防火牆重建會清掉；要測退避就迴圈加回去） | `rc/src/tw_stats.c`、`tw_p_diag.js` |
| **暫停上網定時恢復** | MAC 過濾封鎖清單（MFList）的時段是每週重複的，不能做一次性暫停；另記 `tw_pause_until`（「MAC=到期 Unix 秒」），watchdog 每 30 秒到期就從清單拿掉、`nvram_commit`、重新載入防火牆。**注意 commit 會把其他沒存的 nvram 一起存進去**（例如測試時暫時關掉的 kuroshio_enable） | `rc/src/tw_pause.c`、`tw_p_devices.js` |
| **Wi-Fi 裝置明細** | httpd `tw_wl_detail`（tw_status.asp 的 `tw_wl2`）：頻段、訊號、協商速率（getRate，跟 Wi-Fi 狀態頁同一套）、已連線秒數、IoT；DBDC 依 ApIdx 分頻段 | `httpd/src/ralink.c` |
| **不刷機測新程式** | 從 CI 的 .trx 拆 squashfs（PySquashfsImage；Git Bash 要 `MSYS_NO_PATHCONV=1`，不然 /sbin/rc 會被改成 Windows 路徑）→ `/tmp/twtest/rc`＋`ln -s rc tw-stats` 等，殺掉原本的再從 /tmp 啟動（watchdog 看程式名稱，不會再開一個）；重開機就回原版 | — |
| **新增 nvram** | 要在 `httpd/src/variables.c` 登記（群組＋變更後要重啟的服務）、`shared/src/defaults.c` 給預設值；表單用 `sid_list` 指定群組 | HANDOFF-UI 第 3.3 節 |

---

## 3. 已完成（截至 2026-11-23，`3b0d4c7`）

- 正式版：**v2026.11.20**（第一版，PR #2 合併 main）、**v2026.11.22**（黑潮 DNS 3.4.4；標籤打在開發分支的 d5434a2，main 沒有再合併）
- 2026-11-21～23（v2026.11.20 之後）：
  - AP 互助漫遊 D3＋手機實機：MT7603 用 11r 的裝置每 10 分鐘被踢（9443404）、MT7612 手機不回 Beacon Report（4cfd01a）都已修，細節見 ROAM-COOP 12.1
  - 連不出去時自動重新連線 WAN（4da9167、5af3c2c、3bca635）、暫停上網定時恢復（71ab6e7）、裝置頁 Wi-Fi 明細（47c6a67），實測見 VERIFY-d179165
  - 黑潮 DNS 3.4.4（d5434a2）：串接卡片照 LuCI 重做、`chain_pin`、社群 `use_hints`／`use_upstreams`、`/api/chain` 加進白名單、補 3.3.6～3.3.7 舊預設檔 sha256；D3 與主路由器都 3.4.4 時的串接驗證見 5.7
  - 後台（076d405）：總覽／網際網路／遠端接上黑潮統計與憑證到期日、健康路徑加延遲與掉包、診斷頁事件時間軸、「之後的版本才有」字樣都改成實際原因、黑潮狀態頁版面整理
  - Wi-Fi 預設（0bf61c2）：`rt_HT_OpMode` 出廠 0、頁面「(*)」跟出廠值一致、升級時換掉舊預設（`tw_migrate.c`）、D3 不顯示沒作用的選項
  - 後台（41a448b）：黑潮狀態頁卡片之間留 16px；httpd 讓瀏覽器快取 JS／CSS 30 天，`www/Makefile` 安裝時把頁面引用的本機 .js／.css 加上 `?v=<編譯時間>`（`tw_kuro.js` 動態載入的用 `__TW_ASSET_VER__` 佔位），韌體更新後不會配到舊檔
  - 每日自動選頻（49bc927～3b0d4c7）：先量測、需要才換、換之前先用 11v 移走裝置；MT7612 換頻道沒有 CSA、不要開 IEEE80211H、5G 的 BTM 沒效果（見 WIFI-STABILITY）
  - 開機 dnsmasq 偶爾綁不到連接埠：失敗 1 秒後重試（e8dce99，11-23 09:07 實際接住一次）；IoT 網路出廠名稱「家用名稱＋_IoT」（02fe618）

以下是 2026-11-20（`1f7ff9e`）以前的：

- 台灣化：繁中介面、台灣 Wi-Fi 頻道與功率標示、每日自動選頻、2.4G／5G 同名、802.11k/v 預設開、PPPoE MTU 1480＋自動偵測、WireGuard 伺服器、AP 互助漫遊 `tw-roamd`（觀察／建議模式）、IoT 網路
- 新後台（依使用者目的重做）：總覽、裝置、Wi-Fi、網際網路、遠端與分享、診斷、系統、進階設定；黑潮 DNS 子頁組（LuCI 移植，含自訂規則與評測名單編輯）。頻寬管理頁已隨硬體 QoS 捨棄移除（6959e79）
- D3：有線網路、重開機、黑潮資料區、Wi-Fi 掃描都已修好並在實機驗證；刷機寫完由 init 直接 `reboot()`
- 黑潮 DNS：3.3.2 的整合、儲存、升級遷移、SIGHUP 重新載入、匯入學習資料、跨站請求檢查；之後升到 3.3.3、3.3.6、3.3.7、3.4.0（ace2df1、fdc4446，串接模式預設開），目前 **3.4.4**
- miniupnpd 2.3.7、dropbear 2025.88、networkmap 中文裝置名稱（4750c57、f826b34）；監測取樣器 `tw-stats`（D1、D2）
- Wi-Fi 穩定性：硬體 NAT 殘留標記修正（d333736，已回報上游）、Wi-Fi BPDU 擋法（預設 2）、STP 8 秒＋急速連線、診斷頁開關、5G 40／80 MHz 不選 165、5G 預設混合模式（1a9cbaf）；過夜長測兩晚通過
- 網路：自動 NAT66、igmpproxy 兩個修補、中華電信 MOD 自動偵測＋網際網路頁 MOD／IPTV 卡片＋直播黑畫面修正（40a9205、1f7ff9e）
- 捨棄：硬體 QoS（QDMA）、mtdoops、監測 D3／D5／D6

詳細紀錄：HANDOFF-UI 第 11～13 節、`docs/WIFI-STABILITY.md`、`docs/VERIFY-*.md`。

**ROADMAP 已在 2026-11-23 跟實際進度同步。**

---

## 4. 進行中、待使用者決定的事

| 事項 | 狀態 |
|---|---|
| D3 長時間穩定性測試（第 5.1 節） | 過夜長測已做兩晚（2026-11-18～19 8 小時、2026-11-20 3 小時 24 分，都通過，見 WIFI-STABILITY）；**整晚 Wi-Fi 壓測（2026-11-22 晚到 11-23 08:00）結果待整理**；7 天長測由使用者決定 |
| 黑潮串接（3.4.0 作者要的驗證） | ①②③⑤ 已驗證，④只做了短重啟（2026-11-22～23，D3 與主路由器都 3.4.4，見 5.7）；④長時間停止、⑥補跑時段 `catchup_window` 還沒做。記憶體不回落已回報作者 |
| Wi-Fi 參數還沒有證據的項目 | 5G `wl_stbc`、`wl_HT_AMSDU`，2.4G `rt_HT_AMSDU`，LDPC、DTIM，2.4G 開 11v 的 IoT 過夜，11r 手機實際 FT 換 AP（WIFI-STABILITY「無線進階頁預設值整理」）；有實測結果才改預設 |
| D3 交換器 bug 回報上游 TurBoTse | 2026-11-18 使用者同意後已發 [TurBoTse/padavan#32](https://github.com/TurBoTse/padavan/issues/32)（繁體中文；連同無法重開機） |
| 硬體 NAT 殘留標記（STP 誤判根因）回報上游 | 2026-11-19 使用者同意後已發 [TurBoTse/padavan#33](https://github.com/TurBoTse/padavan/issues/33)、[hanwckf/padavan-4.4#73](https://github.com/hanwckf/padavan-4.4/issues/73)（繁體中文；3.4 的 `__alloc_skb` 有 `DO_FAST_CLEAR_FOE`，4.4 漏掉；雙 GMAC 機型的影響是推論、沒實測，請社群幫忙確認） |
| 正式 Release | ✅ v2026.11.20（2026-11-20，PR #2 合併 main）、✅ v2026.11.22（2026-11-22，黑潮 3.4.4，標籤在開發分支 d5434a2）。之後的 076d405、0bf61c2、41a448b 還沒發布；要不要再合併 main、何時發下一版由使用者決定。CR6608 尚未實機（發布說明有註明） |
| MI-MINI | 暫緩（第 5.9 節） |

---

## 5. 待辦清單（依建議優先順序）

> **2026-11-19 起最新的優先順序與工作量以 [ROADMAP.md「目前優先順序」](ROADMAP.md) 為準**（2026-11-23 同步過）；本節以下是較早的細節（硬體 QoS 已捨棄、監測只留漫遊相關），保留參考。

### 5.1 D3 長時間穩定性測試（過夜長測已做兩晚；2026-11-22～23 整晚 Wi-Fi 壓測結果待整理；7 天版本由使用者決定）
目的：用數據回答「4.4 在 D3 上長期是否穩定」（別人的分支推薦 3.4，但他們的 4.4 在 D3 上本來就有交換器與重開機的問題，見 `docs/KVR-3.4-REVIEW.md` 與 HANDOFF-UI 第 12 節）。
- 寫一個記錄腳本（例如 `trunk/user/scripts/files/usr/bin/tw-soak`，或先放在 `/etc/storage` 手動執行）：每小時記錄運作時間、可用記憶體（`/proc/meminfo`）、各程式 RSS（kuroshio、httpd、dnsmasq）、`nf_conntrack_count`、WAN 連線狀態與重連次數、Wi-Fi 裝置數、黑潮保護程式切換次數（syslog）、`dmesg` 的錯誤；寫到 `/tmp`，每天複製一份到 USB 或用 `scp` 拉回本機
- 標準：連續 7 天不重開、不當機；可用記憶體沒有持續下降；有線與 Wi-Fi 沒有異常斷線；黑潮很少或沒有切回業者 DNS
- D3 要當成主路由器實際使用（使用者決定何時換上）
- 已知 4.4 風險，順便確認：512 MB＋USB 硬碟用 Samba 讀檔可能當機（hanwckf/padavan-4.4 issue #34，關 HIGHMEM 可避開）——使用者有用 USB 硬碟才需要測
- 結果寫成 `docs/SOAK-<日期>.md`

### 5.2 ~~硬體 QoS（ROADMAP E 章）~~：2026-11-18 捨棄
- 實測 CPU 約 3 倍、Wi-Fi 延遲沒有改善；頻寬管理頁、`hw_qos_*`、`tw-qos-check` 都已移除（6959e79）。不要再加回來，原本的規劃留在 ROADMAP E 章當紀錄

### 5.3 監測取樣器 `twstats`＋資料 API（ROADMAP D 章、HANDOFF-UI 第 6、8 節）
- 總覽、診斷、裝置詳情靠它。2026-11-23（076d405）起已有資料的都接上，「之後的版本才有」字樣改成實際原因（延遲監測關閉、資料收集中、漫遊中控關閉等）；還沒做、需要新後端的：向外查對外位址比對 CGNAT、網站回應檢查；路由器端測速決定不提供（路由器自己測會受 CPU 限制，畫面已說明）
- 2026-11-18 完成 D1 延遲、D2 WAN 流量（`d230446`，HANDOFF-UI 第 13.14 節）：rc applet `tw-stats`（watchdog 依 `tw_stats_enable` 啟停，預設開）寫 `/tmp/twstats/latency.json`；`/tw_api.asp?q=<名稱>`，還沒實作的名稱回 `{"_fallback":true}`
- D3 連線追蹤表、D5 事件時間軸、D6 頻道忙碌率：**不做**（2026-11-19，只留跟漫遊有關的資料）；D4 每台 Wi-Fi 裝置訊號／速率併入 KVR R1。資料只存記憶體，不寫 Flash

### 5.4 CR6608（H2）
- 使用者的主路由器，**D3 接手後才刷**
- 要確認：有線（雙 GMAC＋QDMA，跟使用者舊版 PDMA 不同）、Wi-Fi 6、黑潮 RWFS 模式（UBIFS）與 256 MB 記憶體、超頻版
- CR6608 的設定與使用者舊倉庫的比對已做過（雲端紀錄）：裝置樹、機型、核心設定都相同

### 5.5 Wi-Fi 與漫遊（ROADMAP I 章）
- **AP 互助漫遊（2026-11-20 程式完成；2026-11-21～22 D3＋手機實機，見 ROAM-COOP 12.1）**：設計與驅動查證全在 `docs/ROAM-COOP.md`。兩個頻段問 Beacon Report 手機都同一秒回（5G 是 4cfd01a 修好的）、手機會回 BTM（目前回狀態 7 拒絕）；多台 AP（H4）、CR6608 還沒測。
  - 程式：`trunk/user/rc/src/tw_roamd.c`（TWR2 交換＋決定層）、`tw_roam_drv.c`／`tw_roam.h`（各晶片 ioctl 與事件）；`watchdog.c` 改模式時重新啟動 tw-roamd；Wi-Fi 頁「多台 AP 與漫遊」切換關閉／觀察／建議（`tw_roam_enable` 0／1／2，預設 1）。
  - 驅動：D3 2.4G／5G 都開 11k＋11v；MT7612 補 Beacon Report 事件 0x0950、修漏記憶體；MT7603 修 `WNMEnable=0` 無效。
  - 實機要看：`tw-roamd status` 的「驅動」那行（各頻段能不能問／收回報／建議）、每台裝置的 11k／11v、`/etc/storage/tw-diag/roam.log`；驗證步驟照 ROAM-COOP 第 11 節（D3＋Android 手機先做回 5G）。
- H4：三台 D3 多 AP 漫遊實測（同一 SSID、11k/v）
- 漫遊頁與裝置頁的資料（2026-11-20）：tw-roamd 寫 `/tmp/tw-roamd.json`（`q=roam`，每 5 秒）與 `/tmp/tw-roamd.devices`（`q=device&mac=`，每分鐘；24 小時訊號、斷線、漫遊）；實機要看 Wi-Fi 頁「多台 AP 與漫遊」與裝置詳情頁的圖
- J4 WireGuard 實機驗證：手機連上後確認 `/tw_api.asp?q=vpn` 與「遠端與分享」顯示連線中；`ip link del wg1` 後應出現 `running:false` 的紅燈；用含 `"`、`<` 的裝置名稱確認 JSON 跳脫
- I5b CR6608 5G 的 `WNMEnable` 要實機確認；I7 D3 的 802.11r（ralinkiappd）已改成兩個頻段都聽，待實機；I8 CR6608 頻段導引評估
- **802.11r 預設開**（2026-11-20）：`FtMdId1` 由 SSID 算、Wi-Fi 頁開關、BTM 的 Mobility Domain 位元跟著 r；AP 間金鑰交換的加密金鑰是驅動預設值（ROAM-COOP 第 10 節）。D3 信標兩頻段 MDID 相同（VERIFY-d179165）；手機實際用 FT 換 AP 還沒實測
- ~~11r 自適應~~：改成 **IoT 網路**（訪客那一格改成 `_IoT`，不宣告 k/v/r，舊裝置改連它；ROAM-COOP 第 13 節）。D3 信標確認 IoT 網路只有 PSK、沒有 k/v/r（VERIFY-d179165）；2.4G 開 11v 後舊 IoT 裝置的過夜回歸還沒做

### 5.6 設定存進 Flash 的其餘部分
- ~~Padavan 其他檔案欄位存進 Flash~~：`d92c48c` 完成（套用完存一次，內容沒變不寫）
- 黑潮 `KUROSHIO_ON_CONFIG_WRITE`：3.3.2 已修好（含社群金鑰），`kuroshio.sh` 的 `api_action` 不再每個動作存一次

### 5.7 黑潮 DNS 剩下的
- ~~學習資料匯入、UCI 改用 SIGHUP 重新載入~~：2026-11-18 在 `0bb30a1` 完成（黑潮 3.3.2，HANDOFF-UI 第 13.12 節）
- ~~憑證申請進度 API~~：`8ca57dc` 完成（`op=acme-log`，以前前端借 SystemCmd 讀）
- ~~黑潮 3.3.3～3.3.7~~：都已整合並在 D3 驗證；3.4.0（ace2df1；黑潮頁面適配串接模式 fdc4446）；目前韌體是 **3.4.4**（2026-11-22：串接卡片照 LuCI 重做、`/api/chain` 加進白名單、補 3.3.6～3.3.7 的舊預設檔 sha256）
- 黑潮新版本：照 `trunk/user/kuroshio/Makefile` 開頭的說明升級；預設設定有變時把舊預設檔的 sha256 加進 `kuroshio.sh` 的 `UCI_OLD_DEFAULTS`（改過的設定檔由 `kuroshio uci-migrate` 處理）
- ~~查看類的 GET 擋跨站與外網登入~~：`5771f9a` 完成（`X-TW-Request` 標頭、登入來源每次請求判斷）
- J7 Cloudflare 以外的 DDNS（在黑潮專案做）
- **黑潮 3.4.0（串接模式，預設開）作者要的驗證**：①串接狀態 ②共用結果 ⑤重新載入不斷線（400 筆 0 失敗）已驗證（3.4.0 時）。③④ 2026-11-22～23 在 D3 3.4.4、主路由器（KWRT）也是 3.4.4 時驗證：
  - ③ 主路由器關 `allow_downstream`：約 3 分鐘後 D3 退回自己運作（原因 `not-allowed`）；打開後在 10 分鐘的確認時自動接回 ✅
  - ④ 主路由器黑潮短重啟：D3 沒察覺、查詢不中斷 ✅。**長時間停止沒測**；升級主路由器時曾中斷一次，D3 記錄「連續失敗 3 次，暫停 30 秒，先用自己的上游」後自動恢復
  - 3.4.4 新增的：鎖錯指紋（`chain_pin`）原因是 `pin-mismatch`、不向上游登記，改回正確指紋後重新串接 ✅；D3 關 CDN 置換時上游不再幫它換 ✅
  - 還沒做：⑥補跑時段 `catchup_window`
- **黑潮 3.4.0 記憶體**（已回報作者，不是 B6 阻擋項目）：每秒 40 筆查詢 0 逾時；輕載 6 小時 22.3→28.7 MB；每秒 20 筆不重複新網域持續 20 分鐘升到約 110 MB、閒置不回落（記憶體控制判斷寬裕、保留量 36 MB）；模擬 64 MB 時會讓出快取但 RSS 不降
- ~~黑潮 3.3.6 整合與驗證~~（作者 2026-11-19 回覆；已完成，3.3.7 驗證過，以下留作紀錄）：
  - 整合：升級 Makefile；`kuroshio.sh` 在路由器 IPv6 關閉時帶 `option ipv6 '0'`（`config upstream`；另有 `path_check`、`intercept_policy`，預設即建議值）；WAN 連上／位址改變時呼叫 `kuroshio notify wan-changed`
  - 驗證 ①`kuroshio check-path`：一般 DNS 是否判成被接走、攔截者是誰、IPv6 判斷是否符合實際（主路由器也升 3.3.6 時應認出是黑潮——主路由器由使用者決定）②狀態頁／`/api/status` 的 `network.path`、`warnings` ③手動評測一次，提供 `/media/kuroshio/kuroshio/state/benchmark-last/`（judge.log、eliminated.csv、upstreams.json）與 `blacklist-suspects.json`；`upstreams.json` 的 `pathSkipped` 應有 `plain-intercepted` 約 300（沒 IPv6 時另有 `ipv6-unavailable`）④沒有 IPv6 的期間 syslog 不應再有 `sendmsg error: AddrNotAvailable` ⑤評測記憶體高點 `memory.jobs.lastBenchmark.processPeakRssBytes` 跟 3.3.3 比（預期較低）
  - 評測很吃 CPU，不要跟 Wi-Fi 測試同時跑

### 5.8 維護與發布（ROADMAP A、B 章）
- ~~A6 miniupnpd 2.0 → 2.3.x~~：2.3.7 已完成（4750c57，D3 實機）
- A8 定期同步 TurBoTse（上游設定檔不改；衝突多在 `www`、`rc`）
- B4 預編工具鏈改放本專案 Release（目前抓 TurBoTse 的 `toolchain` 標籤，上游刪檔就編不了）
- ~~B5 Actions 升級 Node 24~~：`8ca57dc` 完成
- ~~B6 第一個正式 Release v2026.11.20~~：2026-11-20 完成（PR #2 合併 main、打標籤，發布用的 action 正常）；v2026.11.22 在 2026-11-22 發布（標籤在開發分支）
- MOD 後續：重開路由器但機上盒沒重開時也能偵測、不用 MOD 時自動取消 MOD 孔（目前都要手動）
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
