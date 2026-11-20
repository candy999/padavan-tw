# 各分支修補檢視紀錄

基底：[TurBoTse/padavan](https://github.com/TurBoTse/padavan) `main`（c142aced25，2026-07-29，kernel 4.4.198、gcc 13.3、musl 1.2.5）。
目標機型只有 **NEWIFI3（Newifi D3）** 與 **CR660x（小米 CR6608）**。
原則：以穩定為優先，只收修 bug、安全更新與台灣需要的功能；實驗性驅動、科學上網、中國服務、校園網認證一律不收。

檢視方式：把各分支加成 remote，用 `git cherry` 找出 TurBoTse 沒有同內容 patch 的 commit，
再依修改的檔案分類（其他機型、版本升級、網路驅動、核心、使用者空間），
最後對每個可能相關的 commit 用 `git apply --check` 正向與反向檢查，確認 TurBoTse 是否已用不同寫法收錄。

## 系譜

```
hanwckf/padavan-4.4 (2022-02)
 ├─ MeIsReallyBa（社群匯集，keke1023 是它的鏡像）
 └─ tsl0922/padavan（重寫歷史，2022-09 ~ 2023-10）
     ├─ vb1980/padavan-4.4（2022-10 分出，~2025-09）
     ├─ simonchen/padavan-4.4（2022-12 分出）
     └─ TurBoTse/padavan（2023-10 分出，~2026-07）← 本專案基底
```

## hanwckf/padavan-4.4：穩定性修正

2021-12 之後的 27 個 commit 都檢查過，**與我們機型相關的全部已在 TurBoTse 裡**，只是寫法或 commit 名稱不同：
- mt7615 / mt7915 關閉 `SUPPORT_WLAN_OPTIMIZE`（修正硬體 NAT 問題）、mt7915 關閉 `PKTLOSS_CHK`、kernelrpsadj 修正
- 不設定 `KernelRps`；關閉 `tcp_tw_recycle`（修正 Apple 裝置網頁很慢）
- MT7621 SPI 最高頻率 32 MHz（`newifi3.dts`）、Winbond DVP 50%、清除 EAR、4B opcode、`m25p_shutdown`
- raeth：修正 PPE 重設、關閉 `GE1_RGMII_FORCE_1200`（DDR-1066 交換器問題）、USB 卡死修正
- hw_nat `wan_vid` 參數、MT7615 DBDC 的 site survey 修正

未收：`rc: remove 11kvr related settings`（hanwckf 直接拿掉 KVR；我們改成修 bug 並預設關閉，見下方）。

## vb1980/padavan-4.4

TurBoTse 沒有的 571 個 commit 分類：其他機型 184、套件版本 167、使用者空間 69、網路驅動 18、核心 2、我們機型設定 10、其他 121。

| 項目 | 處理 | 理由 |
|---|---|---|
| **OpenSSH 9.9p2**（e77dd1374e） | ✅ **已收**（改寫） | TurBoTse 仍是 9.7p1，受 regreSSHion（CVE-2024-6387）等漏洞影響。保留 TurBoTse 的 patch，sshd.sh 移除 DSA |
| 從 MeIsReallyBa 移植的新版 HNAT／QDMA／HQoS（845a0f5c69 與 2024-01 的 hnat 修正） | ❌ 不收 | 原作者標為 test，一週內多次 revert；TurBoTse 用 hanwckf 的舊版 hw_nat，長期穩定 |
| NEWIFI3 改用雙 GMAC | ❌ 不收 | 維持 TurBoTse／hanwckf 的單 GMAC 設定 |
| MT76x2 PA/LNA、TxBF offset、XMC SPI flash | 已在 TurBoTse | |
| DNS 進階選項（強制區網用路由器 DNS、DNSSEC、Rebind 防護、strict-order、all-servers、過濾 AAAA）、NTP 立即同步、iperf3 服務、DNSv6 第二組、WAN 變動執行腳本、緩衝區溢位修正 | 已在 TurBoTse | 兩邊都從 padavan-ng 移植 |
| uClibc-ng 升級 | 不需要 | 我們用 musl |
| Rainbow UI、formlogin（表單登入） | ⏸ 暫不收 | 外觀／使用習慣，非穩定性 |
| miniupnpd 2.3.7 | ✅ **已收**（2026-11-18，`4750c57`） | 原始碼用 vb1980 的（padavan-ng 移植，含 2.3.7 之後的 PCP nonce 修正、設定檔維持 /etc/miniupnpd.conf）；接 TurBoTse 的 package.mk，libiptc 用暫存區的 `-lip4tc`，**iptables 不用升級**。D3 實測 SSDP、AddPortMapping（DNAT＋ACCEPT＋lease 檔）、DeletePortMapping 都正常 |
| 套件版本（openssl、curl、dnsmasq、dropbear、zlib…） | 不收 | TurBoTse 普遍較新（openssl 3.0.21 對 1.1.1w、curl 8.21 對 8.15） |
| igmpproxy 0.4 | 不收 | TurBoTse 刻意降回 0.3，維持 0.3；改成在 0.3 上加兩個修補：上游 PR #98 的 `internAgeRoute()` use-after-free 修法（67fc7d8，還沒實際觸發驗證）、核心要求啟用路由時來源在下游介面就略過（e78619e，已實測）。中華電信 MOD 走交換器橋接，不經過 igmpproxy |

## simonchen/padavan-4.4

| 項目 | 處理 | 理由 |
|---|---|---|
| 換回舊版 hw_nat、舊版 mt76x2／mt76x3 驅動 | ❌ 不收 | 與穩定優先相反方向的實驗 |
| 核心調整（關 RCU、NO_HZ 測試、loadavg 等） | ❌ 不收 | 多為 TEST 性質；`get_avenrun` 與 ttwu patch TurBoTse 已收 |
| `tcp_tw_recycle=1` | ❌ 不收 | 會讓 NAT 後面的用戶端連線失敗，Linux 4.12 已移除此參數 |
| SS／dnsproxy 調整 | ❌ 不收 | 科學上網 |
| AP 中繼監控 | 已在 TurBoTse（AP Relay auto-daemon） | |

## MeIsReallyBa/padavan-4.4（含 padavanonly）

| 項目 | 處理 |
|---|---|
| IPv6 fullcone、brcm fullcone、MT7612 TxBF、MT7603+MT7615 TxBF 修正、預設 TCP MSS | 已在 TurBoTse |
| SQM／cake、SFE 與 SQM 相容、SmartDNS、超頻選項 | 已在 TurBoTse（本專案之後移除了 SQM 與 SmartDNS） |
| 新版 HNAT／QDMA／HQoS、ext-to-ext | ❌ 不收（同上） |
| 多 WAN（mwan） | ❌ 不收（不需要） |

## 2026-11-18 再檢視（vb1980/padavan-4.4 到 2025-09、MeIsReallyBa、CleanPadavan-Newifi3）

| 項目 | 處理 | 理由 |
|---|---|---|
| dropbear 2025.88（610139590） | ✅ 已收（`4750c57`） | CVE-2025-47203（dbclient 多跳主機名稱交給 shell）。**注意**：D3、CR6608 開的是 OpenSSH，dropbear 沒有編進這兩台的韌體，只影響其他機型 |
| networkmap 裝置名稱 32 字元（69cc341a6） | ✅ 改寫後收（`4750c57`、`f826b34`） | TurBoTse 已收一半。另外修：中文名稱被 `is_valid_hostname()`（只收 ASCII）丟掉、有號 char 把 UTF-8 清掉、使用者取的名稱排在 DNS 反查之後；長度改 72 bytes 並在完整的字截斷；反查名稱也過濾（會直接放進 JS 字串） |
| 解析主機名稱（553c625c0） | 已在 TurBoTse | `lookup_dhcp_list()` |
| 新機型、套件版本升級 | 不收 | 不是我們的機型；TurBoTse 的套件普遍較新 |
| CleanPadavan-Newifi3 | 不收 | 只有編譯腳本：3.4 用 hanwckf；4.4 用 MeIsReallyBa 的 `NEWIFI` 機型（雙 GMAC、WAN 走 GMAC2／RGMII2，D3 不拆 C48 時不通）。「注入 KVR」找不到對應的資料夾，什麼都沒換 |
| KVR（802.11k/v/r） | 不需要 | vb1980 的「支援 KVR」實際只對 MT7615、MT7915 有效；`CONFIG_FIRMWARE_INCLUDE_WIFI_KVR` 在它的編譯腳本裡沒有處理。D3 的 MT7603 在 vb1980 3.4／4.4、hanwckf、MeIsReallyBa、TurBoTse 都是 11k/v/r 全關，padavan-tw 已經開了 11k（11v／11r 維護者決定不開：2.4G 主要給 IoT 裝置）；CR6608（MT7915）兩邊設定相同（11k、11r、11v 開） |
| CR6608 `CONFIG_KVRH_SUPPORT`（查手機的 11k/v/r 能力） | ⏸ 之後 | 漫遊中控在 CR6608 用 11k／11v 引導時再開 |

## 本專案自己的修正

- `rc/src/ralink.c`：802.11k/v 開關無效（驅動只讀第一個 `RRMEnable`／`WNMEnable`），以及 MT7915 DBDC 的 `FtSupport` 少一個參數。之後 802.11k/v 改成預設開、802.11r 預設關。
- 台灣化：繁體中文（台灣）介面、時區、NTP、斷線偵測主機。
- 機型設定：放在 `trunk/configs/tw/`，編譯時接在上游的機型設定後面（上游設定檔保持不改）。關閉科學上網／校園網等外掛；開啟 SFE、WireGuard、msd_lite；不超頻（另外編 `-oc1000` 版）。軟體 SQM（連同 QoS 排程、IFB 核心選項）已從韌體移除，原本規劃的硬體 QoS（QDMA）也在 2026-11-18 捨棄。
- 其他本專案修正（細節見 ROADMAP、WIFI-STABILITY）：D3 單一 GMAC、D3 重開機、硬體 NAT 殘留標記（STP 誤判 2.4G 迴圈，已回報 TurBoTse/padavan#33、hanwckf/padavan-4.4#73）、Wi-Fi BPDU 擋法、STP 8 秒＋急速連線、自動 NAT66、刷機重開、busybox dhcp6c 洗日誌、中華電信 MOD 自動偵測。
