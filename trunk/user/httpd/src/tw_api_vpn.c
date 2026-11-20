/*
 * padavan-tw：新後台資料介面 /tw_api.asp?q=vpn（docs/HANDOFF-UI.md 第 6 節的 vpn）
 *
 * WireGuard 伺服器（外出連回家，wireguard.sh 建立的 wg1）的裝置清單與連線狀態：
 *   - 裝置清單一律來自 nvram 的 WGSPeerList（wgs_name_x／wgs_pub_x／wgs_ip_x），名稱與頁面上的完全一致
 *   - 最後握手時間、流量、來源位址用 `wg show wg1 dump` 讀核心的資料，依公鑰對應到 nvram 的裝置
 *
 * 輸出（單位寫在欄位名稱）：
 *   {"ok":true,"ts":…,"available":true,"warming_up":false,"enabled":true,"running":true,"listen_port":51820,
 *    "peers":[{"name":"我的手機","ip":"10.66.0.2","last_handshake_ts":…,"rx_bytes":…,"tx_bytes":…,"endpoint":"1.2.3.4"}]}
 *   - rx_bytes／tx_bytes 是路由器這一端收到／送出的位元組（裝置上傳＝rx、裝置下載＝tx），wg1 重新啟動會歸零
 *   - last_handshake_ts：0＝從來沒有連線；null＝不知道（伺服器沒有在執行，或這台裝置還沒載入 wg1）
 *   - endpoint：裝置最後一次的來源 IP（不含連接埠），沒有時是空字串
 *   - running：nvram 開著、但 wg1 不存在（啟動失敗）時是 false，頁面據此提示看系統記錄
 *   伺服器關閉：{"ok":true,"available":false,"reason":"disabled","enabled":false}
 *
 * `wg show dump` 的第一行含伺服器私鑰、裝置行含預先共用金鑰：只取需要的欄位，用完把緩衝區清掉，絕不輸出。
 * 注意 nvram_safe_get() 回傳的是共用的暫存區，下一次呼叫就會被蓋掉：要留著的值一律先複製。
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <errno.h>
#include <unistd.h>
#include <limits.h>
#include <time.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>

#include "httpd.h"

#ifndef IFNAME_TW_WGS
#define IFNAME_TW_WGS		"wg1"
#endif

#define TW_WGS_MAX_PEERS	32	/* variables.c 的 WGSPeerList 上限 */
#define TW_WG_BIN		"/usr/bin/wg"

#if defined(APP_WIREGUARD)

/* JSON 字串：跳脫引號、反斜線、控制字元；< > & 也轉成 \u00XX（tw_api.asp 以 HTML 送出，直接開網址也不會被當成標籤）。
 * 其他位元組（含 UTF-8 中文）原樣輸出 */
static void
tw_json_str(webs_t wp, const char *s)
{
	const unsigned char *p = (const unsigned char *)(s ? s : "");

	fputc('"', wp);
	for (; *p; p++) {
		switch (*p) {
		case '"':  fputs("\\\"", wp); break;
		case '\\': fputs("\\\\", wp); break;
		case '\n': fputs("\\n", wp); break;
		case '\r': fputs("\\r", wp); break;
		case '\t': fputs("\\t", wp); break;
		case '<': case '>': case '&':
			fprintf(wp, "\\u%04x", *p);
			break;
		default:
			if (*p < 0x20 || *p == 0x7f)
				fprintf(wp, "\\u%04x", *p);
			else
				fputc(*p, wp);
		}
	}
	fputc('"', wp);
}

struct tw_wg_live {
	char pub[64];
	char endpoint[64];
	long long hs;
	unsigned long long rx, tx;
};

static struct tw_wg_live tw_wg_peers[TW_WGS_MAX_PEERS + 8];

/* 只接受純數字（nvram 裡的連接埠、主機號碼） */
static int
tw_all_digits(const char *s)
{
	if (!s || !*s)
		return 0;
	for (; *s; s++)
		if (!isdigit((unsigned char)*s))
			return 0;
	return 1;
}

/* "1.2.3.4:51820" → "1.2.3.4"；"[2001:db8::1]:51820" → "2001:db8::1"；"(none)" → "" */
static void
tw_wg_endpoint_host(char *dst, size_t dlen, const char *ep)
{
	const char *b, *e;
	size_t n;

	dst[0] = 0;
	if (!ep || !*ep || ep[0] == '(')
		return;
	if (ep[0] == '[') {
		b = ep + 1;
		e = strchr(b, ']');
	} else {
		b = ep;
		e = strrchr(b, ':');
	}
	n = e ? (size_t)(e - b) : strlen(b);
	if (n >= dlen)
		n = dlen - 1;
	memcpy(dst, b, n);
	dst[n] = 0;
}

/* 讀 `wg show wg1 dump`；回傳裝置數，*port 填實際的監聽連接埠。wg1 不存在或讀不到時回 -1 */
static int
tw_wg_dump(int *port)
{
	char line[512], *p, *f[8];
	FILE *fp;
	int n = 0, first = 1, k;

	if (access("/sys/class/net/" IFNAME_TW_WGS, F_OK) != 0 || access(TW_WG_BIN, X_OK) != 0)
		return -1;
	fp = popen(TW_WG_BIN " show " IFNAME_TW_WGS " dump 2>/dev/null", "r");
	if (!fp)
		return -1;

	while (fgets(line, sizeof(line), fp)) {
		/* 一行太長（不應該發生）：把剩下的讀掉，這行不用 */
		if (!strchr(line, '\n') && !feof(fp)) {
			int c;
			while ((c = fgetc(fp)) != EOF && c != '\n')
				;
			continue;
		}
		line[strcspn(line, "\r\n")] = 0;

		p = line;
		for (k = 0; k < 8; k++)
			f[k] = strsep(&p, "\t");

		if (first) {
			/* 介面：私鑰、公鑰、監聽連接埠、fwmark */
			first = 0;
			if (f[2] && tw_all_digits(f[2]))
				*port = atoi(f[2]);
			memset(line, 0, sizeof(line));
			continue;
		}
		/* 裝置：公鑰、預先共用金鑰、來源、允許的 IP、最後握手、收、送、保持連線 */
		if (!f[0] || !f[6] || n >= (int)(sizeof(tw_wg_peers) / sizeof(tw_wg_peers[0])))
			continue;
		snprintf(tw_wg_peers[n].pub, sizeof(tw_wg_peers[n].pub), "%s", f[0]);
		tw_wg_endpoint_host(tw_wg_peers[n].endpoint, sizeof(tw_wg_peers[n].endpoint), f[2]);
		tw_wg_peers[n].hs = strtoll(f[4], NULL, 10);
		tw_wg_peers[n].rx = strtoull(f[5], NULL, 10);
		tw_wg_peers[n].tx = strtoull(f[6], NULL, 10);
		n++;
	}
	memset(line, 0, sizeof(line));
	pclose(fp);

	return first ? -1 : n;	/* 一行都沒有＝wg 讀不到介面 */
}

int
tw_api_vpn(webs_t wp)
{
	char net3[20], pub[64], host[8], key[32], *dot;
	int i, j, num, live, port, first = 1;

	if (!nvram_match("wgs_enable", "1")) {
		fputs("{\"ok\":true,\"available\":false,\"reason\":\"disabled\",\"enabled\":false}", wp);
		fflush(wp);
		return 0;
	}

	/* VPN 網段的前三段（wgs_addr 預設 10.66.0.1，網段固定 /24，跟 wireguard.sh 相同） */
	snprintf(net3, sizeof(net3), "%s", nvram_safe_get("wgs_addr"));
	if (!net3[0])
		snprintf(net3, sizeof(net3), "10.66.0.1");
	dot = strrchr(net3, '.');
	if (dot)
		*dot = 0;

	port = nvram_safe_get_int("wgs_port", 51820, 1, 65535);
	num = nvram_safe_get_int("wgs_num_x", 0, 0, TW_WGS_MAX_PEERS);

	live = tw_wg_dump(&port);

	fprintf(wp, "{\"ok\":true,\"ts\":%lld,\"available\":true,\"warming_up\":false,\"enabled\":true,\"running\":%s,\"listen_port\":%d,\"peers\":[",
		(long long)time(NULL), live >= 0 ? "true" : "false", port);

	for (i = 0; i < num; i++) {
		snprintf(key, sizeof(key), "wgs_pub_x%d", i);
		snprintf(pub, sizeof(pub), "%s", nvram_safe_get(key));
		snprintf(key, sizeof(key), "wgs_ip_x%d", i);
		snprintf(host, sizeof(host), "%s", nvram_safe_get(key));

		fputs(first ? "{\"name\":" : ",{\"name\":", wp);
		first = 0;
		/* 名稱最後才讀，讀完馬上輸出（共用暫存區） */
		snprintf(key, sizeof(key), "wgs_name_x%d", i);
		tw_json_str(wp, nvram_safe_get(key));

		fputs(",\"ip\":", wp);
		if (tw_all_digits(host) && atoi(host) >= 1 && atoi(host) <= 254)
			fprintf(wp, "\"%s.%d\"", net3, atoi(host));
		else
			fputs("\"\"", wp);

		for (j = 0; j < live; j++)
			if (pub[0] && strcmp(tw_wg_peers[j].pub, pub) == 0)
				break;
		if (live > 0 && j < live) {
			fprintf(wp, ",\"last_handshake_ts\":%lld,\"rx_bytes\":%llu,\"tx_bytes\":%llu,\"endpoint\":",
				tw_wg_peers[j].hs, tw_wg_peers[j].rx, tw_wg_peers[j].tx);
			tw_json_str(wp, tw_wg_peers[j].endpoint);
		} else {
			fputs(",\"last_handshake_ts\":null,\"rx_bytes\":null,\"tx_bytes\":null,\"endpoint\":\"\"", wp);
		}
		fputc('}', wp);
	}
	fputs("]}", wp);
	fflush(wp);

	memset(tw_wg_peers, 0, sizeof(tw_wg_peers));
	return 0;
}

#else	/* !APP_WIREGUARD */

int
tw_api_vpn(webs_t wp)
{
	fputs("{\"ok\":true,\"available\":false,\"reason\":\"not_included\",\"enabled\":false}", wp);
	fflush(wp);
	return 0;
}

#endif
