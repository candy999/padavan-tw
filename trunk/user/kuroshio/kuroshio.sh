#!/bin/sh
# padavan-tw：黑潮 DNS（https://github.com/candy999/kuroshio-dns）
#
#   kuroshio.sh start | stop | restart | status
#   kuroshio.sh acme [force]     申請／續期憑證（acme.sh＋Cloudflare DNS 驗證）
#   kuroshio.sh save             學習資料存檔（每天自動執行一次）
#   kuroshio.sh guard            保護程式（由 start 在背景啟動）
#
# 架構（跟 OpenWrt 版的 dnsmasq-upstream 模式相同）：
# - dnsmasq 照常佔 53 埠與 DHCP，查詢轉給黑潮 DNS（127.0.0.1:5335）；dnsmasq 設定由 rc 產生
#   （no-resolv、cache-size=0，上游依 $USE 寫進 /tmp/dnsmasq.servers）
# - 設定檔是 OpenWrt 的 UCI 文字格式：$UCI_SRC 是使用者設定，啟動時複製到記憶體再寫入後台表單的值（nvram）
# - 保護：黑潮 DNS 不在或連續 3 次沒回答 → 改用業者 DNS（這段期間沒有過濾）；恢復回答就切回
# - 學習資料放專用的 Flash 資料區，由黑潮 DNS 自己控制寫入（每 6～24 小時、內容沒變不寫、停止時寫出）：
#   CR6608 → RWFS（UBIFS，97 MB）；D3 → Kuroshio 分割區（JFFS2，7.5 MB，原本沒人用的重複 Storage 區，跟真正的 Storage 不重疊）
#   第一次使用前檢查：CR6608 的 RWFS 裡是別人的資料就不碰；D3 的分割區表跟其他分割區重疊就不碰；
#   不能用時改放記憶體＋每天匯出備份到 /etc/storage、開機時匯入

BIN=/usr/bin/kuroshio
SHARE=/usr/share/kuroshio
ETC=/etc/storage/kuroshio
RUN=/tmp/kuroshio
UCI_SRC=$ETC/kuroshio.uci	# 使用者的設定（後台「進階設定」可以編輯；不含 Token）
UCI=$RUN/kuroshio.uci		# 實際給黑潮 DNS 讀的：使用者設定＋後台表單的值（含 Token，只在記憶體）
USE=$RUN/use		# kuroshio＝dnsmasq 轉給黑潮 DNS；fallback＝業者 DNS（rc 依這個檔產生 /tmp/dnsmasq.servers）
DNSMASQ_EXTRA=$RUN/dnsmasq.conf
BACKUP=$ETC/backup.kuroshio
RWFS=/media/mtd_rwfs		# CR6608：rc 開機時掛載（nvram mtd_rwfs_mount=1）
JFFS2=/media/kuroshio		# D3：Kuroshio 分割區
PORT=5335
ACME=/usr/lib/acme/acme.sh
CA=/usr/lib/acme/cacert.pem
TAG="黑潮DNS"

export KUROSHIO_UCI_FILE="$UCI" KUROSHIO_ETC="$ETC" KUROSHIO_SHARE="$SHARE" NO_COLOR=1
export KUROSHIO_LOG="${KUROSHIO_LOG:-$(nvram get kuroshio_log 2>/dev/null)}"
[ -n "$KUROSHIO_LOG" ] || export KUROSHIO_LOG=warn

log() { logger -t "$TAG" "$*"; }

nv() { nvram get "$1" 2>/dev/null; }

# 通知 rc 執行事件（跟 C 的 notify_rc 相同）
notify_rc() {
	mkdir -p /tmp/rc_notification /tmp/rc_action_incomplete
	: > "/tmp/rc_action_incomplete/$1"
	: > "/tmp/rc_notification/$1"
	kill -USR1 1
}

lan_ip() { nv lan_ipaddr; }

# ---------- 學習資料放哪裡 ----------

mtd_idx() { awk -v n="\"$1\"" '$4 == n { sub("mtd", "", $1); sub(":", "", $1); print $1; exit }' /proc/mtd 2>/dev/null; }

# blk_erased <裝置> [從第幾個 64 KB 開始] [幾個]：全部是 0xFF（Flash 抹除後的狀態）
blk_erased() {
	[ "$(dd if="$1" bs=65536 skip="${2:-0}" count="${3:-1}" 2>/dev/null | tr -d '\377' | wc -c)" -eq 0 ]
}

note() { echo "$*" > "$RUN/area_note"; log "$*"; }

# CR6608：RWFS。rc 已掛載就直接用；沒有的話：空的 → 格式化成 UBIFS；已經是我們的 → 掛載；有別的資料 → 不碰
prepare_rwfs() {
	local n vols name
	n=$(mtd_idx RWFS)
	[ -n "$n" ] || return 1
	grep -q " $RWFS " /proc/mounts && return 0
	if [ ! -d "/sys/class/ubi/ubi$n" ]; then
		if ! ubiattach -p "/dev/mtd$n" -d "$n" >/dev/null 2>&1; then
			if blk_erased "/dev/mtd$n" 0 8; then
				log "第一次使用 RWFS：格式化成 UBIFS"
				rwfs2ubi.sh >/dev/null 2>&1
				ubiattach -p "/dev/mtd$n" -d "$n" >/dev/null 2>&1 || return 1
			else
				note "RWFS 裡有其他資料（不是 UBI），為了安全沒有動，學習資料暫時放記憶體"
				return 1
			fi
		fi
	fi
	vols=$(cat "/sys/class/ubi/ubi$n/volumes_count" 2>/dev/null)
	name=$(cat "/sys/class/ubi/ubi$n/ubi${n}_0/name" 2>/dev/null)
	if [ "${vols:-0}" -eq 0 ]; then
		ubimkvol "/dev/ubi$n" -m -N rwfs >/dev/null 2>&1 || return 1
	elif [ "$name" != rwfs ]; then
		ubidetach -p "/dev/mtd$n" >/dev/null 2>&1
		note "RWFS 裡有其他資料（可能是原廠韌體備援），為了安全沒有動，學習資料暫時放記憶體"
		return 1
	fi
	mkdir -p "$RWFS"
	mount -t ubifs "/dev/ubi${n}_0" "$RWFS" 2>/dev/null || return 1
	if [ "$(nv mtd_rwfs_mount)" != "1" ]; then
		nvram set mtd_rwfs_mount=1
		nvram commit
	fi
	return 0
}

# 裝置樹裡每個分割區：「名稱 起點 大小」（十進位，位元組）
# 注意：/proc/device-tree 是捷徑（symlink），busybox find 預設不跟進，路徑後面一定要加「/」
dt_parts() {
	local f d l r dt
	for dt in /proc/device-tree/ /sys/firmware/devicetree/base/; do
		[ -d "$dt" ] && break
	done
	for f in $(find "$dt" -name label 2>/dev/null); do
		case "$f" in */partition@*/label) ;; *) continue ;; esac
		d=${f%/label}
		l=$(tr -d '\000' < "$f")
		r=$(hexdump -v -e '1/1 "%02x"' "$d/reg" 2>/dev/null)
		[ ${#r} -eq 16 ] || continue
		echo "$l $((0x$(echo "$r" | cut -c1-8))) $((0x$(echo "$r" | cut -c9-16)))"
	done
}

# Kuroshio 分割區跟其他分割區（整顆 Flash 的除外）完全不重疊，才可以寫
# 回傳：0＝不重疊、1＝重疊、2＝讀不到分割區表（不能確認，一樣不使用）
kuro_layout_ok() {
	dt_parts | awk '
		{ n[NR] = $1; s[NR] = $2; e[NR] = $2 + $3 }
		$1 == "Kuroshio" { k = NR }
		END {
			if (!k) exit 2
			for (i = 1; i <= NR; i++) {
				if (i == k) continue
				if (s[i] == 0 && e[i] >= e[k]) continue
				if (s[i] < e[k] && s[k] < e[i]) exit 1
			}
			exit 0
		}'
}

# D3：Kuroshio 分割區（JFFS2，0x1800000～0x1f80000）。設定存放的 Storage 在它後面（0x1f80000，512K），不重疊。
# 先確認分割區表真的不重疊；開頭不是 JFFS2 也不是全空 → 這塊是專用的，清除後使用
prepare_jffs2() {
	local n
	n=$(mtd_idx Kuroshio)
	[ -n "$n" ] || return 1
	grep -q " $JFFS2 " /proc/mounts && return 0
	kuro_layout_ok
	case $? in
	0) ;;
	1)	note "黑潮 DNS 資料區跟其他分割區重疊，為了保護設定不使用，學習資料暫時放記憶體"
		return 1 ;;
	*)	note "讀不到分割區表，無法確認黑潮 DNS 資料區是否安全，學習資料暫時放記憶體"
		return 1 ;;
	esac
	if [ "$(head -c 2 "/dev/mtd$n" 2>/dev/null | tr '\205\031' 'ab')" != "ab" ] && ! blk_erased "/dev/mtd$n"; then
		log "第一次使用黑潮 DNS 資料區：清除舊資料（約 1 分鐘）"
		mtd_write erase Kuroshio >/dev/null 2>&1 || return 1
	fi
	mkdir -p "$JFFS2"
	mount -t jffs2 "/dev/mtdblock$n" "$JFFS2" 2>/dev/null
}

state_mode() {
	rm -f "$RUN/area_note"
	if prepare_rwfs; then
		echo rwfs
	elif prepare_jffs2; then
		echo jffs2
	else
		echo ram
	fi
}

state_dir() {
	case "$1" in
	rwfs) echo "$RWFS/kuroshio/state" ;;
	jffs2) echo "$JFFS2/kuroshio/state" ;;
	*) echo "$RUN/state" ;;
	esac
}

# ---------- UCI 設定 ----------

# uci_set <區段> <選項> <值>：只改這一行；區段或選項不存在就補上（具名區段）
uci_set() {
	local tmp="$UCI.tmp"
	awk -v s="$1" -v o="$2" -v v="$3" '
		function esc(x) { gsub(/\047/, "\047\\\047\047", x); return x }
		function emit() { printf "\toption %s \047%s\047\n", o, esc(v); done = 1 }
		/^config[ \t]/ {
			if (insec && !done) emit()
			n = $3; gsub(/\047|"/, "", n)
			insec = (n == s); if (insec) found = 1
			print; next
		}
		insec && $1 == "option" && $2 == o { if (!done) emit(); next }
		{ print }
		END {
			if (insec && !done) emit()
			if (!found) {
				t = (s == "main") ? "kuroshio" : s
				printf "\nconfig %s \047%s\047\n", t, s; emit()
			}
		}
	' "$UCI" > "$tmp" && mv "$tmp" "$UCI"
}

wan_if() { ip route 2>/dev/null | awk '/^default/ { for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit } }'; }

is_public_ip() {
	case "$1" in
	''|0.*|10.*|127.*|169.254.*|192.168.*) return 1 ;;
	100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 1 ;;
	172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 1 ;;
	esac
	return 0
}

sync_uci() {
	local mode="$1" sdir wif wip yes
	mkdir -p "$ETC" "$RUN"
	chmod 700 "$ETC" "$RUN"
	# 沒有設定檔、或在後台清空了 → 用預設值（跟 OpenWrt 版同一份）
	grep -q "^config " "$UCI_SRC" 2>/dev/null || cp "$SHARE/kuroshio.uci.default" "$UCI_SRC"
	chmod 600 "$UCI_SRC"
	cp -f "$UCI_SRC" "$UCI"
	chmod 600 "$UCI"

	sdir=$(state_dir "$mode")
	uci_set main enabled 1
	uci_set main redirect dnsmasq-upstream
	uci_set main dns_port "$PORT"
	uci_set main data_dir "$sdir"
	uci_set main admin_port 8054

	uci_set tls domain "$(nv kuroshio_domain)"
	uci_set tls cert_mode acme
	uci_set tls acme_email "$(nv kuroshio_acme_email)"
	uci_set cf_account api_token "$(nv kuroshio_cf_token)"

	# DDNS：WAN 拿到公網 IP 時直接讀網卡（不用對外查詢）；私人位址／CGNAT 時問 Cloudflare
	uci_set ddns enabled "$(nv kuroshio_ddns)"
	wif=$(wan_if)
	wip=$(ip -4 addr show dev "$wif" 2>/dev/null | awk '/inet / { sub("/.*", "", $2); print $2; exit }')
	if [ -n "$wif" ] && is_public_ip "$wip"; then
		uci_set ddns ip_source interface
		uci_set ddns iface4 "$wif"
	else
		uci_set ddns ip_source web
	fi

	yes=$(nv kuroshio_wan)
	uci_set dot enabled "$(nv kuroshio_dot)"
	uci_set dot open_wan "${yes:-0}"
	uci_set doq enabled "$(nv kuroshio_doq)"
	uci_set doh enabled "$(nv kuroshio_doh)"
	uci_set doh http3 "$(nv kuroshio_doh)"
	uci_set doh port "$(nv kuroshio_doh_port)"
	uci_set doh open_wan "${yes:-0}"
	uci_set doh wan_port "$(nv kuroshio_doh_wan_port)"
	uci_set access mode "$(nv kuroshio_access)"
}

# ---------- dnsmasq ----------

# 切換 dnsmasq 的上游：寫狀態檔，rc 的 restart_dns 會重寫 /tmp/dnsmasq.servers 再 SIGHUP dnsmasq
use_servers() {
	mkdir -p "$RUN"
	[ "$(cat "$USE" 2>/dev/null)" = "$1" ] && return 0
	echo "$1" > "$USE"
	restart_dns >/dev/null 2>&1
}

# DDR：區網裝置問 _dns.resolver.arpa 時拿到網域，網域直接解析成路由器；DNR：DHCP 選項 162
dnsmasq_extra() {
	local domain new="$RUN/dnsmasq.conf.new" dnr hex
	domain=$(nv kuroshio_domain)
	mkdir -p "$RUN"
	: > "$new"
	if [ -n "$domain" ]; then
		echo "address=/$domain/$(lan_ip)" >> "$new"
		dnr=$($BIN dnr --uci --lan "$(lan_ip)" 2>/dev/null)
		case "$dnr" in
		*'"ok":true'*|*'"ok": true'*)
			hex=$(echo "$dnr" | sed -n 's/.*"dhcpv4"[ ]*:[ ]*"\([0-9a-fA-F:]*\)".*/\1/p')
			[ -n "$hex" ] && echo "dhcp-option=162,$hex" >> "$new"
			;;
		esac
	fi
	if ! cmp -s "$new" "$DNSMASQ_EXTRA"; then
		mv "$new" "$DNSMASQ_EXTRA"
		notify_rc restart_dhcpd
	else
		rm -f "$new"
	fi
}

# ---------- 啟停 ----------

run_loop() {
	ulimit -n 65535 2>/dev/null
	while [ -f "$RUN/enabled" ]; do
		# 開機後的背景工作（CDN 節點池、網段掃描、上游評測）很吃 CPU，降低優先權讓 Wi-Fi、後台、dnsmasq 先跑
		nice -n 10 $BIN run --uci 2>&1 | logger -t "$TAG"
		[ -f "$RUN/enabled" ] || break
		sleep 2
	done
}

alive() {
	pidof kuroshio >/dev/null 2>&1 || return 1
	$BIN query -s "127.0.0.1:$PORT" --timeout 800 -t SVCB _dns.resolver.arpa 2>/dev/null | grep -qi rcode
}

start() {
	local mode sdir
	[ "$(nv kuroshio_enable)" = "1" ] || return 0
	[ "$(nv wan_route_x)" = "IP_Bridged" ] && return 0	# AP 模式不接管 DNS
	[ -x "$BIN" ] || { log "找不到 $BIN"; return 1; }
	if [ -f "$RUN/enabled" ] && pidof kuroshio >/dev/null 2>&1; then
		return 0
	fi
	mkdir -p "$RUN"
	mode=$(state_mode)
	sdir=$(state_dir "$mode")
	mkdir -p "$sdir"
	rm -rf /etc/storage/kuroshio/state	# 早期測試版放在 /etc/storage 的學習資料，佔儲存空間
	sync_uci "$mode"
	echo "$mode" > "$RUN/mode"

	# 開機時把每天的備份匯入：放記憶體的模式每次都要；剛啟用 RWFS（學習資料目錄還是空的）時也匯入一次，
	# 之前放在記憶體學到的東西才不會因為換存放位置而重來
	if [ -f "$BACKUP" ] && [ ! -f "$RUN/imported" ] && \
	   { [ "$mode" = ram ] || [ -z "$(ls -A "$sdir" 2>/dev/null)" ]; }; then
		$BIN import "$BACKUP" --uci >/dev/null 2>&1 && log "已匯入學習資料備份"
		: > "$RUN/imported"
	fi

	: > "$RUN/enabled"
	run_loop &
	echo $! > "$RUN/loop.pid"
	"$0" guard &
	echo $! > "$RUN/guard.pid"
	log "啟動（學習資料：$sdir）"
}

stop() {
	local i
	rm -f "$RUN/enabled"
	for f in guard loop; do
		[ -f "$RUN/$f.pid" ] && kill "$(cat "$RUN/$f.pid")" 2>/dev/null
		rm -f "$RUN/$f.pid"
	done
	use_servers fallback
	# SIGTERM：黑潮 DNS 會先把快照寫出再結束，最多等 15 秒
	killall -q -TERM kuroshio
	i=0
	while pidof kuroshio >/dev/null 2>&1 && [ $i -lt 15 ]; do
		sleep 1
		i=$((i + 1))
	done
	killall -q -KILL kuroshio
	sync
	[ "$(cat "$RUN/mode" 2>/dev/null)" = ram ] && save_backup
	log "已停止"
}

# ---------- 保護 ----------

guard() {
	local state="" fails=0 tick=0 day today hm
	trap 'exit 0' TERM INT
	sleep 2
	dnsmasq_extra
	while [ -f "$RUN/enabled" ]; do
		if ! pidof kuroshio >/dev/null 2>&1; then
			fails=3
		elif [ $((tick % 10)) -eq 0 ] || [ "$state" != kuroshio ]; then
			if alive; then
				fails=0
			else
				fails=$((fails + 1))
			fi
		fi
		if [ $fails -ge 3 ] && [ "$state" != fallback ]; then
			use_servers fallback
			[ -n "$state" ] && log "沒有回應，暫時改用業者 DNS（這段期間沒有過濾）"
			state=fallback
		elif [ $fails -eq 0 ] && [ "$state" != kuroshio ]; then
			use_servers kuroshio
			log "接管 DNS"
			state=kuroshio
		fi

		# 每天一次：04:23 檢查憑證續期、04:41 學習資料存檔
		hm=$(date +%H%M)
		today=$(date +%Y%m%d)
		if [ "$hm" = "0423" ] && [ "$day" != "a$today" ]; then
			day="a$today"
			"$0" acme cron >/dev/null 2>&1 &
		elif [ "$hm" = "0441" ] && [ "$day" != "s$today" ]; then
			day="s$today"
			"$0" save >/dev/null 2>&1 &
		fi

		tick=$((tick + 1))
		sleep 1
	done
}

# ---------- 存檔 ----------

save_backup() {
	local tmp="$BACKUP.tmp"
	$BIN export -o "$tmp" --uci >/dev/null 2>&1 || { rm -f "$tmp"; return 1; }
	chmod 600 "$tmp"
	mv "$tmp" "$BACKUP"
}

save() {
	# rwfs、jffs2：黑潮 DNS 自己會依 Flash 模式定期寫入，這裡不用做
	if [ "$(cat "$RUN/mode" 2>/dev/null)" = ram ]; then
		save_backup && /sbin/mtd_storage.sh save >/dev/null 2>&1 && log "學習資料備份已存檔"
	fi
}

# ---------- 憑證 ----------

acme() {
	local domain token email rc force=""
	domain=$(nv kuroshio_domain)
	token=$(nv kuroshio_cf_token)
	email=$(nv kuroshio_acme_email)
	[ -x "$ACME" ] || { echo "找不到 acme.sh"; return 1; }
	[ -n "$domain" ] || { echo "沒有設定網域"; return 1; }
	[ -n "$token" ] || { echo "沒有設定 Cloudflare API Token"; return 1; }
	[ "$1" = force ] && force=--force
	mkdir -p "$ETC/acme"
	chmod 700 "$ETC/acme"
	if [ "$1" = cron ]; then
		[ -f "$ETC/cert.pem" ] || return 0	# 還沒申請過就不在排程裡自動申請
		CF_Token="$token" CURL_CA_BUNDLE="$CA" "$ACME" --home "$ETC/acme" --config-home "$ETC/acme" \
			--ca-bundle "$CA" --cron
		return $?
	fi
	echo "申請 $domain 的憑證（Let's Encrypt，Cloudflare DNS 驗證）"
	CF_Token="$token" CURL_CA_BUNDLE="$CA" "$ACME" --home "$ETC/acme" --config-home "$ETC/acme" \
		--ca-bundle "$CA" --issue --dns dns_cf -d "$domain" --server letsencrypt --keylength ec-256 \
		${email:+--accountemail "$email"} $force
	rc=$?
	[ "$rc" = 0 ] || [ "$rc" = 2 ] || { echo "申請失敗（代碼 $rc）"; return "$rc"; }
	"$ACME" --home "$ETC/acme" --config-home "$ETC/acme" --install-cert -d "$domain" --ecc \
		--fullchain-file "$ETC/cert.pem" --key-file "$ETC/key.pem" \
		--reloadcmd "/usr/bin/kuroshio.sh certsync" || return 1
	echo "完成：$ETC/cert.pem"
}

# 續期或申請完成：黑潮 DNS 10 秒內自動換上；同一份憑證給後台 HTTPS 用
certsync() {
	chmod 600 "$ETC/key.pem" 2>/dev/null
	if [ -s "$ETC/cert.pem" ] && [ -s "$ETC/key.pem" ]; then
		mkdir -p /etc/storage/https
		cp -f "$ETC/cert.pem" /etc/storage/https/server.crt
		cp -f "$ETC/key.pem" /etc/storage/https/server.key
		chmod 600 /etc/storage/https/server.key
		case "$(nv http_proto)" in 1|2) notify_rc restart_httpd ;; esac
		dnsmasq_extra
		/sbin/mtd_storage.sh save >/dev/null 2>&1
		log "憑證已更新（後台 HTTPS 一併更新）"
	fi
}

# 網頁用：在背景申請，網頁每幾秒讀一次紀錄
acme_bg() {
	mkdir -p "$RUN"
	if [ -f "$RUN/acme.pid" ] && kill -0 "$(cat "$RUN/acme.pid")" 2>/dev/null; then
		echo "已經在申請中"
		return 0
	fi
	( "$0" acme "$@" > "$RUN/acme.log" 2>&1; echo "== 結束（代碼 $?）==" >> "$RUN/acme.log"; rm -f "$RUN/acme.pid" ) &
	echo $! > "$RUN/acme.pid"
	echo "已開始申請，約 1～3 分鐘"
}

status() {
	echo "狀態：$(pidof kuroshio >/dev/null 2>&1 && echo 執行中 || echo 沒有執行)"
	echo "DNS：$([ "$(cat "$USE" 2>/dev/null)" = kuroshio ] && echo 由黑潮 DNS 處理 || echo 暫時使用業者 DNS)"
	case "$(cat "$RUN/mode" 2>/dev/null)" in
	rwfs) echo "學習資料：Flash（RWFS，$RWFS）" ;;
	jffs2) echo "學習資料：Flash（黑潮 DNS 資料區，$JFFS2）" ;;
	ram) echo "學習資料：記憶體（每天 04:41 備份到 /etc/storage）" ;;
	esac
	[ -f "$RUN/area_note" ] && cat "$RUN/area_note"
	echo "網域：$(nv kuroshio_domain)"
	[ -f "$ETC/cert.pem" ] && echo "憑證：$($BIN cert-info --uci 2>/dev/null | head -n 3 | tr '\n' ' ')"
}

case "$1" in
start) start ;;
stop) stop ;;
restart) stop; start ;;
guard) guard ;;
save) save ;;
acme) shift; acme "$@" ;;
acme-bg) shift; acme_bg "$@" ;;
acme-log) cat "$RUN/acme.log" 2>/dev/null; [ -f "$RUN/acme.pid" ] && echo "（申請中…）" ;;
certsync) certsync ;;
status) status ;;
*) echo "用法：$0 start | stop | restart | status | acme [force] | save" ;;
esac
