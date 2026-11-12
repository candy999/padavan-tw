# padavan-tw

**為台灣網路環境打造的 Padavan 路由器韌體**，專門支援 **Newifi D3** 與**小米 CR6608**。

Padavan 用的是聯發科原廠的閉源無線與硬體 NAT 驅動，長年以「刷了就不用管」的穩定度著稱。
padavan-tw 以目前仍持續維護的 [TurBoTse/padavan](https://github.com/TurBoTse/padavan) 為基底，
逐一檢視各家分支的修補，只留下穩定、安全、台灣用得到的部分，並重新做了完整的台灣中文介面。

## 為什麼選 padavan-tw

| | padavan-tw 的做法 |
|---|---|
| **穩定優先** | 沿用 hanwckf 系列長期驗證過的閉源驅動與舊版硬體 NAT；不收實驗性驅動、不超頻 |
| **兩台做到好，其他機型也能用** | 正式維護 Newifi D3、小米 CR6608，每次修改都會編譯這兩台確認；其他 50 多個機型可以開 Issue 請求或自己一鍵編譯 |
| **真正的台灣中文** | 介面 2,037 條全部以英文原文重新翻譯成台灣網通用語，不是簡轉繁；同時修正簡中版本的大量錯譯（例如把「穿透」譯成「通道」、把「數據機」譯成「網卡」、單位與預設值寫錯等） |
| **台灣預設值** | 時區臺北、NTP 用國家時間與頻率標準實驗室、斷線偵測改用 HiNet 與 TWNIC，不再依賴中國的 DNS 與網站 |
| **乾淨** | 移除科學上網、廣告外掛、中國雲端服務、校園網認證、KMS 等與台灣網路無關的功能 |
| **補安全漏洞** | OpenSSH 從 9.7p1 升到 9.9p2（修補 regreSSHion 等漏洞）；其餘套件跟著 TurBoTse 的版本（OpenSSL 3.0、curl 8.21、dnsmasq 2.90） |
| **修好上游的 bug** | 修正 802.11k/v 開關在網頁上切了也沒作用、CR6608 的 802.11r 設定值錯誤 |
| **自動編譯** | GitHub Actions 每次修改都自動編譯兩台的韌體；發布版附 SHA256 校驗 |
| **修補有紀錄** | 收了什麼、沒收什麼、為什麼，都寫在 [docs/PATCH-REVIEW.md](docs/PATCH-REVIEW.md) |

## 支援機型

### 正式維護

每次修改都會自動編譯、有實機使用、發布 Release。

| 機型 | 編譯名稱 | 晶片 | 無線 |
|---|---|---|---|
| Newifi D3（新路由 3、OpenWrt 稱 Newifi D2） | `NEWIFI3` | MT7621A | MT7603E 2.4G＋MT7612E 5G |
| 小米 CR6608（CR660x 系列） | `CR660x` | MT7621A | MT7905DAN＋MT7975DN（Wi-Fi 6 AX1800） |

CR660x 的設定檔理論上也適用 CR6606、CR6609。

### 社群支援

以下機型沿用上游 TurBoTse/padavan 的設定檔，都能用本專案編譯，編譯時同樣套用台灣版設定
（台灣中文介面、移除無關功能、SFE、硬體 QoS 等）。
**維護者手邊沒有這些機器，沒有實機測試。** 需要的話請看下一節「請求支援」。

「上游說明」是 TurBoTse README 對該設定檔的註記：**已實測**＝上游作者或提供者實機測試可用；**未實測**＝上游也沒有機器測試；空白＝上游沒有特別註記（多半是 hanwckf 時代就有的機型）。

| 編譯名稱 | 機型 | 上游說明 |
|---|---|---|
| `360-T6M`、`360-T6M-PB` | 360 T6M（PB＝pb-boot 版） | 未實測 |
| `B70` | B70 | |
| `BELL-A040WQ` | Bell A040WQ | |
| `C-Life-XG1` | C-Life XG1 | 未實測 |
| `DIR-878` | D-Link DIR-878 | |
| `DIR-882` | D-Link DIR-882 | |
| `EA7500` | Linksys EA7500 | 未實測 |
| `G-AX1800` | 富春江 G-AX1800（白色） | 已實測 |
| `G-AX1800-B` | 富春江 G-AX1800（黑色，網路孔配置與白色版不同） | 已實測 |
| `GHL` | GHL | 未實測 |
| `HAR-20S2U1` | HAR-20S2U1 | 未實測 |
| `JCG-836PRO` | JCG 836PRO | |
| `JCG-AC860M` | JCG AC860M | |
| `JCG-Q10Pro`、`JCG-Q10Pro-PB` | JCG Q10 Pro | 未實測 |
| `JCG-Q11Pro` | JCG Q11 Pro | 未實測 |
| `JCG-Q20`、`JCG-Q20-PB` | JCG Q20 | |
| `JCG-Y2` | JCG Y2 | |
| `JDCLOUD-RE-CP-02` | 京東雲無線寶 魯班（RE-CP-02） | 未實測 |
| `JDCLOUD-RE-SP-01B` | 京東雲 RE-SP-01B | 未實測 |
| `K2P`、`K2P-USB`、`K2P-NANO` | 斐訊 K2P（USB 版、精簡版） | |
| `KOMI-A8` | 康佳 KOMI A8 | 未實測 |
| `MI-4` | 小米路由器 4 | |
| `MI-R3G` | 小米路由器 3G | |
| `MI-R3P`、`MI-R3P-PB`、`MI-R3P-SPI` | 小米路由器 3 Pro | |
| `MI-R4A` | 小米路由器 4A 千兆版 | 已實測 |
| `MR2600` | MR2600 | |
| `MSG1500` | MSG1500 | |
| `MSG1500-Z` | MSG1500-Z | 已實測 |
| `NETGEAR-BZV` | Netgear BZV | |
| `NETGEAR-R6800` | Netgear R6800 | 未實測 |
| `NETGEAR-R7450` | Netgear R7450 | 已實測 |
| `NEWIFI` | Newifi（舊版設定，Newifi D3 請用 `NEWIFI3`） | |
| `QM-B1` | QM-B1 | 未實測 |
| `R2100` | 小米 AC2100 | |
| `RM2100` | Redmi AC2100 | |
| `RT-AC85P` | ASUS RT-AC85P | |
| `SIM-AX1800T` | SIM AX1800T | 未實測 |
| `TX1801` | TX1801 Plus | 未實測 |
| `WDR8620` | TP-Link WDR8620 | 未實測 |
| `WE410443-TC` | WE410443-TC | 未實測 |
| `WIA3300-10` | 西加雲杉 WIA3300-10 | 已實測 |
| `WR1200JS` | WR1200JS | |
| `WRL18M4GD` | WRL18M4GD | 未實測 |
| `XY-C1` | XY-C1 | |
| `ZTE-E8820S` | 中興 E8820S | |
| `ZTE-E8820V2` | 中興 E8820 V2 | |
| `ZTT-RX6000` | 中天科技 RX6000（Wi-Fi 6 電信業者機） | 已實測 |

上游對 `NEWIFI3` 的註記是「部分來自 GH-X/padavan-4.4，不需要拆 C48 電容，上游未實測」；本專案會以實機驗證。

### 請求支援

想在社群支援機型、或清單以外的機型上使用 padavan-tw，有兩種方式：

1. **開 Issue 請維護者協助**：到 [Issues](https://github.com/candy999/padavan-tw/issues/new/choose) 選「機型支援請求」，填寫機型與硬體資訊。
   維護者會幫你編譯並發布該機型的測試版 Release；你測試後回報結果，確認可用的機型會在表格裡標註。
   清單以外的新機型，需要有 Padavan 或 OpenWrt 的現成支援可以參考，請在 Issue 裡附上連結。
2. **自己編譯（不用等）**：
   1. 按右上角 **Fork** 複製本專案到你的帳號。
   2. 到你 Fork 的 **Actions** 頁面，第一次需要按「I understand my workflows, go ahead and enable them」。
   3. 選左邊的 **Build Firmware** → **Run workflow**，在「機型」選你的編譯名稱 → **Run workflow**。
   4. 大約 30–60 分鐘後，在該次執行的 **Artifacts** 下載 `.trx`（保留 14 天）。
   5. 想改功能，編輯 `trunk/configs/tw/<編譯名稱>.config`（新增檔案即可，會覆蓋共用設定），再執行一次。

> 社群支援機型的 Flash 空間差異很大，16 MB 的機型如果編譯失敗或韌體超過分割區大小，請在 Issue 裡提出，我們一起調整功能。

## 功能

**包含**
- 有線：MT7621 硬體 NAT（HWNAT）、SFE 軟體加速、IPv6、fullcone NAT
- 頻寬管理：**硬體 QoS（MT7621 QDMA）**，跟硬體 NAT 同時運作；後台切換關閉／固定／自動（開發中，見路線圖）
- Wi-Fi 國家碼預設台灣（NCC）：頻道與功率**只標示、不鎖定**，DFS 頻段、非台灣頻段在選單上標示；自動選頻只選台灣免雷達偵測的頻道
- 無線：閉源驅動、Beamforming（TxBF）、802.11k/v/r（預設關閉，見下方說明）、AP 中繼自動重連
- DNS：**[黑潮 DNS](https://github.com/candy999/kuroshio-dns)**（預設開啟：找出台灣 CDN 節點、每天挑最快且沒汙染的上游、過濾廣告與詐騙網站；選用：DoT／DoH／DoQ 加密 DNS、Cloudflare DDNS、Let's Encrypt 憑證）；沒有回應時自動改用業者 DNS
- VPN：WireGuard（核心內建）、OpenVPN、L2TP／PPTP 伺服器
- IPTV：msd_lite、xUPnPd、IGMP proxy（中華電信 MOD 相關設定）
- 管理：OpenSSH（含 SFTP）、ttyd 網頁終端機
- Newifi D3 另有 USB：Samba、FTP、NTFS／exFAT／ext4

**刻意不包含**
- 科學上網（Shadowsocks、Xray、V2Ray、Trojan、sing-box 等）
- 廣告外掛（adbyby、AdGuardHome）：之後由黑潮 DNS 負責過濾
- 中國服務（阿里 DDNS、ddnsto、阿里雲盤）、校園網認證、KMS 模擬器
- 預設超頻（另外提供 `-oc1000` 超頻版，自行選用）

## 下載與刷機

1. 到 [Releases](https://github.com/candy999/padavan-tw/releases) 下載對應機型的 `.trx`，並用 `SHA256SUMS-*.txt` 核對檔案。
   每個機型有兩種：標準版（CPU 880 MHz）與檔名有 `-oc1000` 的超頻版（1000 MHz，CPU 快約 13%，關閉硬體 NAT 走軟體路徑時較有餘裕）。不確定就用標準版。
   想試最新修改，可以到 [Actions](https://github.com/candy999/padavan-tw/actions) 下載 Artifacts（保留 14 天）。
2. 刷機：
   - **Newifi D3**：先刷 Breed，再從 Breed 網頁刷入 `.trx`。
   - **小米 CR6608**：要先解鎖 SSH 並刷入支援 Padavan 的 bootloader，步驟依原廠韌體版本而不同，請先查好再動手。
   - 已經在跑 Padavan 的機器：可以直接在「系統管理 → 韌體更新」更新。
3. 預設值：管理頁面 `http://192.168.2.1`，帳號密碼 `admin` / `admin`，Wi-Fi 密碼 `1234567890`。**第一次登入請立刻修改。**

> 刷機有變磚風險，請確認有救援方式（Breed、TTL 或編程器）再操作。

## 使用建議

- **硬體 QoS 正在實機驗證**：目前預設關閉，跟原本的硬體 NAT 行為完全相同。
  手上有 D3 想幫忙測試的話，SSH 進去執行 `tw-qos-check guide` 照步驟做，結果貼到 Issue。
- **DFS 頻段（5 GHz 52–64、100–140）**：台灣規定要有雷達偵測，Padavan 沒有啟用。選單上會標示，自動選頻不會選到；手動選用請自行評估。
- **802.11k/v/r** 只在多台 AP 使用同一個 SSID 時才有用，而且各家閉源驅動之間的漫遊相容性沒人保證，預設關閉。要開請先在兩台都開、實際測試漫遊。
- **Linux 4.4 核心已停止官方維護。** 本韌體選擇閉源驅動的穩定度，代價是核心不再有上游安全更新。不建議把管理頁面或 SSH 開放到 WAN。

## 自行編譯

用 GitHub Actions（建議）：步驟見上方「請求支援 → 自己編譯」。推送 `v*` 標籤會自動發布 Release。

在自己的電腦（Ubuntu 24.04）：

```bash
sudo apt-get install -y bison flex gperf help2man libtool-bin texinfo python3-docutils autopoint gettext ccache autoconf automake liblzma-dev libltdl-dev liblzo2-dev
```

```bash
make NEWIFI3
```

```bash
make CR660x
```

第一次會自動下載預編好的 musl 工具鏈。韌體會出現在 `trunk/images/`。任何 `trunk/configs/templates/` 裡的機型都能用同樣方式編譯，例如 `make K2P`。

設定檔的組合方式：

1. `trunk/configs/templates/<機型>.config`：上游的機型設定，**保持不改**，方便之後同步 TurBoTse
2. `trunk/configs/tw/common.config`：台灣版共用設定（所有機型都套用）
3. `trunk/configs/tw/<機型>.config`：機型專屬調整（有才套用）

後面的值會覆蓋前面的值。要調整功能，改第 2 或第 3 個檔案裡的 `CONFIG_FIRMWARE_INCLUDE_*`。

## 路線圖

完整計畫見 [docs/ROADMAP.md](docs/ROADMAP.md)。重點：

- [x] 以 TurBoTse/padavan 為基底，檢視 hanwckf、MeIsReallyBa、vb1980、simonchen 的修補
- [x] 台灣中文介面、台灣預設值、移除無關功能
- [x] OpenSSH 安全更新、修正 KVR bug、自動編譯（標準版與 OC 1000 版）
- [x] 新後台框架：全站 RWD、亮暗色、手機表格卡片化
- [ ] 總覽儀表板、網路診斷、裝置詳情
- [x] 硬體 QoS 執行中開關與驗證工具（`tw-qos-check`）
- [ ] 硬體 QoS 固定與自動模式：平常硬體 NAT 全速，延遲變高且頻寬快滿時自動限速，不需要時自動解除
- [x] 整合[黑潮 DNS](https://github.com/candy999/kuroshio-dns)（取代 SmartDNS，待實機）
- [x] Wi-Fi 國家碼改為台灣（只標示、不鎖定）
- [ ] miniupnpd 升級

## 致謝與授權

本專案建立在許多人的成果上：Andy Padavan 的 [rt-n56u](https://gitlab.com/padavan/rt-n56u)、
[hanwckf](https://github.com/hanwckf/padavan-4.4)、[tsl0922](https://github.com/tsl0922/padavan)、
[TurBoTse](https://github.com/TurBoTse/padavan)、[vb1980](https://github.com/vb1980/padavan-4.4)、
[MeIsReallyBa](https://github.com/MeIsReallyBa/padavan-4.4)、padavanonly、[simonchen](https://github.com/simonchen/padavan-4.4)，
以及 [padavan-ng](https://gitlab.com/hadzhioglu/padavan-ng) 社群。

授權依各元件原本的授權（主要為 GPL-2.0），詳見 `trunk/License`。
