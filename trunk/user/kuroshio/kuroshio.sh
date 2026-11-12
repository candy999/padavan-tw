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
# - 學習資料：CR6608 已掛載 RWFS → 放 RWFS；儲存分割區 ≥ 6 MB（D3）→ /etc/storage；
#   其他 → 放記憶體，每天匯出備份到 /etc/storage、開機時匯入

BIN=/usr/bin/kuroshio
SHARE=/usr/share/kuroshio
ETC=/etc/storage/kuroshio
RUN=/tmp/kuroshio
UCI_SRC=$ETC/kuroshio.uci	# 使用者的設定（後台「進階設定」可以編輯；不含 Token）
UCI=$RUN/kuroshio.uci		# 實際給黑潮 DNS 讀的：使用者設定＋後台表單的值（含 Token，只在記憶體）
USE=$RUN/use		# kuroshio＝dnsmasq 轉給黑潮 DNS；fallback＝業者 DNS（rc 依這個檔產生 /tmp/dnsmasq.servers）
DNSMASQ_EXTRA=$RUN/dnsmasq.conf
BACKUP=$ETC/backup.kuroshio
RWFS=/media/mtd_rwfs
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

storage_mtd_size() {
	local hex
	hex=$(awk '$4 == "\"Storage\"" { print $2 }' /proc/mtd 2>/dev/null)
	[ -n "$hex" ] && printf '%d' "0x$hex" || echo 0
}

state_mode() {
	if grep -q " $RWFS " /proc/mounts 2>/dev/null; then
		echo rwfs
	elif [ "$(storage_mtd_size)" -ge 6291456 ]; then
		echo storage
	else
		echo ram
	fi
}

state_dir() {
	case "$1" in
	rwfs) echo "$RWFS/kuroshio/state" ;;
	storage) echo "$ETC/state" ;;
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
		$BIN run --uci 2>&1 | logger -t "$TAG"
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
	case "$(cat "$RUN/mode" 2>/dev/null)" in
	ram)
		save_backup && /sbin/mtd_storage.sh save >/dev/null 2>&1 && log "學習資料備份已存檔"
		;;
	storage)
		/sbin/mtd_storage.sh save >/dev/null 2>&1 && log "學習資料已存檔"
		;;
	esac	# rwfs：黑潮 DNS 自己會依 Flash 模式定期寫入
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
	echo "學習資料：$(state_dir "$(cat "$RUN/mode" 2>/dev/null)")"
	if grep -q '"RWFS"' /proc/mtd 2>/dev/null && ! grep -q " $RWFS " /proc/mounts 2>/dev/null; then
		echo "RWFS：可用但未啟用（啟用後學習資料不用放記憶體）"
	fi
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
