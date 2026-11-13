# 本機下一批工作（2026-11-13）

> 寫給：本機工作階段。一律用繁體中文（台灣用語）。開工前 `git pull`。
> 三件事，**依序做**。第一件只改 `docs/`；第二、三件只改前端（`trunk/user/www`、`tools/ui-preview`、`docs`）。
> 後端（`trunk/user/rc`、`httpd/src`、`kuroshio`、`configs`、`linux-4.4.x`）有問題：寫清楚現象、指令輸出與分析，交給使用者轉給雲端。

---

## 用哪一版韌體

| 情況 | 韌體 |
|---|---|
| 雲端還沒做好黑潮 DNS 3.2.0 版 | `padavan-tw-NEWIFI3-20261113-764938b`（<https://github.com/candy999/padavan-tw/actions/runs/43430120430>） |
| 雲端已經推出 3.2.0 版（使用者會告訴你，或 `docs/LOCAL-NEXT.md` 這一節會更新） | 用那一版，第一件的驗證照樣做，另外加做「3.2.0 追加驗證」 |

都不要用 `-oc1000`。刷機由使用者操作，不要清除 Config。這幾版重開機已經正常，可以用後台「韌體更新」。

---

## 第一件：驗證韌體

照 `docs/VERIFY-764938b.md` 第 3 節做，結果填進第 5 節，提交「docs: 764938b 實機驗證結果」。重點：
- D3 黑潮資料區：第一次開機「清除後重新建立」、`mode=jffs2`、重開機後學習資料還在
- 黑潮 DNS：`kuroshio health`、`status --json`、保護程式切換與恢復
- WAN 變動通知、`/kuroshio_api.cgi` 的 8 項測試、回歸檢查

**手動立即儲存學習資料**（重開機、更新韌體、拔電之前用）：
```bash
/usr/bin/kuroshio.sh flush
```
（3.1.0 送 SIGUSR1；3.2.0 起黑潮 DNS 另有 `kuroshio notify save` 與管理 API `POST /api/persist/flush`，雲端升級時會讓 `flush` 改用它們。）驗證「重開機後學習資料還在」之前先執行一次。

### 3.2.0 追加驗證（用 3.2.0 版韌體時才做）
- `/usr/bin/kuroshio --version` 是 3.2.0
- **cdn-pool 不再每 6 分鐘重排**：開機 1 小時內 `grep '節點池重建' /tmp/syslog.log` 不應該每 6 分鐘出現一次（節點真的壞掉才會提早重建；連續不足時間隔 1→6→24 小時）
- 過濾清單換成 3.2.0 的預設（見第三件的「升級時的預設清單」）

全部通過再做第二件。

---

## 第二件：頻寬管理頁接上後端，進階區加「Wi-Fi 也套用」開關

### 要修正的：設定名稱跟後端對齊
`tw_p_qos.js` 現在寫入 `tw_qos_mode`、`tw_qos_down`、`tw_qos_up`（群組 `General;`），但**後端早就有一套設定**（E1，`trunk/user/httpd/src/variables.c` 的 `IPConnection` 群組、`trunk/user/shared/src/defaults.c`），名稱不一樣，所以現在寫了也沒有作用。請改用：

| nvram | 意思 | 預設 |
|---|---|---|
| `hw_qos_mode` | 0 關閉、1 固定限速、2 自動 | 0 |
| `hw_qos_wlan` | **Wi-Fi 裝置也套用頻寬管理**（1 開、0 關） | 1 |
| `hw_qos_down`、`hw_qos_up` | 申裝頻寬（Mbps），0＝未設定 | 0 |
| `hw_qos_tech` | 最後一里：`ftth`、`vdsl`、`cable`、`mobile`、`other` | ftth |
| `hw_qos_over`、`hw_qos_under` | 上限 +%、下限 −%（自動模式的範圍） | 15、15 |
| `hw_qos_method` | 0＝排程常開只調速率（建議）、1＝需要時才開排程（切換時清硬體表） | 0 |

- 表單群組：**`IPConnection;`**（變更後重啟防火牆，rc 會套用 `hnat_qos`／`hnat_qos_wlan` 並清空硬體 NAT 表）
- `docs/HANDOFF-UI.md` 第 6 節 `qos` 那一列與第 11.2 節的表要一起改成這些名稱
- `tw_qos_*` 不要再用；不需要雲端另外登記

### 要新增的：進階區的 Wi-Fi 開關
- 位置：頻寬管理頁的「進階」折疊區
- 標籤：「Wi-Fi 裝置也套用頻寬管理」，預設開（`hw_qos_wlan=1`）
- 說明（白話）：開啟時，網際網路與 Wi-Fi 裝置之間的流量也會經過硬體排程；**如果開了以後 Wi-Fi 變慢或不穩，可以關掉，只管有線裝置**（Wi-Fi 裝置之間互傳不受影響）
- 只有頻寬管理模式不是「關閉」時才有作用；模式是關閉時，開關顯示但註明「頻寬管理開啟後才會生效」

### 目前後端的實際狀態（頁面要誠實呈現）
- 模式切到「固定」或「自動」時，後端**只會讓流量經過硬體排程**，限速值與自動控制器（ROADMAP E4～E8）**還沒做**，所以不會真的限速
- 頁面可以讓使用者先設好方案頻寬與模式，但要清楚寫出「限速功能尚未提供，目前只會經過排程、不限速」，不要讓人以為已經在限速
- 這頁的實機寫入測試：切換 `hw_qos_wlan` 後，`cat /sys/module/hw_nat/parameters/hnat_qos_wlan` 應該跟著變（模式要先不是關閉）；syslog 有 `Hardware QoS: on (wired), off (wlan)` 之類的紀錄

---

## 第三件：黑潮 DNS 的 LuCI 介面移植

規格在 `docs/HANDOFF-UI.md` **第 13 節**（9 頁：狀態、儀表板、基本設定、連線來源、廣告過濾、CDN 台灣節點、社群、進階、日誌），設計原則照同一份文件第 5 節。

參考原始碼請用 **3.2.0**（LuCI 介面比 3.1.0 多了下面三個功能）：
```bash
git clone --depth 1 --branch v3.2.0 https://github.com/candy999/kuroshio-dns.git
```
- `openwrt/luci-app-kuroshio/`：介面（3.2.0 改了 `filter.js`、`status.js`、`common.js`）
- `openwrt/kuroshio/files/rpcd.sh`：後端轉接（我們的 `/kuroshio_api.cgi` 對應它）
- `docs/release-notes/v3.2.0.md`：這版改了什麼

### 3.2.0 新增、也要做進來的
| 功能 | 放在哪 | 後端 |
|---|---|---|
| **立即儲存學習資料** | 狀態頁的操作區 | `POST op=flush`（已有）；3.2.0 起也可以 `op=action&path=/api/persist/flush`（回 `{ok, files, bytes, at, dir}`，雲端升級 3.2.0 時會加進白名單） |
| **恢復預設清單** | 廣告過濾頁 | 預設值用 `op=defaults` 的 `filter.lists`；比對、列出差異、確認後改 UCI 檔的 `filter_list` 區段（照 LuCI `filter.js` 的做法：先用網址、再用名稱對應，自己加的清單預設保留） |
| **恢復預設自訂規則** | 廣告過濾頁的自訂規則下方 | `op=action&path=/api/filter/reset-rules`（服務會先備份成 `custom-rules.txt.bak`；雲端升級 3.2.0 時加進白名單） |

### 升級時的預設清單（Padavan 要注意）
OpenWrt 升級時有腳本把「還是舊預設值」的清單換成 3.2.0 的新預設；Padavan 的 UCI 檔在 `/etc/storage/kuroshio/kuroshio.uci`，**雲端升級 3.2.0 時會在 `kuroshio.sh` 做同樣的搬移**（使用者沒改過的 UCI 檔直接換成新預設，改過的不動、在後台提示可以用「恢復預設清單」）。介面這邊只要做好「恢復預設清單」即可。

### 實機與預覽
- 3.2.0 的三個新功能要等雲端推出 3.2.0 版韌體才能在實機測；在那之前用預覽工具的模擬資料做
- 其他照第 13.5、13.6 節

完成後依第 13.6 節驗收，在 `docs/HANDOFF-UI.md` 記錄進度，提交並推送。
