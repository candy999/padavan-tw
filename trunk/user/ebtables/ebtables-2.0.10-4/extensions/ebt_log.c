/* ebt_log：ebtables 的 log 觀察器（watcher）
 *
 * padavan-tw：上游拿掉了 log 擴充，這裡補回最小版本（--log、--log-level、--log-prefix），
 * 給「Wi-Fi BPDU 擋法」記錄每一次攔截（核心模組 ebt_log 本來就有編）。
 * 不支援 --log-ip／--log-arp（用不到）。
 * 注意：靜態編譯時 Makefile 會把每一行第一個「底線 init」改名，檔案裡除了最後的註冊函式不要出現這個字串。
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <getopt.h>
#include <syslog.h>
#include "../include/ebtables_u.h"
#include <linux/netfilter_bridge/ebt_log.h>

#define LOG_DEFAULT_LEVEL LOG_INFO

#define OPT_PREFIX '1'
#define OPT_LEVEL  '2'
#define OPT_LOG    '3'

#define FLAG_PREFIX 0x01
#define FLAG_LEVEL  0x02
#define FLAG_LOG    0x04

static const char *log_levels[] = {
	"emerg", "alert", "crit", "error", "warning", "notice", "info", "debug", NULL
};

static struct option opts[] =
{
	{ "log-prefix", required_argument, 0, OPT_PREFIX },
	{ "log-level" , required_argument, 0, OPT_LEVEL  },
	{ "log"       , no_argument      , 0, OPT_LOG    },
	{ 0 }
};

static void print_help()
{
	printf(
"log options:\n"
"--log               : use this if you're not specifying anything\n"
"--log-level level   : level = [0-7] | emerg | alert | crit | error | warning | notice | info | debug\n"
"--log-prefix prefix : max. %d chars.\n", EBT_LOG_PREFIX_SIZE - 1);
}

static void init(struct ebt_entry_watcher *watcher)
{
	struct ebt_log_info *li = (struct ebt_log_info *)watcher->data;

	li->bitmask = 0;
	li->prefix[0] = '\0';
	li->loglevel = LOG_DEFAULT_LEVEL;
}

static int parse(int c, char **argv, int argc, const struct ebt_u_entry *entry,
   unsigned int *flags, struct ebt_entry_watcher **watcher)
{
	struct ebt_log_info *li = (struct ebt_log_info *)(*watcher)->data;
	char *end;
	long int i;
	int j;

	switch (c) {
	case OPT_PREFIX:
		ebt_check_option2(flags, FLAG_PREFIX);
		if (strlen(optarg) > EBT_LOG_PREFIX_SIZE - 1)
			ebt_print_error2("Prefix too long");
		if (strchr(optarg, '\"'))
			ebt_print_error2("Use of \\\" is not allowed in the prefix");
		strcpy((char *)li->prefix, optarg);
		break;
	case OPT_LEVEL:
		ebt_check_option2(flags, FLAG_LEVEL);
		i = strtol(optarg, &end, 10);
		if (*end != '\0' || i < 0 || i > 7) {
			i = -1;
			for (j = 0; log_levels[j]; j++)
				if (!strcasecmp(optarg, log_levels[j])) {
					i = j;
					break;
				}
		}
		if (i < 0)
			ebt_print_error2("Problem with the log-level");
		li->loglevel = (uint8_t)i;
		break;
	case OPT_LOG:
		ebt_check_option2(flags, FLAG_LOG);
		break;
	default:
		return 0;
	}
	return 1;
}

static void final_check(const struct ebt_u_entry *entry,
   const struct ebt_entry_watcher *watcher, const char *name,
   unsigned int hookmask, unsigned int time)
{
}

static void print(const struct ebt_u_entry *entry,
   const struct ebt_entry_watcher *watcher)
{
	struct ebt_log_info *li = (struct ebt_log_info *)watcher->data;

	printf("--log-level %s --log-prefix \"%s\" ",
	       li->loglevel <= 7 ? log_levels[li->loglevel] : "info", li->prefix);
}

static int compare(const struct ebt_entry_watcher *w1,
   const struct ebt_entry_watcher *w2)
{
	struct ebt_log_info *a = (struct ebt_log_info *)w1->data;
	struct ebt_log_info *b = (struct ebt_log_info *)w2->data;

	if (a->loglevel != b->loglevel || a->bitmask != b->bitmask)
		return 0;
	return !strcmp((char *)a->prefix, (char *)b->prefix);
}

static struct ebt_u_watcher log_watcher =
{
	.name		= "log",
	.size		= sizeof(struct ebt_log_info),
	.help		= print_help,
	.init		= init,
	.parse		= parse,
	.final_check	= final_check,
	.print		= print,
	.compare	= compare,
	.extra_ops	= opts,
};

void _init(void)
{
	ebt_register_watcher(&log_watcher);
}
