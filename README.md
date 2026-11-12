# padavan-tw

**為台灣網路環境打造的 Padavan 路由器韌體**，專門支援 **Newifi D3** 與**小米 CR6608**。

Padavan 用的是聯發科原廠的閉源無線與硬體 NAT 驅動，長年以「刷了就不用管」的穩定度著稱。
padavan-tw 以目前仍持續維護的 [TurBoTse/padavan](https://github.com/TurBoTse/padavan) 為基底，
逐一檢視各家分支的修補，只留下穩定、安全、台灣用得到的部分，並重新做了完整的台灣中文介面。

## 為什麼選 padavan-tw

| | padavan-tw 的做法 |
|---|---|
| **穩定優先** | 沿用 hanwckf 系列長期驗證過的閉源驅動與舊版硬體 NAT；不收實驗性驅動、不超頻 |
| **只做兩台，做到好** | 只維護 Newifi D3、小米 CR6608 兩台，每次修改都會同時編譯這兩台確認 |
| **真正的台灣中文** | 介面 2,037 條全部以英文原文重新翻譯成台灣網通用語，不是簡轉繁；同時修正簡中版本的大量錯譯（例如把「穿透」譯成「通道」、把「數據機」譯成「網卡」、單位與預設值寫錯等） |
| **台灣預設值** | 時區臺北、NTP 用國家時間與頻率標準實驗室、斷線偵測改用 HiNet 與 TWNIC，不再依賴中國的 DNS 與網站 |
| **乾淨** | 移除科學上網、廣告外掛、中國雲端服務、校園網認證、KMS 等與台灣網路無關的功能 |
| **補安全漏洞** | OpenSSH 從 9.7p1 升到 9.9p2（修補 regreSSHion 等漏洞）；其餘套件跟著 TurBoTse 的版本（OpenSSL 3.0、curl 8.21、dnsmasq 2.90） |
| **修好上游的 bug** | 修正 802.11k/v 開關在網頁上切了也沒作用、CR6608 的 802.11r 設定值錯誤 |
| **自動編譯** | GitHub Actions 每次修改都自動編譯兩台的韌體；發布版附 SHA256 校驗 |
| **修補有紀錄** | 收了什麼、沒收什麼、為什麼，都寫在 [docs/PATCH-REVIEW.md](docs/PATCH-REVIEW.md) |

## 支援機型

| 機型 | 編譯名稱 | 晶片 | 無線 |
|---|---|---|---|
| Newifi D3（新路由 3、OpenWrt 稱 Newifi D2） | `NEWIFI3` | MT7621A | MT7603E 2.4G＋MT7612E 5G |
| 小米 CR6608（CR660x 系列） | `CR660x` | MT7621A | MT7905DAN＋MT7975DN（Wi-Fi 6 AX1800） |

CR660x 的設定檔理論上也適用 CR6606、CR6609，但本專案只以 CR6608 為目標。

## 功能

**包含**
- 有線：MT7621 硬體 NAT（HWNAT）、SFE 軟體加速、IPv6、fullcone NAT
- 頻寬管理：**SQM QoS（cake）**
- 無線：閉源驅動、Beamforming（TxBF）、802.11k/v/r（預設關閉，見下方說明）、AP 中繼自動重連
- DNS：dnsmasq 進階選項（DNSSEC、DNS Rebind 防護、強制區網裝置使用路由器 DNS 等）、SmartDNS
- VPN：WireGuard（核心內建）、OpenVPN、L2TP／PPTP 伺服器
- IPTV：msd_lite、xUPnPd、IGMP proxy（中華電信 MOD 相關設定）
- 管理：OpenSSH（含 SFTP）、ttyd 網頁終端機
- Newifi D3 另有 USB：Samba、FTP、NTFS／exFAT／ext4

**刻意不包含**
- 科學上網（Shadowsocks、Xray、V2Ray、Trojan、sing-box 等）
- 廣告外掛（adbyby、AdGuardHome）：之後由黑潮 DNS 負責過濾
- 中國服務（阿里 DDNS、ddnsto、阿里雲盤）、校園網認證、KMS 模擬器
- 超頻

## 下載與刷機

1. 到 [Releases](https://github.com/candy999/padavan-tw/releases) 下載對應機型的 `.trx`，並用 `SHA256SUMS-*.txt` 核對檔案。
   想試最新修改，可以到 [Actions](https://github.com/candy999/padavan-tw/actions) 下載 Artifacts（保留 14 天）。
2. 刷機：
   - **Newifi D3**：先刷 Breed，再從 Breed 網頁刷入 `.trx`。
   - **小米 CR6608**：要先解鎖 SSH 並刷入支援 Padavan 的 bootloader，步驟依原廠韌體版本而不同，請先查好再動手。
   - 已經在跑 Padavan 的機器：可以直接在「系統管理 → 韌體更新」更新。
3. 預設值：管理頁面 `http://192.168.2.1`，帳號密碼 `admin` / `admin`，Wi-Fi 密碼 `1234567890`。**第一次登入請立刻修改。**

> 刷機有變磚風險，請確認有救援方式（Breed、TTL 或編程器）再操作。

## 使用建議

- **SQM 與硬體 NAT 不能同時發揮作用**：硬體 NAT 會繞過 SQM 的排程。
  寬頻 300M 以下、在意延遲（遊戲、視訊）就開 SQM；千兆 PPPoE 想跑滿速就用硬體 NAT。
- **802.11k/v/r** 只在多台 AP 使用同一個 SSID 時才有用，而且各家閉源驅動之間的漫遊相容性沒人保證，預設關閉。要開請先在兩台都開、實際測試漫遊。
- **Linux 4.4 核心已停止官方維護。** 本韌體選擇閉源驅動的穩定度，代價是核心不再有上游安全更新。不建議把管理頁面或 SSH 開放到 WAN。

## 自行編譯

用 GitHub Actions（建議）：Fork 本專案後，到 Actions → **Build Firmware** → Run workflow，選機型即可。推送 `v*` 標籤會自動發布 Release。

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

第一次會自動下載預編好的 musl 工具鏈。韌體會出現在 `trunk/images/`。
要調整功能，修改 `trunk/configs/templates/NEWIFI3.config` 或 `CR660x.config` 裡的 `CONFIG_FIRMWARE_INCLUDE_*`。

## 路線圖

- [x] 以 TurBoTse/padavan 為基底，檢視 hanwckf、MeIsReallyBa、vb1980、simonchen 的修補
- [x] 台灣中文介面、台灣預設值、移除無關功能
- [x] OpenSSH 安全更新、修正 KVR bug、自動編譯
- [ ] 整合[黑潮 DNS](https://github.com/candy999/kuroshio-dns)：台灣 CDN 節點、加密 DNS、廣告與詐騙過濾
- [ ] miniupnpd 升級（目前 2.0 有已知漏洞）
- [ ] 預設 Wi-Fi 國家碼改為台灣（需確認 5 GHz 頻道表）

## 致謝與授權

本專案建立在許多人的成果上：Andy Padavan 的 [rt-n56u](https://gitlab.com/padavan/rt-n56u)、
[hanwckf](https://github.com/hanwckf/padavan-4.4)、[tsl0922](https://github.com/tsl0922/padavan)、
[TurBoTse](https://github.com/TurBoTse/padavan)、[vb1980](https://github.com/vb1980/padavan-4.4)、
[MeIsReallyBa](https://github.com/MeIsReallyBa/padavan-4.4)、padavanonly、[simonchen](https://github.com/simonchen/padavan-4.4)，
以及 [padavan-ng](https://gitlab.com/hadzhioglu/padavan-ng) 社群。

授權依各元件原本的授權（主要為 GPL-2.0），詳見 `trunk/License`。
