# 驗證交接單：764938b（黑潮 DNS 3.1.0、D3 資料區修正、管理 API 轉接）

> 寫給：本機工作階段。一律用繁體中文（台灣用語）。開工前 `git pull`。
> 順序：**先做本文件的驗證（第 3 節）→ 全部通過後再做黑潮 LuCI 介面移植（`docs/HANDOFF-UI.md` 第 13 節）**。
> 驗證階段只改 `docs/`；移植階段只改前端（`trunk/user/www`、`tools/ui-preview`、`docs`）。後端有問題寫進第 5 節，由雲端修。

---

## 1. 這版包含什麼

| 項目 | commit | 說明 |
|---|---|---|
| d8c9062 的四項修正 | d8c9062 | 重開機、分割表讀取、Wi-Fi 掃描、裝置清單表頭（已驗證通過，見 `docs/VERIFY-d8c9062.md`） |
| 黑潮 DNS 3.1.0 | 5953005 | 官方 Linux 通用包（執行檔＋同版 `data/`） |
| 3.1.0 整合介面 | b07cbb0 | 保護程式改用 `kuroshio health`；WAN 上線時 `notify wan-changed`；後台用的 `/kuroshio_api.cgi` |
| **D3 資料區掛載修正** | 764938b | 上次驗證 3.2 失敗：mtd9 開頭是空的但後面有舊資料，核心拒絕掛載，錯誤又被丟掉。改成「先掛載 → 失敗就清除重建 → 再失敗就寫 area_note 與 syslog」 |

---

## 2. 韌體

- 編譯：GitHub Actions，分支 `claude/zealous-feynman-bhwrbf`、commit `764938b` 的那一次（<https://github.com/candy999/padavan-tw/actions>）
- Artifact：**`padavan-tw-NEWIFI3-20261113-764938b`**（不要用 `-oc1000`）
- 刷機由使用者操作。這版重開機已經正常，可以用後台「韌體更新」，也可以用 Breed；**不要清除 Config**
- 刷完確認：
  ```bash
  nvram get firmver_sub; /usr/bin/kuroshio --version
  ```
  分別包含 `764938b` 與 `3.1.0`

---

## 3. 驗證項目

### 3.1 D3 黑潮資料區（上次失敗的項目）
第一次開機會因為 mtd9 裡的舊資料掛載失敗 → 自動清除 → 重新掛載（約 1 分鐘）。

```bash
grep '黑潮' /tmp/syslog.log | head -20
cat /tmp/kuroshio/mode; cat /tmp/kuroshio/area_note 2>/dev/null
grep kuroshio /proc/mounts
ls -la /media/kuroshio/kuroshio/state 2>/dev/null | head
dmesg | grep -i jffs2 | tail -5
```
預期：
- syslog 有「黑潮 DNS 資料區無法掛載（…），清除後重新建立」與「黑潮 DNS 資料區已重新建立」（只有第一次開機）
- `mode` 是 `jffs2`，沒有 `area_note`
- `/proc/mounts` 有 `/dev/mtdblock9 /media/kuroshio jffs2`
- 等背景工作跑完（或執行 `/usr/bin/kuroshio.sh flush` 立即寫出），`state` 目錄有檔案
- **重開機後**：不再出現「清除後重新建立」、`state` 目錄的檔案還在、cdn-scan／dns-benchmark 不重跑

如果失敗，`area_note` 與 syslog 會寫出原因（mount／mtd_write 的錯誤訊息），請整段貼上。

### 3.2 黑潮 DNS 3.1.0
```bash
/usr/bin/kuroshio health --uci; echo "health=$?"
/usr/bin/kuroshio status --uci --json
```
預期：
- `health=0`
- `status --json` 的 `version` 是 `3.1.0`、`data.ok` 是 `true`、`storage.class` 是 `flash`、`clock.synced` 是 `true`（開機剛完成、還沒對時時可能是 `false`，幾分鐘後再看）、`warnings` 是 `[]`
- 保護程式：`kill -STOP $(pidof kuroshio)` 約 30 秒內 syslog 出現「沒有回應，暫時改用業者 DNS」，期間區網仍能查詢；`kill -CONT $(pidof kuroshio)` 後出現「接管 DNS」

### 3.3 WAN 變動通知
- 在後台按「重新連線」（網際網路）
- 預期 syslog 出現「WAN 變動：已通知更新 DDNS 與對外 IP」

### 3.4 `/kuroshio_api.cgi`（後台轉接）
登入後台後，在瀏覽器開發者工具的 Console 執行：
```js
fetch('/kuroshio_api.cgi?op=status').then(r=>r.json()).then(console.log)
fetch('/kuroshio_api.cgi?op=api&path=' + encodeURIComponent('/api/status')).then(r=>r.json()).then(console.log)
fetch('/kuroshio_api.cgi?op=log&n=20').then(r=>r.json()).then(console.log)
fetch('/kuroshio_api.cgi?op=defaults').then(r=>r.json()).then(o=>console.log(Object.keys(o)))
// 不在白名單 → 不允許的路徑
fetch('/kuroshio_api.cgi?op=api&path=' + encodeURIComponent('/api/admin/shutdown')).then(r=>r.json()).then(console.log)
// 動作用 GET → 要用 POST
fetch('/kuroshio_api.cgi?op=action&path=' + encodeURIComponent('/api/cache/flush')).then(r=>r.json()).then(console.log)
// 動作用 POST → 執行
fetch('/kuroshio_api.cgi', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:'op=action&path=' + encodeURIComponent('/api/cache/flush')}).then(r=>r.json()).then(console.log)
// 匯出學習資料 → 再開 /kuroshio_backup.kuroshio 下載
fetch('/kuroshio_api.cgi', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:'op=backup-export'}).then(r=>r.json()).then(console.log)
```
預期：前四個回 JSON（`op=api` 是 `{"ok":true,"result":{…}}`）；第五個「不允許的路徑」；第六個「這個操作需要用 POST」；第七個 `ok:true`；第八個 `{"ok":true,"size":…}`，接著開 `http://192.168.2.1/kuroshio_backup.kuroshio` 會下載檔案（第二次開會是空的，因為下載後就刪除）。

### 3.5 回歸
- 後台重開機一次，正常回來
- Wi-Fi 鄰近 AP 掃描、有線、Wi-Fi、黑潮 DNS 查詢、後台套用正常
- 開機後 CPU 與記憶體（跟上次比較）：
  ```bash
  top -b -n 1 | head -12; grep -E 'VmRSS|VmHWM' /proc/$(pidof kuroshio)/status
  ```

---

## 4. 已知、不用回報的
- **cdn-pool 每隔約 6 分鐘重排**（「Azure Front Door / CDN IPv6 可用台灣節點只剩 2 個，排入節點池重建」）：黑潮 DNS 本身的行為，已整理給黑潮專案。這版應該還會看到，記下頻率即可

---

## 5. 驗證結果（本機填寫）

| 項目 | 結果 | 備註／輸出 |
|---|---|---|
| 版本含 764938b、黑潮 3.1.0 | | |
| 3.1 第一次開機清除重建 | | |
| 3.1 mode=jffs2、掛載 | | |
| 3.1 重開機後學習資料還在、不重跑 | | |
| 3.2 health=0 | | |
| 3.2 status --json（version、data.ok、storage、clock、warnings） | | |
| 3.2 保護程式切換與恢復 | | |
| 3.3 WAN 變動通知 | | |
| 3.4 API 轉接（8 項） | | |
| 3.5 回歸（重開機、Wi-Fi 掃描、有線、Wi-Fi、DNS、套用） | | |
| 3.5 CPU／記憶體 | | |
| cdn-pool 重排頻率 | | |

完成後：`git pull`，提交「docs: 764938b 實機驗證結果」並推送，同時把摘要告訴使用者。
**全部通過**才開始 `docs/HANDOFF-UI.md` 第 13 節的黑潮 LuCI 介面移植（實機測試就用這版韌體）。
