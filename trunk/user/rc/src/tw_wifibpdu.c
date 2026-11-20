/*
 * padavan-tw：Wi-Fi BPDU 擋法（第二層保險）與觸發紀錄
 *
 * 背景：2026-11-18 D3 的 2.4G 被 STP 封鎖約 50 秒（「卡住再恢復」）。根因是硬體 NAT 的殘留標記，
 * 讓有線埠送出的 BPDU 變成「ra0 收到」（核心 d333736 已修，見 docs/WIFI-STABILITY.md）。
 * 這裡保留 Wi-Fi 介面的 BPDU 擋法當第二層保險，並把每一次攔截的原因與當下狀態記下來；
 * 目標是收集到足夠資料、把剩下的原因都修掉之後，拿掉這個擋法。
 *
 * nvram tw_wifi_bpdu（STP 開著才有作用；WDS、ApCli 不在範圍內）：
 *   0＝不擋（標準 STP）
 *   1＝只擋收進來的並記錄（BPDU 照常從 Wi-Fi 送出，可以觀察 Wi-Fi 送出後被送回的情況）
 *   2＝收送都擋，收進來的記錄（預設）
 *
 * 觸發來源（watchdog 約每 30 秒檢查一次，只讀計數，不常駐抓封包）：
 *   1. Wi-Fi 介面收到 BPDU：ebtables INPUT 規則的計數增加；核心日誌有 TW-BPDU 前綴（含來源 MAC）
 *   2. 硬體 NAT 保險：/sys/module/hw_nat/parameters/tw_bogus_pingpong 增加（核心日誌 HNAT: drop non-IP）
 * 有增加就執行 /sbin/tw-bpdu-snap，收集資訊寫進 /etc/storage/tw-diag/bpdu-events.log
 * 一次檢查收到 10 個以上（可能有橋接裝置一直送、或真的迴圈）：照樣擋，但暫停逐筆記錄 1 小時，避免洗版
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <net/if.h>

#include "rc.h"

#define TWB_BGA		"01:80:c2:00:00:00"
#define TWB_LOG_OPT	"--log-level notice --log-prefix TW-BPDU "
#define TWB_NOLOG_FLAG	"/tmp/tw-bpdu-nolog"
#define TWB_GUARD_FILE	"/sys/module/hw_nat/parameters/tw_bogus_pingpong"
#define TWB_CHECK_TICKS	3	/* watchdog 約 10 秒一輪 → 約 30 秒檢查一次 */
#define TWB_FLOOD	10	/* 一次檢查收到這麼多就暫停逐筆記錄 */
#define TWB_MUTE_CHECKS	120	/* 120 次 × 30 秒＝約 1 小時 */

/* ---------- STP 計時與急速連線 ----------
 * 原本 STP 開著時，連接埠啟用到轉送要 2 × forward_delay（15 秒）＝30 秒；Wi-Fi 每次重啟（每日換頻道、
 * 改 Wi-Fi 設定、驅動自己重啟）那個頻段就 30 秒不通，裝置在這段時間連上會拿不到 DHCP
 * （Windows 會顯示「沒有網際網路」好幾分鐘）。
 * - 計時縮短：hello 2、max_age 6、forward_delay 4 秒（802.1D：2×(4−1) ≥ 6、6 ≥ 2×(2+1)），30 秒 → 8 秒；
 *   家用網路只有一兩層，短計時沒問題，有線埠照常有迴圈保護
 * - 急速連線（nvram tw_wifi_fast，預設 1）：Wi-Fi AP 介面一啟用就轉送（核心 br_stp.c 的 br_tw_fast_port()）。
 *   只在 Wi-Fi BPDU 擋法有開時才開（Wi-Fi 本來就不參與 STP）
 * - 個別退回（只記在記憶體，重開機就忘，遇到再說）：某個 Wi-Fi 介面收到「外部裝置」的 BPDU
 *   （環境中有會送 BPDU 的橋接裝置，真的可能成環）→ 只把那個介面改回標準 STP：放行它的 BPDU，
 *   讓 STP 真的看得到迴圈，啟用時等 8 秒（brport/tw_slow）；其他介面照樣急速。
 *   來源是本機介面的 MAC（D3 內部回送，韌體問題）不算衝突，不降級，只記錄。
 *   判斷與處理在 /sbin/tw-bpdu-snap，清單在 TWB_CONFLICT（每行：介面 來源MAC 時間） */
#define TWB_BR_SYS	"/sys/class/net/" IFNAME_BR "/bridge/"
#define TWB_CONFLICT	"/tmp/tw-bpdu-conflict"

static void
twb_write_int(const char *path, int val)
{
	FILE *fp = fopen(path, "w");

	if (fp) {
		fprintf(fp, "%d\n", val);
		fclose(fp);
	}
}

static int
tw_wifi_fast_wanted(void)
{
	return !nvram_match("tw_wifi_fast", "0") && !nvram_match("lan_stp", "0") &&
	       tw_wifi_bpdu_mode() != 0;
}

/* STP 開啟後呼叫（net_lan.c、services.c 原本 br_set_fd(IFNAME_BR, 15) 的位置） */
void
tw_stp_timers(void)
{
	twb_write_int(TWB_BR_SYS "hello_time", 200);
	twb_write_int(TWB_BR_SYS "max_age", 600);
	twb_write_int(TWB_BR_SYS "forward_delay", 400);
	twb_write_int(TWB_BR_SYS "tw_wifi_fast", tw_wifi_fast_wanted());
}

/* 讀衝突清單，對每個介面呼叫 fn（介面名稱只收英數字，避免拼進指令出事） */
static void
twb_for_conflicts(void (*fn)(const char *ifname))
{
	FILE *fp = fopen(TWB_CONFLICT, "r");
	char line[128], ifn[IFNAMSIZ + 1];

	if (!fp)
		return;
	while (fgets(line, sizeof(line), fp)) {
		const char *c;
		int ok = 1;

		if (sscanf(line, "%16s", ifn) != 1)
			continue;
		for (c = ifn; *c; c++)
			if (!((*c >= 'a' && *c <= 'z') || (*c >= '0' && *c <= '9')))
				ok = 0;
		if (ok)
			fn(ifn);
	}
	fclose(fp);
}

static void
twb_allow_bpdu(const char *ifn)
{
	doSystem("ebtables -A INPUT -i %s -d %s -j ACCEPT", ifn, TWB_BGA);
	doSystem("ebtables -A OUTPUT -o %s -d %s -j ACCEPT", ifn, TWB_BGA);
}

static void
twb_set_slow(const char *ifn)
{
	char path[80];

	snprintf(path, sizeof(path), "/sys/class/net/%s/brport/tw_slow", ifn);
	if (access(path, F_OK) == 0)
		twb_write_int(path, 1);
}

static int twb_tick = 0;
static int twb_mute = 0;
static unsigned long twb_prev_in = 0;
static unsigned long twb_prev_guard = 0;

int
tw_wifi_bpdu_mode(void)
{
	char *v = nvram_safe_get("tw_wifi_bpdu");
	int m;

	if (!*v)
		return 2;
	m = atoi(v);
	return (m < 0 || m > 2) ? 2 : m;
}

/* restart_guest_lan_isolation() 清空 ebtables 後呼叫 */
void
tw_wifi_bpdu_rules(void)
{
	int with_log = (access(TWB_NOLOG_FLAG, F_OK) != 0);

	twb_for_conflicts(twb_allow_bpdu);	/* 個別退回的介面照標準 STP（規則要在擋法前面） */
	if (with_log)
		module_smart_load("ebt_log", NULL);
	doSystem("ebtables -A INPUT -i ra+ -d %s %s-j DROP", TWB_BGA, with_log ? TWB_LOG_OPT : "");
	if (tw_wifi_bpdu_mode() == 2)
		doSystem("ebtables -A OUTPUT -o ra+ -d %s -j DROP", TWB_BGA);
}

/* 讀 INPUT 規則的封包計數；logged＝規則有沒有帶記錄 */
static int
twb_read_input(unsigned long *pcnt, int *logged)
{
	FILE *fp;
	char line[256];
	int found = 0;

	fp = popen("ebtables -L INPUT --Lc 2>/dev/null", "r");
	if (!fp)
		return 0;
	while (fgets(line, sizeof(line), fp)) {
		char *p;

		if (!strstr(line, "-i ra+"))
			continue;
		p = strstr(line, "pcnt = ");
		if (!p)
			continue;
		*pcnt = strtoul(p + 7, NULL, 10);
		*logged = (strstr(line, "--log-prefix") != NULL);
		found = 1;
		break;
	}
	pclose(fp);
	return found;
}

static unsigned long
twb_read_guard(void)
{
	FILE *fp = fopen(TWB_GUARD_FILE, "r");
	unsigned long v = 0;

	if (fp) {
		if (fscanf(fp, "%lu", &v) != 1)
			v = 0;
		fclose(fp);
	}
	return v;
}

/* 換成有記錄／沒記錄的 INPUT 規則（擋法不變） */
static void
twb_swap_input(int to_log)
{
	doSystem("ebtables -D INPUT -i ra+ -d %s %s-j DROP", TWB_BGA, to_log ? "" : TWB_LOG_OPT);
	if (to_log)
		module_smart_load("ebt_log", NULL);
	/* 加在最後：個別退回介面的放行規則要留在前面 */
	doSystem("ebtables -A INPUT -i ra+ -d %s %s-j DROP", TWB_BGA, to_log ? TWB_LOG_OPT : "");
}

void
tw_wifi_bpdu_check(void)
{
	unsigned long in = 0, guard, d_in = 0, d_guard;
	int has_in = 0, logged = 0;

	if (++twb_tick < TWB_CHECK_TICKS)
		return;
	twb_tick = 0;

	if (!nvram_match("lan_stp", "0") && tw_wifi_bpdu_mode() != 0 && is_module_loaded("ebtable_filter"))
		has_in = twb_read_input(&in, &logged);

	if (has_in) {
		if (in < twb_prev_in)	/* 規則重建（Wi-Fi 重啟等），計數從 0 開始 */
			twb_prev_in = 0;
		d_in = in - twb_prev_in;
		twb_prev_in = in;
	} else
		twb_prev_in = 0;

	guard = twb_read_guard();
	if (guard < twb_prev_guard)	/* hw_nat 重新載入 */
		twb_prev_guard = 0;
	d_guard = guard - twb_prev_guard;
	twb_prev_guard = guard;

	twb_for_conflicts(twb_set_slow);	/* Wi-Fi 介面重建（驅動重載）後旗標會不見，每次補上 */
	if (d_in || d_guard)
		doSystem("/sbin/tw-bpdu-snap %lu %lu %lu %lu &", d_in, in, d_guard, guard);

	/* 洗版保護 */
	if (twb_mute > 0) {
		if (--twb_mute == 0) {
			unlink(TWB_NOLOG_FLAG);
			if (has_in && !logged)
				twb_swap_input(1);
			logmessage("Wi-Fi BPDU", "恢復逐筆記錄 Wi-Fi 收到的 BPDU");
		}
	} else if (has_in && logged && d_in >= TWB_FLOOD) {
		FILE *fp = fopen(TWB_NOLOG_FLAG, "w");

		if (fp)
			fclose(fp);
		twb_swap_input(0);
		twb_mute = TWB_MUTE_CHECKS;
		logmessage("Wi-Fi BPDU", "30 秒內 Wi-Fi 收到 %lu 個 BPDU（可能有橋接裝置或真的迴圈），照樣擋，暫停逐筆記錄 1 小時", d_in);
	}
}
