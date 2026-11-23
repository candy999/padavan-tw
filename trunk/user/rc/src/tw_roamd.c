/*
 * padavan-tw：AP 互助漫遊 tw-roamd（設計：docs/ROAM-COOP.md）
 *
 * 每台 AP 各跑一個，彼此在區網用多播交換資訊（TWR2）：
 * - 每 2 秒讀自己的 Wi-Fi 裝置訊號表（驅動的 MAC table）
 * - 每 5 秒在 br0 多播一份報告（239.255.77.77:27330，TTL 1，只在區網內）：
 *   自己的頻段（BSSID、頻道、頻寬、SSID 雜湊、k/v/r）、連著的裝置、剛離開的裝置
 * - 記錄裝置換 AP、換頻段的時間點；記住 24 小時內連過 5G 的裝置
 *
 * 模式（nvram tw_roam_enable）：
 *   1 觀察：交換資訊、寫紀錄，算「會怎麼建議」，不送任何請求
 *   2 建議：決定層（問 → 比 → 建議 → 看結果）：
 *      11k Beacon Request 請裝置量候選 AP → 裝置量到的訊號明顯比較好（連續兩次）→
 *      11v BTM 建議換過去（不設 Disassociation Imminent、不帶斷線計時）→ 15 秒內有沒有過去；
 *      不理會就退避 10 分鐘 → 1 小時 → 24 小時；每台每天 6 次、每台 AP 每小時 12 次（超過自動退回觀察）。
 *      暫時掉到 2.4G 的手機回來後建議回 5G（第 6.3 節）。永遠不踢人。
 *   各晶片能做到哪裡看 tw_roam_drv.c；驅動不支援的頻段自動只觀察。
 *
 *   tw-roamd            以背景程式執行（由 watchdog 依 nvram tw_roam_enable 啟停，改模式會重新啟動）
 *   tw-roamd status     顯示目前狀態與最近的事件
 *
 * 輸出：/tmp/tw-roamd.status（狀態，每 5 秒更新）、/tmp/tw-roamd.events（最近 100 筆事件）、
 *       /tmp/tw-roamd.neighbors（鄰居清單）、/etc/storage/tw-diag/roam.log（決定紀錄，循環 32 KB）、
 *       系統記錄（換 AP 與建議，有頻率限制）
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <signal.h>
#include <poll.h>
#include <time.h>
#include <stdarg.h>
#include <syslog.h>
#include <sys/socket.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <dirent.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#ifdef TWR_TEST
#include <net/if.h>
#include <linux/wireless.h>
#else
/* 跟 rc 的 ralink.c 一樣用 wireless-tools 的標頭：musl 下 <net/if.h> 與 <linux/wireless.h> 會重複定義 */
#include <iwlib.h>
#endif

#include "rc.h"
#include "tw_roam.h"

#define TWR_GROUP		"239.255.77.77"
#define TWR_PORT		27330
#define TWR_POLL_SEC		2
#define TWR_REPORT_SEC		5
#define TWR_PEER_EXPIRE		20
#define TWR_ROAM_WINDOW		30	/* 裝置在別台消失後幾秒內出現在這台，算漫遊 */
#define TWR_GONE_POLLS		2	/* 連續幾次讀不到才算離開 */
#define TWR_MAX_LOCAL		128
#define TWR_MAX_PEERS		8
#define TWR_MAX_PEER_CLI	96
#define TWR_MAX_EVENTS		100
#ifndef TWR_TEST
#define TWR_STATUS_FILE		"/tmp/tw-roamd.status"
#define TWR_EVENTS_FILE		"/tmp/tw-roamd.events"
#define TWR_EVAC_REQ		"/tmp/tw-roamd.evacuate"	/* tw-wifi-acs 要重啟某個頻段前寫：內容「2」或「5」 */
#define TWR_EVAC_DONE		"/tmp/tw-roamd.evacuated"	/* 結果：done 送出 N 不支援 N 未送 N */
#define TWR_PID_FILE		"/var/run/tw-roamd.pid"
#else
#define TWR_STATUS_FILE		"tw-roamd.status"	/* 測試：寫在目前目錄 */
#define TWR_EVENTS_FILE		"tw-roamd.events"
#define TWR_EVAC_REQ		"tw-roamd.evacuate"
#define TWR_EVAC_DONE		"tw-roamd.evacuated"
#define TWR_PID_FILE		"tw-roamd.pid"
#endif

#define RTPRIV_IOCTL_GET_MAC_TABLE_STRUCT	(SIOCIWFIRSTPRIV + 0x1F)

/* 驅動回傳的 MAC table 項目（三種驅動在 +0x1F 這個 ioctl 都是同一個 28 位元組格式） */
struct twr_mac_entry {
	unsigned char	ApIdx;
	unsigned char	Addr[6];
	unsigned char	Aid;
	unsigned char	Psm;
	unsigned char	MimoPs;
	signed char	AvgRssi0;
	signed char	AvgRssi1;
	signed char	AvgRssi2;
	unsigned int	ConnectedTime;
	unsigned short	TxRate;
	unsigned int	LastRxRate;
};

struct twr_local {
	unsigned char mac[6];
	int band;		/* 2 或 5 */
	int guest;
	int rssi;		/* 最近一次 */
	int ema;		/* 平滑後（dBm） */
	int ema16;		/* 平滑值 ×16（避免整數捨入卡住） */
	unsigned int conn;	/* 已連線秒數（驅動） */
	long first_seen, last_seen;
	long weak_since;	/* 0＝目前不弱 */
	int missing;		/* 連續幾次沒讀到 */
	long sug_weak_at, sug_band_at;
	int psm;		/* 省電中（螢幕關著、待機）：不打擾 */
	long band_since;	/* 到這個頻段的時間 */
	int drop_rssi;		/* 剛到 2.4G 時的訊號（回 5G 的備案規則用） */
	int fb_n;		/* 備案規則連續成立幾次 */
	long fb_at;
	int used;
};

struct twr_peer_cli {
	unsigned char mac[6];
	int band;
	int rssi;
};

/* 一個頻段（一個 BSS）：TWR2 的 R 行 */
struct twr_radio {
	int band;			/* 2 或 5 */
	unsigned char bssid[6];
	int ch, bw;			/* 頻道、頻寬（MHz） */
	int ncli;			/* 主網路的裝置數（第一版只記錄） */
	unsigned int ssid_hash;		/* SSID 的 CRC32：相同才算漫遊候選 */
	char cap[4];			/* k／v／r，沒有就是 "-" */
};

struct twr_peer {
	unsigned char node[6];
	char ip[16];
	char name[33];
	int ver;			/* 1＝TWR1（沒有 R 行）、2＝TWR2 */
	int ch2, ch5;
	long last_seen;
	int nradio;
	struct twr_radio radio[2];
	int ncli;
	struct twr_peer_cli cli[TWR_MAX_PEER_CLI];
	/* 最近離開這台的裝置（給漫遊判斷用） */
	int ngone;
	struct { unsigned char mac[6]; int band; int rssi; long at; } gone[32];
	int used;
};

static struct twr_local g_local[TWR_MAX_LOCAL];
static struct twr_peer g_peer[TWR_MAX_PEERS];
/* 最近 24 小時連過 5G 的裝置（本機或別台 AP 的 C 行都算）：暫時掉到 2.4G 時用來建議回 5G */
#define TWR_SEEN5_MAX		128
#define TWR_SEEN5_KEEP		86400
static struct { unsigned char mac[6]; long at; } g_seen5[TWR_SEEN5_MAX];
static struct twr_radio g_radio[2];	/* 這台自己的頻段 */
static int g_nradio;
static char g_events[TWR_MAX_EVENTS][192];
static int g_ev_head, g_ev_count;
static unsigned char g_node[6];
static char g_ip[16], g_name[33];
static int g_weak_dbm = -75, g_strong24_dbm = -50;
static volatile sig_atomic_t g_stop;

static long
mono_sec(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec;
}

static const char *
band_str(int band)
{
	return band == 5 ? "5G" : "2.4G";
}

static void
mac2str(const unsigned char *m, char *out)
{
	sprintf(out, "%02X:%02X:%02X:%02X:%02X:%02X", m[0], m[1], m[2], m[3], m[4], m[5]);
}

static int
str2mac(const char *s, unsigned char *m)
{
	unsigned int b[6];
	int i;
	if (sscanf(s, "%x:%x:%x:%x:%x:%x", &b[0], &b[1], &b[2], &b[3], &b[4], &b[5]) != 6)
		return -1;
	for (i = 0; i < 6; i++)
		m[i] = (unsigned char)b[i];
	return 0;
}

static int
read_if_mac(const char *ifname, unsigned char *mac)
{
	char path[64], s[32];
	FILE *fp;
	snprintf(path, sizeof(path), "/sys/class/net/%s/address", ifname);
	fp = fopen(path, "r");
	if (!fp)
		return -1;
	if (!fgets(s, sizeof(s), fp)) {
		fclose(fp);
		return -1;
	}
	fclose(fp);
	return str2mac(s, mac);
}

/* SSID 只送雜湊（CRC32，IEEE 802.3），不在網路上送明文 */
static unsigned int
ssid_crc32(const char *s)
{
	unsigned int crc = 0xFFFFFFFFu;
	int k;
	while (*s) {
		crc ^= (unsigned char)*s++;
		for (k = 0; k < 8; k++)
			crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
	}
	return ~crc;
}

static void
seen5_note(const unsigned char *mac, long now)
{
	int i, oldest = 0;
	for (i = 0; i < TWR_SEEN5_MAX; i++) {
		if (g_seen5[i].at && memcmp(g_seen5[i].mac, mac, 6) == 0) {
			g_seen5[i].at = now;
			return;
		}
		if (g_seen5[i].at < g_seen5[oldest].at)
			oldest = i;
	}
	memcpy(g_seen5[oldest].mac, mac, 6);
	g_seen5[oldest].at = now;
}

/* 這台裝置最近 24 小時有沒有連過 5G？回傳距今幾秒，沒有就回傳 -1 */
static long
seen5_ago(const unsigned char *mac, long now)
{
	int i;
	for (i = 0; i < TWR_SEEN5_MAX; i++)
		if (g_seen5[i].at && memcmp(g_seen5[i].mac, mac, 6) == 0 && now - g_seen5[i].at <= TWR_SEEN5_KEEP)
			return now - g_seen5[i].at;
	return -1;
}

/* DHCP 租約裡的裝置名稱（找不到就回傳 MAC） */
static const char *
client_name(const unsigned char *mac, char *buf, size_t len)
{
	char line[256], m[18], lm[24], ip[48], host[64];
	FILE *fp;

	mac2str(mac, m);
	snprintf(buf, len, "%s", m);
	fp = fopen("/tmp/dnsmasq.leases", "r");
	if (!fp)
		return buf;
	while (fgets(line, sizeof(line), fp)) {
		if (sscanf(line, "%*s %23s %47s %63s", lm, ip, host) == 3 && strcasecmp(lm, m) == 0) {
			if (strcmp(host, "*") != 0)
				snprintf(buf, len, "%s（%s）", host, m);
			break;
		}
	}
	fclose(fp);
	return buf;
}

static void
event(int to_syslog, const char *fmt, ...)
{
	char msg[160], ts[16];
	time_t now = time(NULL);
	struct tm *tm = localtime(&now);
	va_list ap;
	FILE *fp;
	int i, idx;

	va_start(ap, fmt);
	vsnprintf(msg, sizeof(msg), fmt, ap);
	va_end(ap);
	strftime(ts, sizeof(ts), "%m-%d %H:%M:%S", tm);

	snprintf(g_events[g_ev_head], sizeof(g_events[0]), "%s  %s", ts, msg);
	g_ev_head = (g_ev_head + 1) % TWR_MAX_EVENTS;
	if (g_ev_count < TWR_MAX_EVENTS)
		g_ev_count++;

	fp = fopen(TWR_EVENTS_FILE ".tmp", "w");
	if (fp) {
		for (i = 0; i < g_ev_count; i++) {
			idx = (g_ev_head - g_ev_count + i + TWR_MAX_EVENTS) % TWR_MAX_EVENTS;
			fprintf(fp, "%s\n", g_events[idx]);
		}
		fclose(fp);
		rename(TWR_EVENTS_FILE ".tmp", TWR_EVENTS_FILE);
	}
	if (to_syslog)
		logmessage("漫遊", "%s", msg);
}

/* ---------- 讀本機的裝置訊號表 ---------- */

static int
iw_ioctl(const char *ifname, int cmd, struct iwreq *wrq)
{
	int s, ret;
	s = socket(AF_INET, SOCK_DGRAM, 0);
	if (s < 0)
		return -1;
	strncpy(wrq->ifr_name, ifname, IFNAMSIZ - 1);
	wrq->ifr_name[IFNAMSIZ - 1] = 0;
	ret = ioctl(s, cmd, wrq);
	close(s);
	return ret;
}

static int
entry_rssi(const struct twr_mac_entry *e)
{
	int r = -127;
	if (e->AvgRssi0 && e->AvgRssi0 > r) r = e->AvgRssi0;
	if (e->AvgRssi1 && e->AvgRssi1 > r) r = e->AvgRssi1;
	if (e->AvgRssi2 && e->AvgRssi2 > r) r = e->AvgRssi2;
	return r;
}

typedef void (*twr_entry_cb)(const struct twr_mac_entry *e, int band, int guest, long now);

static void
read_table(const char *ifname, int fixed_band, twr_entry_cb cb, long now)
{
	static unsigned char buf[4096];
	struct iwreq wrq;
	unsigned long num;
	size_t max, i;

	if (!ifname || !*ifname)
		return;
#ifdef TWR_TEST
	/* 測試用：從檔案讀假的訊號表（每行「MAC 訊號 ApIdx」），正式韌體不編入 */
	{
		char path[128], line[64], ms[24];
		int r, idx;
		FILE *tf;
		struct twr_mac_entry fe;
		snprintf(path, sizeof(path), "%s.%s", getenv("TWR_FAKE") ? getenv("TWR_FAKE") : "/tmp/twr", ifname);
		tf = fopen(path, "r");
		if (!tf)
			return;
		while (fgets(line, sizeof(line), tf)) {
			if (sscanf(line, "%23s %d %d", ms, &r, &idx) != 3)
				continue;
			memset(&fe, 0, sizeof(fe));
			str2mac(ms, fe.Addr);
			fe.AvgRssi0 = (signed char)r;
			fe.ApIdx = (unsigned char)idx;
			cb(&fe, fixed_band, idx != 0, now);
		}
		fclose(tf);
		return;
	}
#endif
	memset(buf, 0, sizeof(buf));
	memset(&wrq, 0, sizeof(wrq));
	wrq.u.data.pointer = buf;
	wrq.u.data.length = sizeof(buf);
	if (iw_ioctl(ifname, RTPRIV_IOCTL_GET_MAC_TABLE_STRUCT, &wrq) < 0)
		return;

	memcpy(&num, buf, sizeof(num));
	max = (sizeof(buf) - sizeof(unsigned long)) / sizeof(struct twr_mac_entry);
	if (num > max)
		num = max;
	for (i = 0; i < num; i++) {
		const struct twr_mac_entry *e = (const struct twr_mac_entry *)
			(buf + sizeof(unsigned long) + i * sizeof(struct twr_mac_entry));
		int band = fixed_band, guest;
#if defined (BOARD_MT7915_DBDC)
		/* DBDC：一次回傳兩個頻段；ApIdx 0/1＝2.4G 主／訪客，2/3＝5G 主／訪客 */
		band = (e->ApIdx >= 2) ? 5 : 2;
		guest = (e->ApIdx == 1 || e->ApIdx == 3);
#else
		guest = (e->ApIdx != 0);
#endif
		cb(e, band, guest, now);
	}
}

static struct twr_local *
local_find(const unsigned char *mac, int create)
{
	int i, free_i = -1;
	for (i = 0; i < TWR_MAX_LOCAL; i++) {
		if (g_local[i].used && memcmp(g_local[i].mac, mac, 6) == 0)
			return &g_local[i];
		if (!g_local[i].used && free_i < 0)
			free_i = i;
	}
	if (!create || free_i < 0)
		return NULL;
	memset(&g_local[free_i], 0, sizeof(g_local[0]));
	memcpy(g_local[free_i].mac, mac, 6);
	g_local[free_i].used = 1;
	return &g_local[free_i];
}

static int g_peer_count(long now);
static void roam_note(const unsigned char *mac, const char *type, const char *from, const char *to, int rf, int rt);

/* 這台裝置最近是不是在別台 AP（剛離開或還在報告裡）？回傳那台與當時訊號 */
static struct twr_peer *
peer_had(const unsigned char *mac, long now, int *band, int *rssi)
{
	int i, j;
	for (i = 0; i < TWR_MAX_PEERS; i++) {
		struct twr_peer *p = &g_peer[i];
		if (!p->used || now - p->last_seen > TWR_PEER_EXPIRE)
			continue;
		for (j = 0; j < p->ngone; j++) {
			if (memcmp(p->gone[j].mac, mac, 6) == 0 && now - p->gone[j].at <= TWR_ROAM_WINDOW) {
				*band = p->gone[j].band;
				*rssi = p->gone[j].rssi;
				p->gone[j].at = -1000000;	/* 用過了 */
				return p;
			}
		}
		for (j = 0; j < p->ncli; j++) {
			if (memcmp(p->cli[j].mac, mac, 6) == 0) {
				*band = p->cli[j].band;
				*rssi = p->cli[j].rssi;
				return p;
			}
		}
	}
	return NULL;
}

static void
on_entry(const struct twr_mac_entry *e, int band, int guest, long now)
{
	struct twr_local *c;
	int rssi = entry_rssi(e);
	char name[96];

	/* 還沒有訊號樣本（AvgRssi 全是 0：剛開始認證、802.11r 交換金鑰中）：不建立、不算換頻段、不拿 -127 當訊號。
	 * 2026-11-22 實機：電腦 FT 換到 2.4G 失敗的那一刻被記成「5G → 2.4G（-127 dBm）」、「離開前訊號 -127 dBm」 */
	if (rssi == -127) {
		c = local_find(e->Addr, 0);
		if (c && c->band == band)
			c->missing = 0;
		return;
	}
	c = local_find(e->Addr, 1);
	if (!c)
		return;
	if (c->first_seen == 0) {
		int pband = 0, prssi = 0;
		struct twr_peer *p = peer_had(e->Addr, now, &pband, &prssi);
		c->first_seen = now;
		c->band = band;
		c->band_since = now;
		c->drop_rssi = rssi;
		c->ema16 = rssi * 16;
		if (p) {
			char fr[28], to[28];
			event(1, "換 AP：%s 從 %s %s（%s，%d dBm）到這台（%s，%d dBm）",
			      client_name(e->Addr, name, sizeof(name)), p->name, p->ip, band_str(pband), prssi, band_str(band), rssi);
			snprintf(fr, sizeof(fr), "%.20s %s", p->name, band_str(pband));
			snprintf(to, sizeof(to), "%.20s %s", g_name, band_str(band));
			roam_note(e->Addr, "roam", fr, to, prssi, rssi);
		}
	} else if (c->band != band && c->missing < TWR_GONE_POLLS) {
		event(1, "換頻段：%s %s → %s（%d dBm）",
		      client_name(e->Addr, name, sizeof(name)), band_str(c->band), band_str(band), rssi);
		roam_note(e->Addr, "band", band_str(c->band), band_str(band), c->ema, rssi);
		c->band = band;
		c->band_since = now;
		c->drop_rssi = rssi;
		c->fb_n = 0;
		c->ema16 = rssi * 16;
		c->weak_since = 0;
	}
	c->guest = guest;
	c->psm = e->Psm ? 1 : 0;
	c->rssi = rssi;
	c->ema16 += (rssi * 16 - c->ema16) / 4;
	c->ema = (c->ema16 >= 0 ? c->ema16 + 8 : c->ema16 - 8) / 16;
	c->conn = e->ConnectedTime;
	c->last_seen = now;
	c->missing = 0;
	if (band == 5 && !guest)
		seen5_note(e->Addr, now);
}

static void
poll_local(long now)
{
	int i;
	char name[96];

	for (i = 0; i < TWR_MAX_LOCAL; i++)
		if (g_local[i].used)
			g_local[i].missing++;

#if defined (BOARD_MT7915_DBDC)
	read_table(IFNAME_5G_MAIN, 5, on_entry, now);
#else
	read_table(IFNAME_2G_MAIN, 2, on_entry, now);
#if BOARD_HAS_5G_RADIO
	read_table(IFNAME_5G_MAIN, 5, on_entry, now);
#endif
#endif

	for (i = 0; i < TWR_MAX_LOCAL; i++) {
		struct twr_local *c = &g_local[i];
		if (!c->used)
			continue;
		if (c->missing >= TWR_GONE_POLLS) {
			/* 離開：記到報告裡的「最近離開」，讓接到它的那台判斷是漫遊 */
			if (c->weak_since)
				event(0, "離開：%s（離開前訊號 %d dBm，弱訊號持續 %ld 秒）",
				      client_name(c->mac, name, sizeof(name)), c->ema, now - c->weak_since);
			c->used = 0;
			continue;
		}
		if (c->missing)
			continue;

		/* 弱訊號計時 */
		if (c->ema <= g_weak_dbm) {
			if (!c->weak_since)
				c->weak_since = now;
		} else if (c->ema > g_weak_dbm + 3) {
			c->weak_since = 0;	/* 3 dB 遲滯，避免來回跳 */
		}

		/* 建議一：訊號太弱超過 20 秒，而且家裡還有別台 AP */
		if (c->weak_since && now - c->weak_since >= 20 && g_peer_count(now) > 0 &&
		    (!c->sug_weak_at || now - c->sug_weak_at >= 600)) {
			c->sug_weak_at = now;
			event(1, "建議：%s 在這台訊號 %d dBm 已 %ld 秒，家裡還有 %d 台 AP，換過去可能比較好",
			      client_name(c->mac, name, sizeof(name)), c->ema, now - c->weak_since, g_peer_count(now));
		}
#if BOARD_HAS_5G_RADIO
		/* 建議二：2.4G 訊號很好，可以用 5G（同一個 SSID 時手機應該自己會換） */
		if (c->band == 2 && !c->guest && c->ema >= g_strong24_dbm && now - c->first_seen >= 60 &&
		    (!c->sug_band_at || now - c->sug_band_at >= 1800)) {
			c->sug_band_at = now;
			event(0, "建議：%s 在 2.4G 訊號 %d dBm，很強，可以用 5G（裝置不支援 5G 時可忽略）",
			      client_name(c->mac, name, sizeof(name)), c->ema);
		}
#endif
	}
}

/* ---------- 區網交換 ---------- */

static int
g_peer_count(long now)
{
	int i, n = 0;
	for (i = 0; i < TWR_MAX_PEERS; i++)
		if (g_peer[i].used && now - g_peer[i].last_seen <= TWR_PEER_EXPIRE)
			n++;
	return n;
}

static int
if_channel(const char *ifname)
{
	struct iwreq wrq;
	memset(&wrq, 0, sizeof(wrq));
	if (iw_ioctl(ifname, SIOCGIWFREQ, &wrq) < 0)
		return 0;
	if (wrq.u.freq.e == 0 && wrq.u.freq.m > 0 && wrq.u.freq.m < 200)
		return wrq.u.freq.m;
	{
		double f = wrq.u.freq.m;
		int e = wrq.u.freq.e;
		while (e-- > 0)
			f *= 10;
		f /= 1e6;	/* MHz */
		if (f >= 2412 && f <= 2484)
			return (f == 2484) ? 14 : (int)((f - 2407) / 5);
		if (f >= 5000 && f <= 5900)
			return (int)((f - 5000) / 5);
	}
	return 0;
}

/* 這台自己的頻段（每 5 秒報告前更新）：BSSID、頻道、頻寬、裝置數、SSID 雜湊、k/v/r */
static void
fill_radio(struct twr_radio *r, int band, const char *ifname, int is_aband)
{
	int i, bw, n = 0;
	char *p = r->cap;

	memset(r, 0, sizeof(*r));
	r->band = band;
	r->ch = if_channel(ifname);
#ifdef TWR_TEST
	{
		char key[32];
		snprintf(key, sizeof(key), "TWR_BSSID_%d", band);
		if (getenv(key))
			str2mac(getenv(key), r->bssid);
		if (!r->ch)
			r->ch = band == 5 ? 36 : 1;
	}
#else
	read_if_mac(ifname, r->bssid);
#endif
	bw = nvram_wlan_get_int(is_aband, "HT_BW");
	r->bw = bw >= 3 ? 160 : bw == 2 ? 80 : bw == 1 ? 40 : 20;
	if (band == 2 && r->bw > 40)
		r->bw = 40;
	r->ssid_hash = ssid_crc32(nvram_wlan_get(is_aband, "ssid"));
	for (i = 0; i < TWR_MAX_LOCAL; i++)
		if (g_local[i].used && !g_local[i].missing && !g_local[i].guest && g_local[i].band == band)
			n++;
	r->ncli = n;
	/* k／v 是同一個開關（HT_80211KV）；驅動有沒有編進去看機型（見 docs/ROAM-COOP.md 第 8 節） */
	if (nvram_wlan_get_int(is_aband, "HT_80211KV")) {
		*p++ = 'k';
		*p++ = 'v';
	}
	if (nvram_wlan_get_int(is_aband, "HT_80211R"))
		*p++ = 'r';
	if (p == r->cap)
		*p++ = '-';
	*p = 0;
}

static void
update_radios(void)
{
	g_nradio = 0;
	fill_radio(&g_radio[g_nradio], 2, IFNAME_2G_MAIN, 0);
	if (g_radio[g_nradio].ch > 0)
		g_nradio++;
#if BOARD_HAS_5G_RADIO
	fill_radio(&g_radio[g_nradio], 5, IFNAME_5G_MAIN, 1);
	if (g_radio[g_nradio].ch > 0)
		g_nradio++;
#endif
}

static int
make_socket(void)
{
	struct sockaddr_in a;
	struct ip_mreq mr;
	struct in_addr ifaddr;
	unsigned char ttl = 1, loop = 0;
#ifdef TWR_TEST
	loop = 1;
#endif
	int s, on = 1;

	s = socket(AF_INET, SOCK_DGRAM, 0);
	if (s < 0)
		return -1;
	setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &on, sizeof(on));
	memset(&a, 0, sizeof(a));
	a.sin_family = AF_INET;
	a.sin_port = htons(TWR_PORT);
	a.sin_addr.s_addr = htonl(INADDR_ANY);
	if (bind(s, (struct sockaddr *)&a, sizeof(a)) < 0) {
		close(s);
		return -1;
	}
	inet_aton(g_ip, &ifaddr);
	memset(&mr, 0, sizeof(mr));
	inet_aton(TWR_GROUP, &mr.imr_multiaddr);
	mr.imr_interface = ifaddr;
	setsockopt(s, IPPROTO_IP, IP_ADD_MEMBERSHIP, &mr, sizeof(mr));
	setsockopt(s, IPPROTO_IP, IP_MULTICAST_IF, &ifaddr, sizeof(ifaddr));
	setsockopt(s, IPPROTO_IP, IP_MULTICAST_TTL, &ttl, sizeof(ttl));
	setsockopt(s, IPPROTO_IP, IP_MULTICAST_LOOP, &loop, sizeof(loop));
#ifndef TWR_TEST
	setsockopt(s, SOL_SOCKET, SO_BINDTODEVICE, IFNAME_BR, strlen(IFNAME_BR) + 1);
#endif
	return s;
}

/* 報告格式（文字，一行一筆；docs/ROAM-COOP.md 第 4 節）：
 *   TWR2 <節點 MAC> <IP> <2.4G 頻道> <5G 頻道>
 *   N <名稱>
 *   R <頻段> <BSSID> <頻道> <頻寬> <裝置數> <SSID 雜湊> <能力>    每個頻段一行（TWR2 新增）
 *   C <裝置 MAC> <頻段> <訊號>
 *   G <裝置 MAC> <頻段> <訊號> <幾秒前離開>      （最近 30 秒內離開的裝置）
 * 收的時候 TWR1、TWR2 都接受（TWR1 沒有 R 行）。
 */
static struct { unsigned char mac[6]; int band, rssi; long at; } g_recent_gone[32];
static int g_recent_n;

static void
note_gone(const struct twr_local *c, long now)
{
	int i = g_recent_n < 32 ? g_recent_n++ : (int)(now % 32);
	memcpy(g_recent_gone[i].mac, c->mac, 6);
	g_recent_gone[i].band = c->band;
	g_recent_gone[i].rssi = c->ema;
	g_recent_gone[i].at = now;
}

static void
send_report(int s, long now)
{
	char buf[1400], m[18];
	struct sockaddr_in to;
	int len, i, ch2, ch5 = 0;

	ch2 = if_channel(IFNAME_2G_MAIN);
#if BOARD_HAS_5G_RADIO
	ch5 = if_channel(IFNAME_5G_MAIN);
#endif
	mac2str(g_node, m);
	len = snprintf(buf, sizeof(buf), "TWR2 %s %s %d %d\nN %s\n", m, g_ip, ch2, ch5, g_name);
	for (i = 0; i < g_nradio; i++) {
		mac2str(g_radio[i].bssid, m);
		len += snprintf(buf + len, sizeof(buf) - len, "R %d %s %d %d %d %08x %s\n", g_radio[i].band, m,
				g_radio[i].ch, g_radio[i].bw, g_radio[i].ncli, g_radio[i].ssid_hash, g_radio[i].cap);
	}
	for (i = 0; i < TWR_MAX_LOCAL && len < (int)sizeof(buf) - 40; i++) {
		if (!g_local[i].used || g_local[i].missing)
			continue;
		mac2str(g_local[i].mac, m);
		len += snprintf(buf + len, sizeof(buf) - len, "C %s %d %d\n", m, g_local[i].band, g_local[i].ema);
	}
	for (i = 0; i < g_recent_n && len < (int)sizeof(buf) - 48; i++) {
		if (now - g_recent_gone[i].at > TWR_ROAM_WINDOW)
			continue;
		mac2str(g_recent_gone[i].mac, m);
		len += snprintf(buf + len, sizeof(buf) - len, "G %s %d %d %ld\n", m,
				g_recent_gone[i].band, g_recent_gone[i].rssi, now - g_recent_gone[i].at);
	}

	memset(&to, 0, sizeof(to));
	to.sin_family = AF_INET;
	to.sin_port = htons(TWR_PORT);
	inet_aton(TWR_GROUP, &to.sin_addr);
	sendto(s, buf, len, 0, (struct sockaddr *)&to, sizeof(to));
}

static void
recv_report(int s, long now)
{
	char buf[1500], *line, *save = NULL;
	char m[24], ip[24];
	unsigned char node[6];
	struct twr_peer *p = NULL;
	int n, i, ch2, ch5, ver, free_i = -1;
	struct twr_radio prev[2];
	int nprev;

	n = recv(s, buf, sizeof(buf) - 1, MSG_DONTWAIT);
	if (n <= 0)
		return;
	buf[n] = 0;
	if (sscanf(buf, "TWR%d %23s %23s %d %d", &ver, m, ip, &ch2, &ch5) != 5 || ver < 1 || str2mac(m, node) != 0)
		return;
	if (memcmp(node, g_node, 6) == 0)
		return;

	for (i = 0; i < TWR_MAX_PEERS; i++) {
		if (g_peer[i].used && memcmp(g_peer[i].node, node, 6) == 0) {
			p = &g_peer[i];
			break;
		}
		if ((!g_peer[i].used || now - g_peer[i].last_seen > 300) && free_i < 0)
			free_i = i;
	}
	if (!p) {
		if (free_i < 0)
			return;
		p = &g_peer[free_i];
		memset(p, 0, sizeof(*p));
		memcpy(p->node, node, 6);
		p->used = 1;
		event(1, "找到另一台 AP：%s（%s）", m, ip);
	}
	snprintf(p->ip, sizeof(p->ip), "%.15s", ip);
	snprintf(p->name, sizeof(p->name), "%.15s", ip);
	p->ch2 = ch2;
	p->ch5 = ch5;
	p->last_seen = now;
	nprev = p->nradio;
	memcpy(prev, p->radio, sizeof(prev));
	p->ver = ver;
	p->ncli = 0;
	p->nradio = 0;

	line = strtok_r(buf, "\n", &save);
	while ((line = strtok_r(NULL, "\n", &save)) != NULL) {
		char cm[24], cap[8];
		int band, rssi, rch, rbw, rn;
		unsigned int rh;
		long ago;
		unsigned char cmac[6];

		if (line[0] == 'N' && line[1] == ' ') {
			snprintf(p->name, sizeof(p->name), "%s", line + 2);
		} else if (sscanf(line, "R %d %23s %d %d %d %x %7s", &band, cm, &rch, &rbw, &rn, &rh, cap) == 7 &&
			   str2mac(cm, cmac) == 0 && (band == 2 || band == 5)) {
			if (p->nradio < 2) {
				struct twr_radio *r = &p->radio[p->nradio++];
				int changed = 0, k;
				for (k = 0; k < nprev; k++)
					if (prev[k].band == band &&
					    (prev[k].ch != rch || memcmp(prev[k].bssid, cmac, 6) != 0))
						changed = 1;
				memset(r, 0, sizeof(*r));
				r->band = band;
				memcpy(r->bssid, cmac, 6);
				r->ch = rch;
				r->bw = rbw;
				r->ncli = rn;
				r->ssid_hash = rh;
				snprintf(r->cap, sizeof(r->cap), "%.3s", cap);
				if (changed)
					event(0, "%s 的 %s 換到頻道 %d", p->name, band_str(band), rch);
			}
		} else if (sscanf(line, "C %23s %d %d", cm, &band, &rssi) == 3 && str2mac(cm, cmac) == 0) {
			if (p->ncli < TWR_MAX_PEER_CLI) {
				memcpy(p->cli[p->ncli].mac, cmac, 6);
				p->cli[p->ncli].band = band;
				p->cli[p->ncli].rssi = rssi;
				p->ncli++;
			}
			if (band == 5)
				seen5_note(cmac, now);
		} else if (sscanf(line, "G %23s %d %d %ld", cm, &band, &rssi, &ago) == 4 && str2mac(cm, cmac) == 0) {
			int k, found = 0;
			for (k = 0; k < p->ngone; k++) {
				if (memcmp(p->gone[k].mac, cmac, 6) == 0) {
					found = 1;
					break;
				}
			}
			if (!found) {
				k = p->ngone < 32 ? p->ngone++ : (int)(now % 32);
				memcpy(p->gone[k].mac, cmac, 6);
				p->gone[k].band = band;
				p->gone[k].rssi = rssi;
				p->gone[k].at = now - ago;
			}
		}
	}
}

/* ---------- 決定層：問 → 比 → 建議 → 看結果（docs/ROAM-COOP.md 第 6 節） ---------- */

#define TWR_MODE_OBSERVE	1
#define TWR_MODE_SUGGEST	2

#define K_CROSS		1	/* 換到別台 AP */
#define K_TO5		2	/* 同一台 2.4G → 5G */
#define K_TO24		3	/* 同一台 5G → 2.4G */
#define K_BACK5		4	/* 暫時掉到 2.4G，回到 5G */

#define TWR_MAX_HIST	128
#define TWR_MAX_REP	8
#define TWR_MAX_CAND	8
#define TWR_RESULT_SEC	15	/* 建議後幾秒內要在目標出現 */
#define TWR_DAY_MAX	6	/* 每台裝置每天最多建議幾次 */
#define TWR_HOUR_MAX	12	/* 每台 AP 每小時最多建議幾次，超過就退回觀察模式 */

#ifndef TWR_TEST
#define TWR_ROAMLOG	"/etc/storage/tw-diag/roam.log"
#else
#define TWR_ROAMLOG	"roam.log"
#endif
#define TWR_ROAMLOG_MAX	16384	/* 超過就換到 roam.log.1，兩個合計最多 32 KB */
#define TWR_SIG_N	96	/* 24 小時 × 每 15 分鐘 */
#define TWR_SIG_STEP	900
#define TWR_DEV_LOG	12	/* 每台裝置保留幾筆斷線／漫遊 */
#define TWR_MAX_REV	50	/* 漫遊頁的事件 */
#ifndef TWR_TEST
#define TWR_JSON_FILE	"/tmp/tw-roamd.json"
#define TWR_DEV_FILE	"/tmp/tw-roamd.devices"
#else
#define TWR_JSON_FILE	"tw-roamd.json"
#define TWR_DEV_FILE	"tw-roamd.devices"
#endif

/* 每台裝置的決定紀錄：裝置離開這台也保留（退避、次數要一直算到重開機） */
struct twr_hist {
	unsigned char mac[6];
	int used;
	long last;
	int k, v;			/* 支援 11k／11v：1 是、0 否、-1 不知道 */
	int k_noreply[2];		/* 各頻段連續幾次問了沒回報 */
	int k_dead[2];			/* 在這個頻段問了 3 次都沒回：先不在這個頻段問（另一個頻段照常） */
	int rcpi_signed;		/* 這台把 RSSI（有號數 dBm）填在 RCPI 欄位 */
	long ask_at;			/* 上次送 Beacon Request */
	int ask_rssi, ask_ch, ask_band, ask_seq, ask_counted;
	long rep_at;			/* 上次收到回報 */
	int rep_new;			/* 有新回報還沒比 */
	int nrep;
	struct { unsigned char bssid[6]; int ch, dbm; long at; } rep[TWR_MAX_REP];
	unsigned char cand[6];		/* 確認中的目標 */
	int cand_kind, cand_n;
	long cand_at;
	int pend;			/* 已建議、等結果 */
	unsigned char pend_bssid[6];
	int pend_band, pend_kind, pend_cur, pend_dbm, pend_real;
	long pend_at;
	int ignore_n;			/* 連續不理會次數 */
	long backoff_until;
	int day_n;
	long day_start;
	long back5_at;			/* 上次成功回到 5G */
	int n_sug, n_ok;
	/* 裝置頁（/tw_api.asp?q=device&mac=）：24 小時訊號（每 15 分鐘一點）、斷線、漫遊；時間都是 Unix 秒 */
	long sig_s[TWR_SIG_N];		/* 這一格是第幾個 15 分鐘（time/900），0＝沒有 */
	short sig_v[TWR_SIG_N];
	long sig_cur;			/* 正在累計的格子 */
	int sig_sum, sig_cnt;
	long gone_at;			/* 離開這台的時間（Unix 秒），20 秒後確認是不是換到別台 */
	int gone_rssi, gone_weak;
	int ndisc;
	struct { long ts; char reason[48]; } disc[TWR_DEV_LOG];
	int nroam;
	struct { long ts; char from[28], to[28]; int rf, rt; } roam[TWR_DEV_LOG];
	int dirty;			/* 裝置檔要重寫 */
};

static struct twr_hist g_hist[TWR_MAX_HIST];
static struct twr_drv_caps g_caps;
static int g_mode = TWR_MODE_OBSERVE;	/* 實際模式（超過上限時會自動降回觀察） */
static int g_mode_cfg = TWR_MODE_OBSERVE;	/* nvram 設定的模式 */
static int g_token = 1;
/* 同一個頻段一次只有一個 Beacon Request／BTM 在等回應：MT7603 的量測表會把 500 ms 以前的請求擠掉，
 * BTM 回覆的對應也只認清單第一筆（驅動的毛病），所以排隊一個一個來 */
static long g_ask_busy[2], g_btm_busy[2];
static long g_hour_start;
static int g_hour_n;
static struct { int ask, rep, sug, ok, ign, rej, back5; } g_st;

static const char *
kind_str(int k)
{
	switch (k) {
	case K_CROSS:	return "換 AP";
	case K_TO5:	return "2.4G→5G";
	case K_TO24:	return "5G→2.4G";
	case K_BACK5:	return "回 5G";
	}
	return "?";
}

static int
bidx(int band)
{
	return band == 5 ? 1 : 0;
}

static int
next_token(void)
{
	g_token = g_token % 255 + 1;
	return g_token;
}

/* 決定紀錄：系統日誌＋事件＋ roam.log（循環） */
static void
roam_log(const char *fmt, ...)
{
	char msg[160], ts[24];
	time_t t = time(NULL);
	va_list ap;
	FILE *fp;
	long sz = 0;

	va_start(ap, fmt);
	vsnprintf(msg, sizeof(msg), fmt, ap);
	va_end(ap);
	event(1, "%s", msg);

	fp = fopen(TWR_ROAMLOG, "a");
	if (!fp) {
#ifndef TWR_TEST
		mkdir("/etc/storage/tw-diag", 0755);
#endif
		fp = fopen(TWR_ROAMLOG, "a");
	}
	if (!fp)
		return;
	strftime(ts, sizeof(ts), "%Y-%m-%d %H:%M:%S", localtime(&t));
	fprintf(fp, "%s ROAM %s\n", ts, msg);
	sz = ftell(fp);
	fclose(fp);
	if (sz > TWR_ROAMLOG_MAX)
		rename(TWR_ROAMLOG, TWR_ROAMLOG ".1");
}

static struct twr_hist *
hist_find(const unsigned char *mac, int create, long now)
{
	int i, oldest = -1;
	for (i = 0; i < TWR_MAX_HIST; i++) {
		if (g_hist[i].used && memcmp(g_hist[i].mac, mac, 6) == 0) {
			g_hist[i].last = now;
			return &g_hist[i];
		}
	}
	if (!create)
		return NULL;
	/* 先用空的；滿了就擠掉最久沒用、而且沒在等結果的 */
	for (i = 0; i < TWR_MAX_HIST; i++) {
		if (!g_hist[i].used) {
			oldest = i;
			break;
		}
		if (!g_hist[i].pend && (oldest < 0 || g_hist[i].last < g_hist[oldest].last))
			oldest = i;
	}
	if (oldest < 0)
		return NULL;
	memset(&g_hist[oldest], 0, sizeof(g_hist[0]));
	memcpy(g_hist[oldest].mac, mac, 6);
	g_hist[oldest].used = 1;
	g_hist[oldest].last = now;
	g_hist[oldest].k = g_hist[oldest].v = -1;
	g_hist[oldest].day_start = now;
	return &g_hist[oldest];
}

/* ---------- 給網頁的資料（漫遊頁、裝置頁） ---------- */

/* 漫遊頁的事件（新的在後） */
static struct {
	long ts;
	unsigned char mac[6];
	char type[8];			/* roam（換 AP）／band（同一台換頻段） */
	char from[28], to[28];
	int rf, rt;
} g_rev[TWR_MAX_REV];
static int g_rev_n, g_rev_head;

static void
roam_note(const unsigned char *mac, const char *type, const char *from, const char *to, int rf, int rt)
{
	long wall = (long)time(NULL);
	struct twr_hist *h = hist_find(mac, 1, mono_sec());
	int i = g_rev_head;

	memcpy(g_rev[i].mac, mac, 6);
	g_rev[i].ts = wall;
	snprintf(g_rev[i].type, sizeof(g_rev[i].type), "%s", type);
	snprintf(g_rev[i].from, sizeof(g_rev[i].from), "%s", from);
	snprintf(g_rev[i].to, sizeof(g_rev[i].to), "%s", to);
	g_rev[i].rf = rf;
	g_rev[i].rt = rt;
	g_rev_head = (g_rev_head + 1) % TWR_MAX_REV;
	if (g_rev_n < TWR_MAX_REV)
		g_rev_n++;
	if (h) {
		int k;
		if (h->nroam < TWR_DEV_LOG) {
			k = h->nroam++;
		} else {
			memmove(&h->roam[0], &h->roam[1], sizeof(h->roam[0]) * (TWR_DEV_LOG - 1));
			k = TWR_DEV_LOG - 1;
		}
		h->roam[k].ts = wall;
		snprintf(h->roam[k].from, sizeof(h->roam[k].from), "%s", from);
		snprintf(h->roam[k].to, sizeof(h->roam[k].to), "%s", to);
		h->roam[k].rf = rf;
		h->roam[k].rt = rt;
		h->dirty = 1;
	}
}

static void
dev_disc(struct twr_hist *h, long ts, const char *reason)
{
	int k;
	if (h->ndisc < TWR_DEV_LOG) {
		k = h->ndisc++;
	} else {
		memmove(&h->disc[0], &h->disc[1], sizeof(h->disc[0]) * (TWR_DEV_LOG - 1));
		k = TWR_DEV_LOG - 1;
	}
	h->disc[k].ts = ts;
	snprintf(h->disc[k].reason, sizeof(h->disc[k].reason), "%s", reason);
	h->dirty = 1;
}

/* 每 2 秒記一次訊號，累計成 15 分鐘一點（平均） */
static void
sig_note(struct twr_hist *h, int rssi)
{
	long slot = (long)time(NULL) / TWR_SIG_STEP;
	if (slot != h->sig_cur) {
		if (h->sig_cur && h->sig_cnt) {
			int i = h->sig_cur % TWR_SIG_N;
			h->sig_s[i] = h->sig_cur;
			h->sig_v[i] = (short)(h->sig_sum / h->sig_cnt);
			h->dirty = 1;
		}
		h->sig_cur = slot;
		h->sig_sum = h->sig_cnt = 0;
	}
	h->sig_sum += rssi;
	h->sig_cnt++;
}

/* 離開這台：先記下，20 秒後看是不是出現在別台（那是漫遊，不算斷線） */
static void
dev_gone(const struct twr_local *c)
{
	struct twr_hist *h;
	if (c->guest)
		return;
	h = hist_find(c->mac, 0, mono_sec());
	if (!h)
		return;
	h->gone_at = (long)time(NULL);
	h->gone_rssi = c->ema;
	h->gone_weak = c->weak_since != 0;
}

static int
on_some_peer(const unsigned char *mac, long now)
{
	int i, j;
	for (i = 0; i < TWR_MAX_PEERS; i++) {
		const struct twr_peer *p = &g_peer[i];
		if (!p->used || now - p->last_seen > TWR_PEER_EXPIRE)
			continue;
		for (j = 0; j < p->ncli; j++)
			if (memcmp(p->cli[j].mac, mac, 6) == 0)
				return 1;
	}
	return 0;
}

static void
gone_check(struct twr_hist *h, long now)
{
	long wall = (long)time(NULL);
	struct twr_local *c;
	char r[48];

	if (!h->gone_at || wall - h->gone_at < 20)
		return;
	c = local_find(h->mac, 0);
	if (!(c && !c->missing) && !on_some_peer(h->mac, now)) {
		if (h->gone_weak)
			snprintf(r, sizeof(r), "訊號太弱（%d dBm）", h->gone_rssi);
		else
			snprintf(r, sizeof(r), "離線（最後 %d dBm）", h->gone_rssi);
		dev_disc(h, h->gone_at, r);
	}
	h->gone_at = 0;
}

/* DHCP 租約的主機名稱（沒有就空字串） */
static const char *
client_host(const unsigned char *mac, char *buf, size_t len)
{
	char line[256], m[18], lm[24], ip[48], host[64];
	FILE *fp;

	buf[0] = 0;
	mac2str(mac, m);
	fp = fopen("/tmp/dnsmasq.leases", "r");
	if (!fp)
		return buf;
	while (fgets(line, sizeof(line), fp)) {
		if (sscanf(line, "%*s %23s %47s %63s", lm, ip, host) == 3 && strcasecmp(lm, m) == 0) {
			if (strcmp(host, "*") != 0)
				snprintf(buf, len, "%s", host);
			break;
		}
	}
	fclose(fp);
	return buf;
}

/* JSON 字串（含引號）；控制字元與引號、反斜線都跳脫 */
static void
json_str(FILE *fp, const char *s)
{
	fputc('"', fp);
	for (; *s; s++) {
		unsigned char ch = (unsigned char)*s;
		if (ch == '"' || ch == '\\')
			fprintf(fp, "\\%c", ch);
		else if (ch < 0x20)
			fprintf(fp, "\\u%04x", ch);
		else
			fputc(ch, fp);
	}
	fputc('"', fp);
}

/* 自己的頻段（radio） */
static const struct twr_radio *
own_radio(int band)
{
	int i;
	for (i = 0; i < g_nradio; i++)
		if (g_radio[i].band == band)
			return &g_radio[i];
	return NULL;
}

/* 某個 BSSID 是誰的：本機（*peer＝NULL）或哪台 AP；找不到回傳 NULL */
static const struct twr_radio *
radio_by_bssid(const unsigned char *bssid, long now, const struct twr_peer **peer)
{
	int i, j;
	*peer = NULL;
	for (i = 0; i < g_nradio; i++)
		if (memcmp(g_radio[i].bssid, bssid, 6) == 0)
			return &g_radio[i];
	for (i = 0; i < TWR_MAX_PEERS; i++) {
		const struct twr_peer *p = &g_peer[i];
		if (!p->used || now - p->last_seen > TWR_PEER_EXPIRE)
			continue;
		for (j = 0; j < p->nradio; j++)
			if (memcmp(p->radio[j].bssid, bssid, 6) == 0) {
				*peer = p;
				return &p->radio[j];
			}
	}
	return NULL;
}

/* 裝置目前頻段的候選：同 SSID 的本機另一個頻段＋別台 AP 的頻段 */
static int
cands_for(int band, struct twr_nbr *out, int max, long now)
{
	const struct twr_radio *me = own_radio(band);
	int i, j, n = 0, my_r;

	if (!me)
		return 0;
	/* Mobility Domain 位元：目前這個頻段跟候選都開 802.11r 才算（同 SSID 時 Mobility Domain 一樣，見 ralink.c） */
	my_r = strchr(me->cap, 'r') != NULL;
	for (i = 0; i < g_nradio && n < max; i++) {
		if (g_radio[i].band == band || g_radio[i].ssid_hash != me->ssid_hash)
			continue;
		memcpy(out[n].bssid, g_radio[i].bssid, 6);
		out[n].band = g_radio[i].band;
		out[n].ch = g_radio[i].ch;
		out[n].bw = g_radio[i].bw;
		out[n].pref = 0;
		out[n].ft = my_r && strchr(g_radio[i].cap, 'r') != NULL;
		n++;
	}
	for (i = 0; i < TWR_MAX_PEERS; i++) {
		const struct twr_peer *p = &g_peer[i];
		if (!p->used || now - p->last_seen > TWR_PEER_EXPIRE)
			continue;
		for (j = 0; j < p->nradio && n < max; j++) {
			if (p->radio[j].ssid_hash != me->ssid_hash || !p->radio[j].ch)
				continue;
			memcpy(out[n].bssid, p->radio[j].bssid, 6);
			out[n].band = p->radio[j].band;
			out[n].ch = p->radio[j].ch;
			out[n].bw = p->radio[j].bw;
			out[n].pref = 0;
			out[n].ft = my_r && strchr(p->radio[j].cap, 'r') != NULL;
			n++;
		}
	}
	return n;
}

/* 裝置回報的某個 BSS 訊號（只算這次問之後的），沒有就回傳 0 */
static int
rep_dbm(const struct twr_hist *h, const unsigned char *bssid)
{
	int i;
	for (i = 0; i < h->nrep; i++)
		if (memcmp(h->rep[i].bssid, bssid, 6) == 0 && h->rep[i].at >= h->ask_at)
			return h->rep[i].dbm;
	return 0;
}

static void
on_bcn_report(const struct twr_drv_ev *ev, long now)
{
	struct twr_hist *h = hist_find(ev->sta, 0, now);
	int i, slot = -1, oldest = 0, dbm = ev->dbm;
	char name[96], b[18];

	if (!h)
		return;
	/* 空的報告（BSSID 全 0 或頻道 0）：裝置有回（支援 11k），只是這次什麼都沒量到。
	 * 實測 Mi 10T（2026-11-21 10:09）：RCPI 0 → 照標準是 -110 dBm，以前會被當成一筆量測存起來 */
	if (!ev->ch || !memcmp(ev->bssid, "\0\0\0\0\0\0", 6)) {
		i = bidx(ev->band ? ev->band : h->ask_band);
		h->k_noreply[i] = 0;
		h->k_dead[i] = 0;
		if (ev->band && g_ask_busy[bidx(ev->band)] > now + 1)
			g_ask_busy[bidx(ev->band)] = now + 1;
		event(0, "回報：%s 這次沒量到（空的報告）", client_name(ev->sta, name, sizeof(name)));
		return;
	}
	/* 有些裝置把 RSSI（有號數 dBm）直接填進 RCPI 欄位（實測 Mi 10T：貼近 AP 時報 218，照標準是 -1 dBm，
	 * 當有號數是 -38 dBm，跟它在 2.4G 的訊號相符）。照標準換出 -10 dBm 以上（RCPI 200 以上）只有貼著天線
	 * 才可能，看到一次就記住這台、之後一律當有號數；判斷錯時只會把訊號看得比較弱（少建議），不會亂建議。
	 * 不這樣做的話，這種裝置量到 -80 dBm（176）會被當成 -22 dBm，建議它去收不好的 5G */
	if (!h->rcpi_signed && ev->rcpi >= 200 && ev->rcpi < 255) {
		h->rcpi_signed = 1;
		event(0, "%s 回報的 RCPI 是有號數 dBm（收到 %d），之後照這個換算", client_name(ev->sta, name, sizeof(name)), ev->rcpi);
	}
	if (h->rcpi_signed)
		dbm = (ev->rcpi >= 128 && ev->rcpi < 255) ? ev->rcpi - 256 : 0;
	if (dbm >= 0 || dbm < -110)
		return;
	for (i = 0; i < h->nrep; i++) {
		if (memcmp(h->rep[i].bssid, ev->bssid, 6) == 0)
			slot = i;
		if (h->rep[i].at < h->rep[oldest].at)
			oldest = i;
	}
	if (slot < 0)
		slot = h->nrep < TWR_MAX_REP ? h->nrep++ : oldest;
	memcpy(h->rep[slot].bssid, ev->bssid, 6);
	h->rep[slot].ch = ev->ch;
	h->rep[slot].dbm = dbm;
	h->rep[slot].at = now;
	h->rep_at = now;
	h->rep_new = 1;
	i = bidx(ev->band ? ev->band : h->ask_band);
	h->k_noreply[i] = 0;
	h->k_dead[i] = 0;
	if (ev->band && g_ask_busy[bidx(ev->band)] > now + 1)
		g_ask_busy[bidx(ev->band)] = now + 1;	/* 回來了：再等 1 秒收完同一份報告的其他筆 */
	if (h->k != 1) {
		h->k = 1;
		event(0, "%s 會回 Beacon Report（支援 11k）", client_name(ev->sta, name, sizeof(name)));
	}
	g_st.rep++;
	mac2str(ev->bssid, b);
	event(0, "回報：%s 量到 %s 頻道 %d %d dBm", client_name(ev->sta, name, sizeof(name)), b, ev->ch, dbm);
}

static void
on_btm_resp(const struct twr_drv_ev *ev, long now)
{
	struct twr_hist *h = hist_find(ev->sta, 0, now);
	char name[96];

	if (!h || !h->pend || !h->pend_real)
		return;
	if (ev->status != 0) {
		/* 拒絕＝不理會，一樣退避 */
		roam_log("結果 %s 拒絕建議（狀態 %d）", client_name(ev->sta, name, sizeof(name)), ev->status);
		g_st.rej++;
		h->pend_at = now - TWR_RESULT_SEC - 1;	/* 下一輪當作不理會處理 */
	} else {
		event(0, "%s 接受建議（BTM 回覆 0），等它換過去", client_name(ev->sta, name, sizeof(name)));
	}
}

/* 送出建議（或觀察模式下只記錄） */
static void
suggest(struct twr_local *c, struct twr_hist *h, int kind, const unsigned char *target, int tband, int tdbm, int cur, long now)
{
	const struct twr_peer *peer;
	const struct twr_radio *tr = radio_by_bssid(target, now, &peer);
	struct twr_nbr cand;
	char name[96], where[48];
	int bi = bidx(c->band), real = 0;

	if (!tr)
		return;
	snprintf(where, sizeof(where), "%s%s", peer ? peer->name : "本機", band_str(tr->band));
	if (h->ignore_n >= 3 || now < h->backoff_until)
		return;
	if (now - h->day_start >= 86400) {
		h->day_start = now;
		h->day_n = 0;
	}
	if (h->day_n >= TWR_DAY_MAX)
		return;
	if (h->v == 0 || !g_caps.btm[bi]) {
		/* 裝置不支援 11v 或這顆驅動不能送：什麼都不做，等它自己換 */
		h->cand_n = 0;
		return;
	}
	if (now - g_hour_start >= 3600) {
		g_hour_start = now;
		g_hour_n = 0;
	}
	if (g_hour_n >= TWR_HOUR_MAX) {
		if (g_mode == TWR_MODE_SUGGEST) {
			g_mode = TWR_MODE_OBSERVE;
			roam_log("這一小時已建議 %d 次，超過上限，自動退回觀察模式（重新啟動 tw-roamd 才會恢復）", g_hour_n);
		}
		return;
	}

	client_name(c->mac, name, sizeof(name));
	memset(&cand, 0, sizeof(cand));
	memcpy(cand.bssid, tr->bssid, 6);
	cand.band = tr->band;
	cand.ch = tr->ch;
	cand.bw = tr->bw;
	cand.pref = 255;
	cand.ft = own_radio(c->band) && strchr(own_radio(c->band)->cap, 'r') && strchr(tr->cap, 'r');
	if (g_mode == TWR_MODE_SUGGEST) {
		if (now < g_btm_busy[bi])
			return;		/* 另一台的建議還在等回應，下一輪再說（確認次數保留） */
		if (twr_drv_btm_req(c->band, c->mac, &cand, 1, next_token()) == 0) {
			real = 1;
			g_btm_busy[bi] = now + 12;
		} else {
			event(0, "送 BTM 給 %s 失敗（驅動不接受）", name);
		}
	}
	if (kind == K_BACK5)
		roam_log("%s %s 在 2.4G 待了 %ld 秒，%s %d dBm → %s%s，今日第 %d 次", real ? "回5G" : "（觀察）會建議回5G",
			 name, now - c->band_since, where, tdbm, where, real ? "" : "（沒有送出）", h->day_n + 1);
	else
		roam_log("%s %s %s：目前 %s %d dBm → %s %d dBm（強 %d dB，第 %d 次確認）今日第 %d 次",
			 real ? "建議" : "（觀察）會建議", name, kind_str(kind), band_str(c->band), cur, where, tdbm,
			 tdbm - cur, h->cand_n, h->day_n + 1);
	h->pend = 1;
	h->pend_real = real;
	memcpy(h->pend_bssid, tr->bssid, 6);
	h->pend_band = tr->band;
	h->pend_kind = kind;
	h->pend_cur = cur;
	h->pend_dbm = tdbm;
	h->pend_at = now;
	h->cand_n = 0;
	h->day_n++;
	h->n_sug++;
	g_hour_n++;
	g_st.sug++;
	(void)tband;
}

/* 建議之後有沒有到目標：本機另一個頻段，或目標那台 AP 的 C 行 */
static int
arrived(const struct twr_hist *h, long now)
{
	const struct twr_peer *peer;
	const struct twr_radio *tr = radio_by_bssid(h->pend_bssid, now, &peer);
	int i;

	if (!tr)
		return 0;
	if (!peer) {
		struct twr_local *c = local_find(h->mac, 0);
		return c && !c->missing && c->band == h->pend_band;
	}
	for (i = 0; i < peer->ncli; i++)
		if (memcmp(peer->cli[i].mac, h->mac, 6) == 0 && peer->cli[i].band == tr->band)
			return 1;
	return 0;
}

static void
check_result(struct twr_hist *h, long now)
{
	char name[96];

	if (!h->pend)
		return;
	if (arrived(h, now)) {
		roam_log("結果 %s %ld 秒後到 %s（%s）%s", client_name(h->mac, name, sizeof(name)), now - h->pend_at,
			 band_str(h->pend_band), kind_str(h->pend_kind), h->pend_real ? "" : "（觀察模式，裝置自己換的）");
		if (h->pend_real) {
			h->ignore_n = 0;
			h->backoff_until = 0;
			h->n_ok++;
			g_st.ok++;
			if (h->pend_kind == K_BACK5)
				g_st.back5++;
		}
		if (h->pend_kind == K_BACK5 || h->pend_kind == K_TO5)
			h->back5_at = now;
		h->pend = 0;
		return;
	}
	if (now - h->pend_at <= TWR_RESULT_SEC)
		return;
	h->pend = 0;
	if (!h->pend_real) {
		/* 觀察模式：沒送出，不算不理會；10 分鐘內不再重複同樣的「會建議」 */
		h->backoff_until = now + 600;
		return;
	}
	h->ignore_n++;
	g_st.ign++;
	h->backoff_until = now + (h->ignore_n == 1 ? 600 : h->ignore_n == 2 ? 3600 : 86400);
	roam_log("結果 %s 不理會（第 %d 次）→ %s內不再建議%s", client_name(h->mac, name, sizeof(name)), h->ignore_n,
		 h->ignore_n == 1 ? "10 分鐘" : h->ignore_n == 2 ? "1 小時" : "24 小時",
		 h->ignore_n >= 3 ? "；這次開機期間不再建議它" : "");
}

static int
prio(int k)
{
	return k == K_BACK5 ? 4 : k == K_CROSS ? 3 : k == K_TO5 ? 2 : k == K_TO24 ? 1 : 0;
}

/* 用裝置量到的數字比：回傳目標種類，target／tdbm／cur 填結果；沒有就回傳 0 */
static int
compare(const struct twr_local *c, const struct twr_hist *h, unsigned char *target, int *tdbm, int *cur, long now)
{
	const struct twr_radio *me = own_radio(c->band);
	const struct twr_peer *peer;
	int i, best_k = 0, best_d = -200, d, own = 0;

	if (!me)
		return 0;
	/* 目前連線的訊號：裝置量到自己這台的值優先，沒有就用 AP 聽到的 */
	d = rep_dbm(h, me->bssid);
	*cur = d ? d : c->ema;

	for (i = 0; i < h->nrep; i++) {
		const struct twr_radio *r;
		int k = 0;
		if (h->rep[i].at < h->ask_at || memcmp(h->rep[i].bssid, me->bssid, 6) == 0)
			continue;
		r = radio_by_bssid(h->rep[i].bssid, now, &peer);
		if (!r || r->ssid_hash != me->ssid_hash)
			continue;
		d = h->rep[i].dbm;
		own = (peer == NULL);
		if (c->band == 2 && r->band == 5 && seen5_ago(c->mac, now) >= 0 && now - c->band_since >= 60 && d >= -67)
			k = K_BACK5;
		else if (!own && d >= *cur + 10 && d >= -72)
			k = K_CROSS;
		else if (own && c->band == 2 && r->band == 5 && d >= -65)
			k = K_TO5;
		else if (own && c->band == 5 && r->band == 2 && *cur <= -75 && d >= *cur + 15 &&
			 (now - h->back5_at >= 600 || *cur <= -78))
			k = K_TO24;
		/* 優先順序：回 5G ＞ 換 AP ＞ 2.4G→5G ＞ 5G→2.4G；同一種選裝置量到最強的 */
		if (k && (best_k == 0 || prio(k) > prio(best_k) || (k == best_k && d > best_d))) {
			best_k = k;
			best_d = d;
			memcpy(target, h->rep[i].bssid, 6);
		}
	}
	*tdbm = best_d;
	return best_k;
}

/* 選這次要量的頻道：確認中的目標優先；2.4G 上連過 5G 的量 5G；其他輪流 */
static int
pick_channel(const struct twr_local *c, struct twr_hist *h, const struct twr_nbr *cand, int n, long now)
{
	int i, chs[TWR_MAX_CAND], nch = 0, j;

	if (h->cand_n == 1) {
		const struct twr_peer *peer;
		const struct twr_radio *r = radio_by_bssid(h->cand, now, &peer);
		if (r)
			return r->ch;
	}
	for (i = 0; i < n; i++) {
		if (c->band == 2 && seen5_ago(c->mac, now) >= 0 && cand[i].band != 5)
			continue;
		for (j = 0; j < nch; j++)
			if (chs[j] == cand[i].ch)
				break;
		if (j == nch)
			chs[nch++] = cand[i].ch;
	}
	if (!nch)
		for (i = 0; i < n; i++) {
			for (j = 0; j < nch; j++)
				if (chs[j] == cand[i].ch)
					break;
			if (j == nch)
				chs[nch++] = cand[i].ch;
		}
	if (!nch)
		return 0;
	return chs[(h->ask_seq++) % nch];
}

static void
decide_one(struct twr_local *c, long now)
{
	struct twr_hist *h;
	struct twr_nbr cand[TWR_MAX_CAND];
	int n, bi = bidx(c->band), k, tdbm, cur, min_conn;
	unsigned char target[6];
	char name[96];

	if (c->guest || c->missing)
		return;
	h = hist_find(c->mac, 1, now);
	if (!h)
		return;
	sig_note(h, c->ema);
	h->gone_at = 0;		/* 還在（或又回來了） */
	if (h->k < 0 || h->v < 0) {
		int kk = -1, vv = -1;
		twr_drv_sta_caps(c->band, c->mac, &kk, &vv);
		if (h->k < 0 && kk >= 0)
			h->k = kk;
		if (h->v < 0 && vv >= 0)
			h->v = vv;
	}
	check_result(h, now);
	if (h->pend)
		return;
	n = cands_for(c->band, cand, TWR_MAX_CAND, now);
	if (!n) {
		h->cand_n = 0;
		return;
	}

	/* 有新回報：比 */
	if (h->rep_new) {
		h->rep_new = 0;
		k = compare(c, h, target, &tdbm, &cur, now);
		if (!k) {
			h->cand_n = 0;
		} else if (h->cand_n && memcmp(h->cand, target, 6) == 0 && now - h->cand_at >= 8 && now - h->cand_at <= 120) {
			h->cand_n++;
			h->cand_at = now;
		} else {
			memcpy(h->cand, target, 6);
			h->cand_kind = k;
			h->cand_n = 1;
			h->cand_at = now;
		}
		if (k && h->cand_n >= 2 && !c->psm)
			suggest(c, h, k, target, 0, tdbm, cur, now);
		if (h->pend)
			return;
	}

	/* 問了沒回：同一個頻段連續 3 次就先不在這個頻段問；兩個頻段都這樣才當作不支援 11k
	 * （只在這顆驅動收得到回報時才判斷）。2026-11-21 實測：Mi 10T 在 D3 的 2.4G 每次都回，
	 * 在 5G（MT7612）問 3 次都沒回；以前整台當作不支援，回到 2.4G 後也不再問，回 5G 的建議就沒了 */
	if (h->ask_at && !h->ask_counted && now - h->ask_at >= 10 && h->rep_at < h->ask_at && g_caps.bcn_rep[bidx(h->ask_band)]) {
		int ab = bidx(h->ask_band);
		h->ask_counted = 1;
		if (++h->k_noreply[ab] >= 3 && h->k < 0 && !h->k_dead[ab]) {
			h->k_dead[ab] = 1;
			event(0, "%s 在 %s 問了 3 次都沒回 Beacon Report，這個頻段先不問（另一個頻段照常）",
				client_name(c->mac, name, sizeof(name)), ab ? "5G" : "2.4G");
		}
		if (h->k < 0 && h->k_dead[0] && h->k_dead[1]) {
			h->k = 0;
			event(0, "%s 兩個頻段都沒回 Beacon Report，當作不支援 11k", client_name(c->mac, name, sizeof(name)));
		}
	}

	/* 備案（裝置不回 Beacon Report、驅動收不到回報）：只做回 5G，用 AP 聽到的 2.4G 訊號估 */
	if ((h->k == 0 || h->k_dead[bi] || !g_caps.bcn_rep[bi]) && c->band == 2 && seen5_ago(c->mac, now) >= 0 &&
	    now - c->band_since >= 60 && !c->psm) {
		const struct twr_radio *r5 = own_radio(5);
		if (r5 && c->ema >= -58 && c->ema >= c->drop_rssi + 8) {
			if (now - c->fb_at >= 10) {
				c->fb_n++;
				c->fb_at = now;
			}
			if (c->fb_n >= 2) {
				h->cand_n = 2;
				suggest(c, h, K_BACK5, r5->bssid, 5, c->ema - 8, c->ema, now);
				c->fb_n = 0;
			}
		} else {
			c->fb_n = 0;
		}
		return;
	}

	/* 問（送 Beacon Request） */
	if (h->k == 0 || h->k_dead[bi] || !g_caps.bcn_req[bi] || c->psm || h->ignore_n >= 3 || now < h->backoff_until)
		return;
	min_conn = (c->band == 2 && seen5_ago(c->mac, now) >= 0) ? 60 : 120;
	if (now - c->band_since < min_conn)
		return;
	if (!(h->cand_n == 1 && now - h->ask_at >= 10) &&
	    !(now - h->ask_at >= 60 && (!h->ask_at || abs(c->ema - h->ask_rssi) >= 6 || now - h->ask_at >= 600)))
		return;
	if (g_mode == TWR_MODE_SUGGEST && now < g_ask_busy[bi])
		return;		/* 這個頻段有一個 Beacon Request 還在等，下一輪再問 */
	{
		int ch = pick_channel(c, h, cand, n, now);
		if (!ch)
			return;
		h->ask_at = now;
		h->ask_rssi = c->ema;
		h->ask_ch = ch;
		h->ask_band = c->band;
		h->ask_counted = 0;
		if (g_mode == TWR_MODE_SUGGEST) {
			if (twr_drv_bcn_req(c->band, c->mac, ch, NULL, next_token()) == 0) {
				g_ask_busy[bi] = now + 6;
				g_st.ask++;
				event(0, "問：%s 目前 %s %d dBm，量頻道 %d", client_name(c->mac, name, sizeof(name)),
				      band_str(c->band), c->ema, ch);
			}
		}
	}
}

/*
 * 每日自動選頻要重新啟動某個頻段前（tw-wifi-acs），先請這個頻段上支援 11v 的裝置移到本機另一個頻段，
 * 重啟時才不會斷線；之後由平常的「回 5G」把裝置請回來。只對同名（SSID 相同）的主網路有效，IoT 網路不動。
 * 驅動一次只能等一個 BTM 回覆（g_btm_busy），所以每輪送一台，最多 60 秒；做完寫 TWR_EVAC_DONE。
 */
static int g_evac_band;
static long g_evac_until;
static unsigned char g_evac_sent[TWR_MAX_LOCAL][6];
static int g_evac_n, g_evac_skip;

static void
evacuate_step(long now)
{
	const struct twr_radio *from, *to;
	struct twr_nbr cand;
	char name[64];
	FILE *fp;
	int i, j, left = 0;

	if (!g_evac_band) {
		int band = 0;
		if (!(fp = fopen(TWR_EVAC_REQ, "r")))
			return;
		if (fscanf(fp, "%d", &band) != 1)
			band = 0;
		fclose(fp);
		unlink(TWR_EVAC_REQ);
		unlink(TWR_EVAC_DONE);
		if (band != 2 && band != 5)
			return;
		g_evac_band = band;
		g_evac_until = now + 60;
		g_evac_n = g_evac_skip = 0;
	}
	from = own_radio(g_evac_band);
	to = own_radio(g_evac_band == 5 ? 2 : 5);
	if (from && to && from->ssid_hash == to->ssid_hash && g_caps.btm[bidx(g_evac_band)] && now < g_evac_until) {
		for (i = 0; i < TWR_MAX_LOCAL; i++) {
			struct twr_local *c = &g_local[i];
			struct twr_hist *h;
			int done = 0;
			if (!c->used || c->guest || c->band != g_evac_band)
				continue;
			for (j = 0; j < g_evac_n; j++)
				if (!memcmp(g_evac_sent[j], c->mac, 6))
					done = 1;
			if (done)
				continue;
			h = hist_find(c->mac, 0, now);
			if (!h || h->v != 1)
				continue;		/* 不支援 11v：重啟時會斷線幾秒，之後自己連回來 */
			left++;
			if (now < g_btm_busy[bidx(g_evac_band)] || g_evac_n >= TWR_MAX_LOCAL)
				continue;
			memset(&cand, 0, sizeof(cand));
			memcpy(cand.bssid, to->bssid, 6);
			cand.band = to->band;
			cand.ch = to->ch;
			cand.bw = to->bw;
			cand.pref = 255;
			cand.ft = strchr(from->cap, 'r') && strchr(to->cap, 'r');
			client_name(c->mac, name, sizeof(name));
			if (twr_drv_btm_req(c->band, c->mac, &cand, 1, next_token()) == 0) {
				g_btm_busy[bidx(g_evac_band)] = now + 6;
				memcpy(g_evac_sent[g_evac_n++], c->mac, 6);
				left--;
				roam_log("每日選頻：%s 要重新啟動，請 %s 先移到 %s", band_str(g_evac_band), name, band_str(to->band));
			} else {
				memcpy(g_evac_sent[g_evac_n++], c->mac, 6);
				g_evac_skip++;
				left--;
			}
		}
		if (left > 0)
			return;		/* 還有裝置要送，下一輪再送 */
	}
	/* 做完、逾時，或兩個頻段不同名、驅動不能送：都算結束 */
	if ((fp = fopen(TWR_EVAC_DONE, "w"))) {
		fprintf(fp, "done %d %d %d\n", g_evac_n - g_evac_skip, g_evac_skip, left);
		fclose(fp);
	}
	g_evac_band = 0;
}

static void
decide_all(long now)
{
	int i;

	if (g_mode_cfg < TWR_MODE_OBSERVE)
		return;
	for (i = 0; i < TWR_MAX_LOCAL; i++)
		if (g_local[i].used)
			decide_one(&g_local[i], now);
	/* 離開這台的裝置也要看建議結果（換到別台 AP 的情況）；離開 20 秒後確認是斷線還是漫遊 */
	for (i = 0; i < TWR_MAX_HIST; i++) {
		if (!g_hist[i].used)
			continue;
		if (g_hist[i].pend && !local_find(g_hist[i].mac, 0))
			check_result(&g_hist[i], now);
		gone_check(&g_hist[i], now);
	}
}

/* 11k 鄰居清單：有變動才送給驅動（建議模式才做） */
static void
feed_neighbors(long now)
{
	static unsigned int last_sum[2];
	struct twr_nbr list[TWR_MAX_CAND];
	int i, j, n;

	for (i = 0; i < g_nradio; i++) {
		unsigned int sum = 0;
		int bi = bidx(g_radio[i].band);
		if (!g_caps.nbr[bi] || g_mode != TWR_MODE_SUGGEST)
			continue;
		n = cands_for(g_radio[i].band, list, TWR_MAX_CAND, now);
		for (j = 0; j < n; j++)
			sum = sum * 31 + list[j].bssid[5] + (list[j].bssid[4] << 8) + list[j].ch * 65537u;
		sum += n;
		if (sum == last_sum[bi])
			continue;
		if (twr_drv_set_nbr(g_radio[i].band, list, n) == 0) {
			last_sum[bi] = sum;
			event(0, "%s 的鄰居清單更新：%d 個", band_str(g_radio[i].band), n);
		}
	}
}

static void
drv_events(long now)
{
	struct twr_drv_ev ev[16];
	int i, n = twr_drv_read(ev, 16);
	for (i = 0; i < n; i++) {
		if (ev[i].type == TWR_EV_BCN_REPORT)
			on_bcn_report(&ev[i], now);
		else if (ev[i].type == TWR_EV_BTM_RESP)
			on_btm_resp(&ev[i], now);
	}
}

/* ---------- 狀態檔 ---------- */

#ifndef TWR_TEST
#define TWR_NEIGHBORS_FILE	"/tmp/tw-roamd.neighbors"
#else
#define TWR_NEIGHBORS_FILE	"tw-roamd.neighbors"
#endif

static void
radio_line(FILE *fp, const char *indent, const struct twr_radio *r)
{
	char m[18];
	mac2str(r->bssid, m);
	fprintf(fp, "%s%-4s %s  頻道 %3d  %3d MHz  %2d 台  SSID %08x  能力 %s\n",
		indent, band_str(r->band), m, r->ch, r->bw, r->ncli, r->ssid_hash, r->cap);
}

/* 11k 鄰居清單（docs/ROAM-COOP.md 第 5 節）：每個自己的頻段，列出同一個 SSID 的其他頻段與別台 AP。
 * 格式：<這台的頻段> <候選 BSSID> <頻道> <候選頻段> <頻寬> <來源>；之後由驅動的鄰居報告使用 */
static void
write_neighbors(long now)
{
	FILE *fp = fopen(TWR_NEIGHBORS_FILE ".tmp", "w");
	char m[18];
	int i, j, k;

	if (!fp)
		return;
	for (i = 0; i < g_nradio; i++) {
		const struct twr_radio *me = &g_radio[i];
		for (j = 0; j < g_nradio; j++) {
			if (j == i || g_radio[j].ssid_hash != me->ssid_hash)
				continue;
			mac2str(g_radio[j].bssid, m);
			fprintf(fp, "%d %s %d %d %d 本機\n", me->band, m, g_radio[j].ch, g_radio[j].band, g_radio[j].bw);
		}
		for (j = 0; j < TWR_MAX_PEERS; j++) {
			const struct twr_peer *p = &g_peer[j];
			if (!p->used || now - p->last_seen > TWR_PEER_EXPIRE)
				continue;
			for (k = 0; k < p->nradio; k++) {
				if (p->radio[k].ssid_hash != me->ssid_hash)
					continue;
				mac2str(p->radio[k].bssid, m);
				fprintf(fp, "%d %s %d %d %d %s\n", me->band, m, p->radio[k].ch, p->radio[k].band,
					p->radio[k].bw, p->ip);
			}
		}
	}
	fclose(fp);
	rename(TWR_NEIGHBORS_FILE ".tmp", TWR_NEIGHBORS_FILE);
}

/* 漫遊頁的資料（/tw_api.asp?q=roam，欄位見 docs/HANDOFF-UI.md 第 6 節） */
static void
write_json(long now)
{
	FILE *fp = fopen(TWR_JSON_FILE ".tmp", "w");
	char m[18], host[64];
	int i, j, n24 = 0, n5 = 0, first, peers = g_peer_count(now);
	const struct twr_radio *r2 = own_radio(2), *r5 = own_radio(5);

	if (!fp)
		return;
	for (i = 0; i < TWR_MAX_LOCAL; i++)
		if (g_local[i].used && !g_local[i].missing && !g_local[i].guest) {
			if (g_local[i].band == 5)
				n5++;
			else
				n24++;
		}
	fprintf(fp, "{\"ok\":true,\"available\":true,\"ts\":%ld,\"mode\":\"%s\",\"mode_cfg\":\"%s\",\"weak_dbm\":%d,",
		(long)time(NULL), g_mode == TWR_MODE_SUGGEST ? "steer" : "observe",
		g_mode_cfg == TWR_MODE_SUGGEST ? "steer" : "observe", g_weak_dbm);
	fprintf(fp, "\"driver\":{\"name\":");
	json_str(fp, g_caps.name ? g_caps.name : "");
	for (i = 0; i < 2; i++)
		fprintf(fp, ",\"%s\":{\"ask\":%s,\"report\":%s,\"steer\":%s,\"neighbor\":%s}", i ? "b5" : "b24",
			g_caps.bcn_req[i] ? "true" : "false", g_caps.bcn_rep[i] ? "true" : "false",
			g_caps.btm[i] ? "true" : "false", g_caps.nbr[i] ? "true" : "false");
	fprintf(fp, "},\"stats\":{\"ask\":%d,\"report\":%d,\"suggest\":%d,\"moved\":%d,\"back5\":%d,\"ignored\":%d,\"rejected\":%d,\"hour\":%d,\"hour_max\":%d},",
		g_st.ask, g_st.rep, g_st.sug, g_st.ok, g_st.back5, g_st.ign, g_st.rej, g_hour_n, TWR_HOUR_MAX);

	/* AP 清單：這台在最前面 */
	fprintf(fp, "\"aps\":[{\"name\":");
	json_str(fp, g_name);
	fprintf(fp, ",\"model\":\"%s\",\"ip\":\"%s\",\"online\":true,\"self\":true,\"clients_24\":%d,\"clients_5\":%d,\"steer_capable\":%s,\"ft\":%s}",
		BOARD_NAME, g_ip, n24, n5, (g_caps.btm[0] || g_caps.btm[1]) ? "true" : "false",
		((r2 && strchr(r2->cap, 'r')) || (r5 && strchr(r5->cap, 'r'))) ? "true" : "false");
	for (i = 0; i < TWR_MAX_PEERS; i++) {
		const struct twr_peer *p = &g_peer[i];
		int c24 = 0, c5 = 0, v = 0, ft = 0;
		if (!p->used || now - p->last_seen > 300)
			continue;
		for (j = 0; j < p->ncli; j++) {
			if (p->cli[j].band == 5)
				c5++;
			else
				c24++;
		}
		for (j = 0; j < p->nradio; j++) {
			if (strchr(p->radio[j].cap, 'v'))
				v = 1;
			if (strchr(p->radio[j].cap, 'r'))
				ft = 1;
		}
		fprintf(fp, ",{\"name\":");
		json_str(fp, p->name);
		fprintf(fp, ",\"model\":\"\",\"ip\":\"%s\",\"online\":%s,\"self\":false,\"clients_24\":%d,\"clients_5\":%d,\"steer_capable\":%s,\"ft\":%s}",
			p->ip, now - p->last_seen <= TWR_PEER_EXPIRE ? "true" : "false", c24, c5, v ? "true" : "false", ft ? "true" : "false");
	}

	/* 事件：新的在前 */
	fprintf(fp, "],\"events\":[");
	for (i = 0, first = 1; i < g_rev_n; i++) {
		int k = (g_rev_head - 1 - i + TWR_MAX_REV * 2) % TWR_MAX_REV;
		mac2str(g_rev[k].mac, m);
		client_host(g_rev[k].mac, host, sizeof(host));
		fprintf(fp, "%s{\"ts\":%ld,\"mac\":\"%s\",\"name\":", first ? "" : ",", g_rev[k].ts, m);
		json_str(fp, host[0] ? host : m);
		fprintf(fp, ",\"from\":");
		json_str(fp, g_rev[k].from);
		fprintf(fp, ",\"to\":");
		json_str(fp, g_rev[k].to);
		fprintf(fp, ",\"rssi_from\":%d,\"rssi_to\":%d,\"type\":\"%s\"}", g_rev[k].rf, g_rev[k].rt, g_rev[k].type);
		first = 0;
	}

	/* 建議（設定面的提醒） */
	fprintf(fp, "],\"advice\":[");
	first = 1;
	if (r2 && r5 && r2->ssid_hash != r5->ssid_hash) {
		fprintf(fp, "{\"level\":\"warn\",\"title\":\"2.4G 和 5G 的名稱不一樣\",\"detail\":\"頻段引導與「回 5G」只對同名同密碼的網路有效；名稱不同時手機會把建議當成換網路而不理會。\"}");
		first = 0;
	}
	if (g_mode_cfg != TWR_MODE_SUGGEST && (g_caps.btm[0] || g_caps.btm[1])) {
		fprintf(fp, "%s{\"level\":\"info\",\"title\":\"可以改成建議模式\",\"detail\":\"這台的驅動能用 11k 請手機量附近的 AP、用 11v 建議它換過去（不會踢人）。目前是觀察模式，只記錄。\"}", first ? "" : ",");
		first = 0;
	}
	if (g_mode != g_mode_cfg) {
		fprintf(fp, "%s{\"level\":\"warn\",\"title\":\"已自動退回觀察模式\",\"detail\":\"這一小時建議次數超過 %d 次；重新啟動 tw-roamd（或改一次模式）才會恢復。\"}", first ? "" : ",", TWR_HOUR_MAX);
		first = 0;
	}
	if (peers && !((r2 && strchr(r2->cap, 'r')) || (r5 && strchr(r5->cap, 'r')))) {
		fprintf(fp, "%s{\"level\":\"info\",\"title\":\"家裡有 %d 台 AP，快速漫遊（802.11r）沒開\",\"detail\":\"開啟後換 AP 時省掉重新驗證；連不上的舊裝置請改連 IoT 網路。\"}", first ? "" : ",", peers + 1);
		first = 0;
	}

	/* 連在這台的裝置與決定狀態 */
	fprintf(fp, "],\"clients\":[");
	for (i = 0, first = 1; i < TWR_MAX_LOCAL; i++) {
		struct twr_local *c = &g_local[i];
		struct twr_hist *h;
		if (!c->used || c->missing || c->guest)
			continue;
		h = hist_find(c->mac, 0, now);
		mac2str(c->mac, m);
		client_host(c->mac, host, sizeof(host));
		fprintf(fp, "%s{\"mac\":\"%s\",\"name\":", first ? "" : ",", m);
		json_str(fp, host[0] ? host : m);
		fprintf(fp, ",\"band\":%d,\"rssi\":%d,\"psm\":%s,\"seen5\":%s,\"k\":%d,\"v\":%d,\"state\":\"%s\",\"suggested\":%d,\"moved\":%d}",
			c->band, c->ema, c->psm ? "true" : "false", seen5_ago(c->mac, now) >= 0 ? "true" : "false",
			h ? h->k : -1, h ? h->v : -1,
			!h ? "" : h->pend ? "pending" : h->ignore_n >= 3 ? "stopped" : now < h->backoff_until ? "backoff" : "",
			h ? h->n_sug : 0, h ? h->n_ok : 0);
		first = 0;
	}
	fprintf(fp, "]}\n");
	fclose(fp);
	rename(TWR_JSON_FILE ".tmp", TWR_JSON_FILE);
}

/* 裝置頁的資料：每台一行「MAC JSON」（/tw_api.asp?q=device&mac= 找到那一行就原樣送出）。
 * 欄位：signal{step,start,values[96]}（沒有資料的格子是 null）、disconnects[{ts,reason}]、roams[{ts,from,to,rssi_from,rssi_to}] */
static void
write_devices(void)
{
	FILE *fp;
	char m[18];
	long wall = (long)time(NULL), cur = wall / TWR_SIG_STEP;
	int i, j;

	fp = fopen(TWR_DEV_FILE ".tmp", "w");
	if (!fp)
		return;
	for (i = 0; i < TWR_MAX_HIST; i++) {
		struct twr_hist *h = &g_hist[i];
		if (!h->used || (!h->sig_cur && !h->ndisc && !h->nroam))
			continue;
		mac2str(h->mac, m);
		fprintf(fp, "%s {\"ok\":true,\"available\":true,\"mac\":\"%s\",\"signal\":{\"step\":%d,\"start\":%ld,\"values\":[",
			m, m, TWR_SIG_STEP, (cur - TWR_SIG_N + 1) * TWR_SIG_STEP);
		for (j = 0; j < TWR_SIG_N; j++) {
			long s = cur - TWR_SIG_N + 1 + j;
			int k = s % TWR_SIG_N;
			if (s == h->sig_cur && h->sig_cnt)
				fprintf(fp, "%s%d", j ? "," : "", h->sig_sum / h->sig_cnt);
			else if (h->sig_s[k] == s)
				fprintf(fp, "%s%d", j ? "," : "", h->sig_v[k]);
			else
				fprintf(fp, "%snull", j ? "," : "");
		}
		fprintf(fp, "]},\"disconnects\":[");
		for (j = 0; j < h->ndisc; j++) {
			fprintf(fp, "%s{\"ts\":%ld,\"reason\":", j ? "," : "", h->disc[j].ts);
			json_str(fp, h->disc[j].reason);
			fprintf(fp, "}");
		}
		fprintf(fp, "],\"roams\":[");
		for (j = 0; j < h->nroam; j++) {
			fprintf(fp, "%s{\"ts\":%ld,\"from\":", j ? "," : "", h->roam[j].ts);
			json_str(fp, h->roam[j].from);
			fprintf(fp, ",\"to\":");
			json_str(fp, h->roam[j].to);
			fprintf(fp, ",\"rssi_from\":%d,\"rssi_to\":%d}", h->roam[j].rf, h->roam[j].rt);
		}
		/* 改善建議：最近 2 小時的平均訊號、今天斷線次數、2.4G 上的 5G 裝置 */
		fprintf(fp, "],\"advice\":[");
		{
			int sum = 0, cnt = 0, today = 0, first = 1, k;
			struct twr_local *c = local_find(h->mac, 0);
			for (j = 0; j < 8; j++) {
				long s = cur - j;
				k = s % TWR_SIG_N;
				if (s == h->sig_cur && h->sig_cnt) {
					sum += h->sig_sum / h->sig_cnt;
					cnt++;
				} else if (h->sig_s[k] == s) {
					sum += h->sig_v[k];
					cnt++;
				}
			}
			for (j = 0; j < h->ndisc; j++)
				if (wall - h->disc[j].ts < 86400)
					today++;
			if (cnt >= 2 && sum / cnt <= -75) {
				fprintf(fp, "{\"title\":\"訊號偏弱（最近 2 小時平均 %d dBm）\",\"detail\":\"%s\",\"action\":\"看 Wi-Fi 設定\",\"href\":\"tw_wifi.asp#roam\"}",
					sum / cnt, g_peer_count(mono_sec()) ? "家裡有其他 AP：可以把漫遊中控改成建議模式，支援 11v 的裝置會被建議換到比較近的 AP。" :
					"把路由器放高、放在比較中間的位置，或在訊號弱的地方加一台 padavan-tw AP（同名同密碼）。");
				first = 0;
			}
			if (today >= 3) {
				fprintf(fp, "%s{\"title\":\"今天斷線 %d 次\",\"detail\":\"常在訊號弱的地方斷線時，先改善訊號；舊裝置看到 802.11r 連不上時，請改連 IoT 網路。\",\"action\":\"看 Wi-Fi 設定\",\"href\":\"tw_wifi.asp\"}",
					first ? "" : ",", today);
				first = 0;
			}
			if (c && !c->missing && !c->guest && c->band == 2 && seen5_ago(h->mac, mono_sec()) >= 0 && c->ema >= -55) {
				fprintf(fp, "%s{\"title\":\"可以用 5G\",\"detail\":\"這台裝置連過 5G，現在在 2.4G 而且訊號很好（%d dBm）；5G 通常快很多。建議模式會自動建議它回 5G。\",\"action\":\"看漫遊設定\",\"href\":\"tw_wifi.asp#roam\"}",
					first ? "" : ",", c->ema);
				first = 0;
			}
		}
		fprintf(fp, "]}\n");
		h->dirty = 0;
	}
	fclose(fp);
	rename(TWR_DEV_FILE ".tmp", TWR_DEV_FILE);
}

static void
write_status(long now)
{
	FILE *fp = fopen(TWR_STATUS_FILE ".tmp", "w");
	char name[96], m[18];
	int i, j, n = 0;

	if (!fp)
		return;
	mac2str(g_node, m);
	fprintf(fp, "這台 AP：%s（%s，%s）\n", g_name, g_ip, m);
	if (g_mode == TWR_MODE_SUGGEST)
		fprintf(fp, "建議模式：用 11k 問裝置、11v 建議換 AP／頻段，永遠不踢人\n");
	else if (g_mode_cfg == TWR_MODE_SUGGEST)
		fprintf(fp, "觀察模式（設定是建議模式，但%s）\n", (g_caps.btm[0] || g_caps.btm[1]) ? "這一小時建議次數超過上限，已自動退回" : "驅動還不能送 11v 建議");
	else
		fprintf(fp, "觀察模式：只記錄，不引導裝置。弱訊號門檻 %d dBm\n", g_weak_dbm);
	fprintf(fp, "驅動：%s｜2.4G 問 %s 回報 %s 建議 %s 鄰居清單 %s｜5G 問 %s 回報 %s 建議 %s 鄰居清單 %s\n", g_caps.name,
		g_caps.bcn_req[0] ? "✓" : "✗", g_caps.bcn_rep[0] ? "✓" : "✗", g_caps.btm[0] ? "✓" : "✗", g_caps.nbr[0] ? "✓" : "✗",
		g_caps.bcn_req[1] ? "✓" : "✗", g_caps.bcn_rep[1] ? "✓" : "✗", g_caps.btm[1] ? "✓" : "✗", g_caps.nbr[1] ? "✓" : "✗");
	fprintf(fp, "開機以來：問 %d 次、收到回報 %d 筆、建議 %d 次、換過去 %d 次（回 5G %d 次）、不理會 %d 次、拒絕 %d 次；這一小時建議 %d／%d 次\n",
		g_st.ask, g_st.rep, g_st.sug, g_st.ok, g_st.back5, g_st.ign, g_st.rej, g_hour_n, TWR_HOUR_MAX);
	for (i = 0; i < g_nradio; i++)
		radio_line(fp, "  ", &g_radio[i]);
	fprintf(fp, "\n");
	fprintf(fp, "連在這台的裝置：\n");
	for (i = 0; i < TWR_MAX_LOCAL; i++) {
		struct twr_local *c = &g_local[i];
		if (!c->used || c->missing)
			continue;
		n++;
		fprintf(fp, "  %-40s %-4s%s  %4d dBm  已連線 %u 秒%s%s%s",
			client_name(c->mac, name, sizeof(name)), band_str(c->band), c->guest ? "（IoT）" : "",
			c->ema, c->conn, c->psm ? "  省電中" : "", c->weak_since ? "  ⚠ 訊號弱" : "",
			(c->band == 2 && seen5_ago(c->mac, now) >= 0) ? "  24 小時內連過 5G" : "");
		{
			struct twr_hist *h = hist_find(c->mac, 0, now);
			if (h && !c->guest)
				fprintf(fp, "  11k %s 11v %s%s", h->k > 0 ? "✓" : h->k == 0 ? "✗" : "?", h->v > 0 ? "✓" : h->v == 0 ? "✗" : "?",
					h->pend ? "  等建議結果" : h->ignore_n >= 3 ? "  不再建議" : now < h->backoff_until ? "  退避中" : "");
			if (h && !c->guest && h->k != 0 && (h->k_dead[0] || h->k_dead[1]))
				fprintf(fp, "（%s不回）", h->k_dead[0] ? (h->k_dead[1] ? "兩邊都" : "2.4G ") : "5G ");
			if (h && h->n_sug)
				fprintf(fp, "  建議 %d 次、換過去 %d 次", h->n_sug, h->n_ok);
		}
		fprintf(fp, "\n");
	}
	if (!n)
		fprintf(fp, "  （無）\n");

	fprintf(fp, "\n區網內的其他 AP：\n");
	n = 0;
	for (i = 0; i < TWR_MAX_PEERS; i++) {
		struct twr_peer *p = &g_peer[i];
		if (!p->used || now - p->last_seen > TWR_PEER_EXPIRE)
			continue;
		n++;
		fprintf(fp, "  %s（%s）2.4G 頻道 %d、5G 頻道 %d，%d 台裝置%s\n", p->name, p->ip, p->ch2, p->ch5, p->ncli,
			p->ver < 2 ? "（舊版，沒有頻段資料）" : "");
		for (j = 0; j < p->nradio; j++)
			radio_line(fp, "    ", &p->radio[j]);
		for (j = 0; j < p->ncli; j++)
			fprintf(fp, "    %-38s %-4s  %4d dBm\n",
				client_name(p->cli[j].mac, name, sizeof(name)), band_str(p->cli[j].band), p->cli[j].rssi);
	}
	if (!n)
		fprintf(fp, "  （沒有找到；其他 AP 也要是 padavan-tw 並開啟漫遊中控）\n");

	n = 0;
	for (i = 0; i < TWR_SEEN5_MAX; i++)
		if (g_seen5[i].at && now - g_seen5[i].at <= TWR_SEEN5_KEEP)
			n++;
	fprintf(fp, "\n最近 24 小時連過 5G 的裝置：%d 台\n", n);
	fclose(fp);
	rename(TWR_STATUS_FILE ".tmp", TWR_STATUS_FILE);
	write_neighbors(now);
	write_json(now);
	{
		static long last_dev;
		if (!last_dev || now - last_dev >= 60) {
			write_devices();
			last_dev = now;
		}
	}
}

/* ---------- 主程式 ---------- */

static void
on_term(int sig)
{
	g_stop = 1;
}

static int
read_br_mac(unsigned char *mac)
{
	return read_if_mac(IFNAME_BR, mac);
}

static void
cat_file(const char *path)
{
	char line[256];
	FILE *fp = fopen(path, "r");
	if (!fp)
		return;
	while (fgets(line, sizeof(line), fp))
		fputs(line, stdout);
	fclose(fp);
}

#ifndef TWR_TEST
/* 有沒有別的常駐 tw-roamd（命令列只有程式名稱的；tw-roamd status 不算） */
static int
other_instance(void)
{
	DIR *d = opendir("/proc");
	struct dirent *e;
	pid_t self = getpid();
	int found = 0;

	if (!d)
		return 0;
	while (!found && (e = readdir(d))) {
		char path[32], buf[64];
		const char *base;
		pid_t pid = atoi(e->d_name);
		ssize_t n;
		int fd;

		if (pid <= 0 || pid == self)
			continue;
		snprintf(path, sizeof(path), "/proc/%d/cmdline", (int)pid);
		fd = open(path, O_RDONLY);
		if (fd < 0)
			continue;
		n = read(fd, buf, sizeof(buf) - 1);
		close(fd);
		if (n <= 0)
			continue;
		buf[n] = 0;
		base = strrchr(buf, '/');
		base = base ? base + 1 : buf;
		if (strcmp(base, "tw-roamd") == 0 && (size_t)n == strlen(buf) + 1)
			found = 1;
	}
	closedir(d);
	return found;
}
#endif

int
tw_roamd_main(int argc, char **argv)
{
	long now, next_poll = 0, next_report = 0, next_status = 0;
	int s, i;
	FILE *fp;

	if (argc > 1 && strcmp(argv[1], "status") == 0) {
		cat_file(TWR_STATUS_FILE);
		printf("\n最近的事件：\n");
		cat_file(TWR_EVENTS_FILE);
		return 0;
	}
	if (argc > 1) {
		fprintf(stderr, "用法：tw-roamd status（看狀態）；常駐程式由 watchdog 依 tw_roam_enable 啟動\n");
		return 1;
	}
#ifndef TWR_TEST
	/* 2026-11-22 實機：直接打 tw-roamd（或打錯參數）以前會多開一個，兩個搶著寫狀態檔、重複送 11k 請求，
	 * 多開的那個結束時還把 pid 檔刪掉 */
	if (other_instance()) {
		fprintf(stderr, "tw-roamd 已經在執行；看狀態用 tw-roamd status\n");
		return 0;
	}
#endif

#ifdef TWR_TEST
	if (getenv("TWR_NODE")) str2mac(getenv("TWR_NODE"), g_node); else
#endif
	if (read_br_mac(g_node) != 0) {
		fprintf(stderr, "tw-roamd：讀不到 %s 的 MAC\n", IFNAME_BR);
		return 1;
	}
	snprintf(g_ip, sizeof(g_ip), "%s", nvram_safe_get("lan_ipaddr"));
	snprintf(g_name, sizeof(g_name), "%s", nvram_safe_get("computer_name"));
	if (!g_name[0])
		snprintf(g_name, sizeof(g_name), "%s", BOARD_NAME);
	i = nvram_get_int("tw_roam_weak");
	if (i <= -50 && i >= -95)
		g_weak_dbm = i;

#ifndef TWR_TEST
	if (daemon(0, 0) < 0)
		return 1;
#endif
	fp = fopen(TWR_PID_FILE, "w");
	if (fp) {
		fprintf(fp, "%d\n", getpid());
		fclose(fp);
	}
	signal(SIGTERM, on_term);
	signal(SIGINT, on_term);
	signal(SIGPIPE, SIG_IGN);

	s = make_socket();
	g_mode_cfg = nvram_get_int("tw_roam_enable") >= TWR_MODE_SUGGEST ? TWR_MODE_SUGGEST : TWR_MODE_OBSERVE;
	twr_drv_init(&g_caps);
	g_mode = g_mode_cfg;
	if (g_mode == TWR_MODE_SUGGEST && !g_caps.btm[0] && !g_caps.btm[1]) {
		g_mode = TWR_MODE_OBSERVE;
		event(1, "這台的驅動（%s）還不能送 11v 建議，先用觀察模式", g_caps.name);
	}
	g_hour_start = mono_sec();
	event(0, "漫遊中控（%s模式）啟動：%s %s；驅動 %s", g_mode == TWR_MODE_SUGGEST ? "建議" : "觀察", g_name, g_ip, g_caps.name);

	while (!g_stop) {
		struct pollfd pfd[2] = { { s, POLLIN, 0 }, { twr_drv_event_fd(), POLLIN, 0 } };
		now = mono_sec();
		if (now >= next_poll) {
			int before[TWR_MAX_LOCAL];
			for (i = 0; i < TWR_MAX_LOCAL; i++)
				before[i] = g_local[i].used;
			poll_local(now);
			for (i = 0; i < TWR_MAX_LOCAL; i++)
				if (before[i] && !g_local[i].used) {
					note_gone(&g_local[i], now);
					dev_gone(&g_local[i]);
				}
			if (g_nradio) {
				decide_all(now);
				evacuate_step(now);
			}
			next_poll = now + TWR_POLL_SEC;
		}
		if (s >= 0 && now >= next_report) {
			update_radios();
			send_report(s, now);
			feed_neighbors(now);
			next_report = now + TWR_REPORT_SEC;
		}
		if (now >= next_status) {
			write_status(now);
			next_status = now + TWR_REPORT_SEC;
		}
		if (s < 0) {
			sleep(1);
			s = make_socket();	/* br0 還沒有位址時稍後再試 */
			continue;
		}
		if (poll(pfd, pfd[1].fd >= 0 ? 2 : 1, 1000) > 0) {
			if (pfd[0].revents & POLLIN)
				recv_report(s, mono_sec());
			if (pfd[1].fd >= 0 && (pfd[1].revents & POLLIN))
				drv_events(mono_sec());
		}
	}

	if (s >= 0)
		close(s);
	twr_drv_close();
	unlink(TWR_PID_FILE);
	return 0;
}
