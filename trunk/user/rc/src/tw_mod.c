/*
 * padavan-tw：中華電信 MOD 機上盒自動偵測（tw_mod_auto）
 *
 * 中華電信光世代的上網（PPPoE）和 MOD 走同一條線；MOD 機上盒要直接向中華電信取得位址，
 * 所以要把它接的 LAN 孔在交換器上橋接到 WAN（wan_stb_x）。使用者通常不知道接在哪個孔（機身沒有標號），
 * 這裡讓路由器自己判斷：
 *   1. 監聽區網（br0）的 DHCP 要位址封包；Vendor Class（option 60）以「CHT-」開頭的就是 MOD 機上盒
 *      （2026-11-20 實測：CHT-VSM-505，Client-ID「<序號>-STB-00」）。路由器給的位址機上盒不會接受，會每分鐘重送一次
 *   2. 每次看到它，記下這段時間各 LAN 孔交換器的「收到廣播」計數有增加的孔；連續幾次取交集，剩下唯一一個孔就是它
 *   3. 把那個孔設成 MOD 專用（wan_stb_x、wan_stb_iso=1），寫進 nvram、重新設定交換器，記在系統記錄
 * 只在「自動偵測開著、目前沒有 MOD 專用孔、不是 AP 模式」時監聽；設好後就停止（不會自動取消，取消在後台按）。
 * 只用 MT7621 內建交換器（D3、CR6608）的計數；其他交換器不編進來。
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <syslog.h>
#include <sys/socket.h>
#include <sys/ioctl.h>
#include <net/if.h>
#include <arpa/inet.h>
#include <linux/if_packet.h>
#include <linux/if_ether.h>
#include <linux/filter.h>

#include "rc.h"
#include "switch.h"

#if defined (USE_MTK_GSW)

#define TWMOD_PORTS	4		/* wan_stb_x 1～4 對應 LAN1～LAN4 */
#define TWMOD_CONFIRM	3		/* 連續幾次看到機上盒才判斷 */
#define TWMOD_STALE	600		/* 超過 10 分鐘沒再看到就重新開始 */

static int twmod_fd = -1;
static unsigned int twmod_last_bcast[TWMOD_PORTS + 1];
static int twmod_have_last;
static unsigned int twmod_cand;		/* 候選孔的位元遮罩（bit n = LANn） */
static int twmod_seen;
static time_t twmod_seen_at;
static unsigned char twmod_mac[6];
static char twmod_vendor[48];

static int
twmod_enabled(void)
{
	if (nvram_get_int("tw_mod_auto") != 1)
		return 0;
	if (get_ap_mode())
		return 0;
	if (nvram_get_int("wan_stb_x") != 0)
		return 0;
	return 1;
}

/* 只收 UDP 目的埠 67（DHCP 伺服器）：tcpdump -dd 'udp dst port 67'（IPv4，不含分段） */
static int
twmod_open(void)
{
	struct sock_filter code[] = {
		{ 0x28, 0, 0, 0x0000000c },
		{ 0x15, 0, 8, 0x00000800 },
		{ 0x30, 0, 0, 0x00000017 },
		{ 0x15, 0, 6, 0x00000011 },
		{ 0x28, 0, 0, 0x00000014 },
		{ 0x45, 4, 0, 0x00001fff },
		{ 0xb1, 0, 0, 0x0000000e },
		{ 0x48, 0, 0, 0x00000010 },
		{ 0x15, 0, 1, 0x00000043 },
		{ 0x06, 0, 0, 0x00040000 },
		{ 0x06, 0, 0, 0x00000000 },
	};
	struct sock_fprog prog = { sizeof(code) / sizeof(code[0]), code };
	struct sockaddr_ll sll;
	int fd, ifindex;

	ifindex = if_nametoindex(IFNAME_BR);
	if (ifindex <= 0)
		return -1;
	fd = socket(AF_PACKET, SOCK_RAW, htons(ETH_P_IP));
	if (fd < 0)
		return -1;
	if (setsockopt(fd, SOL_SOCKET, SO_ATTACH_FILTER, &prog, sizeof(prog)) < 0) {
		close(fd);
		return -1;
	}
	memset(&sll, 0, sizeof(sll));
	sll.sll_family = AF_PACKET;
	sll.sll_protocol = htons(ETH_P_IP);
	sll.sll_ifindex = ifindex;
	if (bind(fd, (struct sockaddr *)&sll, sizeof(sll)) < 0) {
		close(fd);
		return -1;
	}
	fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK);
	fcntl(fd, F_SETFD, FD_CLOEXEC);
	return fd;
}

static void
twmod_close(void)
{
	if (twmod_fd >= 0)
		close(twmod_fd);
	twmod_fd = -1;
	twmod_have_last = 0;
	twmod_cand = 0;
	twmod_seen = 0;
}

/* DHCP DISCOVER／REQUEST 而且 option 60 以 CHT- 開頭：回傳 1，並帶出 MAC 與 Vendor Class */
static int
twmod_parse(const unsigned char *p, int len, unsigned char *mac, char *vendor, size_t vlen)
{
	int ihl, i, is_req = 0;
	const unsigned char *d, *o, *end;
	char vc[48] = {0};

	if (len < 14 + 20 + 8 + 240)
		return 0;
	ihl = (p[14] & 0x0f) * 4;
	d = p + 14 + ihl + 8;			/* BOOTP */
	end = p + len;
	if (d + 240 > end || d[0] != 1)		/* op = BOOTREQUEST */
		return 0;
	if (d[236] != 0x63 || d[237] != 0x82 || d[238] != 0x53 || d[239] != 0x63)
		return 0;
	for (o = d + 240; o < end && *o != 0xff; ) {
		if (*o == 0) { o++; continue; }
		if (o + 2 > end || o + 2 + o[1] > end)
			break;
		if (o[0] == 53 && o[1] >= 1 && (o[2] == 1 || o[2] == 3))
			is_req = 1;
		if (o[0] == 60) {
			int n = o[1] < (int)sizeof(vc) - 1 ? o[1] : (int)sizeof(vc) - 1;
			memcpy(vc, o + 2, n);
			vc[n] = 0;
		}
		o += 2 + o[1];
	}
	if (!is_req || strncmp(vc, "CHT-", 4) != 0)
		return 0;
	for (i = 0; vc[i]; i++)
		if ((unsigned char)vc[i] < 0x20 || (unsigned char)vc[i] > 0x7e)
			vc[i] = '?';
	memcpy(mac, d + 28, 6);
	snprintf(vendor, vlen, "%s", vc);
	return 1;
}

static int
twmod_read_bcast(unsigned int *v)
{
	int i;

	for (i = 1; i <= TWMOD_PORTS; i++)
		if (phy_status_port_rx_bcast(i, &v[i]) != 0)
			return -1;
	return 0;
}

static void
twmod_apply(int port)
{
	char msg[160];

	snprintf(msg, sizeof(msg), "偵測到中華電信 MOD 機上盒（%s，%02X:%02X:%02X:%02X:%02X:%02X）接在 LAN%d，自動設為 MOD 專用孔",
		twmod_vendor, twmod_mac[0], twmod_mac[1], twmod_mac[2], twmod_mac[3], twmod_mac[4], twmod_mac[5], port);
	logmessage("MOD", "%s", msg);
	nvram_set_int("wan_stb_x", port);
	nvram_set_int("wan_stb_iso", 1);
	nvram_set("tw_mod_auto_last", msg);
	nvram_commit();
	notify_rc(RCN_RESTART_SWITCH_VLAN);
}

/* watchdog 每 10 秒呼叫一次 */
void
tw_mod_check(void)
{
	unsigned char buf[1600], mac[6];
	char vendor[48];
	unsigned int now_bc[TWMOD_PORTS + 1], hit = 0, link;
	int n, i, seen_now = 0;
	time_t now;

	if (!twmod_enabled()) {
		if (twmod_fd >= 0)
			twmod_close();
		return;
	}
	if (twmod_fd < 0) {
		twmod_fd = twmod_open();
		if (twmod_fd < 0)
			return;
	}

	while ((n = recv(twmod_fd, buf, sizeof(buf), 0)) > 0) {
		if (twmod_parse(buf, n, mac, vendor, sizeof(vendor))) {
			if (twmod_seen && memcmp(mac, twmod_mac, 6) != 0)
				continue;	/* 一次只追一台 */
			memcpy(twmod_mac, mac, 6);
			snprintf(twmod_vendor, sizeof(twmod_vendor), "%s", vendor);
			seen_now = 1;
		}
	}

	if (twmod_read_bcast(now_bc) != 0)
		return;
	if (!twmod_have_last) {
		memcpy(twmod_last_bcast, now_bc, sizeof(now_bc));
		twmod_have_last = 1;
		return;		/* 第一次只記基準，這段期間的封包不算 */
	}
	for (i = 1; i <= TWMOD_PORTS; i++) {
		link = 0;
		if (now_bc[i] != twmod_last_bcast[i] && phy_status_port_link(i, &link) == 0 && link)
			hit |= 1u << i;
	}
	memcpy(twmod_last_bcast, now_bc, sizeof(now_bc));

	now = time(NULL);
	if (twmod_seen && now - twmod_seen_at > TWMOD_STALE) {
		twmod_seen = 0;
		twmod_cand = 0;
	}
	if (!seen_now || !hit)
		return;

	twmod_cand = twmod_seen ? (twmod_cand & hit) : hit;
	twmod_seen++;
	twmod_seen_at = now;
	if (!twmod_cand) {
		/* 交集變空（中途換孔或計數被別的裝置干擾）：從這次重新算 */
		twmod_cand = hit;
		twmod_seen = 1;
	}
	if (twmod_seen < TWMOD_CONFIRM)
		return;
	for (i = 1; i <= TWMOD_PORTS; i++) {
		if (twmod_cand == (1u << i)) {
			twmod_close();
			twmod_apply(i);
			return;
		}
	}
}

#else

void
tw_mod_check(void)
{
}

#endif
