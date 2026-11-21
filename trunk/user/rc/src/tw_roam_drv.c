/*
 * padavan-tw：漫遊中控的驅動介面（11k Beacon Request、11v BTM、鄰居清單、事件）
 *
 * 決定層（tw_roamd.c）只透過 tw_roam.h 的函式呼叫這裡，各晶片的細節都在這個檔。
 * 查證紀錄：docs/ROAM-COOP.md 第 8 節（2026-11-20 讀驅動原始碼）。
 *
 * | 機型／頻段          | 晶片    | Beacon Request        | 回報                     | BTM                         | 裝置能力          | 鄰居清單      |
 * |---------------------|---------|-----------------------|--------------------------|-----------------------------|-------------------|---------------|
 * | CR6608 2.4G／5G     | MT7915  | OID 0x894C 子命令 5   | 事件 0x094D              | OID 0x894A 子命令 6（參數） | 0x5102（KVRH）    | 程式回答      |
 * | D3 2.4G（ra0）      | MT7603E | OID 0x894C 子命令 5   | 事件 0x094D              | OID 0x894A 子命令 5（原始） | 0x494A／0x494C    | 程式回答      |
 * | D3 5G（rai0）       | MT7612E | iwpriv BcnReq（字串） | 事件 0x0950（padavan-tw）| OID 0x8928（padavan-tw）    | 不知道（看回報）  | 驅動用掃描表  |
 *
 * 不踢人的保證：所有 BTM 的 Disassociation Timer 都是 0、Request Mode 不設 Disassociation Imminent
 * （MT7915／MT7603 的參數版在 timer 為 0 時自己清掉該位元、不設斷線倒數；原始版只有我們設了 0x04 才會倒數）。
 * 這裡也不送任何 Deauth／Disassoc。
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/socket.h>
#include <sys/ioctl.h>
#ifdef TWR_TEST
#include <net/if.h>
#include <linux/wireless.h>
#else
#include <iwlib.h>
#endif
#include <linux/netlink.h>

#include "rc.h"
#include "tw_roam.h"

#if !defined (TWR_TEST) && defined (BOARD_MT7915_DBDC)
#define TWR_DRV_MT7915
#elif !defined (TWR_TEST) && defined (BOARD_NEWIFI3)
#define TWR_DRV_D3
#endif

/* rtnetlink 的幾個常數與結構（ABI 固定；自己定義，避免 <linux/rtnetlink.h> 跟 iwlib 的標頭打架） */
#define TWR_RTMGRP_LINK		1
#define TWR_RTM_NEWLINK		16
#define TWR_IFLA_WIRELESS	11
struct twr_ifinfomsg {
	unsigned char	ifi_family;
	unsigned char	pad;
	unsigned short	ifi_type;
	int		ifi_index;
	unsigned int	ifi_flags;
	unsigned int	ifi_change;
};
struct twr_rtattr {
	unsigned short	rta_len;
	unsigned short	rta_type;
};
#define TWR_ALIGN4(x)		(((x) + 3) & ~3)
#define TWR_UNUSED		__attribute__((unused))

/* 驅動共用的 ioctl 與 OID */
#define MT_RT_PRIV_IOCTL	(SIOCIWFIRSTPRIV + 0x01)
#define MT_RTPRIV_IOCTL_SET	(SIOCIWFIRSTPRIV + 0x02)	/* iwpriv set 字串 */
#define MT_GET_MAC_TABLE	(SIOCIWFIRSTPRIV + 0x1F)
#define MT_OID_RRM_SET		0x894C	/* OID_802_11_RRM_COMMAND | 0x8000 */
#define MT_OID_WNM_SET		0x894A	/* OID_802_11_WNM_COMMAND | 0x8000 */
#define MT_OID_RRM_CAP		0x494C	/* RT_QUERY_RRM_CAPABILITY（MT7603） */
#define MT_OID_WNM_CAP		0x494A	/* RT_QUERY_WNM_CAPABILITY（MT7603） */
#define MT_OID_KVR_QUERY	0x5102	/* RT_QUERY_KVR_CAPABILITY（MT7915） */
#define MT_OID_BTM_REQ_7612	0x8928	/* OID_802_11_WNM_BTM_REQ | 0x8000（padavan-tw 加的不需 Hotspot 版） */
#define MT_EV_RRM		0x094D
#define MT_EV_WNM		0x094B
#define MT_EV_BCN_7612		0x0950	/* TW_BCN_REPORT_EVENT（padavan-tw 補的 MT7612 事件） */
#define MT_RRM_SET_BCN_REQ	5
#define MT_RRM_SET_NR_RSP	7
#define MT_RRM_NR_BY_DAEMON	8
#define MT_RRM_QUERY_CAP	4
#define MT_WNM_SEND_BTM_IE	5
#define MT_WNM_SET_BTM_REQ	6
#define MT_WNM_QUERY_CAP	4
#define MT_BCN_REQ_LEN		141	/* sizeof(bcn_req_info)，驅動要求剛好相等 */
#define MT_BTM_REQ_LEN		67	/* sizeof(btm_reqinfo_t)，不含候選 */
#define MT_BTM_IE_HDR		19	/* sizeof(btm_req_ie_data_t) */
#define MT_NR_INFO_LEN		18	/* sizeof(struct nr_info) */
#define MT_MAX_CAND		5

static int g_nl = -1;
static int g_ifidx[2];			/* [0]＝2.4G、[1]＝5G 的 ifindex（判斷事件是哪個頻段） */
static const char *g_ifname[2];
static unsigned char g_mybssid[2][6];

/* MT7603／MT7915：由程式回答鄰居詢問時用的清單 */
static int g_nr_daemon;
static struct twr_nbr g_nr_list[2][MT_MAX_CAND];	/* [0]＝2.4G、[1]＝5G */
static int g_nr_n[2];

/* ---------- 小工具 ---------- */

static TWR_UNUSED void put16(unsigned char *p, unsigned int v) { p[0] = v; p[1] = v >> 8; }	/* 小端（mipsel） */
static TWR_UNUSED void put32(unsigned char *p, unsigned int v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; }
static TWR_UNUSED unsigned int get32(const unsigned char *p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((unsigned int)p[3] << 24); }

static int
read_sys(const char *ifname, const char *what, char *s, int len)
{
	char path[64];
	FILE *fp;
	snprintf(path, sizeof(path), "/sys/class/net/%s/%s", ifname, what);
	fp = fopen(path, "r");
	if (!fp)
		return -1;
	if (!fgets(s, len, fp))
		s[0] = 0;
	fclose(fp);
	return 0;
}

static int
read_ifindex(const char *ifname)
{
	char s[16];
	if (!ifname || read_sys(ifname, "ifindex", s, sizeof(s)) < 0)
		return 0;
	return atoi(s);
}

static TWR_UNUSED int
read_mac(const char *ifname, unsigned char *mac)
{
	char s[32];
	unsigned int b[6];
	int i;
	if (!ifname || read_sys(ifname, "address", s, sizeof(s)) < 0)
		return -1;
	if (sscanf(s, "%x:%x:%x:%x:%x:%x", &b[0], &b[1], &b[2], &b[3], &b[4], &b[5]) != 6)
		return -1;
	for (i = 0; i < 6; i++)
		mac[i] = (unsigned char)b[i];
	return 0;
}

static TWR_UNUSED int
band_of_ifindex(int idx)
{
	if (idx && idx == g_ifidx[0])
		return 2;
	if (idx && idx == g_ifidx[1])
		return 5;
	return 0;
}

static TWR_UNUSED const char *
ifname_of(int band)
{
	return g_ifname[band == 5 ? 1 : 0];
}

static TWR_UNUSED int
is_mine(const unsigned char *bssid)
{
	return memcmp(bssid, g_mybssid[0], 6) == 0 || memcmp(bssid, g_mybssid[1], 6) == 0;
}

/* 私有 ioctl：flags 放 OID，pointer／length 放資料；驅動有時回傳正數的錯誤碼，非 0 都算失敗 */
static TWR_UNUSED int
priv_ioctl(const char *ifname, int cmd, unsigned int oid, void *buf, int len)
{
	struct iwreq wrq;
	int s, ret;

	if (!ifname)
		return -1;
	s = socket(AF_INET, SOCK_DGRAM, 0);
	if (s < 0)
		return -1;
	memset(&wrq, 0, sizeof(wrq));
	strncpy(wrq.ifr_name, ifname, IFNAMSIZ - 1);
	wrq.u.data.pointer = buf;
	wrq.u.data.length = len;
	wrq.u.data.flags = oid;
	ret = ioctl(s, cmd, &wrq);
	close(s);
	return ret ? -1 : 0;
}

/* 全球 Operating Class（20 MHz）：Beacon Request、鄰居清單都要填 */
static TWR_UNUSED int
op_class(int band, int ch)
{
	if (band == 2)
		return 81;
	if (ch >= 36 && ch <= 48)
		return 115;
	if (ch >= 52 && ch <= 64)
		return 118;
	if (ch >= 100 && ch <= 144)
		return 121;
	if (ch >= 149 && ch <= 161)
		return 124;
	return 125;	/* 165～177 */
}

/* Beacon Report 的 RCPI（0～220，每 0.5 dB）→ dBm；量不到回傳 0 */
static TWR_UNUSED int
rcpi_dbm(int rcpi)
{
	if (rcpi > 220)
		return 0;
	return rcpi / 2 - 110;
}

/* BTM Request 本體（Category／Action／Dialog Token 之後）：給「原始」版 ioctl（MT7603、MT7612）
 * Request Mode＝候選清單＋Abridged（0x03，不含 0x04 Disassociation Imminent）、Disassociation Timer 0、
 * Validity 200 TBTT，每個候選一個 Neighbor Report 元素（ID 52）＋偏好值子元素（ID 3）放在元素裡面。 */
static TWR_UNUSED int
btm_body(unsigned char *p, int max, const struct twr_nbr *c, int n)
{
	int i, len = 4;

	if (max < 4)
		return -1;
	p[0] = 0x03;
	put16(p + 1, 0);
	p[3] = 200;
	for (i = 0; i < n && len + 18 <= max; i++) {
		unsigned int info = 0x3;		/* AP 可達 */
		unsigned char *e = p + len;
		info |= 1 << 2;				/* 加密方式相同 */
		if (is_mine(c[i].bssid))
			info |= 1 << 3;			/* 同一台（Key Scope） */
		info |= (1 << 5) | (1 << 7) | (1 << 9);	/* QoS、RRM、Immediate BA */
		if (c[i].ft)
			info |= 1 << 10;		/* Mobility Domain：同一個，可以用 802.11r 快速漫遊 */
		info |= 1 << 11;			/* HT */
		if (c[i].band == 5)
			info |= 1 << 12;		/* VHT */
		e[0] = 52;
		e[1] = 16;
		memcpy(e + 2, c[i].bssid, 6);
		put32(e + 8, info);
		e[12] = op_class(c[i].band, c[i].ch);
		e[13] = c[i].ch;
		e[14] = c[i].band == 5 ? 9 : 7;		/* PHY：VHT／HT */
		e[15] = 3;				/* 子元素：BSS Transition Candidate Preference */
		e[16] = 1;
		e[17] = c[i].pref ? c[i].pref : 255;
		len += 18;
	}
	return len;
}

/* struct nr_info（18 位元組，packed）：MT7915／MT7603 的參數版用。
 * phytype、regclass、capinfo、is_ht、is_vht、mobility 六個欄位驅動要全部非 0，不然改去掃描表找、
 * 找不到就丟掉候選（compose_btm_req_ie／compose_rrm_nrrsp_ie）。1 位元的欄位填 2＝存成 0（不宣告但通過檢查）。 */
static TWR_UNUSED void
nr_info(unsigned char *p, const struct twr_nbr *c)
{
	memset(p, 0, MT_NR_INFO_LEN);
	p[0] = c->ch;					/* channum */
	p[1] = c->band == 5 ? 9 : 7;			/* phytype：VHT／HT */
	p[2] = op_class(c->band, c->ch);		/* regclass */
	put16(p + 3, 0x0001);				/* capinfo：只有 ESS 位元（不宣告其他能力） */
	memcpy(p + 5, c->bssid, 6);			/* bssid */
	p[11] = c->pref;				/* preference */
	p[12] = 1;					/* is_ht */
	p[13] = c->band == 5 ? 1 : 2;			/* is_vht（2.4G 填 2＝0） */
	p[14] = 3;					/* ap_reachability：可達 */
	p[15] = 1;					/* security：加密方式相同 */
	p[16] = is_mine(c->bssid) ? 1 : 2;		/* key_scope：同一台才是 1 */
	p[17] = c->ft ? 1 : 2;				/* mobility：有開 11r＝1（同一個 Mobility Domain），沒開填 2＝0 */
}

/* 開 rtnetlink（收驅動的 IWEVCUSTOM 事件） */
static TWR_UNUSED void
open_netlink(void)
{
	struct sockaddr_nl sa;

	g_nl = socket(AF_NETLINK, SOCK_RAW, NETLINK_ROUTE);
	if (g_nl < 0)
		return;
	memset(&sa, 0, sizeof(sa));
	sa.nl_family = AF_NETLINK;
	sa.nl_groups = TWR_RTMGRP_LINK;
	if (bind(g_nl, (struct sockaddr *)&sa, sizeof(sa)) < 0) {
		close(g_nl);
		g_nl = -1;
	}
}

typedef int (*custom_cb)(int band, unsigned int flags, const unsigned char *data, int len, struct twr_drv_ev *ev);

/* 讀一批 rtnetlink 訊息，把 IFLA_WIRELESS 裡的 IWEVCUSTOM 交給 cb 解析 */
static TWR_UNUSED int
read_netlink(custom_cb cb, struct twr_drv_ev *ev, int max)
{
	static unsigned char buf[8192];
	int n, cnt = 0;
	struct nlmsghdr *nh;

	if (g_nl < 0)
		return 0;
	n = recv(g_nl, buf, sizeof(buf), MSG_DONTWAIT);
	if (n <= 0)
		return 0;
	for (nh = (struct nlmsghdr *)buf; NLMSG_OK(nh, (unsigned int)n) && cnt < max; nh = NLMSG_NEXT(nh, n)) {
		struct twr_ifinfomsg *ifi;
		unsigned char *a, *end;
		int band;

		if (nh->nlmsg_type != TWR_RTM_NEWLINK || nh->nlmsg_len < NLMSG_LENGTH(sizeof(*ifi)))
			continue;
		ifi = (struct twr_ifinfomsg *)NLMSG_DATA(nh);
		band = band_of_ifindex(ifi->ifi_index);
		a = (unsigned char *)ifi + TWR_ALIGN4(sizeof(*ifi));
		end = (unsigned char *)nh + nh->nlmsg_len;
		while (a + sizeof(struct twr_rtattr) <= end && cnt < max) {
			struct twr_rtattr *ra = (struct twr_rtattr *)a;
			if (ra->rta_len < sizeof(*ra) || a + ra->rta_len > end)
				break;
			if (ra->rta_type == TWR_IFLA_WIRELESS) {
				/* iw_event（網路上省略指標）：len(2) cmd(2) length(2) flags(2) data */
				unsigned char *e = a + sizeof(*ra), *eend = a + ra->rta_len;
				while (e + 8 <= eend && cnt < max) {
					unsigned int elen = e[0] | (e[1] << 8), cmd = e[2] | (e[3] << 8);
					unsigned int dlen = e[4] | (e[5] << 8), flags = e[6] | (e[7] << 8);
					if (elen < 8 || e + elen > eend)
						break;
					if (cmd == IWEVCUSTOM && 8 + dlen <= elen) {
						memset(&ev[cnt], 0, sizeof(ev[0]));
						if (cb(band, flags, e + 8, dlen, &ev[cnt]))
							cnt++;
					}
					e += elen;
				}
			}
			a += TWR_ALIGN4(ra->rta_len);
		}
	}
	return cnt;
}

#if defined (TWR_DRV_MT7915) || defined (TWR_DRV_D3)
/* ======================================================================
 * MT7915、MT7603 共用：OID 0x894C 送 Beacon Request，事件 0x094D／0x094B
 * ====================================================================== */

static int
oid_bcn_req(int band, const unsigned char *sta, int ch, const unsigned char *bssid)
{
	unsigned char b[5 + MT_BCN_REQ_LEN], *p = b + 5;
	const char *ssid = nvram_wlan_get(band == 5, "ssid");
	int sl = strlen(ssid);

	memset(b, 0, sizeof(b));
	b[0] = MT_RRM_SET_BCN_REQ;
	put32(b + 1, MT_BCN_REQ_LEN);
	memcpy(p, sta, 6);				/* peer_address */
	put16(p + 6, 0);				/* num_rpt */
	p[8] = op_class(ch > 14 ? 5 : 2, ch);		/* regclass（一定要自己填：HT40 時驅動會選錯） */
	p[9] = ch;					/* channum */
	put16(p + 10, 0);				/* random_ivl */
	put16(p + 12, 50);				/* duration（TU） */
	if (bssid)
		memcpy(p + 14, bssid, 6);		/* bssid（全 0＝驅動改成廣播） */
	p[20] = 0;					/* mode：0＝自動（裝置能主動就主動） */
	if (sl > 32)
		sl = 32;
	p[21] = sl;					/* req_ssid_len：只量同 SSID */
	memcpy(p + 22, ssid, sl);			/* req_ssid[33] */
	put32(p + 55, 5);				/* timeout（秒）：一定要填，0 會變成十幾小時、佔住量測表 */
	p[59] = 0;					/* rep_conditon */
	p[60] = 0;					/* ref_value */
	p[61] = 1;					/* detail：1＝送出 detail 0（只要固定欄位） */
	/* op_class_len、ch_list_len、request_len＝0 */
	return priv_ioctl(ifname_of(band), MT_RT_PRIV_IOCTL, MT_OID_RRM_SET, b, sizeof(b));
}

/* MT7603／MT7915：程式回答裝置的鄰居詢問（RRM 子命令 7，dialog token 要對上） */
static void
oid_nr_answer(int band, const unsigned char *sta, int token)
{
	unsigned char b[5 + 8 + MT_MAX_CAND * MT_NR_INFO_LEN], *p = b + 5;
	int i, n = 0, len;

	int bi = band == 5 ? 1 : 0;

	for (i = 0; i < g_nr_n[bi]; i++)
		if (g_nr_list[bi][i].ch)
			nr_info(p + 8 + (n++) * MT_NR_INFO_LEN, &g_nr_list[bi][i]);
	len = 8 + n * MT_NR_INFO_LEN;
	b[0] = MT_RRM_SET_NR_RSP;
	put32(b + 1, len);
	memcpy(p, sta, 6);
	p[6] = token;
	p[7] = n;
	priv_ioctl(ifname_of(band), MT_RT_PRIV_IOCTL, MT_OID_RRM_SET, b, 5 + len);
}

/* 鄰居詢問交給程式（1）或驅動（0）回答：RRM 子命令 8。這個旗標在驅動是整張卡共用的
 * （MT7915 DBDC 兩個頻段一起；MT7603 只有 2.4G） */
static int
oid_nr_daemon(int on)
{
	unsigned char b[6];
	b[0] = MT_RRM_NR_BY_DAEMON;
	put32(b + 1, 1);
	b[5] = on ? 1 : 0;
	return priv_ioctl(ifname_of(2), MT_RT_PRIV_IOCTL, MT_OID_RRM_SET, b, sizeof(b));
}

/* 事件：0x094D＝rrm_event_t(5)＋bcn_rsp_data(15)／nr_req_data(14)＋內容；0x094B＝wnm_event(2)＋btm_rsp_data(14)＋回覆 */
static int
oid_custom(int band, unsigned int flags, const unsigned char *d, int len, struct twr_drv_ev *ev)
{
	if (flags == MT_EV_RRM && len >= 5 + 15 && d[0] == 1) {
		const unsigned char *body = d + 5, *r;
		unsigned int rlen = get32(body + 11);
		int dbm, b;
		if (rlen != 26 || len < 5 + 15 + 26)
			return 0;	/* 3＝裝置拒絕或沒東西報、0＝逾時 */
		r = body + 15;
		if (r[13] == 255)
			return 0;	/* 255＝量不到 */
		dbm = rcpi_dbm(r[13]);
		ev->type = TWR_EV_BCN_REPORT;
		b = band_of_ifindex(get32(body + 1));
		ev->band = b ? b : band;
		memcpy(ev->sta, body + 5, 6);
		memcpy(ev->bssid, r + 15, 6);
		ev->ch = r[1];
		ev->dbm = dbm;
		ev->rcpi = r[13];
		return 1;
	}
	if (flags == MT_EV_RRM && len >= 5 + 14 + 1 && d[0] == 2) {
		/* 鄰居詢問（交給程式回答時才有）：nr_req[0]＝dialog token */
		const unsigned char *body = d + 5;
		int b = band_of_ifindex(get32(body));
		if (g_nr_daemon && get32(body + 10) >= 1)
			oid_nr_answer(b ? b : band, body + 4, body[14]);
		return 0;
	}
	if (flags == MT_EV_WNM && len >= 2 + 14 && d[0] == 2) {
		const unsigned char *body = d + 2, *r = body + 14;
		unsigned int rlen = get32(body + 10);
		int b;
		if (rlen < 2 || len < 2 + 14 + 2)
			return 0;	/* 1＝等不到回覆 */
		ev->type = TWR_EV_BTM_RESP;
		b = band_of_ifindex(get32(body));
		ev->band = b ? b : band;
		memcpy(ev->sta, body + 4, 6);
		ev->status = r[1];
		if (ev->status == 0 && rlen >= 9 && len >= 2 + 14 + 9)
			memcpy(ev->bssid, r + 3, 6);
		return 1;
	}
	return 0;
}
#endif

#ifdef TWR_DRV_MT7915
/* ======================================================================
 * CR6608：MT7915（mt7915 7.3.0.1）
 * ====================================================================== */

/* BTM：參數版（子命令 6）。disassoc_timer 0 時驅動自己清掉 Disassociation Imminent、不設斷線倒數 */
static int
mt7915_btm(int band, const unsigned char *sta, const struct twr_nbr *cand, int n, int token)
{
	unsigned char b[2 + MT_BTM_REQ_LEN + MT_MAX_CAND * MT_NR_INFO_LEN], *p = b + 2;
	int i, len;

	if (n > MT_MAX_CAND)
		n = MT_MAX_CAND;
	len = MT_BTM_REQ_LEN + n * MT_NR_INFO_LEN;
	memset(b, 0, sizeof(b));
	b[0] = MT_WNM_SET_BTM_REQ;
	b[1] = len;
	memcpy(p, sta, 6);				/* sta_mac */
	p[6] = token;					/* dialogtoken */
	p[7] = 0x03;					/* reqmode：候選清單＋Abridged（驅動依欄位重算） */
	put16(p + 8, 0);				/* disassoc_timer：0＝不斷線（不能改） */
	p[10] = 200;					/* valint（TBTT，約 20 秒；0 是保留值） */
	put32(p + 11, 10);				/* timeout（秒）：等 BTM Response */
	/* TSF(8)＝0、duration(2)＝0、url_len＝0、url[40] */
	p[66] = n;					/* num_candidates */
	for (i = 0; i < n; i++)
		nr_info(p + MT_BTM_REQ_LEN + i * MT_NR_INFO_LEN, &cand[i]);
	return priv_ioctl(ifname_of(band), MT_RT_PRIV_IOCTL, MT_OID_WNM_SET, b, 2 + len);
}

static void
mt7915_caps(int band, const unsigned char *sta, int *k, int *v)
{
	unsigned char b[7];
	memcpy(b, sta, 6);
	b[6] = 0;
	if (priv_ioctl(ifname_of(band), MT_RT_PRIV_IOCTL, MT_OID_KVR_QUERY, b, sizeof(b)) < 0)
		return;
	*k = (b[6] & 0x01) ? 1 : 0;
	*v = (b[6] & 0x02) ? 1 : 0;
}
#endif /* TWR_DRV_MT7915 */

#ifdef TWR_DRV_D3
/* ======================================================================
 * Newifi D3：MT7603E（ra0，2.4G）＋ MT7612E（rai0，5G）
 * ====================================================================== */

/* MT7603 BTM：原始版（子命令 5），本體自己組。參數版會把偏好值子元素放在鄰居元素外面（格式錯誤），不用。
 * btm_req_ie_data_t：ifindex(4) peer(6) dialog_token(1) timeout(4) btm_req_len(4) btm_req[]；
 * 驅動用 command_len（u8）配置緩衝區，所以 19＋本體要 ≤ 255。 */
static int
mt7603_btm(const unsigned char *sta, const struct twr_nbr *cand, int n, int token)
{
	unsigned char b[2 + 255], *p = b + 2;
	int blen;

	if (n > MT_MAX_CAND)
		n = MT_MAX_CAND;
	memset(b, 0, sizeof(b));
	blen = btm_body(p + MT_BTM_IE_HDR, 255 - MT_BTM_IE_HDR, cand, n);
	if (blen < 0)
		return -1;
	b[0] = MT_WNM_SEND_BTM_IE;
	b[1] = MT_BTM_IE_HDR + blen;
	put32(p, g_ifidx[0]);				/* ifindex */
	memcpy(p + 4, sta, 6);				/* peer_mac_addr */
	p[10] = token;					/* dialog_token */
	put32(p + 11, 10);				/* timeout（秒） */
	put32(p + 15, blen);				/* btm_req_len */
	return priv_ioctl(ifname_of(2), MT_RT_PRIV_IOCTL, MT_OID_WNM_SET, b, 2 + MT_BTM_IE_HDR + blen);
}

static void
mt7603_caps(const unsigned char *sta, int *k, int *v)
{
	unsigned char w[9], r[19];

	/* 11v：wnm_command(2)＋MAC＋1 位元組，回傳 body[6]＝1 表示支援 BSS Transition */
	memset(w, 0, sizeof(w));
	w[0] = MT_WNM_QUERY_CAP;
	w[1] = 7;
	memcpy(w + 2, sta, 6);
	if (priv_ioctl(ifname_of(2), MT_RT_PRIV_IOCTL, MT_OID_WNM_CAP, w, sizeof(w)) == 0)
		*v = w[8] == 1 ? 1 : 0;
	/* 11k：rrm_command(5)＋MAC＋RrmEnCap(8)，第 0 位元組 bit4／bit5＝Beacon 被動／主動量測 */
	memset(r, 0, sizeof(r));
	r[0] = MT_RRM_QUERY_CAP;
	put32(r + 1, 14);
	memcpy(r + 5, sta, 6);
	if (priv_ioctl(ifname_of(2), MT_RT_PRIV_IOCTL, MT_OID_RRM_CAP, r, sizeof(r)) == 0)
		*k = (r[11] & 0x30) ? 1 : 0;
}


/* MT7612 的 BcnReq 第一個欄位是 WCID（MAC table 的 Aid，十六進位） */
static int
mt7612_aid(const unsigned char *sta)
{
	static unsigned char buf[4096];
	struct iwreq wrq;
	unsigned long num, i;
	int s, aid = -1;

	s = socket(AF_INET, SOCK_DGRAM, 0);
	if (s < 0)
		return -1;
	memset(buf, 0, sizeof(buf));
	memset(&wrq, 0, sizeof(wrq));
	strncpy(wrq.ifr_name, ifname_of(5), IFNAMSIZ - 1);
	wrq.u.data.pointer = buf;
	wrq.u.data.length = sizeof(buf);
	if (ioctl(s, MT_GET_MAC_TABLE, &wrq) == 0) {
		memcpy(&num, buf, sizeof(num));
		if (num > (sizeof(buf) - sizeof(unsigned long)) / 28)
			num = (sizeof(buf) - sizeof(unsigned long)) / 28;
		for (i = 0; i < num; i++) {
			const unsigned char *e = buf + sizeof(unsigned long) + i * 28;
			if (memcmp(e + 1, sta, 6) == 0) {
				aid = e[7];
				break;
			}
		}
	}
	close(s);
	return aid;
}

/* MT7612 Beacon Request：iwpriv set 字串
 * BcnReq=<WCID 十六進位>-<量測時間 TU>-<Operating Class>-<BSSID>-<SSID>-<頻道>-<模式>-<頻道報告的 Class>
 * 欄位用「-」分隔，SSID 有「-」就不帶（量所有 SSID）；給滿 8 個欄位，避開解析器沒有 break 的地方 */
static int
mt7612_bcn_req(const unsigned char *sta, int ch, const unsigned char *bssid)
{
	char cmd[160], ssid[40];
	const char *s = nvram_wlan_get(1, "ssid");
	/* 要量的頻道可能是 2.4G（從 5G 問「回 2.4G 好不好」）：Class 要依頻道算。2026-11-22 以前一律用 5G 的算法，
	 * 量 2.4G 頻道 2 時送出「Class 125＋頻道 2」這種不存在的組合，手機、電腦都不回（ROAM-COOP「從 D3 的 5G 問，手機都沒回」） */
	int aid = mt7612_aid(sta), oc = op_class(ch > 14 ? 5 : 2, ch);
	unsigned char bc[6] = { 0xff, 0xff, 0xff, 0xff, 0xff, 0xff };
	const unsigned char *b = bssid ? bssid : bc;

	if (aid < 0)
		return -1;
	snprintf(ssid, sizeof(ssid), "%s", (strchr(s, '-') || strchr(s, ',') || strlen(s) > 32) ? "" : s);
	snprintf(cmd, sizeof(cmd), "BcnReq=%x-50-%d-%02x:%02x:%02x:%02x:%02x:%02x-%s-%d-1-%d",
		 aid, oc, b[0], b[1], b[2], b[3], b[4], b[5], ssid, ch, oc);
	return priv_ioctl(ifname_of(5), MT_RTPRIV_IOCTL_SET, 0, cmd, strlen(cmd) + 1);
}

/* MT7612 BTM：OID 0x8928，struct btm_req_data（沒有 packed）：ifindex@0、peer_mac@4、btm_req_len@12、本體@16 */
static int
mt7612_btm(const unsigned char *sta, const struct twr_nbr *cand, int n)
{
	unsigned char b[16 + 4 + MT_MAX_CAND * 18];
	int blen;

	if (n > MT_MAX_CAND)
		n = MT_MAX_CAND;
	memset(b, 0, sizeof(b));
	blen = btm_body(b + 16, sizeof(b) - 16, cand, n);
	if (blen < 0)
		return -1;
	put32(b, g_ifidx[1]);
	memcpy(b + 4, sta, 6);
	put32(b + 12, blen);
	return priv_ioctl(ifname_of(5), MT_RT_PRIV_IOCTL, MT_OID_BTM_REQ_7612, b, 16 + blen);
}

/* 事件：MT7603 走共用格式；MT7612 是 padavan-tw 補的 0x0950：裝置 MAC 6、BSSID 6、Class、頻道、RCPI、RSNI */
static int
d3_custom(int band, unsigned int flags, const unsigned char *d, int len, struct twr_drv_ev *ev)
{
	if (flags == MT_EV_BCN_7612 && len >= 16) {
		int dbm = rcpi_dbm(d[14]);
		if (d[14] == 255)
			return 0;
		ev->type = TWR_EV_BCN_REPORT;
		ev->band = band ? band : 5;
		memcpy(ev->sta, d, 6);
		memcpy(ev->bssid, d + 6, 6);
		ev->ch = d[13];
		ev->dbm = dbm;
		ev->rcpi = d[14];
		return 1;
	}
	return oid_custom(band, flags, d, len, ev);
}
#endif /* TWR_DRV_D3 */

/* ======================================================================
 * 對外的函式（tw_roam.h）
 * ====================================================================== */

int
twr_drv_init(struct twr_drv_caps *caps)
{
	memset(caps, 0, sizeof(*caps));
	caps->name = "沒有支援（只能觀察）";
	g_ifname[0] = IFNAME_2G_MAIN;
#if BOARD_HAS_5G_RADIO
	g_ifname[1] = IFNAME_5G_MAIN;
#endif
	g_ifidx[0] = read_ifindex(g_ifname[0]);
	g_ifidx[1] = read_ifindex(g_ifname[1]);
	read_mac(g_ifname[0], g_mybssid[0]);
	read_mac(g_ifname[1], g_mybssid[1]);
#if defined (TWR_DRV_MT7915)
	caps->name = "MT7915";
	caps->bcn_req[0] = caps->bcn_req[1] = 1;
	caps->bcn_rep[0] = caps->bcn_rep[1] = 1;
	caps->btm[0] = caps->btm[1] = 1;
	caps->nbr[0] = caps->nbr[1] = 1;
	caps->sta_caps = 1;
	open_netlink();
#elif defined (TWR_DRV_D3)
	caps->name = "MT7603E＋MT7612E";
	caps->bcn_req[0] = caps->bcn_req[1] = 1;
	caps->bcn_rep[0] = caps->bcn_rep[1] = 1;
	caps->btm[0] = caps->btm[1] = 1;
	caps->nbr[0] = 1;
	caps->sta_caps = 1;	/* 只有 2.4G；5G 從回報推斷 */
	open_netlink();
#endif
#if defined (TWR_DRV_MT7915) || defined (TWR_DRV_D3)
	/* 上次 tw-roamd 沒有正常結束時，驅動可能還在等程式回答鄰居詢問：先交回驅動，建議模式需要時再接手 */
	oid_nr_daemon(0);
#endif
	if (g_nl < 0) {
		/* 收不到事件就不能「問」，只留備案規則（回 5G 用 AP 聽到的訊號） */
		caps->bcn_rep[0] = caps->bcn_rep[1] = 0;
	}
	return 0;
}

void
twr_drv_close(void)
{
#if defined (TWR_DRV_MT7915) || defined (TWR_DRV_D3)
	if (g_nr_daemon)
		oid_nr_daemon(0);	/* 交回給驅動自己回答 */
#endif
	g_nr_daemon = 0;
	if (g_nl >= 0)
		close(g_nl);
	g_nl = -1;
}

int
twr_drv_bcn_req(int band, const unsigned char *sta, int ch, const unsigned char *bssid, int token)
{
	(void)token;	/* 三顆驅動都自己選 token；回報用裝置 MAC 對應 */
#if defined (TWR_DRV_MT7915)
	return oid_bcn_req(band, sta, ch, bssid);
#elif defined (TWR_DRV_D3)
	return band == 5 ? mt7612_bcn_req(sta, ch, bssid) : oid_bcn_req(2, sta, ch, bssid);
#else
	(void)band; (void)sta; (void)ch; (void)bssid;
	return -1;
#endif
}

int
twr_drv_btm_req(int band, const unsigned char *sta, const struct twr_nbr *cand, int n, int token)
{
#if defined (TWR_DRV_MT7915)
	return mt7915_btm(band, sta, cand, n, token);
#elif defined (TWR_DRV_D3)
	return band == 5 ? mt7612_btm(sta, cand, n) : mt7603_btm(sta, cand, n, token);
#else
	(void)band; (void)sta; (void)cand; (void)n; (void)token;
	return -1;
#endif
}

int
twr_drv_set_nbr(int band, const struct twr_nbr *list, int n)
{
#if defined (TWR_DRV_MT7915) || defined (TWR_DRV_D3)
	int bi = band == 5 ? 1 : 0;
#if defined (TWR_DRV_D3)
	if (band != 2)
		return -1;	/* MT7612 沒有交給程式回答的功能，用掃描表 */
#endif
	if (n > MT_MAX_CAND)
		n = MT_MAX_CAND;
	memcpy(g_nr_list[bi], list, n * sizeof(list[0]));
	g_nr_n[bi] = n;
	if (!g_nr_daemon && g_nl >= 0 && oid_nr_daemon(1) == 0)
		g_nr_daemon = 1;
	return g_nr_daemon ? 0 : -1;
#else
	(void)band; (void)list; (void)n;
	return -1;
#endif
}

void
twr_drv_sta_caps(int band, const unsigned char *sta, int *k, int *v)
{
#if defined (TWR_DRV_MT7915)
	mt7915_caps(band, sta, k, v);
#elif defined (TWR_DRV_D3)
	if (band == 2)
		mt7603_caps(sta, k, v);
#else
	(void)band; (void)sta; (void)k; (void)v;
#endif
}

int
twr_drv_event_fd(void)
{
	return g_nl;
}

int
twr_drv_read(struct twr_drv_ev *ev, int max)
{
#if defined (TWR_DRV_MT7915)
	return read_netlink(oid_custom, ev, max);
#elif defined (TWR_DRV_D3)
	return read_netlink(d3_custom, ev, max);
#else
	(void)ev; (void)max;
	return 0;
#endif
}
