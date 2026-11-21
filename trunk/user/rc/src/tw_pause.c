/*
 * padavan-tw：裝置「暫停上網」的定時恢復
 *
 * 暫停上網沿用 MAC 過濾的封鎖清單（MFList：macfilter_list_x／time_x／date_x、macfilter_num_x）。
 * 清單本身的時段是「每週重複」的排程，不能拿來做「暫停 1 小時」這種一次性的事，所以另外記：
 *   nvram tw_pause_until＝「MAC=到期時間（Unix 秒）」以空白分隔；MAC 跟 macfilter_list_x 一樣是 12 位十六進位
 * watchdog 每 30 秒看一次，到期的就從封鎖清單拿掉（後面的往前移）、存進 Flash、重新載入防火牆。
 * - 時鐘還沒對時（剛開機、D3 沒有 RTC）不動作，對時後再處理（重開機期間到期的會在對時後恢復）
 * - 使用者已經手動恢復（清單裡找不到）的，只把紀錄拿掉
 * - 寫 Flash 只在真的有到期時（一次暫停只寫一次）
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <time.h>

#include "rc.h"

#define TW_PAUSE_TIME_OK	1700000000L	/* 時鐘大於這個（2023-11）才算對時 */
#define TW_PAUSE_TICKS		3		/* watchdog 每 10 秒一次 → 30 秒看一次 */

/* 只比較十六進位字元（不分大小寫、忽略冒號） */
static int
mac_same(const char *a, const char *b)
{
	for (;;) {
		while (*a && !isxdigit((unsigned char)*a))
			a++;
		while (*b && !isxdigit((unsigned char)*b))
			b++;
		if (!*a || !*b)
			return !*a && !*b;
		if (toupper((unsigned char)*a) != toupper((unsigned char)*b))
			return 0;
		a++;
		b++;
	}
}

/* 從封鎖清單拿掉這個 MAC（後面的往前移），有拿掉回傳 1 */
static int
mflist_remove(const char *mac)
{
	int i, j, n = nvram_get_int("macfilter_num_x");
	char k1[32], k2[32];
	static const char *keys[] = { "macfilter_list_x", "macfilter_time_x", "macfilter_date_x" };

	for (i = 0; i < n; i++) {
		snprintf(k1, sizeof(k1), "macfilter_list_x%d", i);
		if (!mac_same(nvram_safe_get(k1), mac))
			continue;
		for (j = i; j < n - 1; j++) {
			int k;
			for (k = 0; k < 3; k++) {
				snprintf(k1, sizeof(k1), "%s%d", keys[k], j);
				snprintf(k2, sizeof(k2), "%s%d", keys[k], j + 1);
				nvram_set(k1, nvram_safe_get(k2));
			}
		}
		for (j = 0; j < 3; j++) {
			snprintf(k1, sizeof(k1), "%s%d", keys[j], n - 1);
			nvram_unset(k1);
		}
		nvram_set_int("macfilter_num_x", n - 1);
		return 1;
	}
	return 0;
}

void
tw_pause_check(void)
{
	static int tick;
	char buf[2048], out[2048], *p, *save = NULL;
	time_t now;
	int changed = 0, removed = 0;
	size_t len = 0;

	if (++tick < TW_PAUSE_TICKS)
		return;
	tick = 0;

	p = nvram_safe_get("tw_pause_until");
	if (!*p)
		return;
	now = time(NULL);
	if (now < TW_PAUSE_TIME_OK)
		return;

	snprintf(buf, sizeof(buf), "%s", p);
	out[0] = 0;
	for (p = strtok_r(buf, " ", &save); p; p = strtok_r(NULL, " ", &save)) {
		char *eq = strchr(p, '=');
		long ts;

		if (!eq) {
			changed = 1;	/* 格式不對的丟掉 */
			continue;
		}
		*eq = 0;
		ts = atol(eq + 1);
		if (ts > 0 && now < ts) {
			int w = snprintf(out + len, sizeof(out) - len, "%s%s=%ld", len ? " " : "", p, ts);
			if (w > 0 && (size_t)w < sizeof(out) - len)
				len += w;
			continue;
		}
		changed = 1;
		if (mflist_remove(p)) {
			removed++;
			logmessage("暫停上網", "時間到，恢復 %s 上網", p);
		}
	}
	if (!changed)
		return;
	nvram_set("tw_pause_until", out);
	nvram_commit();
	if (removed)
		notify_rc("restart_firewall");
}
