/*
 * padavan-tw：升級時把「還是舊出廠預設值」的設定換成新的預設（每台只做一次）
 *
 * nvram_restore_defaults() 只補不存在的鍵，已經存在的舊預設值不會變；有實測證據、而且
 * 不會讓使用者覺得少了功能的穩定性設定，才放進下面的表。
 * 條件：不是整份回復出廠，而且升級前沒有 tw_defaults_ver（defaults.c 給新機器 1，新機器不會跑）。
 * 限制：分不出「使用者刻意設成舊值」和「舊預設剛好是這個值」，所以只放證據強的項目，Release 說明要寫。
 */
#include <stdio.h>
#include <string.h>

#include "rc.h"

struct tw_mig {
	const char *name;
	const char *old_val;
	const char *new_val;
	const char *why;
};

static const struct tw_mig tw_mig_v1[] = {
	/* 5G Greenfield 關：D3 兩晚 15 輪，開著 5 輪 1 次斷線、關閉 5 輪 0 次（docs/WIFI-STABILITY.md） */
	{ "wl_HT_OpMode", "1", "0", "5G Greenfield 改成關閉（實測較穩）" },
	/* 2.4G 跟著關：預設 g/n 模式下驅動本來就寫 0，只有改成純 N 時才有差 */
	{ "rt_HT_OpMode", "1", "0", "2.4G Greenfield 改成關閉" },
	{ NULL, NULL, NULL, NULL }
};

/* 回傳改了幾項（有改就要 commit） */
int
tw_migrate_defaults(int had_ver)
{
	const struct tw_mig *m;
	int n = 0;

	if (had_ver)
		return 0;
	for (m = tw_mig_v1; m->name; m++) {
		if (!nvram_match((char *)m->name, (char *)m->old_val))
			continue;
		nvram_set(m->name, m->new_val);
		logmessage("padavan-tw", "升級：%s（%s %s→%s）", m->why, m->name, m->old_val, m->new_val);
		n++;
	}
	return n;
}
