# 3.4 版「KVR」做法調查（CleanPadavan-Newifi3、vb1980/Padavan-KVR）

> 2026-11-17。使用者問：別人的 Newifi D3 3.4 版標榜「注入 KVR 漫遊補丁、極致穩定、訊號優異」，能不能把它的做法收集起來。
> 結論：**對 D3 來說，那些 3.4 版其實沒有 KVR**；padavan-tw 的 4.4 在 D3 上的 802.11k/v/r 反而比較完整。

## 1. 調查對象

| 專案 | 核心 | 最後更新 | 說明 |
|---|---|---|---|
| Biaogo94/CleanPadavan-Newifi3 | 3.4／4.4 | 2025-11-29 | 只有 GitHub Actions 腳本，自己不放原始碼。3.4 = hanwckf/rt-n56u＋「注入 vb1980 KVR」；4.4 = MeIsReallyBa/padavan-4.4（用 `NEWIFI` 機型設定編） |
| hanwckf/rt-n56u | 3.4.113 | 2021-06-14（23387b2） | 使用者在 D3 上實測過的 `3.4.3.9-099_23387b2` 就是這一版 |
| vb1980/Padavan-KVR | 3.4.113 | 2024-02-08 | 「基於 hanwckf、chongshengB、padavanonly 整合，支援 7603/7615/7915 的 KVR」；使用者舊的 candy999/Padavan 就是從這裡來的 |

## 2. CleanPadavan 的「KVR 注入」實際做了什麼
它的 `.github/workflows/build-Gemini.yml`（3.4 分支）：
1. clone vb1980/Padavan-KVR 到暫存目錄
2. `find $KVR_TEMP -type d -name "mt7603e*"`、`-name "mt7612e*"`，找到就整個覆蓋 hanwckf 的 `trunk/proprietary/rt_wifi/mt7603e`、`mt7612e`
3. `.config` 改 `CONFIG_FIRMWARE_WIFI2_DRIVER=5.0`、`CONFIG_FIRMWARE_WIFI5_DRIVER=3.0`，加上 `CONFIG_FIRMWARE_INCLUDE_WIFI_KVR=y`

**但這三步對 D3 都沒有作用**（2026-11-17 用原始碼確認）：
- vb1980 與 hanwckf 都**沒有**叫 `mt7603e*`、`mt7612e*` 的資料夾。驅動實際在 `trunk/proprietary/rt_wifi/rtpci/4.1.X.X/mt76x3`（MT7603）與 `rtpci/3.0.X.X/mt76x2`（MT7612），所以 `find` 找不到、什麼都沒換
- hanwckf 的設定系統裡沒有 `CONFIG_FIRMWARE_INCLUDE_WIFI_KVR` 這個選項（整個原始碼只有 MT7915 的 `kvr_def.h` 提到 kvr）
- hanwckf 的 `rtpci` 只有 `5.0.5.1/mt7615_ap`，沒有給 MT7603 的 5.0 版驅動

→ 使用者刷的 CleanPadavan 3.4 等於**原樣的 hanwckf 2021 年最後一版**。

## 3. vb1980 的 KVR 對 D3 也沒有開
vb1980 `trunk/configs/boards/NEWIFI3/kernel-3.4.x.config`：
```
# CONFIG_MT7603E_DOT11R_FT_SUPPORT is not set
# CONFIG_MT7603E_DOT11K_RRM_SUPPORT is not set
# CONFIG_MT7603E_WNM_SUPPORT is not set
# CONFIG_RT_DOT11R_FT is not set
# CONFIG_RT_DOT11K_RRM is not set
```
- MT7603（2.4G）、MT7612（5G）的 11k、11v、11r 在**驅動編譯時就是關的**
- 後台寫進驅動設定檔的 `RRMEnable`／`WNMEnable`／`FtSupport` 因此不會有作用；而且 `rc/ralink.c` 的 `FtSupport=%d;%d` 少一個參數（padavan-tw 早期修過同一個 bug）
- vb1980 README 的「支援 7603/7615/7915 的 KVR」：實際有效的是 MT7615（padavanonly 的 5.0.4.0 驅動）與 MT7915；README 也寫明「對 7612 無線的支援已知是有問題的」

## 4. padavan-tw（4.4）在 D3 上的狀況
| 項目 | padavan-tw | vb1980／hanwckf 3.4 |
|---|---|---|
| 5G（MT7612）11k | ✅ `CONFIG_RT_DOT11K_RRM=y`（上游就有） | ❌ |
| 5G（MT7612）11r | ✅ `CONFIG_RT_DOT11R_FT=y`（上游就有；預設關，相容性考量） | ❌ |
| 2.4G（MT7603）11k | ✅ `configs/tw/kernel-NEWIFI3.config` 自己開的（`CONFIG_MT7603E_DOT11K_RRM_SUPPORT=y`） | ❌ |
| 11v | ❌（維護者決定列入長遠計畫） | ❌ |
| 後台開關寫入驅動設定 | ✅ 修過 `WNMEnable`／`RRMEnable` 被前面寫 0 蓋掉、`FtSupport` 少參數 | ❌（有同樣的 bug） |
| 驅動版本 | MT7603 4.1.2.0_20190222、MT7612 3.0.5.0 | 相同版本 |

**「3.4 訊號比較好」**：兩邊的 Wi-Fi 驅動是同一版，差別在核心介面與周邊修改；沒有找到可驗證的數據。如果要比，請在同一個位置、同樣的頻道與功率，用同一台手機量 RSSI 與速度，兩版各量一次。

## 5. 可以借鏡、但目前不需要做的
- 如果將來要做 MI-MINI（只有 3.4）的精簡版：3.4 的 KVR 要自己在驅動設定打開（上面那幾個 `CONFIG_*`），並修 `ralink.c` 的同樣兩個 bug；MI-MINI 的 2.4G 是 MT7620 內建（rt2860v2 驅動），11k/v/r 支援要另外查
- CleanPadavan 的「依核心版本分流」Actions 寫法（一份腳本選 3.4／4.4、各自的 Release 標籤）可以參考，但 padavan-tw 只維護 4.4

## 6. 2026-11-18 補充確認
- vb1980 的 `trunk/build_firmware(_modify)` 完全沒有處理 `CONFIG_FIRMWARE_INCLUDE_WIFI_KVR`：這個選項設了也沒有作用，KVR 只看核心設定
- vb1980/padavan-4.4（2025-09）的 NEWIFI3：MT7603 的 11k／11r／11v 一樣全關；MT7612 的 11k、11r 開（跟 padavan-tw 相同）。README 寫明 D3 要拆 C48 電容 WAN 才會通（雙 GMAC）
- vb1980/padavan-4.4 的 CR660x 核心設定與 padavan-tw 相同（11k、11r、11v 開，KVRH 關）
- 結論不變：沒有哪個分支在 D3 上有更完整的 KVR；維護者決定 D3 2.4G 不開 11v／11r（主要給 IoT 裝置）
