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
| 版本含 d8c9062 | | |
| 3.1 A 後台重開機 | | |
| 3.1 B SSH reboot | | |
| 3.1 C 設定保留 | | |
| 3.2 資料區 jffs2 掛載 | | |
| 3.3 第一次開機背景工作（時間、NI） | | |
| 3.3 記憶體（工作中／閒置） | | |
| 3.3 第二次開機不重跑 | | |
| 3.4 Wi-Fi 掃描 2.4G | | |
| 3.4 Wi-Fi 掃描 5G | | |
| 3.5 裝置清單表頭 | | |
| 3.6 回歸檢查 | | |
