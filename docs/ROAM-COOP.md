# AP 互助漫遊：交換資訊的手段與方法

> 2026-11-20 定稿第一版。設計由 Fable 提案、本機工作階段整理。
> 目的：讓同一個區網裡的 AP 互相找到、交換資訊，**只用「建議」幫裝置換到比較好的 AP 或頻段，永遠不踢人**。
> 寫法盡量和韌體無關，方便之後移植到 OpenWrt（第 9 節是對照表）。

## 1. 原則（任何版本都不能違反）

1. **永遠不踢**：不用固定訊號門檻斷線，不送 Deauth／Disassoc，BTM 不設 Disassociation Imminent、不帶斷線計時。頂樓的 IoT 裝置訊號再弱，只要能傳資料就留著。
2. **相對比較**：只有「另一個選擇明顯比較好」才建議，不看「目前多差」。
3. **裝置說了算**：裝置不支援 11k／11v，就完全不碰；收到建議不理會，就記下來、退避，不再煩它。
4. **能少就少**：交換的資料、規則、參數都用最少的；每一條都要能從記錄看出為什麼。
5. **一鍵退回**：任何時候把模式切回「觀察」，就回到完全不發任何請求的狀態。

## 2. 資訊從哪裡來

| 來源 | 內容 | 誰能提供 | 用途 |
|---|---|---|---|
| A. AP 自己看 | 每台連線裝置的訊號、頻段、連線時間、是否省電 | 每台 AP 的驅動 | 判斷「裝置現在在哪、狀況如何」 |
| B. AP 互相交換 | 別台 AP 有哪些頻段（BSSID、頻道）、連著誰、訊號多少 | 跑 tw-roamd 的 AP | 找出漫遊候選、確認裝置真的換過去、知道裝置「連過 5G」 |
| C. 裝置自己量 | 裝置收到各個候選 AP 的訊號（11k Beacon Report） | 支援 11k 的裝置 | 「哪台比較好」以裝置的角度為準（AP 聽到的跟裝置收到的不一定一樣） |

**決策主要靠 C**。A、B 是用來找候選、做事後確認，以及在裝置不支援 11k 時做保守的估計。

## 3. AP 怎麼找到彼此

- 每台 AP 每 5 秒在 LAN 橋接介面（br0）送一份文字報告到群播 `239.255.77.77:27330`，TTL 1，只在區網內。
- 收到別台的報告就記成「鄰居 AP」。20 秒沒收到就當它離線。不用設定，也不用配對。
- 只有 **SSID 相同**（比對雜湊）的頻段才算漫遊候選；訪客網路、IoT 專用 SSID 各自獨立。
- 已知風險：中間的交換器或 Mesh 開了 IGMP snooping 但沒有查詢者時，群播可能被擋。被擋就改用區網廣播（同一個埠）。

## 4. 交換的內容（協定）

文字格式，一行一筆，第一行是版本與節點。現有 `TWR1` 已在韌體裡（`trunk/user/rc/src/tw_roamd.c`），`TWR2` 只多一種 `R` 行，舊版收到 `TWR2` 會略過，不會出錯。

```
TWR2 <節點 MAC> <IP> <2.4G 頻道> <5G 頻道>
N <名稱>
R <頻段> <BSSID> <頻道> <頻寬> <裝置數> <SSID 雜湊> <能力>     每個頻段一行
C <裝置 MAC> <頻段> <訊號>                                     目前連著的裝置
G <裝置 MAC> <頻段> <訊號> <幾秒前離開>                         最近 30 秒內離開的裝置
```

- `能力`：`k`＝11k、`v`＝11v、`r`＝11r，例如 `kv`。
- `SSID 雜湊`：SSID 的 CRC32（十六進位），不在網路上送明文 SSID。
- `裝置數` 第一版只記錄、不參與決策。
- 報告大小上限 1400 位元組（一個封包）；裝置多時先送 `R`，`C`／`G` 依訊號排序後截斷。
- 不交換密碼、金鑰、IP 對照或主機名稱以外的個資；主機名稱只用在本機記錄，不放進報告。

### 每台 AP 記住的東西（只在記憶體，不寫 Flash）

| 項目 | 保存多久 | 用途 |
|---|---|---|
| 鄰居 AP 的 `R` 行 | 20 秒沒更新就刪 | 候選清單、鄰居報告 |
| 別台 AP 的 `C`／`G` 行 | 同上 | 確認裝置換過去了、避免打擾剛換過來的裝置 |
| 裝置「連過 5G」的時間 | 24 小時 | 第 6.3 節：建議回到 5G |
| 每台裝置的建議次數、不理會次數、退避到期時間 | 到重開機 | 頻率限制 |

## 5. 告訴裝置「附近有誰」：11k 鄰居報告

- tw-roamd 把「自己另一個頻段」加上「鄰居 AP 的 `R` 行（同 SSID）」組成鄰居清單，送給驅動；鄰居變動（新 AP、換頻道、離線）才更新。
- 裝置問鄰居時（Neighbor Report Request），驅動就照這份清單回答，裝置掃描時只要掃這幾個頻道，換得快也省電。
- D3 的 5G 驅動不能直接餵清單，是用自己的掃描表組；做法是鄰居變動時掃一次讓對方進表（見第 8 節）。

## 6. 什麼時候建議裝置換

### 6.1 流程（四步）

1. **問**（送 11k Beacon Request，只量候選的頻道）
   - 條件：有候選；裝置支援 11k；不在省電狀態；連上超過 120 秒。
   - 時機：訊號比上次問時變動 ≥ 6 dB，或距上次問已過 10 分鐘；同一台裝置最少間隔 60 秒。
2. **比**（用裝置量到的數字，候選 vs 目前）
   - 跨 AP：候選強 **≥ 10 dB**，而且候選本身 ≥ -72 dBm，**連續兩次**（間隔 10 秒）都成立。
   - 同一台 AP 換頻段：見 6.2、6.3。
3. **建議**（送 11v BTM Request，附候選清單；不設斷線、不帶計時）
4. **看結果**
   - 15 秒內在目標出現（自己另一個頻段，或別台的 `C` 行）→ 記「成功」。
   - 沒過去 → 記「不理會」，退避 10 分鐘 → 1 小時 → 24 小時；三次後這次開機期間不再建議它。

**上限**：每台裝置每天最多 6 次建議；每台 AP 每小時最多 12 次，超過就自動退回觀察模式並寫記錄。

兩邊各要強 10 dB，中間等於有 20 dB 的緩衝，不會來回彈。

### 6.2 頻段引導（同一台 AP，同一個 SSID）

| 方向 | 條件 | 為什麼 |
|---|---|---|
| 2.4G → 5G | 裝置量到本機 5G ≥ -65 dBm，連續兩次 | 5G 數字天生比 2.4G 低，但速率高；-65 dBm 的 5G 通常比好的 2.4G 快 |
| 5G → 2.4G | 5G ≤ -75 dBm，而且 2.4G 強 ≥ 15 dB，連續兩次 | 只在 5G 真的快撐不住、2.4G 明顯好很多時才建議 |

- 不藏 2.4G 的探測回應、不拒絕連線：裝置選 2.4G 也照樣讓它連。
- **前提：2.4G 與 5G 要同 SSID、同密碼、同加密方式**。SSID 不同時，多數手機會把建議當成「換網路」而不理會，這個功能就沒效果（介面要提醒）。

### 6.3 暫時離開又回來：建議回到 5G

情境：手機帶去廁所或陽台，5G 收不到就掉到 2.4G；回到房間後，很多手機會一直黏在 2.4G，速度回不來。

**條件（全部成立才建議）**

1. 裝置現在在 2.4G，而且**最近 24 小時內連過同 SSID 的 5G**（本機或別台 AP 的 `C` 行都算），所以確定它支援 5G。
2. 已經在 2.4G 待了 ≥ 60 秒（剛掉下來不要馬上拉回去）。
3. 看起來已經回來了，以下任一種成立：
   - 裝置支援 11k：Beacon Report 量到某個同 SSID 的 5G ≥ -67 dBm，連續兩次；
   - 裝置不支援 11k、只支援 11v：AP 聽到它的 2.4G 訊號 ≥ -58 dBm，而且比掉下來那時強 ≥ 8 dB，連續兩次（用 2.4G 估 5G：近距離時 5G 大約比 2.4G 弱 7～10 dB，所以 -58 大約是 5G 的 -66）。
4. 不在省電狀態（螢幕關著、待機中的手機不打擾，等它醒來再說）。

**目標**：有 Beacon Report 就選它量到最強的同 SSID 5G（可能是別台 AP）；沒有就選本機 5G。

**防來回彈**：建議回 5G 成功後 10 分鐘內，除非 5G ≤ -78 dBm，不建議它再去 2.4G。

**不支援 11v 的裝置**：什麼都不做，等它自己換。不用斷線逼它回 5G。

## 7. 記錄、模式、退回

**模式**（nvram `tw_roam_enable`）

| 值 | 模式 | 會做什麼 |
|---|---|---|
| 0 | 關閉 | 不跑 tw-roamd |
| 1 | 觀察（目前預設） | 交換資訊、寫記錄、算「如果是建議模式會怎麼做」，**不送任何請求** |
| 2 | 建議 | 送 Beacon Request、鄰居報告、BTM 建議 |

**記錄**：系統日誌，另寫 `/etc/storage/tw-diag/roam.log`（上限 32 KB，循環覆寫）

```
ROAM 問   mac=.. 名稱=Mi10T 目前=本機5G/-71
ROAM 回報 mac=.. 本機5G=-71 AP2-5G=-58 本機2.4G=-55
ROAM 建議 mac=.. → AP2-5G（強13dB，第2次確認）今日第1次
ROAM 回5G mac=.. 2.4G 待了 3分12秒，5G=-61 → 本機5G
ROAM 結果 mac=.. 6秒後到 AP2-5G   ｜或｜ 不理會(第1次)→10分鐘內不再問
```

**退回順序**：模式改 1 → 驅動的 11k／11v 開關改 0 並重啟無線 → 刷回上一版韌體。

**要看的數字**：建議次數、成功率、換過去花幾秒、每台每天次數、誤建議次數（換過去後訊號反而變差）、回 5G 成功次數。

## 8. 各硬體的驅動狀況

| 機種／頻段 | 晶片（驅動） | 11k 鄰居報告 | 11k Beacon Request／Report | 11v BTM | 要修的地方 |
|---|---|---|---|---|---|
| D3 2.4G | MT7603E（mt76x3） | 有，可由程式餵清單 | 有；回報寫進掃描表，另有事件路徑待確認 | 有（`OID_802_11_WNM_COMMAND`），不需 Hotspot | **2026-11-20 已處理**：11k 原本就開；`configs/tw/kernel-NEWIFI3.config` 再開 `CONFIG_MT7603E_WNM_SUPPORT`（11v）、`CONFIG_MT7603E_DOT11R_FT_SUPPORT`（11r，預設仍關）；`rtmp_def.h` 補沒有 PMF 時的 `CATEGORY_WNM` |
| D3 5G | MT7612E（mt76x2） | 有，從自己的掃描表組 | 能送；回報只寫掃描表、不記是哪台裝置回的（**還沒補**） | **2026-11-20 已接上**：新增 Kconfig `RT_DOT11V_WNM`，Makefile 接 `wnm.o`；`OID_802_11_WNM_BTM_REQ` 加了不需 Hotspot 的版本；beacon／探測回應／連線回應宣告 BSS Transition（跟 11k 同一個開關） | Beacon Report 上報（含裝置 MAC）還要補 |
| CR6608 2.4G／5G | MT7905／MT7975（mt7915 7.3.0.1，2.4G＝rax0、5G＝ra0） | 有，但要用 ioctl 設，不能用 iwpriv | 有；回報以事件送出，**含手機 MAC** | 有；`SendBTMReq` **不能用**（會踢人），要用 ioctl | 核心設定不用改，要寫一支小工具發 ioctl、收事件（見 8.1） |

### 8.1 CR6608（mt7915）細節

2026-11-20 只讀查證（`git show`，沒有實機）。路徑縮寫：K＝`trunk/configs/boards/CR660x/kernel-4.4.x.config`，驅動在 `trunk/linux-4.4.x/drivers/net/wireless/mediatek/mt7915/`，Makefile 在 `mediatek/mt7915_ap/Makefile`。

**已經編進去**

| 功能 | 設定 | 位置 |
|---|---|---|
| 11k | `DOT11K_RRM_SUPPORT=y` | K:1531 |
| 11v | `WNM_SUPPORT=y`（加 `-DCONFIG_DOT11V_WNM`） | K:1548 |
| 11r | `DOT11R_FT_SUPPORT=y` | K:1530 |

- 沒開：MBO、MAP、PASSPOINT_R2、INTERWORKING、KVRH。
- `WAPP_SUPPORT=y` 只是 Kconfig 的 select；Makefile 只有在 MBO、MAP 等開著時才加 `-DWAPP_SUPPORT`，所以實際上沒編進去。

**dat 檔**：`ralink.c:1328-1342` 寫入 `RRMEnable`、`WNMEnable`（＝`HT_80211KV`，預設 1）與 `FtSupport`（＝`HT_80211R`，預設 0），`MboSupport=0`。

**怎麼操作**

- **Beacon Request（簡單用法）**：`iwpriv rax0 set BcnReq=<MAC或AID>!<時長>!<RegClass>!<BSSID>!<SSID>!<頻道>!<模式>[!...]`
  - 分隔符號是 `!`，不是說明文字寫的 `-`（`rrm.c:204-380`）。
  - 模式：0 被動、1 主動、2 查表。
- **`iwpriv set SendBTMReq=<MAC>` 不能用**（`ap_cfg.c:21001-21037`）：它固定設 Disassociation Imminent、計時 600 TBTT，約 60 秒後驅動會把手機踢掉（`wnm.c:1835-1846`），而且不帶候選清單。違反第 1 節原則。
- **正確做法：私有 ioctl**（`RT_PRIV_IOCTL`，flags＝OID｜0x8000）。只要 RRM／WNM 編進去就能用，不需要 HOTSPOT、MBO、WAPP。

| OID | 子命令 | 用途 |
|---|---|---|
| `0x094C`（RRM，`rrm.c:1091-1158`） | `SET_BEACON_REQ_PARAM` | 送 Beacon Request |
| | `SET_NEIGHBOR_REPORT_PARAM` | 設定鄰居清單 |
| | `HANDLE_NEIGHBOR_REQUEST_BY_DAEMON` | 改由程式回答手機的鄰居詢問 |
| `0x094A`（WNM，`wnm.c:2441-2508`） | `SET_BTM_REQ_PARAM` | 送 BTM，可設 `disassoc_timer=0`、帶候選清單 |

**事件**：走 WEXT 的 `IWEVCUSTOM`，也就是 rtnetlink `RTM_NEWLINK`／`IFLA_WIRELESS`（`rt_linux.c:1239`）。

| 事件 | flags | 內容 |
|---|---|---|
| Beacon Report | `0x094D`，event_id 1 | dialog token、ifindex、**手機 MAC**、BSSID、頻道、RCPI、RSNI；每筆一個事件（`rrm.c:858、2120-2152`），同時寫進掃描表 |
| BTM Response | `0x094B`，event_id 2 | 手機 MAC、狀態碼、目標 BSSID（`wnm.c:140-170、1507-1580`）；只有經驅動送出的請求才回報 |
| Neighbor Request | | 交給程式處理時才送；程式要在 2 分鐘內回（`rrm.c:757-790`） |

**每台裝置的訊號與能力**

- 訊號：`RTPRIV_IOCTL_GET_MAC_TABLE_STRUCT` 的 AvgRssi0-2（httpd 已經在用，`httpd/src/ralink.c:894`）。
- 是否支援 11k／11v：驅動在連線時已經解析（11v：`BssTransitionManmtSupport`；11k：`RrmEnCap`），但 MAC 表結構裡沒有這些位元。要開 `KVRH_SUPPORT` 用 `RT_QUERY_KVR_CAPABILITY` 依 MAC 查，或修補驅動匯出。

**預測要做的修改**

1. 核心設定不用改。要查每台裝置的能力，可以另開 `KVRH_SUPPORT`。
2. 寫一支小 C 工具（或併進 tw-roamd）：發上面的 ioctl、聽 rtnetlink 事件。不用 `SendBTMReq`；真要用就要修補它，拿掉 Disassociation Imminent 位元、加上候選清單。
3. **候選 AP 可能被丟掉**：組 BTM 候選時，只要候選的 phytype／regclass／capinfo／HT／VHT／mobility 任一欄是 0，驅動就改去掃描表找，找不到就跳過（`wnm.c:3037` 起）；沒開 11r 時 mobility 就是 0。解法：先送 detail ≥ 1 的 Beacon Request，讓回報把鄰居寫進掃描表；或修補這個判斷。
4. **`WNMEnable` 可能只套用到 2.4G**：多設定檔合併時只合併 `RRMEnable`（`multi_profile.c:2801`），但 `WNMCtrlInit` 又把每個 BSS 預設設成開（`wnm.c:2774-2797`），順序沒查清，要實機確認。
5. 驅動自己回鄰居報告要靠 AP 掃描，會中斷服務，建議交給程式回答。

**D3 可以借鏡的地方**：mt76x3／mt76x2 和 mt7915 是同一家族的私有驅動。D3 修好編譯後，也應該優先找同樣的 OID ioctl 和 rtnetlink 事件，比讀掃描表可靠；D3 的 BTM 也要先確認不會預設設 Disassociation Imminent。

驅動對 Beacon Report 的訊號用「RCPI ＋ 固定偏移」換算，跟標準的 RCPI/2 − 110 不同；程式要拿原始值自己算，並跟手機顯示的訊號對照。

## 9. 移植到 OpenWrt 的對照

OpenWrt 用 hostapd，11k／11v 都是標準功能，而且有 ubus 介面，移植主要是把「驅動 iwpriv／ioctl」換成「hostapd ubus」，交換協定和決策規則照搬。

| 本設計的動作 | padavan（MTK 私有驅動） | OpenWrt（hostapd） |
|---|---|---|
| 開啟功能 | dat 檔 `RRMEnable`、`WNMEnable`（加上編譯設定） | `/etc/config/wireless`：`option ieee80211k '1'`、`option bss_transition '1'`（對應 hostapd 的 `rrm_neighbor_report=1`、`rrm_beacon_report=1`、`bss_transition=1`） |
| 讀連線裝置與訊號 | 驅動 MAC table（`RTPRIV_IOCTL_GET_MAC_TABLE`） | `ubus call hostapd.<介面> get_clients`（含 signal、rrm 能力、是否支援 11v） |
| 設定鄰居清單 | mt76x3：RRM 指令餵清單；mt76x2：掃描表 | `ubus call hostapd.<介面> rrm_nr_get_own` 取自己的資料、`rrm_nr_set` 設清單 |
| 送 Beacon Request | `iwpriv <介面> set BcnReq=...` | `ubus call hostapd.<介面> rrm_beacon_req '{"addr":...,"channel":...,"mode":...}'` |
| 收 Beacon Report | 讀掃描表或驅動事件 | `ubus subscribe hostapd.<介面>` 收 `beacon-report` 通知 |
| 送 BTM 建議 | `OID_802_11_WNM_COMMAND`（D3 2.4G）等 | `ubus call hostapd.<介面> bss_transition_request '{"addr":...,"neighbors":[...],"abridged":1,"disassociation_imminent":false}'` |
| AP 之間交換 | 群播 239.255.77.77:27330 | 同一套；用 `ucode` 或 shell＋`socat` 都能做，或寫成小 C 程式 |

- 方法名稱以目標 OpenWrt 版本的 hostapd 為準（新舊版有差異，`beacon-report` 通知是較新的版本才有），移植時先 `ubus -v list hostapd.*` 確認。
- OpenWrt 已有 usteer、DAWN 兩個漫遊套件。它們都會用門檻踢人，本設計刻意不做這件事；移植時可以參考它們的 ubus 用法，但不要沿用踢人的規則。
- 2.4G／5G 同 SSID 的前提一樣適用。

## 10. 第一版範圍

| 階段 | 內容 | 工作量 |
|---|---|---|
| 0 | 驅動：D3 兩個頻段的 11k／11v 編譯與修補（第 8 節） | 2～3 天（含幾輪編譯刷機） |
| 1 | tw-roamd：`TWR2`、Beacon Request／Report、比較、BTM、退避、記錄；模式 2 | 2～2.5 天 |
| 2 | 鄰居清單自動餵入；頻段引導與回 5G（6.2、6.3） | 1 天 |
| 驗證 | 第 11 節 | 2～3 晚 |

以後再做：負載參與決策、11r 快速漫遊、介面卡片、CR6608。不做：學習模型、自適應 11r。

## 11. 驗證方法

1. **頻段引導與回 5G**（只要一台 D3＋Android 手機）：手機連 5G → 拿到陽台掉到 2.4G → 走回房間，看 60 秒後有沒有收到建議、幾秒回到 5G；來回幾趟，確認不會一直彈。
2. **跨 AP**：Beacon Report 是裝置自己量的，不參與交換的 Deco 也量得到。把 Deco 設成同名同密碼、加一個測試參數把它的 BSSID 列為候選，就能在第二台 padavan-tw 到之前驗證「問 → 比 → 建議 → 換過去」。前提是 Deco 和 D3 在同一個區網。
3. **不理會**：USB 網卡預期不支援或不理會，用來確認退避與上限生效、連線不受影響。
4. **IoT 回歸**：2.4G 開 11v 後過夜，確認既有 IoT 都還連得上、斷線 0。

## 12. 還不確定、要實機確認

1. Android 手機是否回 Beacon Report（尤其螢幕關著時）、是否接受 BTM；各廠牌不同，這是成效的最大變數。
2. D3 5G 的 11v 接上後能否編過、BTM 框內容是否正確。
3. D3 2.4G 的 Beacon Report 事件在沒開 `WAPP_SUPPORT` 時會不會送出；不會就改讀掃描表的 BcnRept 欄。
4. Beacon Request 的參數：兩顆驅動格式略不同；台灣頻道的 Regulatory Class（81／115／124／125）要對照。
5. 「省電狀態」能不能代表「沒在用」：驅動沒有每台裝置的流量，第一版只能這樣近似。
6. 用 2.4G 估 5G 的 7～10 dB 差距要用實測校正（不同牆、不同手機會不一樣）。
7. 2.4G 開 11v 會改變 beacon 的能力欄位，少數舊 IoT 可能不相容，所以要過夜回歸。
8. 群播能不能穿過 Mesh 或交換器。

## 13. 自適應 11r：不動驅動的做法（2026-11-20 研究）

原本規劃的「自適應 11r」（ROADMAP I14）：beacon 不宣告 FT，只對已知相容的裝置在探測／連線回應帶 FT。這要改驅動，維護困難，所以改找不動驅動的方案。

### 13.1 限制

1. **相容性是在連線前決定的**：11r 是寫在 beacon 的加密資訊（RSN IE 的 FT-PSK）和 MDIE 裡，beacon 是廣播，AP 沒辦法只讓某一台看不到。被動掃描的裝置只看 beacon，所以就算改驅動、只在探測回應帶 FT，也只能照顧到一部分裝置。**以單一裝置為單位的自適應，不動驅動做不到，動了效果也有限。**
2. **混合模式救不了最舊的裝置**：兩顆驅動開 11r 時都是同時宣告 PSK 與 FT-PSK（mt76x2 `common/cmm_wpa.c:3655` 起；mt7915 `embedded/security/cmm_wpa.c:2055` 起），照理舊裝置選 PSK 就好；但驅動太舊、解析不了多個加密方式並列的裝置還是會連不上，只能關 11r 或另開不帶 11r 的 SSID。
3. **出事的樣子是「連不上」**，不是漫遊變差，後果比較嚴重；而且 AP 端不容易分辨是 11r 造成的，還是密碼錯、訊號差。
4. **常見的地雷組合**：11r＋11w（PMF）、11r＋WPA2/WPA3 混合模式。padavan 固定寫 `PMFMFPC=1`（支援 PMF、不強制，`rc/src/ralink.c:693`），開 11r 前要確認這個組合在手邊的舊裝置上沒問題。
5. **設定的單位**：每個頻段一個開關（nvram `rt_HT_80211R`、`wl_HT_80211R`，預設都 0），dat 的 `FtSupport=a;b` 可以分主網路／訪客。改了要重啟該頻段 Wi-Fi（中斷幾秒）。
6. **AP 之間的金鑰交換**：MTK 的 FT 換 AP 時，新 AP 向原 AP 要 PMK-R1，走 `ralinkiappd`（TCP／UDP 3517，`mt76x2/ap/ap_ftkd.c`）。只在跑 MTK 驅動的 padavan 之間有效，跟 Deco、OpenWrt 不通。D3 的 `iappd.sh` 只帶 5G 介面（rai0）。
7. **晶片**：D3 2.4G（MT7603）沒編 11r，5G 有；CR6608 兩個頻段都有。
8. **效益有限**：WPA2-PSK 家用環境，11r 省的是換 AP 時的四次交握，大約幾十到一百多毫秒，主要是視訊、語音通話換 AP 時比較不會頓一下；一般上網幾乎感覺不到。11k／11v（第 6 節的互助漫遊）不需要 11r。

### 13.2 定案：IoT 網路（2026-11-20，使用者提議）

用原本的「訪客網路」那一格（每個頻段的第二個 SSID）當 **IoT 網路**：

- dat 的 `RRMEnable`、`WNMEnable`、`FtSupport` 第二格固定寫 0（`rc/src/ralink.c`），IoT 網路的 beacon 不宣告 11k／v／r；兩顆驅動都是逐個 SSID 讀這些值（mt76x2 `common/ft.c:2929`、`common/rrm.c:119`），驅動不用改
- 名稱預設「家用名稱＋`_IoT`」，2.4G／5G 分別開關（5G 預設不開）、可選兩個頻段同名、密碼預設跟家用網路相同、可選能否連到家裡的裝置（`guest_lan_isolate`）、IoT 裝置之間能否互連（`guest_ap_isolate`）
- 結果：主網路可以放心開 11k／v／r（含 11r），不相容的舊裝置（例如出單機）改連 `_IoT`；**不需要再做自適應 11r**
- 代價：沒有訪客網路了；舊裝置要重新設定連到新名稱；多一組 beacon（很少的空中時間）

### 13.2.1 原本的備案：頻段分工＋偵測到問題自動退回（不做，留作紀錄）

1. **頻段分工**：開 11r 時只開 5G、2.4G 保持關。只有 2.4G 的裝置（大部分 IoT、ESP8266、舊印表機）看不到 5G，完全不受影響；只有 11r 的手機、筆電大多在 5G。現有的 nvram 就做得到（`wl_HT_80211R=1`、`rt_HT_80211R=0`），驅動不用動。
2. **5G 的保護：自動退回**（雙頻但驅動很舊的裝置，例如舊筆電網卡、舊 Android、舊電視盒）
   - watchdog 或 tw-roamd 看到同一台裝置在 5G 短時間內反覆連線失敗、卻能在 2.4G 連上，就判定「這裡有跟 11r 不相容的裝置」。
   - 自動關掉 5G 的 11r（重啟 5G 一次），寫系統記錄，後台顯示「偵測到不相容的裝置，已關閉 5G 快速漫遊」，並列出是哪一台。
   - 只自動關、不自動開：要再開由使用者決定（裝置換掉或更新了）。
   - 這是「以頻段為單位」的自適應，取代原本「以裝置為單位」的設計。
3. **預設仍是關**：只有家裡有兩台以上 padavan-tw AP 時，介面才建議開；只有一台 AP 時 11r 沒有用處。

### 13.3 不採用的做法

| 做法 | 為什麼不用 |
|---|---|
| 驅動依裝置調整 FT（原本的 I14） | 要改閉源驅動的 beacon／探測回應，維護困難；被動掃描的裝置照樣看到 beacon |
| 另開一個 FT 專用 SSID | 使用者要自己選 SSID，違反「同一個名稱到處漫遊」；多一組 beacon 佔空中時間 |
| 同名兩個 BSS（一個有 FT、一個沒有） | 裝置怎麼選不可預測，舊裝置仍可能挑到有 FT 的那個 |

### 13.4 要實機確認

1. MTK 驅動在「因為 11r 連不上」時，看得到什麼：系統記錄、無線事件、MAC 表進出、四次交握逾時？這決定 13.2 第 2 點能不能做、要怎麼判斷。
2. 兩台 padavan-tw 之間 FT 真的成功（`ralinkiappd` 有交換到金鑰、換 AP 時是 FT 而不是完整重新連線）：要等 CR6608。
3. 5G 開、2.4G 關、同一個 SSID 時，手機的換頻段行為有沒有變差。
4. 11r＋`PMFMFPC=1` 在家裡的舊裝置上能不能連。
