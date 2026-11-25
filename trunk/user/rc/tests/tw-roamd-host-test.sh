#!/bin/sh
# padavan-tw：tw-roamd 在一般 Linux 上的模擬測試（TWR_TEST：假的訊號表，不碰 Wi-Fi 驅動）
# 用法：sh trunk/user/rc/tests/tw-roamd-host-test.sh（需要 gcc；CI 每次編譯前會跑）
#
# 情境（2026-11-25 D3 長測）：手機從 5G 換到 2.4G 之後，驅動的 5G 表還留著它的舊紀錄幾分鐘。
# 以前每次讀表兩邊都看到它，就來回記「換頻段」；現在同一次讀表只認連線時間比較短的那筆。
# 2026-11-25 確認過：v2026.11.24 的 tw-roamd 在這個情境每 2 秒來回記一次（跟 D3 長測一樣），這裡會失敗。
set -eu
SRC=${TWR_SRC:-$(cd "$(dirname "$0")/../src" && pwd)}
W=$(mktemp -d)
trap 'kill $PID 2>/dev/null || true; rm -rf "$W"' EXIT
PID=

cp "$SRC/tw_roamd.c" "$SRC/tw_roam_drv.c" "$SRC/tw_roam.h" "$W/"
cat > "$W/rc.h" <<'H'
/* 測試用的 rc.h：只放 tw-roamd 用到的部分 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <netinet/in.h>
#define IFNAME_BR		"lo"
#define IFNAME_2G_MAIN		"ra0"
#define IFNAME_5G_MAIN		"rai0"
#define BOARD_NAME		"TEST"
#define BOARD_HAS_5G_RADIO	1
static inline char *nvram_safe_get(const char *n) { char k[128]; char *v; snprintf(k, sizeof(k), "NV_%s", n); v = getenv(k); return v ? v : ""; }
static inline int nvram_get_int(const char *n) { return atoi(nvram_safe_get(n)); }
static inline char *nvram_wlan_get(int a, const char *p) { char k[64]; snprintf(k, sizeof(k), "%s_%s", a ? "wl" : "rt", p); return nvram_safe_get(k); }
static inline int nvram_wlan_get_int(int a, const char *p) { return atoi(nvram_wlan_get(a, p)); }
static inline void logmessage(char *h, char *fmt, ...) { va_list ap; va_start(ap, fmt); fprintf(stderr, "[%s] ", h); vfprintf(stderr, fmt, ap); fputc('\n', stderr); va_end(ap); }
int tw_roamd_main(int argc, char **argv);
H
echo 'int tw_roamd_main(int argc, char **argv); int main(int c, char **v) { return tw_roamd_main(c, v); }' > "$W/main.c"
gcc -DTWR_TEST -O1 -Wall -Wno-unused-function -I"$W" -o "$W/tw-roamd" "$W/tw_roamd.c" "$W/tw_roam_drv.c" "$W/main.c"

cd "$W"
M=02:11:22:33:44:55
export TWR_FAKE="$W/twr" TWR_NODE=02:00:00:00:00:01 NV_tw_roam_enable=1 NV_lan_ipaddr=127.0.0.1 NV_computer_name=TEST
# 欄位：MAC 訊號 ApIdx 連線時間（秒）
step() { printf '%s' "$1" > twr.ra0; printf '%s' "$2" > twr.rai0; sleep "$3"; }

step "" "$M -55 0 3600
" 0
./tw-roamd > run.log 2>&1 &
PID=$!
sleep 5
# 1. 換到 2.4G；5G 表還留著舊紀錄（連線時間比較長）12 秒
step "$M -46 0 3
" "$M -60 0 3605
" 12
# 2. 5G 的舊紀錄消失
step "$M -46 0 20
" "" 6
# 3. 回到 5G；這次是 2.4G 留著舊紀錄
step "$M -48 0 40
" "$M -52 0 1
" 10
step "" "$M -52 0 15
" 6
kill $PID; wait $PID 2>/dev/null || true; PID=

echo "---- 事件 ----"; cat tw-roamd.events
n=$(grep -c "換頻段" tw-roamd.events || true)
if [ "$n" != 2 ]; then
	echo "失敗：換頻段應該記 2 筆（5G→2.4G、2.4G→5G），實際 $n 筆"; cat run.log; exit 1
fi
grep -q "換頻段.*5G → 2.4G" tw-roamd.events && grep -q "換頻段.*2.4G → 5G" tw-roamd.events || { echo "失敗：方向不對"; exit 1; }
echo "通過：同一台兩個頻段都在表裡時只記真的換頻段（2 筆）"
