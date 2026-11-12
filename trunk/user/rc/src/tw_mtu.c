/*
 * padavan-tw：測量 WAN 能通過的最大封包（MTU）
 *
 *   tw-mtu-probe [-i 介面] [目標 IP ...]
 *
 * 做法：從 WAN 介面送出「不可分片」（DF）的 ICMP echo，用二分搜尋找出
 * 每個目標都回應得到的最大 IP 封包大小，就是建議的 MTU。
 * - 預設介面＝預設路由的介面；預設目標＝HiNet DNS、Google DNS、Cloudflare DNS
 * - PPPoE 的上限是 1492（乙太網路 1500 減 8 位元組 PPPoE 標頭）；
 *   介面目前的 MTU 比上限小時會暫時調高來測，結束（或中斷）時一定改回原值
 * - 最後一行輸出「MTU=數字」給網頁讀取；測不到時輸出「MTU=0」並回傳 1
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <signal.h>
#include <poll.h>
#include <time.h>
#include <sys/time.h>
#include <sys/socket.h>
#include <sys/ioctl.h>
#include <net/if.h>
#include <netinet/in.h>
#include <netinet/ip.h>
#include <netinet/ip_icmp.h>
#include <arpa/inet.h>

#ifndef IP_PMTUDISC_PROBE
#define IP_PMTUDISC_PROBE	3
#endif

#define MTU_MIN		1280
#define TRIES		2
#define WAIT_MS		800

static char g_ifname[IFNAMSIZ];
static int g_old_mtu = 0;
static int g_mtu_changed = 0;

static int
if_mtu(const char *ifname, int set)
{
	struct ifreq ifr;
	int fd, ret;

	fd = socket(AF_INET, SOCK_DGRAM, 0);
	if (fd < 0)
		return -1;
	memset(&ifr, 0, sizeof(ifr));
	snprintf(ifr.ifr_name, IFNAMSIZ, "%s", ifname);
	if (set > 0) {
		ifr.ifr_mtu = set;
		ret = ioctl(fd, SIOCSIFMTU, &ifr);
	} else {
		ret = ioctl(fd, SIOCGIFMTU, &ifr);
		if (ret == 0)
			ret = ifr.ifr_mtu;
	}
	close(fd);
	return ret;
}

static void
restore_mtu(void)
{
	if (g_mtu_changed) {
		if_mtu(g_ifname, g_old_mtu);
		g_mtu_changed = 0;
	}
}

static void
on_signal(int sig)
{
	restore_mtu();
	_exit(1);
}

/* 預設路由的介面（/proc/net/route 第一個目的地 00000000 的項目） */
static int
default_route_if(char *out, size_t len)
{
	FILE *fp = fopen("/proc/net/route", "r");
	char line[256], ifn[IFNAMSIZ + 1];
	unsigned long dst, mask;

	if (!fp)
		return -1;
	if (!fgets(line, sizeof(line), fp)) {
		fclose(fp);
		return -1;
	}
	while (fgets(line, sizeof(line), fp)) {
		if (sscanf(line, "%16s %lx %*x %*x %*d %*d %*d %lx", ifn, &dst, &mask) == 3 &&
		    dst == 0 && mask == 0) {
			snprintf(out, len, "%.*s", IFNAMSIZ - 1, ifn);
			fclose(fp);
			return 0;
		}
	}
	fclose(fp);
	return -1;
}

static unsigned short
icmp_cksum(const void *data, int len)
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

static long
now_ms(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return ts.tv_sec * 1000L + ts.tv_nsec / 1000000L;
}

/*
 * 送一個 IP 總長度為 size 的 DF echo，等回應。
 * 回傳 1＝通過、0＝沒有回應或太大；*hint 收到「需要分片」時填入對方告知的 MTU
 */
static int
probe_once(int fd, struct in_addr dst, int size, unsigned short id, unsigned short seq, int *hint)
{
	static unsigned char buf[2048], rbuf[2048];
	struct sockaddr_in to, from;
	struct icmphdr *icmp = (struct icmphdr *)buf;
	int plen = size - 20;	/* ICMP 部分（IP 標頭 20 位元組） */
	long deadline;

	if (plen < (int)sizeof(struct icmphdr) || plen > (int)sizeof(buf))
		return 0;

	memset(buf, 0, plen);
	icmp->type = ICMP_ECHO;
	icmp->code = 0;
	icmp->un.echo.id = htons(id);
	icmp->un.echo.sequence = htons(seq);
	memset(buf + sizeof(*icmp), 0xA5, plen - sizeof(*icmp));
	icmp->checksum = icmp_cksum(buf, plen);

	memset(&to, 0, sizeof(to));
	to.sin_family = AF_INET;
	to.sin_addr = dst;
	if (sendto(fd, buf, plen, 0, (struct sockaddr *)&to, sizeof(to)) < 0)
		return 0;	/* EMSGSIZE：比介面 MTU 大 */

	deadline = now_ms() + WAIT_MS;
	for (;;) {
		struct pollfd pfd = { fd, POLLIN, 0 };
		long left = deadline - now_ms();
		socklen_t flen = sizeof(from);
		struct iphdr *ip;
		struct icmphdr *r;
		int n, hl;

		if (left <= 0)
			return 0;
		if (poll(&pfd, 1, (int)left) <= 0)
			return 0;
		n = recvfrom(fd, rbuf, sizeof(rbuf), 0, (struct sockaddr *)&from, &flen);
		if (n < (int)sizeof(struct iphdr))
			continue;
		ip = (struct iphdr *)rbuf;
		hl = ip->ihl * 4;
		if (n < hl + (int)sizeof(struct icmphdr))
			continue;
		r = (struct icmphdr *)(rbuf + hl);

		if (r->type == ICMP_ECHOREPLY && from.sin_addr.s_addr == dst.s_addr &&
		    ntohs(r->un.echo.id) == id && ntohs(r->un.echo.sequence) == seq)
			return 1;

		/* 路上有設備回報「需要分片」：內含原始封包標頭，確認是我們送的 */
		if (r->type == ICMP_DEST_UNREACH && r->code == ICMP_FRAG_NEEDED &&
		    n >= hl + 8 + 20 + 8) {
			struct iphdr *oip = (struct iphdr *)(rbuf + hl + 8);
			struct icmphdr *oicmp = (struct icmphdr *)((unsigned char *)oip + oip->ihl * 4);
			if ((unsigned char *)oicmp + 8 <= rbuf + n &&
			    oip->daddr == dst.s_addr && ntohs(oicmp->un.echo.id) == id) {
				int m = ntohs(r->un.frag.mtu);
				if (hint && m >= 576 && m < size)
					*hint = m;
				return 0;
			}
		}
	}
}

static int
probe_size(int fd, struct in_addr dst, int size, unsigned short id, unsigned short *seq, int *hint)
{
	int t;
	for (t = 0; t < TRIES; t++) {
		if (probe_once(fd, dst, size, id, ++(*seq), hint))
			return 1;
	}
	return 0;
}

/* 回傳目標可通過的最大大小；目標不回應時回傳 0 */
static int
probe_target(int fd, const char *target, int upper, unsigned short id)
{
	struct in_addr dst;
	unsigned short seq = 0;
	int lo, hi, mid, hint = 0;

	if (inet_aton(target, &dst) == 0) {
		printf("  %s：不是 IPv4 位址，略過\n", target);
		return 0;
	}
	if (!probe_size(fd, dst, MTU_MIN, id, &seq, NULL)) {
		printf("  %s：沒有回應，略過\n", target);
		return 0;
	}
	if (probe_size(fd, dst, upper, id, &seq, &hint)) {
		printf("  %s：%d\n", target, upper);
		return upper;
	}
	lo = MTU_MIN;
	hi = upper;
	/* 有設備回報 MTU 時先驗證那個值，通常一次就找到 */
	if (hint > lo && hint < hi) {
		if (probe_size(fd, dst, hint, id, &seq, NULL))
			lo = hint;
		else
			hi = hint;
	}
	while (hi - lo > 1) {
		mid = (lo + hi) / 2;
		if (probe_size(fd, dst, mid, id, &seq, NULL))
			lo = mid;
		else
			hi = mid;
	}
	printf("  %s：%d\n", target, lo);
	return lo;
}

int
tw_mtu_probe_main(int argc, char **argv)
{
	static const char *def_targets[] = { "168.95.1.1", "8.8.8.8", "1.1.1.1" };
	const char **targets = def_targets;
	int ntargets = 3, upper, fd, i, opt, best = 0, ok = 0, r;
	int pmtu = IP_PMTUDISC_PROBE;
	unsigned short id;

	g_ifname[0] = 0;
	while ((opt = getopt(argc, argv, "i:")) != -1) {
		if (opt == 'i')
			snprintf(g_ifname, sizeof(g_ifname), "%s", optarg);
		else {
			printf("用法：tw-mtu-probe [-i 介面] [目標 IP ...]\n");
			return 2;
		}
	}
	if (optind < argc) {
		targets = (const char **)&argv[optind];
		ntargets = argc - optind;
	}
	if (!g_ifname[0] && default_route_if(g_ifname, sizeof(g_ifname)) != 0) {
		printf("找不到預設路由（WAN 沒有連線？）\nMTU=0\n");
		return 1;
	}

	g_old_mtu = if_mtu(g_ifname, 0);
	if (g_old_mtu <= 0) {
		printf("讀不到 %s 的 MTU\nMTU=0\n", g_ifname);
		return 1;
	}
	upper = (strncmp(g_ifname, "ppp", 3) == 0) ? 1492 : 1500;

	fd = socket(AF_INET, SOCK_RAW, IPPROTO_ICMP);
	if (fd < 0) {
		printf("無法建立 ICMP socket：%s\nMTU=0\n", strerror(errno));
		return 1;
	}
	setsockopt(fd, IPPROTO_IP, IP_MTU_DISCOVER, &pmtu, sizeof(pmtu));
	setsockopt(fd, SOL_SOCKET, SO_BINDTODEVICE, g_ifname, strlen(g_ifname) + 1);

	signal(SIGINT, on_signal);
	signal(SIGTERM, on_signal);
	signal(SIGHUP, on_signal);
	signal(SIGALRM, on_signal);
	alarm(60);

	if (g_old_mtu < upper) {
		if (if_mtu(g_ifname, upper) == 0)
			g_mtu_changed = 1;
		else
			upper = g_old_mtu;
	}

	printf("介面 %s（目前 MTU %d），測試範圍 %d～%d：\n", g_ifname, g_old_mtu, MTU_MIN, upper);
	fflush(stdout);

	id = (unsigned short)(getpid() & 0xffff);
	for (i = 0; i < ntargets; i++) {
		r = probe_target(fd, targets[i], upper, id);
		fflush(stdout);
		if (r > 0) {
			ok++;
			if (best == 0 || r < best)
				best = r;
		}
	}

	restore_mtu();
	alarm(0);
	close(fd);

	if (!ok) {
		printf("所有目標都沒有回應，無法判斷\nMTU=0\n");
		return 1;
	}
	printf("建議 MTU：%d\nMTU=%d\n", best, best);
	return 0;
}
