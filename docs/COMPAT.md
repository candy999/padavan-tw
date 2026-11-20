# 社群機型相容度預測

> 由 `tools/compat/predict.py` 自動產生（2026-11-20，原始碼 8b141d4）。**只讀設定檔推測，沒有編譯、沒有實機。**
> 用途：想在其他機型用 padavan-tw、或要移植到新機型的人，先知道哪些地方大概沒問題、哪些地方要改或要測。

## 怎麼推測的

社群支援的 56 個設定檔全部是 **MT7621＋Linux 4.4**，跟 Newifi D3、小米 CR6608 同一個平台。台灣版的修改大多跟平台綁在一起（核心、rc、後台），換機型時主要差在四個地方：**Wi-Fi 晶片、記憶體、Flash 大小、網路孔接法**。工具逐台讀上游的機型設定（`configs/templates`、`configs/boards/<機型>/`、裝置樹 dts），再加上台灣版的 `configs/tw/` 覆蓋，用下面的規則比對。

### 台灣版的修改依賴什麼硬體

| 修改 | 依賴 | 在別台的情況 |
|---|---|---|
| 台灣中文介面、台灣預設值、新後台 | 無 | 所有機型相同；沒有 5G 或 USB 的機型，對應卡片會隱藏 |
| 硬體 NAT 殘留標記修正（2.4G 被 STP 誤判） | MT7621 raeth／hw_nat | 所有機型都套用；只在 D3（單一 GMAC）實機驗證 |
| STP 計時 8 秒、Wi-Fi 急速連線、Wi-Fi 迴圈保護 | Wi-Fi 介面名稱 `ra*` | MT7603／7612／7615／7915 的介面都是 `ra` 開頭，都會套用；只在 MT7603＋MT7612 實測 |
| 自動選頻排除 165、2.4G 不選 12／13、掃描頁解析 | 各晶片驅動的 iwpriv 輸出 | MT7615 系列的輸出格式沒有實測 |
| 5G／2.4G 出廠預設值（Greenfield 關、TxBurst 開） | 只在 MT7612／MT7603 實測 | 其他晶片沿用同樣的值，效果沒有驗證 |
| 中華電信 MOD 自動設定 | 內建交換器（mtk_esw）、`RAETH_ESW_PORT_LAN1～4` | 每台都有孔位對照，都會編進去；孔位標錯時會設到別的孔；WAN 走 GMAC2 的機型要實測 |
| 黑潮 DNS | 記憶體、Flash | 快取最多長到約 110 MB：64 MB 放不下、128 MB 會被壓縮；學習資料要有專用分割區（D3）或 NAND 的 RWFS，不然只存在記憶體 |
| 重開機修正（關 `CONFIG_32M_REBOOT_FIXUP`） | 32 MB SPI Flash | 上游只有 NEWIFI3 開了這個選項，其他機型不受影響 |
| 802.11k／v／r | 驅動編譯設定 | MT7615、MT7915 上游已編 k／v／r；MT7603 上游沒編（D3 台灣版自己開了 11k）；MT7612 有 k、r，沒有 v |

### 韌體大小

用這次的實際編譯結果估：含 USB 功能約 **15.97 MB**（D3）、不含約 **13.69 MB**（CR6608）。16 MB SPI 的韌體分割區是 15.93 MB，所以 **16 MB＋USB 的機型差約 48 KB，要關掉一點功能**；16 MB 不含 USB 的大約剩 2.2 MB。Wi-Fi 驅動的大小每顆晶片不同，實際以編譯結果為準。

### 等級

| 等級 | 意思 |
|---|---|
| 預期可用 | 硬體組合跟 D3 相同，沒有發現衝突 |
| 預期可用（有小差異） | 只有低風險的差異（例如 MT7915 未實機、黑潮學習資料重開機要重學） |
| 大致可用，要實測 | 有中風險項目：Wi-Fi 晶片台灣版沒實測、記憶體 128 MB、WAN 走 GMAC2 等 |
| 需要調整才能用 | 有高風險項目：韌體放不下、記憶體太小，要改設定才能用 |
| 不建議 | 關功能也放不下（例如 8 MB Flash） |

## 結果

| 機型 | 預測 | Wi-Fi 晶片 | 記憶體 | Flash | 11k/v/r 編譯 | 主要待確認點 |
|---|---|---|---|---|---|---|
| `360-T6M` | 預期可用（有小差異） | MT7915（DBDC） | 256 MB | NAND | MT7915:kvr | - |
| `360-T6M-PB` | 預期可用（有小差異） | MT7915（DBDC） | 256 MB | NAND | MT7915:kvr | - |
| `B70` | 預期可用（有小差異） | MT7603E＋MT7612E | 256 MB | NAND＋USB | MT7603E:無、MT7612E:kr | - |
| `BELL-A040WQ` | 大致可用，要實測 | MT7615E（DBDC） | 256 MB | NAND＋USB | MT7615E:kvr | MT7615E 未實測 |
| `C-Life-XG1` | 預期可用（有小差異） | MT7915（DBDC） | 256 MB | NAND＋USB | MT7915:kvr | - |
| `CR660x` | 正式維護（每次編譯、未實機） | MT7915（DBDC） | 256 MB | NAND | MT7915:kvr | - |
| `DIR-878` | 大致可用，要實測 | MT7615E＋MT7615E | 128 MB | SPI 16 MB | MT7615E:kvr | 記憶體 128 MB，黑潮快取受限；MT7615E 未實測 |
| `DIR-882` | 需要調整才能用 | MT7615E＋MT7615E | 128 MB | SPI 16 MB＋USB | MT7615E:kvr | 韌體超過分割區 48 KB；記憶體 128 MB，黑潮快取受限；MT7615E 未實測 |
| `EA7500` | 大致可用，要實測 | MT7615E＋MT7615E | 512 MB | NAND＋USB | MT7615E:kvr | MT7615E 未實測 |
| `G-AX1800` | 預期可用（有小差異） | MT7915（DBDC） | 256 MB | NAND | MT7915:kvr | - |
| `G-AX1800-B` | 預期可用（有小差異） | MT7915（DBDC） | 256 MB | NAND | MT7915:kvr | - |
| `GHL` | 預期可用（有小差異） | MT7603E＋MT7612E | ? MB | SPI 32 MB＋USB | MT7603E:無、MT7612E:kr | - |
| `HAR-20S2U1` | 預期可用（有小差異） | MT7915（DBDC） | 256 MB | NAND | MT7915:kvr | - |
| `JCG-836PRO` | 需要調整才能用 | MT7615E（DBDC） | 256 MB | SPI 16 MB＋USB | MT7615E:kvr | 韌體超過分割區 48 KB；MT7615E 未實測 |
| `JCG-AC860M` | 需要調整才能用 | MT7615E＋MT7615E | 256 MB | SPI 16 MB＋USB | MT7615E:kvr | 韌體超過分割區 48 KB；MT7615E 未實測 |
| `JCG-Q10Pro` | 預期可用（有小差異） | MT7915（DBDC） | 256 MB | NAND | MT7915:kvr | - |
| `JCG-Q10Pro-PB` | 預期可用（有小差異） | MT7915（DBDC） | 256 MB | NAND | MT7915:kvr | - |
| `JCG-Q11Pro` | 預期可用（有小差異） | MT7915（DBDC） | 256 MB | NAND | MT7915:kvr | - |
| `JCG-Q20` | 預期可用（有小差異） | MT7915（DBDC） | 256 MB | NAND | MT7915:kvr | - |
| `JCG-Q20-PB` | 預期可用（有小差異） | MT7915（DBDC） | 256 MB | NAND | MT7915:kvr | - |
| `JCG-Y2` | 需要調整才能用 | MT7615E（DBDC） | 256 MB | SPI 16 MB＋USB | MT7615E:kvr | 韌體超過分割區 48 KB；MT7615E 未實測 |
| `JDCLOUD-RE-CP-02` | 預期可用（有小差異） | MT7915（DBDC） | 512 MB | SPI（自訂分割） | MT7915:kvr | - |
| `JDCLOUD-RE-SP-01B` | 大致可用，要實測 | MT7603E＋MT7615E | 512 MB | SPI（自訂分割）＋USB | MT7603E:無、MT7615E:kvr | MT7615E 未實測 |
| `K2P` | 大致可用，要實測 | MT7615E（DBDC） | 128 MB | SPI 16 MB | MT7615E:kvr | 記憶體 128 MB，黑潮快取受限；MT7615E 未實測 |
| `K2P-NANO` | 大致可用，要實測 | MT7615E（DBDC） | 128 MB | SPI 16 MB | MT7615E:kvr | 記憶體 128 MB，黑潮快取受限；MT7615E 未實測 |
| `K2P-USB` | 大致可用，要實測 | MT7615E（DBDC） | 256 MB | SPI 32 MB＋USB | MT7615E:kvr | MT7615E 未實測 |
| `KOMI-A8` | 預期可用（有小差異） | MT7915（DBDC） | 256 MB | NAND | MT7915:kvr | - |
| `MI-4` | 大致可用，要實測 | MT7603E＋MT7612E | 128 MB | NAND | MT7603E:無、MT7612E:kr | 記憶體 128 MB，黑潮快取受限 |
| `MI-R3G` | 預期可用 | MT7603E＋MT7612E | 256 MB | NAND＋USB | MT7603E:無、MT7612E:kr | - |
| `MI-R3P` | 大致可用，要實測 | MT7615E＋MT7615E | 512 MB | NAND＋USB | MT7615E:kvr | MT7615E 未實測 |
| `MI-R3P-PB` | 大致可用，要實測 | MT7615E＋MT7615E | 512 MB | NAND＋USB | MT7615E:kvr | MT7615E 未實測 |
| `MI-R3P-SPI` | 大致可用，要實測 | MT7615E＋MT7615E | 512 MB | SPI 32 MB＋USB | MT7615E:kvr | MT7615E 未實測 |
| `MI-R4A` | 大致可用，要實測 | MT7603E＋MT7612E | 128 MB | SPI 16 MB | MT7603E:無、MT7612E:kr | 記憶體 128 MB，黑潮快取受限 |
| `MR2600` | 需要調整才能用 | MT7615E＋MT7615E | 128 MB | SPI 16 MB＋USB | MT7615E:kvr | 韌體超過分割區 48 KB；記憶體 128 MB，黑潮快取受限；MT7615E 未實測 |
| `MSG1500` | 大致可用，要實測 | MT7615E（DBDC） | 256 MB | NAND＋USB | MT7615E:kvr | MT7615E 未實測 |
| `MSG1500-Z` | 需要調整才能用 | MT7603E＋MT7612E | 64 MB | SPI 16 MB＋USB | MT7603E:無、MT7612E:無 | 韌體超過分割區 48 KB；記憶體 64 MB，要關黑潮 DNS |
| `NETGEAR-BZV` | 大致可用，要實測 | MT7615E＋MT7615E | 256 MB | NAND＋USB | MT7615E:kvr | MT7615E 未實測 |
| `NETGEAR-R6800` | 大致可用，要實測 | MT7615E＋MT7615E | 256 MB | NAND＋USB | MT7615E:kvr | MT7615E 未實測 |
| `NETGEAR-R7450` | 大致可用，要實測 | MT7615E＋MT7615E | 256 MB | NAND＋USB | MT7615E:kvr | MT7615E 未實測；WAN 走 GMAC2，MOD 要實測 |
| `NEWIFI` | 預期可用（有小差異） | MT7603E＋MT7612E | ? MB | SPI 32 MB＋USB | MT7603E:無、MT7612E:kr | - |
| `NEWIFI3` | 正式維護（D3 實機驗證） | MT7603E＋MT7612E | 512 MB | SPI 32 MB＋USB | MT7603E:k、MT7612E:kr | - |
| `QM-B1` | 大致可用，要實測 | MT7602E＋MT7612E | 512 MB | SPI（自訂分割）＋USB | MT7602E:kr、MT7612E:kr | Flash 剩不到 1 MB；MT7602E 未實測 |
| `R2100` | 大致可用，要實測 | MT7603E＋MT7615E | 128 MB | NAND | MT7603E:無、MT7615E:kvr | 記憶體 128 MB，黑潮快取受限；MT7615E 未實測 |
| `RM2100` | 大致可用，要實測 | MT7603E＋MT7615E | 128 MB | NAND | MT7603E:無、MT7615E:kvr | 記憶體 128 MB，黑潮快取受限；MT7615E 未實測 |
| `RT-AC85P` | 大致可用，要實測 | MT7615E＋MT7615E | 256 MB | NAND＋USB | MT7615E:kvr | MT7615E 未實測 |
| `SIM-AX1800T` | 預期可用（有小差異） | MT7915（DBDC） | 256 MB | NAND | MT7915:kvr | - |
| `TX1801` | 預期可用（有小差異） | MT7915（DBDC） | 512 MB | NAND | MT7915:kvr | - |
| `WDR8620` | 需要調整才能用 | MT7615E＋MT7615E | 128 MB | SPI 16 MB＋USB | MT7615E:kvr | 韌體超過分割區 48 KB；記憶體 128 MB，黑潮快取受限；MT7615E 未實測；WAN 走 GMAC2，MOD 要實測 |
| `WE410443-TC` | 不建議 | MT7615E＋MT7615E | 128 MB | SPI（自訂分割） | MT7615E:kvr | Flash 太小；記憶體 128 MB，黑潮快取受限；MT7615E 未實測 |
| `WIA3300-10` | 大致可用，要實測 | MT7615E（DBDC） | 256 MB | SPI 32 MB＋USB | MT7615E:kvr | MT7615E 未實測 |
| `WR1200JS` | 預期可用（有小差異） | MT7603E＋MT7612E | ? MB | SPI 16 MB | MT7603E:無、MT7612E:kr | - |
| `WRL18M4GD` | 預期可用（有小差異） | MT7915（DBDC） | 256 MB | NAND | MT7915:kvr | - |
| `XY-C1` | 大致可用，要實測 | - | 512 MB | SPI（自訂分割）＋USB | - | Wi-Fi 晶片不明 |
| `ZTE-E8820S` | 預期可用 | MT7603E＋MT7612E | 256 MB | NAND＋USB | MT7603E:無、MT7612E:kr | - |
| `ZTE-E8820V2` | 需要調整才能用 | MT7603E＋MT7612E | 64 MB | SPI 16 MB＋USB | MT7603E:無、MT7612E:kr | 韌體超過分割區 48 KB；記憶體 64 MB，要關黑潮 DNS |
| `ZTT-RX6000` | 預期可用（有小差異） | MT7915（DBDC） | 256 MB | NAND | MT7915:kvr | - |

`11k/v/r 編譯`：各晶片驅動在台灣版設定下有沒有編進 802.11k、v、r（`無`＝都沒有）。這只代表設定開關，實際效果見 [ROAM-COOP.md](ROAM-COOP.md) 第 8 節。

## 常見衝突怎麼改

在 `trunk/configs/tw/<編譯名稱>.config` 加設定（新增檔案即可，會覆蓋共用設定），再用 GitHub Actions 編一次。

| 狀況 | 怎麼改 |
|---|---|
| 韌體超過分割區（16 MB＋USB） | 關掉用不到的 USB 功能，例如 `CONFIG_FIRMWARE_INCLUDE_SMBD=n`、`CONFIG_FIRMWARE_INCLUDE_FTPD=n`、`CONFIG_FIRMWARE_INCLUDE_NTFS_3G=n`；或 `CONFIG_FIRMWARE_INCLUDE_OPENVPN=n`。編完確認 `.trx` 小於分割區 |
| 記憶體 64 MB | `CONFIG_FIRMWARE_INCLUDE_KUROSHIO=n`，DNS 回到 dnsmasq＋業者 DNS |
| 記憶體 128 MB | 可以先照常用；大量查詢時注意系統記錄裡黑潮讓出快取的訊息 |
| 上游開了 `CONFIG_32M_REBOOT_FIXUP` | `CONFIG_32M_REBOOT_FIXUP=n`，並實測後台重開機、SSH `reboot` |
| WAN 走 GMAC2 | 一般上網不受影響；接 MOD 前實測：直播有沒有畫面、群播有沒有灌到其他 LAN 孔 |

選項名稱以 `trunk/configs/templates/<機型>.config` 裡實際出現的為準。

## 移植後要實測的項目

1. 有線：LAN、WAN 都通，硬體 NAT 有作用（`cat /proc/mt7621/esw_cnt` 或測速）
2. 重開機：後台重開、SSH `reboot`、韌體更新後會自己開回來
3. Wi-Fi：兩個頻段都連得上；Wi-Fi 重啟後裝置馬上拿到 IP；掃描頁有資料；診斷頁「Wi-Fi 迴圈保護」的計數正常
4. MOD（有的話）：機上盒接到某個 LAN 孔，系統記錄寫出的孔號跟實際一樣；直播有畫面
5. 黑潮 DNS：`/usr/bin/kuroshio.sh status` 是執行中；放一天看記憶體

結果歡迎開 Issue 回報，確認可用的機型會更新到 README。

## 重新產生

```bash
python tools/compat/predict.py > docs/COMPAT.body.md   # 全部機型的表格
python tools/compat/predict.py K2P MI-R4A              # 指定機型，附每一項的細節
python tools/compat/predict.py --json                  # 給其他程式用
```

改了台灣版跟硬體有關的程式（Wi-Fi、交換器、Flash、記憶體用量）時，記得一起更新工具裡的規則和這份文件。
