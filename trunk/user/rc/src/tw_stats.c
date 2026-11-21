/*
 * padavan-tw：監測取樣器 twstats（第一版：延遲與掉包，ROADMAP D1）
 *
 *   tw-stats           以背景程式執行（由 watchdog 依 nvram tw_stats_enable 啟停，預設開；程式結束會自動重新啟動）
 *   tw-stats status    印出目前的延遲資料（JSON）
 *
 * 每 10 秒同時對 4 個目標送一個 ICMP echo，最多等 1 秒：
 *   gw     業者閘道：預設路由的閘道；PPPoE 等點對點連線用介面的對端位址
 *   hinet  HiNet DNS 168.95.1.1
 *   twnic  TWNIC 101.101.101.101
 *   cf     Cloudflare 1.1.1.1
 *
 * - current_ms：最近 6 次（1 分鐘）有回應的中位數；loss_pct：最近 30 次（5 分鐘）沒回應的比例
 * - 序列：15 分鐘一格、96 格（24 小時），每格存平均延遲與掉包率；時鐘還沒對時之前不記序列
 * - baseline_ms：序列裡有資料的格子取第 25 百分位（平常、閒置時的水準）；不到 4 格時用 current_ms
 * - 整體的 current_ms／baseline_ms：gw 以外三個目標的中位數；loss_pct：三個目標的平均
 * - 資料只放記憶體（/tmp/twstats/latency.json，每 10 秒覆寫），不寫 Flash
 *
 * 格式見 docs/HANDOFF-UI.md 第 6 節（latency）與 tools/ui-preview/mock/latency.json
 *
 * 連外中斷自動重新連線（nvram tw_wan_watch，預設開；tw_wan_watch_sec 預設 30 秒，30～600）：
 *   中華電信機房維護時常見「拿著 IP 卻連不出去」，或剛維護完撥號拿到不能上網的 IP、撥號沒拿到 IP，重撥才會好。
 *   - 判斷：HiNet DNS、TWNIC、Cloudflare 三個都沒回 ping 持續設定的秒數（用上面同一份 ping，不另外送）
 *   - 有 IPv4 時，動手前再用 TCP 連 1.1.1.1:443、168.95.1.1:53、8.8.8.8:53 確認，任何一個連得上就不重撥（只是 ping 被擋）
 *   - 沒有 IPv4（撥號沒拿到位址）至少等 90 秒，先讓 pppd、udhcpc 自己重試；WAN 網路線沒接、固定 IP、AP 模式都不動作
 *   - 動作：rc 的 auto_wan_reconnect（跟後台「重新連線」同一條路），寫系統記錄
 *   - 退避：重撥後至少隔 2、5、10、30 分鐘（之後都是 30 分鐘）才會再重撥，連外恢復 10 分鐘後歸零，不會一直撥號
 *   - 狀態放在 latency.json 的 wan_watch（診斷頁顯示）
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <signal.h>
#include <poll.h>
#include <time.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <sys/ioctl.h>
#include <net/if.h>
#include <netinet/in.h>
#include <netinet/ip.h>
#include <netinet/ip_icmp.h>
#include <arpa/inet.h>

#include "rc.h"

#define TWS_DIR		"/tmp/twstats"
#define TWS_LATENCY	TWS_DIR "/latency.json"
#define TWS_PID_FILE	"/var/run/tw-stats.pid"

#define TWS_INTERVAL	10	/* 秒 */
#define TWS_WAIT_MS	1000
#define TWS_CUR_N	6	/* current：最近 6 次（1 分鐘） */
#define TWS_LOSS_N	30	/* loss：最近 30 次（5 分鐘） */
#define TWS_STEP	900	/* 序列一格 15 分鐘 */
#define TWS_SLOTS	96	/* 24 小時 */
#define TWS_TIME_OK	1700000000L	/* 時鐘大於這個（2023-11）才算對時 */

#define NTARGETS	4

struct target {
	const char *id;
	const char *label;
	char host[INET_ADDRSTRLEN];
	struct in_addr addr;
	int valid;			/* host 有位址 */
	int rtt[TWS_LOSS_N];		/* 最近的結果：毫秒×10，-1＝沒回應 */
	int nres, pos;
	long slot_id[TWS_SLOTS];	/* 這一格是哪一個 15 分鐘（now / TWS_STEP） */
	long slot_sum[TWS_SLOTS];	/* 毫秒×10 的總和 */
	int slot_ok[TWS_SLOTS], slot_n[TWS_SLOTS];
	unsigned short seq;
	long long sent_us;		/* 這一輪送出的時間（單調時鐘，微秒） */
	int got;			/* 這一輪收到了（毫秒×10），-1＝還沒 */
};

static struct target g_t[NTARGETS] = {
	{ "gw",    "業者閘道",  "" },
	{ "hinet", "HiNet DNS", "168.95.1.1" },
	{ "twnic", "TWNIC",     "101.101.101.101" },
	{ "cf",    "Cloudflare", "1.1.1.1" },
};

static unsigned short g_id;
static int g_rounds = 0;
static volatile sig_atomic_t g_stop = 0;

/* 連外中斷自動重新連線 */
enum { WW_OFF, WW_OK, WW_BAD, WW_WAIT, WW_NOLINK, WW_ICMP };
#define WW_MAX_EV	5
#define WW_NOIP_MIN	90	/* 沒有 IPv4 時至少等幾秒 */
#define WW_RESET_OK	600	/* 連外恢復多久之後退避歸零 */
#define WW_ICMP_HOLD	600	/* ping 不通但 TCP 通：多久之後再確認 */
static const int ww_gap[] = { 120, 300, 600, 1800 };

static struct {
	int state, sec, has_ip;
	long bad_since;			/* 單調時鐘秒；0＝目前連得出去 */
	long ok_since;
	long next_ok;			/* 這之前不再重撥（退避） */
	long icmp_until;		/* ping 不通但 TCP 通：這之前不再用 TCP 確認 */
	int n;				/* 連續重撥次數（退避用） */
	int total;			/* 開機以來 */
	struct { long ts; int secs; int has_ip; } ev[WW_MAX_EV];
	int nev;
} g_ww;

static long
mono_ms(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec * 1000L + ts.tv_nsec / 1000000L;
}

/* 延遲用微秒算（毫秒×10 的精度要 0.1 ms） */
static long long
mono_us(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec * 1000000LL + ts.tv_nsec / 1000;
}

static unsigned short
cksum(const void *data, int len)
{
	const unsigned short *w = data;
	unsigned long sum = 0;

	while (len > 1) {
		sum += *w++;
		len -= 2;
	}
	if (len == 1)
		sum += *(const unsigned char *)w;
	sum = (sum >> 16) + (sum & 0xffff);
	sum += (sum >> 16);
	return (unsigned short)~sum;
}

/* 業者閘道：預設路由的閘道；閘道是 0（PPPoE 等點對點）時用介面的對端位址 */
static int
find_gateway(struct in_addr *gw)
{
	FILE *fp = fopen("/proc/net/route", "r");
	char line[256], ifn[IFNAMSIZ + 1];
	unsigned long dst, gate, mask;
	int found = 0;

	if (!fp)
		return 0;
	if (fgets(line, sizeof(line), fp)) {
		while (fgets(line, sizeof(line), fp)) {
			if (sscanf(line, "%16s %lx %lx %*x %*d %*d %*d %lx", ifn, &dst, &gate, &mask) == 4 &&
			    dst == 0 && mask == 0) {
				found = 1;
				break;
			}
		}
	}
	fclose(fp);
	if (!found)
		return 0;
	if (gate) {
		gw->s_addr = (in_addr_t)gate;	/* /proc/net/route 是網路位元組順序的十六進位 */
		return 1;
	} else {
		struct ifreq ifr;
		int fd = socket(AF_INET, SOCK_DGRAM, 0);
		int ok = 0;

		if (fd < 0)
			return 0;
		memset(&ifr, 0, sizeof(ifr));
		snprintf(ifr.ifr_name, IFNAMSIZ, "%s", ifn);
		if (ioctl(fd, SIOCGIFDSTADDR, &ifr) == 0) {
			struct sockaddr_in *sin = (struct sockaddr_in *)&ifr.ifr_dstaddr;
			if (sin->sin_addr.s_addr) {
				*gw = sin->sin_addr;
				ok = 1;
			}
		}
		close(fd);
		return ok;
	}
}

static void
update_targets(void)
{
	struct in_addr gw;
	int i;

	if (find_gateway(&gw)) {
		g_t[0].addr = gw;
		inet_ntop(AF_INET, &gw, g_t[0].host, sizeof(g_t[0].host));
		g_t[0].valid = 1;
	} else {
		g_t[0].host[0] = 0;
		g_t[0].valid = 0;
	}
	for (i = 1; i < NTARGETS; i++)
		g_t[i].valid = inet_aton(g_t[i].host, &g_t[i].addr) != 0;
}

/* 同時送出，1 秒內收回；沒有回應的記 -1 */
static void
probe_round(int fd)
{
	unsigned char buf[64], rbuf[512];
	struct icmphdr *icmp = (struct icmphdr *)buf;
	struct sockaddr_in to, from;
	long deadline;
	int i, pending = 0;

	for (i = 0; i < NTARGETS; i++) {
		struct target *t = &g_t[i];

		t->got = -1;
		if (!t->valid)
			continue;
		memset(buf, 0, sizeof(buf));
		icmp->type = ICMP_ECHO;
		icmp->code = 0;
		icmp->un.echo.id = htons(g_id);
		icmp->un.echo.sequence = htons(++t->seq);
		memset(buf + sizeof(*icmp), 0x54, sizeof(buf) - sizeof(*icmp));
		icmp->checksum = cksum(buf, sizeof(buf));
		memset(&to, 0, sizeof(to));
		to.sin_family = AF_INET;
		to.sin_addr = t->addr;
		t->sent_us = mono_us();
		if (sendto(fd, buf, sizeof(buf), 0, (struct sockaddr *)&to, sizeof(to)) == (ssize_t)sizeof(buf))
			pending++;
	}

	deadline = mono_ms() + TWS_WAIT_MS;
	while (pending > 0) {
		struct pollfd pfd = { fd, POLLIN, 0 };
		long left = deadline - mono_ms();
		socklen_t flen = sizeof(from);
		struct iphdr *ip;
		struct icmphdr *r;
		int n, hl;

		if (left <= 0 || poll(&pfd, 1, (int)left) <= 0)
			break;
		n = recvfrom(fd, rbuf, sizeof(rbuf), 0, (struct sockaddr *)&from, &flen);
		if (n < (int)sizeof(struct iphdr))
			continue;
		ip = (struct iphdr *)rbuf;
		hl = ip->ihl * 4;
		if (n < hl + (int)sizeof(struct icmphdr))
			continue;
		r = (struct icmphdr *)(rbuf + hl);
		if (r->type != ICMP_ECHOREPLY || ntohs(r->un.echo.id) != g_id)
			continue;
		for (i = 0; i < NTARGETS; i++) {
			struct target *t = &g_t[i];
			if (t->valid && t->got < 0 && from.sin_addr.s_addr == t->addr.s_addr &&
			    ntohs(r->un.echo.sequence) == t->seq) {
				long long d = mono_us() - t->sent_us;
				t->got = (int)((d + 50) / 100);
				if (t->got < 1)
					t->got = 1;	/* 0.1 ms 以內記成 0.1 */
				pending--;
				break;
			}
		}
	}
}

static void
record(long now)
{
	long bucket = now / TWS_STEP;
	int i, k;

	for (i = 0; i < NTARGETS; i++) {
		struct target *t = &g_t[i];

		if (!t->valid)
			continue;
		t->rtt[t->pos] = t->got;
		t->pos = (t->pos + 1) % TWS_LOSS_N;
		if (t->nres < TWS_LOSS_N)
			t->nres++;

		if (now < TWS_TIME_OK)
			continue;
		k = (int)(bucket % TWS_SLOTS);
		if (t->slot_id[k] != bucket) {
			t->slot_id[k] = bucket;
			t->slot_sum[k] = 0;
			t->slot_ok[k] = 0;
			t->slot_n[k] = 0;
		}
		t->slot_n[k]++;
		if (t->got >= 0) {
			t->slot_ok[k]++;
			t->slot_sum[k] += t->got;
		}
	}
}

static int
cmp_int(const void *a, const void *b)
{
	int x = *(const int *)a, y = *(const int *)b;
	return (x > y) - (x < y);
}

/* 最近 n 次有回應的中位數（毫秒×10），沒有回傳 -1 */
static int
recent_median(const struct target *t, int n)
{
	int v[TWS_LOSS_N], c = 0, i;

	if (n > t->nres)
		n = t->nres;
	for (i = 1; i <= n; i++) {
		int x = t->rtt[(t->pos - i + TWS_LOSS_N) % TWS_LOSS_N];
		if (x >= 0)
			v[c++] = x;
	}
	if (!c)
		return -1;
	qsort(v, c, sizeof(int), cmp_int);
	return (c % 2) ? v[c / 2] : (v[c / 2 - 1] + v[c / 2]) / 2;
}

/* 最近 n 次的掉包率（%×10），沒有結果回傳 -1 */
static int
recent_loss(const struct target *t)
{
	int lost = 0, i;

	if (!t->nres)
		return -1;
	for (i = 1; i <= t->nres; i++)
		if (t->rtt[(t->pos - i + TWS_LOSS_N) % TWS_LOSS_N] < 0)
			lost++;
	return lost * 1000 / t->nres;
}

/* 序列裡有資料的格子（最近 24 小時）的第 25 百分位；不到 4 格回傳 -1 */
static int
slot_baseline(const struct target *t, long now)
{
	long cur = now / TWS_STEP;
	int v[TWS_SLOTS], c = 0, k;

	for (k = 0; k < TWS_SLOTS; k++) {
		if (t->slot_ok[k] > 0 && t->slot_id[k] > cur - TWS_SLOTS && t->slot_id[k] <= cur)
			v[c++] = (int)(t->slot_sum[k] / t->slot_ok[k]);
	}
	if (c < 4)
		return -1;
	qsort(v, c, sizeof(int), cmp_int);
	return v[c / 4];
}

/* TCP 確認：三個目標同時連，3 秒內任何一個連上就算連得出去 */
static int
ww_tcp_any(void)
{
	static const struct { const char *ip; int port; } tt[] = { { "1.1.1.1", 443 }, { "168.95.1.1", 53 }, { "8.8.8.8", 53 } };
	int fd[3], i, ok = 0;
	long deadline = mono_ms() + 3000;

	for (i = 0; i < 3; i++) {
		struct sockaddr_in sa;

		fd[i] = socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK, 0);
		if (fd[i] < 0)
			continue;
		memset(&sa, 0, sizeof(sa));
		sa.sin_family = AF_INET;
		sa.sin_port = htons(tt[i].port);
		inet_aton(tt[i].ip, &sa.sin_addr);
		if (connect(fd[i], (struct sockaddr *)&sa, sizeof(sa)) == 0)
			ok = 1;
		else if (errno != EINPROGRESS) {
			close(fd[i]);
			fd[i] = -1;
		}
	}
	while (!ok) {
		struct pollfd p[3];
		int n = 0, k;
		long left = deadline - mono_ms();

		for (i = 0; i < 3; i++)
			if (fd[i] >= 0) {
				p[n].fd = fd[i];
				p[n].events = POLLOUT;
				p[n].revents = 0;
				n++;
			}
		if (!n || left <= 0 || poll(p, n, (int)left) <= 0)
			break;
		for (k = 0; k < n; k++) {
			int err = 0;
			socklen_t l = sizeof(err);

			if (!p[k].revents)
				continue;
			if (getsockopt(p[k].fd, SOL_SOCKET, SO_ERROR, &err, &l) == 0 && !err && (p[k].revents & POLLOUT)) {
				ok = 1;
				break;
			}
			for (i = 0; i < 3; i++)
				if (fd[i] == p[k].fd) {
					close(fd[i]);
					fd[i] = -1;
				}
		}
	}
	for (i = 0; i < 3; i++)
		if (fd[i] >= 0)
			close(fd[i]);
	return ok;
}

/* 每一輪 ping 之後呼叫：ext_ok＝HiNet DNS、TWNIC、Cloudflare 至少一個有回 */
static void
ww_check(int ext_ok)
{
	long now = mono_ms() / 1000;
	int sec, gap;

	if (nvram_match("tw_wan_watch", "0") || get_ap_mode() || get_wan_proto(0) == IPV4_WAN_PROTO_IPOE_STATIC) {
		g_ww.state = WW_OFF;
		g_ww.bad_since = 0;
		return;
	}
	g_ww.sec = sec = nvram_safe_get_int("tw_wan_watch_sec", 30, 30, 600);
	g_ww.has_ip = has_wan_ip4(0);
	if (ext_ok) {
		if (!g_ww.ok_since || g_ww.bad_since)
			g_ww.ok_since = now;
		g_ww.bad_since = 0;
		if (g_ww.n && now - g_ww.ok_since >= WW_RESET_OK)
			g_ww.n = 0;
		g_ww.state = WW_OK;
		return;
	}
	if (!get_wan_ether_link_cached()) {
		g_ww.state = WW_NOLINK;
		g_ww.bad_since = 0;
		return;
	}
	if (!g_ww.bad_since)
		g_ww.bad_since = now;
	if (!g_ww.has_ip && sec < WW_NOIP_MIN)
		sec = WW_NOIP_MIN;
	if (g_ww.has_ip && now < g_ww.icmp_until) {
		g_ww.state = WW_ICMP;
		return;
	}
	if (now - g_ww.bad_since < sec) {
		g_ww.state = WW_BAD;
		return;
	}
	if (now < g_ww.next_ok) {
		g_ww.state = WW_WAIT;
		return;
	}
	if (g_ww.has_ip && ww_tcp_any()) {
		if (!g_ww.icmp_until || now - g_ww.icmp_until >= 3600)	/* 系統記錄最多每小時一次 */
			logmessage("連外偵測", "ping 三個目標都沒有回應 %ld 秒，但 TCP 連得出去（可能只是 ping 被擋），不重新連線",
				   now - g_ww.bad_since);
		g_ww.state = WW_ICMP;
		g_ww.icmp_until = now + WW_ICMP_HOLD;
		return;
	}

	gap = ww_gap[g_ww.n < 3 ? g_ww.n : 3];
	g_ww.total++;
	g_ww.n++;
	memmove(&g_ww.ev[1], &g_ww.ev[0], sizeof(g_ww.ev[0]) * (WW_MAX_EV - 1));
	g_ww.ev[0].ts = (long)time(NULL);
	g_ww.ev[0].secs = (int)(now - g_ww.bad_since);
	g_ww.ev[0].has_ip = g_ww.has_ip;
	if (g_ww.nev < WW_MAX_EV)
		g_ww.nev++;
	logmessage("連外偵測", "%s已 %d 秒（HiNet DNS、TWNIC、Cloudflare 都沒有回應），重新連線 WAN（開機以來第 %d 次；%d 分鐘內不會再重撥）",
		   g_ww.has_ip ? "拿著 IP 但連不出去" : "WAN 沒有拿到 IP", g_ww.ev[0].secs, g_ww.total, gap / 60);
	g_ww.next_ok = now + gap;
	g_ww.bad_since = 0;
	g_ww.state = WW_WAIT;
	notify_rc("auto_wan_reconnect");
}

static void
put_x10(FILE *fp, int v)
{
	if (v < 0)
		fputs("null", fp);
	else
		fprintf(fp, "%d.%d", v / 10, v % 10);
}

static int
median3(int *v, int c)
{
	int w[NTARGETS], n = 0, i;

	for (i = 0; i < c; i++)
		if (v[i] >= 0)
			w[n++] = v[i];
	if (!n)
		return -1;
	qsort(w, n, sizeof(int), cmp_int);
	return (n % 2) ? w[n / 2] : (w[n / 2 - 1] + w[n / 2]) / 2;
}

/* "wan_watch":{state, sec, has_ip, bad_for, next_in, total, events:[{ts, secs, has_ip}]} */
static void
ww_json(FILE *fp)
{
	static const char *st[] = { "off", "ok", "bad", "wait", "nolink", "icmp" };
	long now = mono_ms() / 1000;
	int i;

	fprintf(fp, ",\"wan_watch\":{\"state\":\"%s\",\"sec\":%d,\"has_ip\":%s,\"bad_for\":%ld,\"next_in\":%ld,\"total\":%d,\"events\":[",
		st[g_ww.state], g_ww.sec ? g_ww.sec : 30, g_ww.has_ip ? "true" : "false",
		g_ww.bad_since ? now - g_ww.bad_since : 0L, g_ww.next_ok > now ? g_ww.next_ok - now : 0L, g_ww.total);
	for (i = 0; i < g_ww.nev; i++)
		fprintf(fp, "%s{\"ts\":%ld,\"secs\":%d,\"has_ip\":%s}", i ? "," : "", g_ww.ev[i].ts, g_ww.ev[i].secs,
			g_ww.ev[i].has_ip ? "true" : "false");
	fputs("]}", fp);
}

static void
write_json(FILE *fp, long now)
{
	int cur[NTARGETS], base[NTARGETS], loss[NTARGETS];
	int all_cur[NTARGETS], all_base[NTARGETS], nl = 0, sl = 0, na = 0;
	long cbucket = now / TWS_STEP, start = (cbucket - TWS_SLOTS + 1) * TWS_STEP;
	int i, k, synced = now >= TWS_TIME_OK;

	for (i = 0; i < NTARGETS; i++) {
		struct target *t = &g_t[i];
		cur[i] = t->valid ? recent_median(t, TWS_CUR_N) : -1;
		loss[i] = t->valid ? recent_loss(t) : -1;
		base[i] = t->valid ? slot_baseline(t, now) : -1;
		if (base[i] < 0)
			base[i] = cur[i];
		if (i > 0 && t->valid) {
			all_cur[na] = cur[i];
			all_base[na] = base[i];
			na++;
			if (loss[i] >= 0) {
				sl += loss[i];
				nl++;
			}
		}
	}

	fprintf(fp, "{\"ok\":true,\"ts\":%ld,\"available\":true,\"warming_up\":%s,\"source\":\"twstats\"",
		now, g_rounds < TWS_CUR_N ? "true" : "false");
	fputs(",\"current_ms\":", fp);
	put_x10(fp, median3(all_cur, na));
	fputs(",\"baseline_ms\":", fp);
	put_x10(fp, median3(all_base, na));
	fputs(",\"loss_pct\":", fp);
	put_x10(fp, nl ? sl / nl : -1);
	fputs(",\"targets\":[", fp);
	for (i = 0; i < NTARGETS; i++) {
		struct target *t = &g_t[i];

		fprintf(fp, "%s{\"id\":\"%s\",\"label\":\"%s\",\"host\":\"%s\",\"current_ms\":", i ? "," : "", t->id, t->label, t->host);
		put_x10(fp, cur[i]);
		fputs(",\"baseline_ms\":", fp);
		put_x10(fp, base[i]);
		fputs(",\"loss_pct\":", fp);
		put_x10(fp, loss[i]);
		if (synced) {
			fprintf(fp, ",\"series\":{\"step\":%d,\"start\":%ld,\"values\":[", TWS_STEP, start);
			for (k = 0; k < TWS_SLOTS; k++) {
				long b = cbucket - TWS_SLOTS + 1 + k;
				int s = (int)(b % TWS_SLOTS);
				if (k)
					fputc(',', fp);
				if (t->slot_id[s] == b && t->slot_ok[s] > 0)
					put_x10(fp, (int)(t->slot_sum[s] / t->slot_ok[s]));
				else
					fputs("null", fp);
			}
			fprintf(fp, "]},\"loss\":{\"step\":%d,\"start\":%ld,\"values\":[", TWS_STEP, start);
			for (k = 0; k < TWS_SLOTS; k++) {
				long b = cbucket - TWS_SLOTS + 1 + k;
				int s = (int)(b % TWS_SLOTS);
				if (k)
					fputc(',', fp);
				if (t->slot_id[s] == b && t->slot_n[s] > 0)
					put_x10(fp, (t->slot_n[s] - t->slot_ok[s]) * 1000 / t->slot_n[s]);
				else
					fputs("null", fp);
			}
			fputs("]}", fp);
		} else
			fputs(",\"series\":null,\"loss\":null", fp);
		fputc('}', fp);
	}
	fputc(']', fp);
	ww_json(fp);
	fputs("}\n", fp);
}

static void
save_json(long now)
{
	FILE *fp;

	mkdir(TWS_DIR, 0755);
	fp = fopen(TWS_LATENCY ".tmp", "w");
	if (!fp)
		return;
	write_json(fp, now);
	fclose(fp);
	rename(TWS_LATENCY ".tmp", TWS_LATENCY);
}

static void
on_term(int sig)
{
	g_stop = 1;
}

int
tw_stats_main(int argc, char **argv)
{
	int fd, i;
	FILE *fp;

	if (argc > 1 && !strcmp(argv[1], "status")) {
		char line[4096];
		size_t n;

		fp = fopen(TWS_LATENCY, "r");
		if (!fp) {
			printf("twstats 還沒有資料（%s）\n", TWS_LATENCY);
			return 1;
		}
		while ((n = fread(line, 1, sizeof(line), fp)) > 0)
			fwrite(line, 1, n, stdout);
		fclose(fp);
		return 0;
	}

	if (daemon(0, 0) < 0)
		return 1;
	umask(022);

	fp = fopen(TWS_PID_FILE, "w");
	if (fp) {
		fprintf(fp, "%d\n", getpid());
		fclose(fp);
	}

	signal(SIGTERM, on_term);
	signal(SIGINT, on_term);
	signal(SIGHUP, SIG_IGN);
	signal(SIGPIPE, SIG_IGN);

	fd = socket(AF_INET, SOCK_RAW, IPPROTO_ICMP);
	if (fd < 0) {
		logmessage("twstats", "無法建立 ICMP socket（%s）", strerror(errno));
		return 1;
	}
	g_id = (unsigned short)(getpid() ^ 0x7473);
	for (i = 0; i < NTARGETS; i++)
		memset(g_t[i].slot_id, 0xff, sizeof(g_t[i].slot_id));	/* -1：還沒有資料 */

	while (!g_stop) {
		long t0 = mono_ms(), left;

		update_targets();
		probe_round(fd);
		record((long)time(NULL));
		if (g_rounds < TWS_CUR_N)
			g_rounds++;
		ww_check(g_t[1].got >= 0 || g_t[2].got >= 0 || g_t[3].got >= 0);
		save_json((long)time(NULL));

		left = TWS_INTERVAL * 1000L - (mono_ms() - t0);
		while (left > 0 && !g_stop) {
			usleep((left > 1000 ? 1000 : left) * 1000);
			left = TWS_INTERVAL * 1000L - (mono_ms() - t0);
		}
	}

	close(fd);
	unlink(TWS_PID_FILE);
	return 0;
}
