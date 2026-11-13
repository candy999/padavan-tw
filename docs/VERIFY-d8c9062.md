# 驗證交接單：d8c9062（D3 重開機、黑潮資料區、Wi-Fi 掃描）

> 寫給：本機工作階段（可以連路由器）。雲端工作階段同時在做黑潮 DNS 3.1.0 升級，**請分頭進行**：
> - 本機只做驗證與回報，**不要修改後端程式**（`trunk/user/rc`、`httpd/src`、`kuroshio`、`configs`）；發現問題就把結果寫進第 6 節，雲端會修
> - 一律用繁體中文（台灣用語）
> - 開工前 `git pull`；只改 `docs/` 的提交不會觸發編譯

---

## 1. 這版修了什麼

| # | 問題 | 原因 | 修法 |
|---|---|---|---|
| 1 | D3 無法重開機（後台按了沒反應；SSH `reboot` 停在服務關掉之後，要拔電源） | 上游 NEWIFI3 開了「32 MB 重開機修正」，執行 `mtd_write -r unlock mtd1`；4.4 的 `mtd_write` 依**分割區名稱**找裝置，沒有叫 mtd1 的分割區 → 結束、不重開 | `configs/tw/NEWIFI3.config` 關掉 `CONFIG_32M_REBOOT_FIXUP`，走一般流程：init 停服務、存設定 → 核心重開機；核心的 Flash 驅動關機時會把 Flash 切回 3-byte 模式並重置 |
| 2 | 黑潮 DNS「資料區跟其他分割區重疊」、學習資料放記憶體、每次開機 CPU 滿載幾十分鐘 | 誤判：`kuroshio.sh` 用 `find /proc/device-tree` 讀分割表，但那是捷徑，busybox `find` 不跟進 → 一個分割區都沒讀到 | 路徑改成 `/proc/device-tree/`；「讀不到分割表」與「真的重疊」分開顯示；黑潮 DNS 改用 `nice -n 10` |
| 3 | Wi-Fi 鄰近 AP 掃描錯位（JS 字串含換行） | 替 MT7603 開了 802.11k，驅動掃描表多一欄「BcnRept」，表頭與資料列欄寬不同 | `httpd/src/ralink.c` 改成逐行解析、欄位位置從表頭找；輸出格式不變 |
| 4 | `device-map/clients.asp` 表頭少一格 | colspan 5，表格 6 欄 | 改成 6 |

---

## 2. 韌體

- 編譯：<https://github.com/candy999/padavan-tw/actions/runs/43423523090>（成功）
- 下載 Artifact：**`padavan-tw-NEWIFI3-20261113-d8c9062`**（不要用 `-oc1000`）
- 刷機方式（**由使用者操作**，AI 不代為刷機）：
  - **建議用 Breed**：拔電 → 按住 Reset 插電 → 瀏覽器開 Breed（通常 `http://192.168.1.1`）→ 韌體更新 → 選 `.trx`。**不要清除 Config**（這次要順便確認設定保留）
  - 用後台「韌體更新」也可以，但舊韌體的重開機有問題：寫入完成後如果 3 分鐘沒有回來，拔電源重插即可（寫入本身會完成）
- 刷完確認版本：
  ```bash
  nvram get firmver_sub
  ```
  應該包含 `d8c9062`

---

## 3. 驗證項目

每一項記下：**通過／失敗**、實際輸出（貼原文）、發生時間。

### 3.1 重開機（最重要）
| 步驟 | 預期 |
|---|---|
| A. 後台按「重新開機」（新介面與原始頁面各一次） | 約 1～2 分鐘後後台重新可用；不需要拔電 |
| B. SSH 執行 `reboot` | 同上 |
| C. 重開前先改一個無害設定（例如燈號），重開後確認還在 | 設定保留（代表關機前有存設定） |

- 每次重開後執行：
  ```bash
  uptime; head -5 /tmp/syslog.log
  ```
- **如果卡住**：等 3 分鐘，仍沒回來就拔電重插，記下卡住前最後看到的狀態（網路線燈號、能不能 ping 到 192.168.2.1）

### 3.2 黑潮 DNS 資料區
第一次開機時會清除 mtd9 舊資料（系統記錄有「第一次使用黑潮 DNS 資料區：清除舊資料」，約 1 分鐘），之後掛載。

```bash
/usr/bin/kuroshio.sh status
cat /tmp/kuroshio/mode; cat /tmp/kuroshio/area_note 2>/dev/null
grep kuroshio /proc/mounts
ls -la /media/kuroshio/kuroshio/state 2>/dev/null | head
grep '黑潮' /tmp/syslog.log | tail -20
```
預期：
- `mode` 是 `jffs2`；**沒有** `area_note`（或內容不是「重疊」「讀不到分割區表」）
- `/proc/mounts` 有 `/dev/mtdblock9 /media/kuroshio jffs2`
- `status` 顯示「學習資料：Flash（黑潮 DNS 資料區，/media/kuroshio）」

如果還是 `ram`，請附上：
```bash
for f in $(find /proc/device-tree/ -name label); do case "$f" in */partition@*) echo "$f: $(tr -d '\000' < $f)";; esac; done
cat /proc/mtd
```

### 3.3 黑潮 DNS 的 CPU 與記憶體
1. **第一次開機**（資料區是空的）：背景工作照樣會跑，記錄開始與結束時間：
   ```bash
   top -b -n 1 | head -15
   cat /media/kuroshio/kuroshio/state/jobs.json 2>/dev/null | head -50
   ```
   - `top` 的 NI 欄位，kuroshio 應該是 `10`（降低優先權）
2. 背景工作跑完、CPU 降下來之後，記錄記憶體：
   ```bash
   grep -E 'VmRSS|VmHWM' /proc/$(pidof kuroshio)/status
   ```
3. **再重開機一次**，開機後 10 分鐘內看 `top`：
   - 預期：**不會**再跑 cdn-pool／cdn-scan／dns-benchmark（`jobs.json` 的上次成功時間還在），CPU 很快回到閒置
   - 同樣記錄 `VmRSS`／`VmHWM`

這些數字會回報給黑潮 DNS 專案（MIPS 實機記憶體，跟 Lite 版的可行性有關）。

### 3.4 Wi-Fi 鄰近 AP 掃描
- 新 Wi-Fi 頁的鄰近 AP 清單；原始頁面「無線 2.4GHz／5GHz → WDS」的掃描
- 也可以直接看原始輸出（要先登入後台，用瀏覽器開）：`http://192.168.2.1/wds_aplist_2g.asp`、`http://192.168.2.1/wds_aplist.asp`
- 預期：每筆是 `["SSID","BSSID","頻道","訊號"]`，**沒有換行、BSSID 都是 `xx:xx:xx:xx:xx:xx`**，訊號只有數字；中文 SSID 正常（經過編碼）
- 掃描會讓 Wi-Fi 短暫變慢約 5 秒，屬正常
- 新 Wi-Fi 頁裡「偵測到掃描壞掉就顯示需要更新韌體」的判斷，確認後可以拿掉或保留給舊韌體（前端的事，本機自己決定）

### 3.5 裝置清單表頭
- 原始「網路地圖」的裝置清單（`device-map/clients.asp`）：「已連線裝置」「已封鎖裝置」標題橫跨整個表格

### 3.6 回歸檢查（確認沒有弄壞別的）
- 有線：4 個 LAN 口都拿得到 IP；WAN 正常上網
- Wi-Fi：2.4G／5G 都能連
- 黑潮 DNS：`nslookup www.google.com 192.168.2.1` 正常；後台 DNS 頁狀態正常
- 後台登入、套用設定正常

---

## 4. 不要做的事
- 不要清除 Breed 的 Config、不要恢復原廠設定（除非使用者要求）
- 不要改後端程式；需要修就寫進第 6 節
- 輸入密碼的動作（管理密碼、Wi-Fi／PPPoE 密碼）由使用者自己做

---

## 5. 回報方式
1. 把結果填進第 6 節（每項：通過／失敗、原始輸出摘要）
2. `git pull` 後提交：`docs: d8c9062 實機驗證結果`
3. 同時把同樣的摘要給使用者，使用者會轉給雲端工作階段

---

## 6. 驗證結果（本機填寫）

| 項目 | 結果 | 備註／輸出 |
|---|---|---|
| 版本含 d8c9062 | ✅ 通過 | `nvram get firmver_sub` → `4.4.198.9-100_d8c9062`（使用者用後台韌體更新刷入，設定保留，SSH 金鑰還在）。黑潮 DNS 是 `kuroshio 3.0.1` |
| 3.1 A 後台重開機 | ✅ 通過 | 新介面「重開機」20:40:52 送出：+9 秒斷線、+44 秒 ping 回來、+51 秒 SSH 可登入。原始頁面頂部列按鈕 20:42:21 送出：+14 秒斷線、+67 秒 ping 回來。都不用拔電；syslog 第一行 `firmware version: 4.4.198.9-100_d8c9062` |
| 3.1 B SSH reboot | ✅ 通過 | 20:43:5x `reboot`：+18 秒斷線、+53 秒 ping 回來、+60 秒 SSH 可登入（之前會停住要拔電） |
| 3.1 C 設定保留 | ✅ 通過 | 重開前用新介面關燈號（`front_led_all=0`），三次重開後都還是 0 |
| 3.2 資料區 jffs2 掛載 | ❌ **失敗** | `mode` 是 `ram`；**沒有** `area_note`；`/proc/mounts` 沒有 kuroshio；`status`：「學習資料：記憶體（每天 04:41 備份到 /etc/storage）」。分割區表讀得到（device-tree 9 個 label，含 `partition@1800000/label: Kuroshio`），所以重疊判斷已經正確。**原因**：`prepare_jffs2` 用 `blk_erased` 只檢查第一個 64 KB（全是 FF）就跳過抹除，但 mtd9 在 `0x600000` 還有舊資料（`BZh91AY&SY…`），核心：`jffs2_scan_eraseblock(): Magic bitmask 0x1985 not found at 0x0060000c` … `Cowardly refusing to erase blocks on filesystem with no valid JFFS2 nodes`、`empty_blocks 119, bad_blocks 0, c->nr_blocks 120`；手動 `mount -t jffs2 -o ro /dev/mtdblock9` → `I/O error`。腳本把 mount 的錯誤丟掉（`2>/dev/null`），所以沒有留下任何提示就退回 ram。**建議**：判斷「空白」要檢查整個分割區（或開頭不是 JFFS2 就一律 `mtd_write erase`），mount 失敗要寫 `area_note` 與 syslog |
| 3.3 第一次開機背景工作（時間、NI） | ✅ NI／⚠️ 時間 | `top`：`1108 1105 admin S N … /usr/bin/kuroshio run --uci`，`/proc/<pid>/stat` 第 19 欄 nice=10；全機 `22.9% nic 70.8% idle`（之前是 100% usr、0% idle）。因為是 ram 模式＋開機時「已匯入學習資料備份」，第一次開機**沒有**重跑 cdn-scan／dns-benchmark，只有 cdn-pool 在 20:32:49 開始（原因「azure 節點不足」，syslog：`Azure Front Door / CDN IPv6 可用台灣節點只剩 2 個，排入節點池重建`），開機 7 分鐘時 CPU 已降到 0～13% |
| 3.3 記憶體（工作中／閒置） | ✅ | 開機 6 分鐘（cdn-pool 中）：VmRSS 27,036 kB、VmHWM 29,080 kB；開機 1～2 分鐘：VmRSS 25,540～27,064 kB、VmHWM 27,828～28,184 kB（舊版 3.0 開機 40 分鐘時 RSS 78～80 MB） |
| 3.3 第二次開機不重跑 | ⚠️ 部分 | SSH 重開後（20:44:30 開機）觀察 10 分鐘，每分鐘取樣：**cdn-scan、dns-benchmark 沒有重跑**；但 **cdn-pool 每次開機都重跑**：20:45:27 開始（`jobs.json` 只有 `lastStart`、沒有 `lastEnd`，原因「azure 節點不足」），syslog 20:45:27 與 20:51:44 各一次 `WARN Azure Front Door / CDN IPv6 可用台灣節點只剩 2 個，排入節點池重建`——兩次開機都沒看到 cdn-pool 完成，看起來是一直重排，不是資料遺失。CPU（佔全機）：開機 1～6 分鐘 22～27%，之後 1～5%。記憶體：VmRSS 25,540 → 32,188 kB，VmHWM 28,184 → 39,592 kB（開機 7～8 分鐘時跳升）。目前 ram 模式下開機會「已匯入學習資料備份」（/etc/storage/kuroshio/backup.kuroshio，301 KB）。建議雲端確認：Azure IPv6 台灣節點只有 2 個時是否該停止重建，或 cdn-pool 是否有完成條件 |
| 3.4 Wi-Fi 掃描 2.4G | ✅ 通過 | `wds_aplist_2g.asp`：約 5 秒、10 筆、沒有換行、BSSID 全是 MAC、頻道與訊號全是數字；逐筆對照 `iwpriv ra0 get_site_survey` 原始表（含 BcnRept 欄）一致（訊號 100 的幾筆是同一台鄰近路由器的多個 SSID，原始表也是 100） |
| 3.4 Wi-Fi 掃描 5G | ✅ 通過 | `wds_aplist.asp`：約 5 秒、8 筆、格式正確，頻道 36、44、153 |
| 3.5 裝置清單表頭 | ✅ 通過 | `Clients_table`、`xClients_table` 的標題都是 colspan=6、表格 6 欄；網路地圖畫面上表頭橫跨整個表格 |
| 3.6 回歸檢查 | ✅ 通過（部分待使用者） | WAN：預設路由 10.0.0.1、ping HiNet 3 ms；DNS：路由器上 `nslookup www.google.com 192.168.2.1` 正常、電腦經路由器解析 www.google.com、www.cht.com.tw 正常，`/tmp/kuroshio/use`=kuroshio；Wi-Fi：ra0、rai0 都在廣播；有線：這台電腦拿到 192.168.2.233；後台登入與套用（燈號開關）正常。**4 個 LAN 孔逐一接線、手機實際連 2.4G／5G 需要使用者測** |

### 6.1 其他發現（前端，本機已處理）
- 新介面的重開機對話框寫「開機完成後會自動重新載入」，但 Padavan 的進度條只會在時間到時收起遮罩，不會重新載入 → 改成等路由器斷線又回來才重新載入（`tw_ui.js` `waitRouterBack()`）。實機（記憶體副本）測試：20:55:31 送出、路由器約 20:56:13 回來、頁面 20:56:23 自動重新載入
- 測試結束後設定已還原：跟測試前的 nvram 備份逐鍵比對，只差執行期的 `ntp_ready`
- 韌體更新、設定還原、套用中的進度框跑到畫面最上面壓住頂部列（框架把 `.container-fluid` 的 margin 歸零）→ 改成固定蓋住整個畫面、框置中（`tw.css`）
- 新 Wi-Fi 頁的「掃描壞掉就顯示需要更新韌體」判斷保留給舊韌體；新韌體的輸出會通過判斷，正常畫出鄰近 AP
