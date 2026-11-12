/*
 * padavan-tw：輕量漫遊中控 tw-roamd（第一版：觀察模式）
 *
 * 每台 AP 各跑一個，彼此在區網用多播交換「我這裡有哪些裝置、訊號多強」：
 * - 每 2 秒讀自己的 Wi-Fi 裝置訊號表（驅動的 MAC table）
 * - 每 5 秒在 br0 多播一份報告（239.255.77.77:27330，TTL 1，只在區網內）
 * - 記錄裝置換 AP、換頻段的時間點，以及換之前訊號弱了多久（調整門檻用的資料）
 * - 給「建議」：訊號持續太弱而家裡還有別台 AP、2.4G 訊號很好可以用 5G
 * 觀察模式不做任何動作（不踢除、不送 802.11v），只寫紀錄。
 *
 *   tw-roamd            以背景程式執行（由 watchdog 依 nvram tw_roam_enable 啟停）
 *   tw-roamd status     顯示目前狀態與最近的事件
 *
 * 輸出：/tmp/tw-roamd.status（狀態，每 5 秒更新）、/tmp/tw-roamd.events（最近 100 筆事件）、
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
#include <net/if.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <linux/wireless.h>

#include "rc.h"

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
#define TWR_PID_FILE		"/var/run/tw-roamd.pid"
#else
#define TWR_STATUS_FILE		"tw-roamd.status"	/* 測試：寫在目前目錄 */
#define TWR_EVENTS_FILE		"tw-roamd.events"
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
	int used;
};

struct twr_peer_cli {
	unsigned char mac[6];
	int band;
	int rssi;
};

struct twr_peer {
	unsigned char node[6];
	char ip[16];
	char name[33];
	int ch2, ch5;
	long last_seen;
	int ncli;
	struct twr_peer_cli cli[TWR_MAX_PEER_CLI];
	/* 最近離開這台的裝置（給漫遊判斷用） */
	int ngone;
	struct { unsigned char mac[6]; int band; int rssi; long at; } gone[32];
	int used;
};

static struct twr_local g_local[TWR_MAX_LOCAL];
static struct twr_peer g_peer[TWR_MAX_PEERS];
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
	struct twr_local *c = local_find(e->Addr, 1);
	int rssi = entry_rssi(e);
	char name[96];

	if (!c)
		return;
	if (c->first_seen == 0) {
		int pband = 0, prssi = 0;
		struct twr_peer *p = peer_had(e->Addr, now, &pband, &prssi);
		c->first_seen = now;
		c->band = band;
		c->ema16 = rssi * 16;
		if (p) {
			event(1, "換 AP：%s 從 %s %s（%s，%d dBm）到這台（%s，%d dBm）",
			      client_name(e->Addr, name, sizeof(name)), p->name, p->ip, band_str(pband), prssi, band_str(band), rssi);
		}
	} else if (c->band != band && c->missing < TWR_GONE_POLLS) {
		event(1, "換頻段：%s %s → %s（%d dBm）",
		      client_name(e->Addr, name, sizeof(name)), band_str(c->band), band_str(band), rssi);
		c->band = band;
		c->ema16 = rssi * 16;
		c->weak_since = 0;
	}
	c->guest = guest;
	c->rssi = rssi;
	c->ema16 += (rssi * 16 - c->ema16) / 4;
	c->ema = (c->ema16 >= 0 ? c->ema16 + 8 : c->ema16 - 8) / 16;
	c->conn = e->ConnectedTime;
	c->last_seen = now;
	c->missing = 0;
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

/* 報告格式（文字，一行一筆）：
 *   TWR1 <節點 MAC> <IP> <2.4G 頻道> <5G 頻道>
 *   N <名稱>
 *   C <裝置 MAC> <頻段> <訊號>
 *   G <裝置 MAC> <頻段> <訊號> <幾秒前離開>      （最近 30 秒內離開的裝置）
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
	len = snprintf(buf, sizeof(buf), "TWR1 %s %s %d %d\nN %s\n", m, g_ip, ch2, ch5, g_name);
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
	int n, i, ch2, ch5, free_i = -1;

	n = recv(s, buf, sizeof(buf) - 1, MSG_DONTWAIT);
	if (n <= 0)
		return;
	buf[n] = 0;
	if (sscanf(buf, "TWR1 %23s %23s %d %d", m, ip, &ch2, &ch5) != 4 || str2mac(m, node) != 0)
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
	p->ncli = 0;

	line = strtok_r(buf, "\n", &save);
	while ((line = strtok_r(NULL, "\n", &save)) != NULL) {
		char cm[24];
		int band, rssi;
		long ago;
		unsigned char cmac[6];

		if (line[0] == 'N' && line[1] == ' ') {
			snprintf(p->name, sizeof(p->name), "%s", line + 2);
		} else if (sscanf(line, "C %23s %d %d", cm, &band, &rssi) == 3 && str2mac(cm, cmac) == 0) {
			if (p->ncli < TWR_MAX_PEER_CLI) {
				memcpy(p->cli[p->ncli].mac, cmac, 6);
				p->cli[p->ncli].band = band;
				p->cli[p->ncli].rssi = rssi;
				p->ncli++;
			}
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

/* ---------- 狀態檔 ---------- */

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
	fprintf(fp, "觀察模式：只記錄，不引導裝置。弱訊號門檻 %d dBm\n\n", g_weak_dbm);
	fprintf(fp, "連在這台的裝置：\n");
	for (i = 0; i < TWR_MAX_LOCAL; i++) {
		struct twr_local *c = &g_local[i];
		if (!c->used || c->missing)
			continue;
		n++;
		fprintf(fp, "  %-40s %-4s%s  %4d dBm  已連線 %u 秒%s\n",
			client_name(c->mac, name, sizeof(name)), band_str(c->band), c->guest ? "（訪客）" : "",
			c->ema, c->conn, c->weak_since ? "  ⚠ 訊號弱" : "");
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
		fprintf(fp, "  %s（%s）2.4G 頻道 %d、5G 頻道 %d，%d 台裝置\n", p->name, p->ip, p->ch2, p->ch5, p->ncli);
		for (j = 0; j < p->ncli; j++)
			fprintf(fp, "    %-38s %-4s  %4d dBm\n",
				client_name(p->cli[j].mac, name, sizeof(name)), band_str(p->cli[j].band), p->cli[j].rssi);
	}
	if (!n)
		fprintf(fp, "  （沒有找到；其他 AP 也要是 padavan-tw 並開啟漫遊中控）\n");
	fclose(fp);
	rename(TWR_STATUS_FILE ".tmp", TWR_STATUS_FILE);
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
	char path[64], s[32];
	FILE *fp;
	snprintf(path, sizeof(path), "/sys/class/net/%s/address", IFNAME_BR);
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
	event(0, "漫遊中控（觀察模式）啟動：%s %s", g_name, g_ip);

	while (!g_stop) {
		struct pollfd pfd = { s, POLLIN, 0 };
		now = mono_sec();
		if (now >= next_poll) {
			int before[TWR_MAX_LOCAL];
			for (i = 0; i < TWR_MAX_LOCAL; i++)
				before[i] = g_local[i].used;
			poll_local(now);
			for (i = 0; i < TWR_MAX_LOCAL; i++)
				if (before[i] && !g_local[i].used)
					note_gone(&g_local[i], now);
			next_poll = now + TWR_POLL_SEC;
		}
		if (s >= 0 && now >= next_report) {
			send_report(s, now);
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
		if (poll(&pfd, 1, 1000) > 0)
			recv_report(s, mono_sec());
	}

	if (s >= 0)
		close(s);
	unlink(TWR_PID_FILE);
	return 0;
}
