# 驗證單：d179165（2026-11-21～22 夜間，D3 改成中華 PPPoE 直接撥號）

D3 從 KWRT 後面改成直接撥號（PPPoE），同時幫黑潮 DNS 收集 3.5.0 的名單資料。收集期間不能動 WAN（不刷機、不重撥），所以新程式先從 CI 的韌體映像拆出 `rc`、`httpd` 與網頁，放在 D3 的 `/tmp/twtest`、`/www`（記憶體）執行；重開機就回到原本的韌體。

## 1. 這批修了什麼

| commit | 內容 |
|---|---|
| 273c859 | 套用中進度框的進度條只佔一半寬度（state.js 寫死 50%） |
| bd270dc | 網際網路頁的業者 DNS 顯示 `<br/>`（韌體用 `<br/>` 分隔） |
| 4e09f72 | 自動 NAT66：WAN 換介面（例如改成 PPPoE）後留下一條沒用的 MASQUERADE |
| 5a330af | tw-roamd：打 `tw-roamd`／`tw-roamd help` 會多開一個常駐程式；沒有訊號樣本的裝置被記成 -127 dBm |
| 4da9167、5af3c2c | **新功能：連不出去時自動重新連線 WAN**（tw-stats＋診斷頁卡片，見第 3 節） |
| 47c6a67 | 裝置頁補上 Wi-Fi 頻段、連線速率、這次上線時間、今天斷線；拿掉過時的「之後的版本」 |
| d179165 | ralinkiappd：每次重啟 Wi-Fi 都多加一組 3517 埠的防火牆規則 |

CI：<https://github.com/candy999/padavan-tw/actions/runs/44926984702>（成功）；`padavan-tw-NEWIFI3-oc1000-20261122-d179165.trx` SHA256 `a32db092ed4e6dee86e575a472d05d2cf6a0e265e6522963e3156cb10c71daf7`

## 2. PPPoE 直連實測（D3 舊韌體 68d6c69＋上面幾項的記憶體版本）

| 項目 | 結果 |
|---|---|
| PPPoE 撥號、MTU 1492、MSS 修正 | ✅ |
| 硬體 NAT 處理 PPPoE | ✅ 電腦經 D3 下載 HiNet 測速檔約 403 Mbps，D3 CPU 2% |
| IPv6 委派前綴（dhcp6c 在 ppp0）、重撥換前綴 | ✅ 電腦自動換到新前綴；NAT66 沒有啟用（有前綴） |
| 重撥恢復 | ✅ 約 2 秒；黑潮收到 WAN 變動通知；UPnP 跟著換到 ppp0 |
| 後台「可以：你有公網 IP」 | ✅ |
| 外網曝露（電腦經 KWRT 的線路連 D3 公網 IPv4／IPv6、br0 的 IPv6、區網電腦的 IPv6；21、22、23、80、135、139、443、445、853、3389、3517、5000、8080、8443、24569） | ✅ 全部 filtered；ip(6)tables INPUT／FORWARD 預設 DROP。53 埠從這條線測不了：KWRT 的黑潮會把所有往外的 53 埠接走（連 192.0.2.77:53 都「通」） |

## 3. 連不出去時自動重新連線 WAN（新功能）

- 使用者需求：中華電信機房維護時，可能拿著 IP 卻連不出去、維護完撥號拿到不能上網的 IP、撥號沒拿到 IP，重撥才會好
- 做法：tw-stats 本來每 10 秒 ping HiNet DNS、TWNIC、Cloudflare；三個都沒回應持續 `tw_wan_watch_sec` 秒（預設 30）→ 有 IPv4 時再用 TCP 連 1.1.1.1:443、168.95.1.1:53、8.8.8.8:53 確認 → 確定斷了才走 rc 的 `auto_wan_reconnect`
- 保護：沒有 IPv4 至少等 90 秒；WAN 網路線沒接、固定 IP、AP 模式不動作；重撥後至少隔 2、5、10、30 分鐘（之後每 30 分鐘）才再重撥，恢復 10 分鐘後歸零；ping 不通但 TCP 通就不重撥、10 分鐘內不再確認
- nvram：`tw_wan_watch`（預設 1）、`tw_wan_watch_sec`（30～600）；狀態在 `/tw_api.asp?q=latency` 的 `wan_watch`；診斷頁「斷線自動重新連線」卡片
- Padavan 原本的「網際網路偵測」（`detect_internet`、`di_lost_action`）預設只在開著後台時檢查、重撥後沒有退避，沒有拿來用

| 測試 | 結果 |
|---|---|
| 正常時 | ✅ `state:ok`；診斷頁顯示「連外正常、開機以來自動重新連線 0 次」 |
| 只擋路由器自己的 ping（iptables OUTPUT 擋三個目標的 echo-request） | ✅ 30 秒後 TCP 確認 → `state:icmp`、系統記錄「ping 三個目標都沒有回應 30 秒，但 TCP 連得出去（可能只是 ping 被擋），不重新連線」，沒有重撥；找到兩個小問題已修（5af3c2c） |
| 真的連不出去（擋 ppp0 的 OUTPUT）→ 重撥、退避 | ⏳ 黑潮收集結束後做 |
| 沒有拿到 IP | ⏳ 不好模擬，看程式路徑 |

## 4. Wi-Fi（電腦的 USB 網卡 AIC8800D80＋使用者的手機）

| 項目 | 結果 |
|---|---|
| 信標內容（Windows WLAN API 讀 IE） | ✅ 主網路 2.4G／5G：11k（RM）、11v（BTM）、11r（MDID 5841，兩頻段相同）、AKM PSK＋FT-PSK；IoT 網路：只有 PSK，沒有 k/v/r |
| tw-roamd 問電腦（11k ✓、11v ✗） | 電腦在 5G、2.4G 都沒回 Beacon Report；手機在 5G 本來就不回（已知）。電腦不支援 11v，沒辦法建議它換頻段 |
| 關掉 5G | 電腦用 802.11r 換到 2.4G 時 D3 回「FT_AuthReqRsnValidation : The PMKID is invalid」（5G 的金鑰持有者已經關了，預期內），電腦斷線 |
| 重啟 2.4G（每日自動選頻也會） | 電腦斷線後沒自己連回：Windows 有有線網路時預設不自動重連 Wi-Fi（WLAN AutoConfig 事件「驅動程式已經中斷網路的連線」），不是 D3 的問題 |
| 手機（Mi 10T） | 5G 關掉時跑到別的網路，開回來後自己回到 D3 5G；之前的 BTM 建議都回狀態 7（沒有合適的候選，已知） |
| tw-roamd 多開（5a330af） | ✅ `/tmp/twtest` 版：`tw-roamd help` 印用法、`tw-roamd` 印「已經在執行」，沒有多開 |
| iappd 防火牆規則（d179165） | ✅ 舊版：重啟 5G、2.4G 各一次後 INPUT 有 3 組；新版 iappd.sh 掛上後重啟 2.4G 還是 1 組 |
| 裝置頁 Wi-Fi 明細（47c6a67） | ✅ 電腦 5G：D3 算出下行 433 Mbps（Windows 顯示 433）、上行 351、已連線秒數相符；清單顯示「Wi-Fi 5 GHz」與這次上線時間 |

## 5. 待做（刷 d179165 之後）

- 刷機後：進度框、業者 DNS、NAT66 不留規則（下次改回 KWRT 後面時看）
- 斷線自動重新連線的實際重撥與退避
- 黑潮 6e24353 在直連下評測一次（黑潮測試單 D 段）
