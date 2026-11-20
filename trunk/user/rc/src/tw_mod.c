/*
 * padavan-tw：中華電信 MOD 機上盒自動設定（tw_mod_auto）
 *
 * 中華電信光世代的上網（PPPoE）和 MOD 走同一條線；MOD 機上盒要直接向中華電信取得位址，
 * 所以要把它接的 LAN 孔在交換器上橋接到 WAN（wan_stb_x）。使用者通常不知道接在哪個孔（機身沒有標號），
 * 這裡讓路由器自己處理：
 *   1. 認出機上盒：監聽區網（br0）的 DHCP 要位址封包；Vendor Class（option 60）以「CHT-」開頭的就是 MOD 機上盒
 *      （2026-11-20 實測 CHT-VSM-505）。記下它的 MAC（nvram tw_mod_mac，最多 4 台）
 *   2. 找孔：查交換器的 MAC 表（switch dump），看那個 MAC 在哪個 LAN 孔——機上盒一直在發封包（就算只是找閘道），
 *      交換器一定記得它在哪，不用等它重新要位址
 *   3. 每 30 秒追蹤記得的機上盒：
 *      - 還沒有 MOD 孔、看到它在某個孔（例如路由器重開、機上盒沒重開）→ 設成 MOD 孔
 *      - 它換到別的孔 → MOD 孔跟著搬
 *      - MOD 孔上出現別的裝置、機上盒 10 分鐘以上沒出現在那個孔 → 取消 MOD 孔
 *        （機上盒只是關機、孔上沒有別的裝置就不動）
 *      每個動作要連續兩次（間隔 30 秒）看到才做，做完冷卻 2 分鐘；每次都寫系統記錄
 * 使用者在後台手動改成「沒有接 MOD」時，後台會清掉記得的機上盒（不再自動設回來）。AP 模式不動作。
 * 交換器埠號與 LAN 孔的對應依機型（核心設定 CONFIG_RAETH_ESW_PORT_LANn，cflags.mk 傳進來）。
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
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

#if defined (TW_ESW_PORT_LAN1) && defined (TW_ESW_PORT_LAN2) && defined (TW_ESW_PORT_LAN3) && defined (TW_ESW_PORT_LAN4)
#define TWMOD_ARL	1
#endif

#define TWMOD_PORTS	4		/* wan_stb_x 1～4 對應 LAN1～LAN4 */
#define TWMOD_MAXMAC	4
#define TWMOD_ABSENT	600		/* MOD 孔上有別的裝置、機上盒這麼久沒出現就取消 */
#define TWMOD_COOL	120		/* 改過交換器之後這段時間不再動作（MAC 表要時間更新） */

static int twmod_fd = -1;
static int twmod_tick;
static time_t twmod_cool_until, twmod_on_mod_at;
static int twmod_pend_act, twmod_pend_port;	/* 等第二次確認的動作 */

static int
twmod_enabled(void)
{
	return nvram_get_int("tw_mod_auto") == 1 && !get_ap_mode();
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

/* 記得的機上盒 MAC：nvram tw_mod_mac，小寫 12 位十六進位、空白分隔 */
static int
twmod_known(const char *mac12)
{
	char list[64], *p, *save = NULL;

	snprintf(list, sizeof(list), "%s", nvram_safe_get("tw_mod_mac"));
	for (p = strtok_r(list, " ", &save); p; p = strtok_r(NULL, " ", &save))
		if (strcasecmp(p, mac12) == 0)
			return 1;
	return 0;
}

static void
twmod_remember(const char *mac12)
{
	char list[64], out[64], *p, *save = NULL;
	int n = 1;

	if (twmod_known(mac12))
		return;
	snprintf(out, sizeof(out), "%s", mac12);
	snprintf(list, sizeof(list), "%s", nvram_safe_get("tw_mod_mac"));
	for (p = strtok_r(list, " ", &save); p && n < TWMOD_MAXMAC; p = strtok_r(NULL, " ", &save), n++) {
		strncat(out, " ", sizeof(out) - strlen(out) - 1);
		strncat(out, p, sizeof(out) - strlen(out) - 1);
	}
	nvram_set("tw_mod_mac", out);
}

static void
twmod_set(int port, const char *msg)
{
	logmessage("MOD", "%s", msg);
	nvram_set_int("wan_stb_x", port);
	nvram_set_int("wan_stb_iso", 1);
	nvram_set("tw_mod_auto_last", msg);
	nvram_commit();
	notify_rc(RCN_RESTART_SWITCH_VLAN);
	twmod_cool_until = time(NULL) + TWMOD_COOL;
	twmod_on_mod_at = time(NULL);
	twmod_pend_act = 0;
}

#if defined (TWMOD_ARL)
/* 交換器埠號 → LAN 孔（1～4），不是 LAN 孔回 0 */
static int
twmod_gsw_to_lan(int gsw)
{
	if (gsw == TW_ESW_PORT_LAN1) return 1;
	if (gsw == TW_ESW_PORT_LAN2) return 2;
	if (gsw == TW_ESW_PORT_LAN3) return 3;
	if (gsw == TW_ESW_PORT_LAN4) return 4;
	return 0;
}

/*
 * 讀交換器 MAC 表（switch dump）：
 *   *stb_ports：記得的機上盒出現在哪些 LAN 孔（位元 n = LANn）
 *   *other_on：LAN 孔 other_port 上有沒有「不是記得的機上盒」的裝置；只有一台時 other_mac 是它的 MAC，不只一台時是空字串
 * 一行的格式：「138:   ---1 ----    0     2  145  58c41e734d7b     -     -」（埠 0～7 各一個字元）
 */
static int
twmod_read_arl(unsigned int *stb_ports, int other_port, int *other_on, char *other_mac)
{
	FILE *fp;
	char line[160], g1[8], g2[8], mac[16], pm[9], *c;
	int fid, vid, age, i, lan;

	*stb_ports = 0;
	*other_on = 0;
	fp = popen("/sbin/switch dump 2>/dev/null", "r");
	if (!fp)
		return -1;
	while (fgets(line, sizeof(line), fp)) {
		c = strchr(line, ':');
		if (!c || sscanf(c + 1, "%7s %7s %d %d %d %15s", g1, g2, &fid, &vid, &age, mac) != 6)
			continue;
		if (strlen(g1) != 4 || strlen(g2) != 4 || strlen(mac) != 12)
			continue;
		snprintf(pm, sizeof(pm), "%s%s", g1, g2);
		for (i = 0; i < 8; i++) {
			if (pm[i] != '1')
				continue;
			lan = twmod_gsw_to_lan(i);
			if (!lan)
				continue;
			if (twmod_known(mac))
				*stb_ports |= 1u << lan;
			else if (lan == other_port) {
				if (*other_on == 0 || strcasecmp(other_mac, mac) == 0)
					strcpy(other_mac, mac);
				else
					other_mac[0] = 0;	/* 不只一台 */
				*other_on = 1;
			}
		}
	}
	pclose(fp);
	return 0;
}

/* 同一個動作要連續兩次（間隔 30 秒）看到才做 */
static int
twmod_confirm(int act, int port)
{
	if (twmod_pend_act == act && twmod_pend_port == port)
		return 1;
	twmod_pend_act = act;
	twmod_pend_port = port;
	return 0;
}

/* 只出現在一個孔：回傳孔號；沒有或不只一個：0 */
static int
twmod_single(unsigned int ports)
{
	int i, found = 0;

	for (i = 1; i <= TWMOD_PORTS; i++) {
		if (ports & (1u << i)) {
			if (found)
				return 0;
			found = i;
		}
	}
	return found;
}
#endif

/* watchdog 每 10 秒呼叫一次 */
void
tw_mod_check(void)
{
	unsigned char buf[1600], mac[6];
	char vendor[48], mac12[16];
	int n, cur;
#if defined (TWMOD_ARL)
	char msg[200], other_mac[16] = {0};
	unsigned int ports = 0;
	int other_on = 0, stb;
	time_t now;
#endif

	if (!twmod_enabled()) {
		if (twmod_fd >= 0)
			twmod_close();
		return;
	}
	cur = nvram_get_int("wan_stb_x");
	if (cur < 0 || cur > TWMOD_PORTS)
		return;		/* 原始頁面設了兩個以上的孔：不動 */

	/* 1. 還沒有 MOD 孔：聽區網的 DHCP，認出新的機上盒並記住 */
	if (cur == 0) {
		if (twmod_fd < 0)
			twmod_fd = twmod_open();
		while (twmod_fd >= 0 && (n = recv(twmod_fd, buf, sizeof(buf), 0)) > 0) {
			if (!twmod_parse(buf, n, mac, vendor, sizeof(vendor)))
				continue;
			snprintf(mac12, sizeof(mac12), "%02x%02x%02x%02x%02x%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
			if (!twmod_known(mac12)) {
				twmod_remember(mac12);
				nvram_commit();
				logmessage("MOD", "認出中華電信 MOD 機上盒（%s，%02X:%02X:%02X:%02X:%02X:%02X），找它接在哪個孔", vendor,
					mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
				twmod_tick = 2;		/* 下一次就查 MAC 表 */
			}
		}
	} else if (twmod_fd >= 0) {
		twmod_close();
	}

#if defined (TWMOD_ARL)
	/* 2. 每 30 秒查 MAC 表，追蹤記得的機上盒 */
	if ((cur == 0 && !*nvram_safe_get("tw_mod_mac")) || ++twmod_tick < 3)
		return;
	twmod_tick = 0;
	now = time(NULL);
	if (now < twmod_cool_until)
		return;
	if (twmod_read_arl(&ports, cur, &other_on, other_mac) != 0)
		return;
	/* 已經有 MOD 孔、但還沒記住機上盒（例如手動設的、或舊版韌體設的）：孔上只有一台裝置就記成機上盒 */
	if (cur && !*nvram_safe_get("tw_mod_mac")) {
		if (other_on && other_mac[0]) {
			twmod_remember(other_mac);
			nvram_commit();
			logmessage("MOD", "記住 LAN%d（MOD 專用孔）上的機上盒，之後換孔、路由器重開會自動跟著", cur);
		}
		return;
	}
	stb = twmod_single(ports);
	if (!twmod_on_mod_at)
		twmod_on_mod_at = now;		/* 開機後先給 10 分鐘 */

	if (cur == 0) {
		if (stb) {
			if (twmod_confirm(1, stb)) {
				snprintf(msg, sizeof(msg), "MOD 機上盒接在 LAN%d，自動設為 MOD 專用孔", stb);
				twmod_set(stb, msg);
			}
		} else {
			twmod_pend_act = 0;
		}
		return;
	}

	if (ports & (1u << cur)) {
		twmod_on_mod_at = now;		/* 機上盒在 MOD 孔上：正常 */
		twmod_pend_act = 0;
		return;
	}
	if (stb && stb != cur) {
		if (twmod_confirm(2, stb)) {
			snprintf(msg, sizeof(msg), "MOD 機上盒從 LAN%d 換到 LAN%d，MOD 專用孔跟著改", cur, stb);
			twmod_set(stb, msg);
		}
		return;
	}
	if (other_on && now - twmod_on_mod_at >= TWMOD_ABSENT) {
		if (twmod_confirm(3, cur)) {
			snprintf(msg, sizeof(msg), "LAN%d 接了其他裝置、機上盒超過 10 分鐘沒出現在這個孔，取消 MOD 專用孔", cur);
			twmod_set(0, msg);
		}
		return;
	}
	twmod_pend_act = 0;
#endif
}

#else

void
tw_mod_check(void)
{
}

#endif
