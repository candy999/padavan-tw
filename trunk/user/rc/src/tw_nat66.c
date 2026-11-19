/*
 * padavan-tw：沒有委派前綴時自動 NAT66（nvram ip6_nat66_auto，預設開）
 *
 * 二級路由器常見的情況：WAN 從上一層拿得到全球 IPv6（SLAAC），但上一層只有一段 /64、沒有前綴可以再分
 * （例如 HiNet 只給主路由 /64），DHCPv6-PD 要不到前綴，區網就沒有 IPv6。
 * 這時在 br0 加一段 ULA（fdXX:XXXX:XXXX::/64，由 br0 的 MAC 算出，每台固定），
 * dnsmasq（constructor:br0）會自動用 RA 廣播；再用 ip6tables MASQUERADE 經 WAN 的位址出去。
 *
 * 由 watchdog 每輪（約 10 秒）呼叫 tw_nat66_check()：
 * - 啟用條件：路由器模式、IPv6 是原生 DHCPv6、LAN 前綴設自動、WAN 有全球 IPv6 位址、
 *   br0 連續 6 輪（約 60 秒）沒有全球前綴
 * - 解除條件：開關關掉、拿到真正的前綴、WAN 沒有全球 IPv6、模式改變
 * - 啟用期間每 6 輪確認位址與規則還在（防火牆重啟會清掉 nat 表）
 * 狀態寫在暫存 nvram ip6_nat66_state（空白＝沒用；有值＝區網用的 ULA 前綴），給後台顯示
 *
 * 限制：手機、電腦依 RFC 6724，ULA 位址連外網時通常優先用 IPv4，NAT66 主要讓「只有 IPv6」的服務連得到
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <net/ethernet.h>
#include <net/if.h>

#include "rc.h"

#if defined (USE_IPV6)

#define NAT66_GRACE_TICKS	6
#define NAT66_REFRESH_TICKS	6

static int nat66_on = 0;
static int nat66_noprefix = 0;
static int nat66_refresh = 0;
static char nat66_ula[48];	/* "fdxx:xxxx:xxxx::" */
static char nat66_wan[IFNAMSIZ + 1];

/* 介面上有沒有全球位址：want_ula＝0 只算非 ULA 的全球位址；1 只算 ULA */
static int
if_has_global6(const char *ifname, int want_ula)
{
	FILE *fp = fopen("/proc/net/if_inet6", "r");
	char addr[40], dev[IFNAMSIZ + 1];
	unsigned int idx, plen, scope, flags;
	int found = 0;

	if (!fp)
		return 0;
	while (fscanf(fp, "%32s %x %x %x %x %16s", addr, &idx, &plen, &scope, &flags, dev) == 6) {
		int is_ula;

		if (strcmp(dev, ifname) != 0 || scope != 0)	/* 0＝global */
			continue;
		is_ula = (addr[0] == 'f' && (addr[1] == 'c' || addr[1] == 'd'));
		if (is_ula == want_ula) {
			found = 1;
			break;
		}
	}
	fclose(fp);
	return found;
}

static int
nat66_wanted(char *wan_if, size_t wan_len)
{
	char *ifn;

	if (nvram_match("ip6_nat66_auto", "0"))
		return 0;
	if (get_ap_mode())
		return 0;
	if (get_ipv6_type() != IPV6_NATIVE_DHCP6)
		return 0;
	if (!nvram_match("ip6_lan_auto", "1"))
		return 0;

	ifn = get_wan_unit_value(0, "ifname6");
	if (!ifn || !*ifn || !is_interface_exist(ifn))
		return 0;
	if (!if_has_global6(ifn, 0))
		return 0;
	snprintf(wan_if, wan_len, "%s", ifn);
	return 1;
}

static void
nat66_rule(const char *op)
{
	doSystem("ip6tables -t nat %s POSTROUTING -s %s/64 -o %s -j MASQUERADE 2>/dev/null",
		op, nat66_ula, nat66_wan);
}

static void
nat66_ensure(void)
{
	if (!if_has_global6(IFNAME_BR, 1))
		doSystem("ip -6 addr add %s1/64 dev %s 2>/dev/null", nat66_ula, IFNAME_BR);
	doSystem("ip6tables -t nat -C POSTROUTING -s %s/64 -o %s -j MASQUERADE 2>/dev/null || "
		 "ip6tables -t nat -A POSTROUTING -s %s/64 -o %s -j MASQUERADE",
		nat66_ula, nat66_wan, nat66_ula, nat66_wan);
}

static void
nat66_enable(const char *wan_if)
{
	unsigned char ea[ETHER_ADDR_LEN];
	char prefix[64];

	if (!ether_atoe(nvram_safe_get("lan_hwaddr"), ea))
		memset(ea, 0x5a, sizeof(ea));
	/* RFC 4193：fd＋40 位元的全域 ID，這裡用 MAC 後 5 個位元組，每台固定 */
	snprintf(nat66_ula, sizeof(nat66_ula), "fd%02x:%02x%02x:%02x%02x::",
		ea[1], ea[2], ea[3], ea[4], ea[5]);
	snprintf(nat66_wan, sizeof(nat66_wan), "%s", wan_if);

	module_smart_load("ip6table_nat", NULL);
	module_smart_load("ip6t_MASQUERADE", NULL);
	nat66_ensure();

	snprintf(prefix, sizeof(prefix), "%s/64", nat66_ula);
	nvram_set_temp("ip6_nat66_state", prefix);
	nat66_on = 1;
	nat66_refresh = 0;
	logmessage("IPv6", "上一層沒有給可分配的前綴，區網改用 NAT66（%s，經 %s 出去）", prefix, nat66_wan);
}

static void
nat66_disable(const char *why)
{
	nat66_rule("-D");
	doSystem("ip -6 addr del %s1/64 dev %s 2>/dev/null", nat66_ula, IFNAME_BR);
	nvram_set_temp("ip6_nat66_state", "");
	nat66_on = 0;
	logmessage("IPv6", "停止 NAT66（%s）", why);
}

void
tw_nat66_check(void)
{
	char wan_if[IFNAMSIZ + 1];
	int want = nat66_wanted(wan_if, sizeof(wan_if));

	if (nat66_on) {
		if (!want) {
			nat66_disable(nvram_match("ip6_nat66_auto", "0") ? "已關閉自動 NAT66" : "WAN 沒有 IPv6 或設定已變更");
			nat66_noprefix = 0;
			return;
		}
		if (if_has_global6(IFNAME_BR, 0)) {
			nat66_disable("已經拿到可分配的前綴");
			nat66_noprefix = 0;
			return;
		}
		if (strcmp(wan_if, nat66_wan) != 0) {
			/* WAN 介面換了（例如 PPPoE 重撥）：規則改到新介面 */
			nat66_rule("-D");
			snprintf(nat66_wan, sizeof(nat66_wan), "%s", wan_if);
			nat66_ensure();
			return;
		}
		if (++nat66_refresh >= NAT66_REFRESH_TICKS) {
			nat66_refresh = 0;
			nat66_ensure();
		}
		return;
	}

	if (!want || if_has_global6(IFNAME_BR, 0)) {
		nat66_noprefix = 0;
		return;
	}
	if (++nat66_noprefix < NAT66_GRACE_TICKS)
		return;
	nat66_enable(wan_if);
}

#else

void
tw_nat66_check(void)
{
}

#endif
