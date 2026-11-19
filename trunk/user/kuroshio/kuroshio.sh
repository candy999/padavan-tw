#!/bin/sh
# padavan-tw：黑潮 DNS（https://github.com/candy999/kuroshio-dns）
#
#   kuroshio.sh start | stop | restart | status
#   kuroshio.sh reload           後台改了設定：SIGHUP 在同一個行程裡重新載入（rc 的 restart_kuroshio 先試這個）
#   kuroshio.sh acme [force]     申請／續期憑證（acme.sh＋Cloudflare DNS 驗證）
#   kuroshio.sh save             學習資料存檔（每天自動執行一次）
#   kuroshio.sh guard            保護程式（由 start 在背景啟動）
#   kuroshio.sh notify wan-changed   WAN 換了 IP：通知黑潮 DNS 立即更新 DDNS、重新偵測對外 IP（rc 在 WAN 上線時呼叫）
#   kuroshio.sh notify trim [秒]      先讓出記憶體（httpd 收韌體映像之前呼叫；3.3.0 起）
#   kuroshio.sh storage-save     把 /etc/storage 存進 Flash（在背景、合併連續的呼叫；內容沒變就不寫）
#   kuroshio.sh flush            立即把學習資料寫出（SIGUSR1）
#   後台轉接（httpd 的 kuroshio_api.cgi 呼叫，輸出 JSON）：
#   kuroshio.sh api <路徑> [參數]      查看類管理 API（白名單）
#   kuroshio.sh action <路徑> [參數]   會改變狀態的管理 API（白名單，httpd 只在 POST 時呼叫）
#   kuroshio.sh status-json | defaults | about | dnr | log [行數] | backup-export [share]
#
# 架構（跟 OpenWrt 版的 dnsmasq-upstream 模式相同）：
# - dnsmasq 照常佔 53 埠與 DHCP，查詢轉給黑潮 DNS（127.0.0.1:5335）；dnsmasq 設定由 rc 產生
#   （no-resolv、cache-size=0，上游依 $USE 寫進 /tmp/dnsmasq.servers）
# - 設定檔是 OpenWrt 的 UCI 文字格式：$UCI_SRC 是使用者設定，啟動時複製到記憶體再寫入後台表單的值（nvram）
# - 保護：黑潮 DNS 不在或連續 3 次沒回答 → 改用業者 DNS（這段期間沒有過濾）；恢復回答就切回
# - 學習資料放專用的 Flash 資料區，由黑潮 DNS 自己控制寫入（每 6～24 小時、內容沒變不寫、停止時寫出）：
#   CR6608 → RWFS（UBIFS，97 MB）；D3 → Kuroshio 分割區（JFFS2，7.5 MB，原本沒人用的重複 Storage 區，跟真正的 Storage 不重疊）
#   使用前檢查：CR6608 的 RWFS 裡是別人的資料就不碰；D3 的分割區表跟其他分割區重疊就不碰（不重疊但掛不上就清除重建）；
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
# 3.3.0：黑潮寫入設定目錄（自訂規則、.bak 等）之後執行，Padavan 的 /etc/storage 要另外存進 Flash
export KUROSHIO_ON_CONFIG_WRITE="/usr/bin/kuroshio.sh storage-save"
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

# 服務本體（kuroshio run）的 PID。pidof 會連 kuroshio health／export／notify 這些一下子就結束的指令一起算，
# 停止時不能把正在跑的每日匯出也殺掉
main_pid() {
	local p
	for p in $(pidof kuroshio 2>/dev/null); do
		case " $(tr '\000' ' ' < "/proc/$p/cmdline" 2>/dev/null)" in
		*" run "*) echo "$p"; return 0 ;;
		esac
	done
	return 1
}

# 自己的網域：格式不對（引號、空白、換行…）就當沒設定，不寫進 UCI 與 dnsmasq
kuro_domain() {
	local d
	d=$(nv kuroshio_domain)
	domain_ok "$d" && echo "$d"
}

# ---------- 存進 Flash ----------
# /etc/storage 在記憶體裡，rc 只在正常關機／重開機時寫進 Storage 分割區，斷電就回到上次重開機前的樣子。
# 黑潮 DNS 的設定改了（後台存檔、恢復預設自訂規則、社群金鑰、升級搬移、憑證）就自己存一次：
# mtd_storage.sh save 比對內容，沒變就不寫 Flash；在背景執行，2 秒內連續的呼叫合併成一次。
# 黑潮自己寫的檔（3.3.2 起含社群金鑰與邀請）由 KUROSHIO_ON_CONFIG_WRITE 呼叫這裡；httpd 寫的檔由 httpd 呼叫
storage_save() {
	local p
	mkdir -p "$RUN"
	: > "$RUN/storage.pending"
	if ! mkdir "$RUN/storage.lock" 2>/dev/null; then
		# 已經有人在存：等它順便存這次。鎖還在、記的程式卻不在了（被中斷）→ 接手，不然到重開機前都不會再存
		p=$(cat "$RUN/storage.lock/pid" 2>/dev/null)
		[ -z "$p" ] || kill -0 "$p" 2>/dev/null && return 0
		rm -rf "$RUN/storage.lock"
		mkdir "$RUN/storage.lock" 2>/dev/null || return 0
	fi
	(
		read -r p _ < /proc/self/stat
		echo "$p" > "$RUN/storage.lock/pid"
		while :; do
			while [ -f "$RUN/storage.pending" ]; do
				sleep 2
				rm -f "$RUN/storage.pending"
				/sbin/mtd_storage.sh save >/dev/null 2>&1 || log "設定存進 Flash 失敗（請看 Storage save 的紀錄）"
			done
			rm -rf "$RUN/storage.lock"
			# 最後一次檢查之後才進來的呼叫：再搶一次鎖接著存，不然那次就沒人處理
			[ -f "$RUN/storage.pending" ] && mkdir "$RUN/storage.lock" 2>/dev/null || break
			echo "$p" > "$RUN/storage.lock/pid"
		done
	) </dev/null >/dev/null 2>&1 &
}

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
# 先確認分割區表真的不重疊；掛載失敗（裡面有別的資料）→ 這塊是專用的，清除後重新建立
prepare_jffs2() {
	local n err
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
	mkdir -p "$JFFS2"
	# 先直接掛載：已經是 JFFS2、或整塊都是空的（0xFF）都掛得上。
	# 不能只看開頭判斷：實機上第一個 64 KB 是空的，但後面還留著舊資料（早期韌體的設定備份），
	# 核心會拒絕掛載（Cowardly refusing to erase blocks on filesystem with no valid JFFS2 nodes）
	if err=$(mount -t jffs2 "/dev/mtdblock$n" "$JFFS2" 2>&1); then
		return 0
	fi
	# 掛不上 → 裡面有不是 JFFS2 的資料。這塊是黑潮專用、上面已確認不跟其他分割區重疊，
	# 清除後重新建立（學習資料可以重建）
	log "黑潮 DNS 資料區無法掛載（${err:-未知原因}），清除後重新建立（約 1 分鐘）"
	if ! err=$(mtd_write erase Kuroshio 2>&1); then
		note "黑潮 DNS 資料區清除失敗（${err:-未知原因}），學習資料暫時放記憶體"
		return 1
	fi
	if err=$(mount -t jffs2 "/dev/mtdblock$n" "$JFFS2" 2>&1); then
		log "黑潮 DNS 資料區已重新建立"
		return 0
	fi
	note "黑潮 DNS 資料區清除後仍無法掛載（${err:-未知原因}），學習資料暫時放記憶體"
	return 1
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
# 值用環境變數傳給 awk（awk -v 會把值裡的 \n、\t、\\ 當成跳脫字元，Token 裡有反斜線會被吃掉）
uci_set() {
	local tmp="$UCI.tmp"
	UCI_V="$3" awk -v s="$1" -v o="$2" '
		BEGIN { v = ENVIRON["UCI_V"] }
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
	' "$UCI" > "$tmp" && chmod 600 "$tmp" && mv "$tmp" "$UCI"
}

# 埠號：1～65535 的數字，否則用預設值（填錯時黑潮會改用預設，防火牆也是，兩邊才對得上）
port_or() { case "$1" in ''|*[!0-9]*) echo "$2" ;; *) [ "$1" -ge 1 ] && [ "$1" -le 65535 ] && echo "$1" || echo "$2" ;; esac; }

# 網域只收英數字、點、連字號（會寫進 dnsmasq 設定與 UCI）
domain_ok() { case "$1" in ''|*[!A-Za-z0-9.-]*|.*|*..*) return 1 ;; esac; return 0; }

wan_if() { ip route 2>/dev/null | awk '/^default/ { for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit } }'; }

is_public_ip() {
	case "$1" in
	''|0.*|10.*|127.*|169.254.*|192.168.*) return 1 ;;
	100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 1 ;;
	172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 1 ;;
	esac
	return 0
}

# 升級時的預設設定搬移（OpenWrt 由 uci-defaults 腳本做；Padavan 的設定檔在 /etc/storage，要自己做）：
# 1. 使用者的設定檔跟某一個「舊版預設檔」一模一樣（從沒改過）→ 整份換成這一版的預設
# 2. 改過的 → kuroshio uci-migrate（3.3.1 起；規則跟 OpenWrt 套件升級時一樣：依 main.lists_version
#    更新沒動過的預設清單、加上新版本的清單，使用者改過的不動，做過的不再做）
#    一定要明確給使用者設定檔的路徑：KUROSHIO_UCI_FILE 指的是 /tmp 裡合併過表單值的那一份
# 舊版預設檔的 sha256：3.0.1～3.1.0（這幾版內容相同）、3.2.0、3.3.0
UCI_OLD_DEFAULTS="f0cbe30c3856635eb6a28621ee3d84b88fa9a9b5fe38d07ddaa1ef310b6df66e
2d1a9a7ce393269243957adb124d31a2bf66e70e0098e29c830be6bce31d47b6
2acf7cb391f48ebe79b4e5432055158e16e93f33f7296382ff0f4513b785beb0"
migrate_uci() {
	local cur new h tmp="$RUN/uci.migrate" out
	[ -f "$UCI_SRC" ] && [ -f "$SHARE/kuroshio.uci.default" ] || return 0
	rm -f "$ETC/.migrate_note"	# 3.3.0 以前：改過的設定檔只留提示
	cur=$(sha256sum "$UCI_SRC" 2>/dev/null | cut -d' ' -f1)
	new=$(sha256sum "$SHARE/kuroshio.uci.default" 2>/dev/null | cut -d' ' -f1)
	[ -n "$cur" ] && [ "$cur" != "$new" ] || return 0
	for h in $UCI_OLD_DEFAULTS; do
		if [ "$cur" = "$h" ]; then
			cp -f "$SHARE/kuroshio.uci.default" "$UCI_SRC"
			log "設定檔是舊版預設值，已換成這一版的預設（過濾清單等）"
			return 0
		fi
	done
	# 輸出到暫存檔再比對內容：看不懂的 lists_version 也會印說明但不改檔，不能用「有沒有輸出」判斷
	rm -f "$tmp"
	if out=$($BIN uci-migrate "$UCI_SRC" -o "$tmp" 2>&1); then
		if [ -s "$tmp" ] && grep -q '^config ' "$tmp" && \
		   [ "$(md5sum < "$tmp")" != "$(md5sum < "$UCI_SRC")" ]; then
			chmod 600 "$tmp"
			mv -f "$tmp" "$UCI_SRC"
			# （busybox 的 tr 一次只換一個位元組，全形分號要用 awk 接）
			log "設定檔升級遷移：$(printf '%s\n' "$out" | awk 'sub(/^- /, "") { printf "%s%s", (n++ ? "；" : ""), $0 }')"
		else
			# 沒改檔但有說明（例如 lists_version 看不懂，不做遷移）：記下來
			case "$out" in *看不懂*) log "設定檔沒有升級遷移：$(printf '%s' "$out" | head -n 1 | sed 's/^- //')" ;; esac
		fi
	else
		log "設定檔升級遷移失敗：$(printf '%s' "$out" | tail -n 1)"
	fi
	rm -f "$tmp"
}

sync_uci() {
	local mode="$1" sdir wif wip yes
	mkdir -p "$ETC" "$RUN"
	chmod 700 "$ETC" "$RUN"
	# 沒有設定檔、或在後台清空了 → 用預設值（跟 OpenWrt 版同一份）
	grep -q "^config " "$UCI_SRC" 2>/dev/null || cp "$SHARE/kuroshio.uci.default" "$UCI_SRC"
	migrate_uci
	chmod 600 "$UCI_SRC"
	# 設定目錄裡的檔案只給 root 讀寫（舊版寫的 custom-rules.txt 是 0666）
	for f in "$ETC"/*.txt "$ETC"/*.bak; do [ -f "$f" ] && chmod 600 "$f"; done
	[ -d "$ETC/benchmark" ] && chmod 700 "$ETC/benchmark" && chmod 600 "$ETC"/benchmark/* 2>/dev/null
	# 去掉 BOM 與 CR（用 Windows 編輯器改過、scp 上傳的檔）：不然 uci_set 認不得區段，會在檔尾再補一段
	(umask 077; awk 'NR == 1 { sub(/^\357\273\277/, "") } { sub(/\r$/, ""); print }' "$UCI_SRC" > "$UCI")
	chmod 600 "$UCI"

	sdir=$(state_dir "$mode")
	uci_set main enabled 1
	uci_set main redirect dnsmasq-upstream
	uci_set main dns_port "$PORT"
	uci_set main data_dir "$sdir"
	uci_set main admin_port 8054

	uci_set tls domain "$(kuro_domain)"
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
	uci_set doh port "$(port_or "$(nv kuroshio_doh_port)" 8443)"
	uci_set doh open_wan "${yes:-0}"
	uci_set doh wan_port "$(port_or "$(nv kuroshio_doh_wan_port)" 443)"
	uci_set access mode "$(nv kuroshio_access)"

	# 3.3.6 起：路由器的 IPv6 關閉時告訴黑潮不要用 IPv6 連上游（只改 /tmp 裡的執行用副本）；
	# 開著時照使用者的設定（預設 auto，黑潮自己看路由判斷）
	[ -z "$(nv ip6_service)" ] && uci_set upstream ipv6 0
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
	domain=$(kuro_domain)
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
	# 路由器的 busybox 沒有 cmp：以前每次比對都當成「不同」，每次啟動都重新啟動一次 DHCP／dnsmasq
	if [ "$(md5sum < "$new")" != "$([ -f "$DNSMASQ_EXTRA" ] && md5sum < "$DNSMASQ_EXTRA")" ]; then
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

# 檢查用的小設定檔：只有 DNS 埠與管理埠（Padavan 固定的值）。kuroshio health／status 要先讀設定才知道問哪裡，
# 使用者存了一份讀不進來的 UCI 時，黑潮會用上一份設定繼續跑（3.3.1 起），但用 $UCI 檢查會讀不到設定、
# 以為沒回應而改用業者 DNS
PROBE=$RUN/probe.uci
probe() {
	[ -s "$PROBE" ] || { mkdir -p "$RUN"; printf "config kuroshio 'main'\n\toption enabled '1'\n\toption redirect 'dnsmasq-upstream'\n\toption dns_port '%s'\n\toption admin_port '8054'\n" "$PORT" > "$PROBE"; }
	KUROSHIO_UCI_FILE="$PROBE" "$BIN" "$@" --uci
}

# 健康檢查：kuroshio health（3.1.0 起的穩定介面；問黑潮自己回答的 _dns.resolver.arpa，不經過上游，
# WAN 斷線不會誤判）。結束碼 0＝有回答
alive() {
	main_pid >/dev/null || return 1
	probe health --timeout 800 >/dev/null 2>&1
}

start() {
	local mode sdir
	[ "$(nv kuroshio_enable)" = "1" ] || return 0
	[ "$(nv wan_route_x)" = "IP_Bridged" ] && return 0	# AP 模式不接管 DNS
	[ -x "$BIN" ] || { log "找不到 $BIN"; return 1; }
	if [ -f "$RUN/enabled" ] && main_pid >/dev/null; then
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
		# 3.3.2 起有項目寫入失敗時結束碼是 1：這次開機下一次啟動再試
		if $BIN import "$BACKUP" --uci >/dev/null 2>&1; then
			log "已匯入學習資料備份"
			: > "$RUN/imported"
		else
			log "學習資料備份有部分沒有匯入（下次啟動再試）"
		fi
	fi
	# 學習資料放 Flash（rwfs、jffs2）而且已經有資料：放記憶體時代的每日備份用不到了，
	# 卻佔掉 Storage 分割區（512 KB）的大半，再大就整個 /etc/storage 都存不進去。這次開機剛匯入的話下次再刪
	if [ "$mode" != ram ] && [ -f "$BACKUP" ] && [ ! -f "$RUN/imported" ] && [ -n "$(ls -A "$sdir" 2>/dev/null)" ]; then
		rm -f "$BACKUP"
		log "學習資料已經在 Flash 資料區，刪除用不到的記憶體模式備份（/etc/storage/kuroshio/backup.kuroshio）"
	fi
	storage_save

	: > "$RUN/enabled"
	echo "$KUROSHIO_LOG" > "$RUN/log_level"	# 環境變數：改了要重新啟動（reload 看這個）
	run_loop &
	echo $! > "$RUN/loop.pid"
	"$0" guard &
	echo $! > "$RUN/guard.pid"
	log "啟動（學習資料：$sdir）"
}

stop() {
	local i p
	rm -f "$RUN/enabled" "$RUN/reloading"
	for f in guard loop; do
		[ -f "$RUN/$f.pid" ] && kill "$(cat "$RUN/$f.pid")" 2>/dev/null
		rm -f "$RUN/$f.pid"
	done
	use_servers fallback
	# SIGTERM：黑潮 DNS 會先把快照寫出再結束（3.3.2 起日誌記「關機前寫出 N 份快照，X KB，Y ms」）。
	# 只送給服務本體（每日匯出等指令讓它跑完）；最多等 30 秒，結束了就不等
	p=$(main_pid) && kill -TERM "$p" 2>/dev/null
	i=0
	while main_pid >/dev/null && [ $i -lt 30 ]; do
		sleep 1
		i=$((i + 1))
	done
	p=$(main_pid) && { kill -KILL "$p" 2>/dev/null; log "黑潮 DNS 30 秒內沒有結束，已強制停止"; }
	sync
	# 學習資料放記憶體：備份寫進 /etc/storage 之後也要存進 Flash，不然之後斷電就回到上一份每日備份。
	# 同步執行（重開機時 rc 接著也會存 /etc/storage，兩個 mtd_storage.sh 不能同時跑），先等背景的存檔做完
	if [ "$(cat "$RUN/mode" 2>/dev/null)" = ram ]; then
		if save_backup; then
			i=0
			while [ -d "$RUN/storage.lock" ] && [ $i -lt 15 ]; do sleep 1; i=$((i + 1)); done
			/sbin/mtd_storage.sh save >/dev/null 2>&1 || log "學習資料備份存進 Flash 失敗"
		else
			log "學習資料備份失敗（沿用上一份）"
		fi
	fi
	log "已停止"
}

# kuro_ver_ge <主> <次> <修訂>：黑潮 DNS 的版本（kuroshio --version 的「kuroshio X.Y.Z」）大於等於指定版本
kuro_ver_ge() {
	$BIN --version 2>/dev/null | awk -v a="$1" -v b="$2" -v c="$3" 'NR == 1 {
		split($2, v, "."); x = v[1] + 0; y = v[2] + 0; z = v[3] + 0
		exit !(x > a || (x == a && (y > b || (y == b && z >= c))))
	}'
}

# 這一輪啟動以來的秒數（kuroshio status --json 的 uptimeSec；重新載入設定會歸零）
gen_uptime() {
	probe status --json 2>/dev/null | tr -d '\n' | sed -n 's/.*"uptimeSec"[ ]*:[ ]*\([0-9][0-9]*\).*/\1/p'
}

# 後台改了設定：rc 的 restart_kuroshio 先呼叫這裡。只動 UCI 的設定用 SIGHUP 在同一個行程裡重新載入
# （3.3.1 起 UCI 模式新設定有錯也不會結束，用上一份設定繼續跑），不必停掉、不會有改用業者 DNS 的空檔。
# 結束碼 0＝已經套用；1＝要完整重新啟動（rc 接著 stop、start）
reload() {
	local p mode u0 u i st seen settle
	[ "$(nv kuroshio_enable)" = "1" ] || return 1
	[ -f "$RUN/enabled" ] || return 1
	p=$(main_pid) || return 1
	mode=$(cat "$RUN/mode" 2>/dev/null)
	[ -n "$mode" ] || return 1
	# 環境變數（日誌等級）只在啟動時讀
	[ "$(cat "$RUN/log_level" 2>/dev/null)" = "$KUROSHIO_LOG" ] || return 1
	u0=$(gen_uptime)
	[ -n "$u0" ] || return 1
	# 剛啟動不到 3 秒：等一下，新的一輪歸零後才分得出來
	if [ "$u0" -lt 3 ]; then
		sleep 3
		u0=$(gen_uptime)
		[ -n "$u0" ] || return 1
	fi
	date +%s > "$RUN/reloading"
	sync_uci "$mode"
	if ! kill -HUP "$p" 2>/dev/null; then
		rm -f "$RUN/reloading"
		return 1
	fi
	# 等新的一輪穩定：uptimeSec 歸零之後，跑滿 settle 秒而且 health 有回答（最多 90 秒）。
	# D3 實測：3.3.2 新的一輪第 1 秒就會回答，接著約 4 秒忙著載入（過濾清單、CDN 資料庫）不回答，
	# 太早拿掉 reloading 標記的話，保護程式會以為沒回應、改用業者 DNS → 等 8 秒。
	# 3.3.3 起載入改在背景執行緒，只剩換監聽的約 0.1 秒（SIGHUP 後 0.2～0.4 秒）→ 等 2 秒
	settle=8; gap="約有幾秒不回答"
	kuro_ver_ge 3 3 3 && { settle=2; gap="不回答的時間不到 1 秒"; }
	i=0; seen=""
	while [ $i -lt 90 ]; do
		sleep 1
		i=$((i + 1))
		u=$(gen_uptime)
		[ -n "$u" ] || continue
		[ -n "$seen" ] || { [ "$u" -lt "$u0" ] && seen=1; }
		[ -n "$seen" ] && [ "$u" -ge "$settle" ] && alive && break
	done
	rm -f "$RUN/reloading"
	st=$(curl -s -m 5 "http://127.0.0.1:$(api_port)/api/status" 2>/dev/null | tr -d ' \n')
	case "$st" in
	*'"usingPrevious":true'*) log "新設定無法套用，黑潮 DNS 繼續用上一份設定（原因在後台黑潮 DNS 的狀態頁）" ;;
	*) [ $i -lt 90 ] && log "設定已重新載入（沒有改用業者 DNS；換上新設定時$gap）" || log "送出重新載入後 90 秒還沒換上新設定，請看黑潮 DNS 的紀錄" ;;
	esac
	dnsmasq_extra	# 網域改了：區網解析與 DHCP 選項 162 跟著更新
	return 0
}

# ---------- 保護 ----------

guard() {
	local state="" fails=0 tick=0 day today hm
	trap 'exit 0' TERM INT
	sleep 2
	dnsmasq_extra
	while [ -f "$RUN/enabled" ]; do
		if ! main_pid >/dev/null; then
			fails=3
		elif [ $(( $(date +%s) - $(cat "$RUN/reloading" 2>/dev/null || echo 0) )) -lt 120 ]; then
			:	# 正在重新載入設定（幾秒內換新的一輪監聽）：不算沒回應，不必改用業者 DNS（最多 2 分鐘）
		elif [ $((tick % 10)) -eq 0 ] || [ "$state" != kuroshio ] || [ $fails -gt 0 ]; then
			# 平常每 10 秒問一次；沒回答過一次就每秒問，約 5 秒內決定要不要改用業者 DNS
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
	domain=$(kuro_domain)
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

# 給後台（kuroshio_api.cgi 的 op=acme-log）：{"ok":true,"running":是否申請中,"log":"最後 100 行"}；保留換行
acme_log_json() {
	local run=false
	[ -f "$RUN/acme.pid" ] && kill -0 "$(cat "$RUN/acme.pid")" 2>/dev/null && run=true
	printf '{"ok":true,"running":%s,"log":"' "$run"
	tail -n 100 "$RUN/acme.log" 2>/dev/null | awk '{
		gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, " "); gsub(/\r/, ""); gsub(/[\001-\037\177]/, " ")
		printf "%s%s", (NR > 1 ? "\\n" : ""), $0 }'
	printf '"}'
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

# ---------- 整合指令與後台轉接 ----------

running() { main_pid >/dev/null; }

notify() {
	case "$1" in
	wan-changed|trim) ;;
	*) echo "用法：$0 notify wan-changed | trim [秒]"; return 2 ;;
	esac
	running || return 0
	if [ "$1" = trim ]; then
		# 3.3.0：立刻縮小快取、把 CDN 冷資料移出記憶體，並在幾分鐘內不再長大（預設 300 秒）
		case "$2" in ''|*[!0-9]*) set -- trim 300 ;; esac
		$BIN notify trim --hold "$2" --uci >/dev/null 2>&1 && log "已先讓出記憶體（$2 秒內不長大）"
		return 0
	fi
	# 3.3.6 起 wan-changed 也會重新做路徑檢查（一般 DNS 是否被接走、協定被擋、IPv6）
	$BIN notify "$1" --uci >/dev/null 2>&1 && log "WAN 變動：已通知黑潮（DDNS、對外 IP、路徑檢查）"
}

# 立即把學習資料寫出：3.2.0 起有 kuroshio notify save；舊版或失敗時送 SIGUSR1（效果相同）
flush() {
	running || return 0
	$BIN notify save --uci >/dev/null 2>&1 || { p=$(main_pid) && kill -USR1 "$p"; }
}

# 管理 API 的埠號（只接受數字，才不會被設定值帶到別台主機）
api_port() {
	local p
	p=$(awk '$1 == "option" && $2 == "admin_port" { gsub(/\047|"/, "", $3); print $3; exit }' "$UCI" 2>/dev/null)
	case "$p" in ''|*[!0-9]*) p=8054 ;; esac
	echo "$p"
}

# 參數只能用網址查詢字串會用到的字元（不能有引號、空白、分號…）
valid_query() { case "$1" in *[!A-Za-z0-9._=\&%:,~-]*) return 1 ;; esac; return 0; }

# api_fetch <路徑> [參數] [post]：輸出 {"ok":true,"result":…} 或 {"ok":false,"error":…}
# 會改變狀態的動作用 POST（管理 API 不接受用 GET 做這些事）
# 不用 curl -f：管理 API 的 4xx／5xx 會帶 {"error":"原因"}（例如「DDNS 未啟用」），要轉給後台看
api_fetch() {
	local url out rc code body err
	url="http://127.0.0.1:$(api_port)$1"
	[ -n "$2" ] && url="$url?$2"
	# 最後一行是 HTTP 狀態碼（curl 的 -w），前面是回應內容
	if [ "$3" = post ]; then
		out=$(curl -sS -m 60 -w '\n%{http_code}' -X POST -H 'Content-Type: application/x-www-form-urlencoded' --data "${2:-_}" "$url" 2>/dev/null)
	elif [ -n "$4" ]; then
		# 上傳檔案（原始內容，不是表單）：學習資料備份匯入
		out=$(curl -sS -m 120 -w '\n%{http_code}' -X POST -H 'Content-Type: application/octet-stream' --data-binary "@$4" "$url" 2>/dev/null)
	else
		out=$(curl -sS -m 60 -w '\n%{http_code}' "$url" 2>/dev/null)
	fi
	rc=$?
	code=$(printf '%s' "$out" | tail -n 1)
	body=$(printf '%s' "$out" | sed '$d')
	case "$code" in
	2??)
		case "$body" in
		'{'*|'['*) printf '{"ok":true,"result":%s}' "$body"; return 0 ;;
		esac ;;
	[45]??)
		err=$(printf '%s' "$body" | tr -d '\n' | sed -n 's/.*"error"[ ]*:[ ]*"\([^"]*\)".*/\1/p')
		printf '{"ok":false,"status":%s,"error":%s}' "$code" "$(json_str "${err:-黑潮 DNS 回應錯誤（HTTP $code）}")"
		return 0 ;;
	esac
	if ! running; then echo '{"ok":false,"error":"黑潮 DNS 沒有執行"}'
	elif [ "$rc" = 28 ]; then echo '{"ok":false,"error":"黑潮 DNS 沒有在 60 秒內回應（可能還在處理）"}'
	else echo '{"ok":false,"error":"黑潮 DNS 沒有回應"}'; fi
}

# 白名單跟 OpenWrt 版（openwrt/kuroshio/files/rpcd.sh）相同
api_view() {
	case "$1" in
	/api/status|/api/access|/api/sysinfo|/api/upstreams|/api/benchmark|/api/cdn/pools|/api/cdn/v6nodes|/api/cdn/summary|/api/cdn/domains|/api/jobs|/api/trace|/api/filter/check|/api/routing|/api/ddns|/api/paths|/api/interfaces) ;;
	/api/dashboard|/api/backup/last-import) ;;
	/api/community/status|/api/community/peers|/api/community/events|/api/community/invite) ;;
	*) echo '{"ok":false,"error":"不允許的路徑"}'; return 0 ;;
	esac
	valid_query "$2" || { echo '{"ok":false,"error":"參數格式錯誤"}'; return 0; }
	# 網域清單一次最多 2000 筆（黑潮允許到 20 萬筆，整份 JSON 會在 shell 裡複製好幾份）
	if [ "$1" = /api/cdn/domains ]; then
		# （busybox awk 會把「s (」當成呼叫函式，所以分隔字元另外放一個變數）
		set -- "$1" "$(printf '%s\n' "$2" | awk -F'&' '{
			s = ""; f = 0
			for (i = 1; i <= NF; i++) {
				if ($i == "") continue
				if ($i ~ /^limit=/) { n = substr($i, 7) + 0; if (n < 1 || n > 2000) n = 2000; $i = "limit=" n; f = 1 }
				sep = (s == "") ? "" : "&"; s = s sep $i
			}
			if (!f) { sep = (s == "") ? "" : "&"; s = s sep "limit=2000" }
			print s }')"
	fi
	api_fetch "$1" "$2"
}

api_action() {
	case "$1" in
	/api/cache/flush|/api/filter/update|/api/jobs/run|/api/cdn/verify|/api/cdn/policy|/api/cdn/ecs|/api/ddns/update) ;;
	/api/filter/reset-rules|/api/persist/flush) ;;
	/api/community/check|/api/community/add|/api/community/accept|/api/community/reject|/api/community/block|/api/community/unblock|/api/community/delete|/api/community/sync) ;;
	/api/community/invite/refresh|/api/community/invite/use) ;;
	/api/community/rotate|/api/community/accept-key|/api/community/channel) ;;
	*) echo '{"ok":false,"error":"不允許的路徑"}'; return 0 ;;
	esac
	valid_query "$2" || { echo '{"ok":false,"error":"參數格式錯誤"}'; return 0; }
	# 動作寫了設定目錄（恢復預設自訂規則、社群金鑰與邀請等）時，黑潮 DNS 自己會呼叫 storage-save
	# （KUROSHIO_ON_CONFIG_WRITE；3.3.2 起連社群模組的寫入也算），這裡不用每個動作都存一次
	api_fetch "$1" "$2" post
}

# 後台上傳的學習資料備份（httpd 的 kuroshio_import.cgi 收下、檢查過是 zstd 檔）：交給黑潮 DNS 的
# /api/backup/import。黑潮會先檢查內容、存成待匯入，接著重新載入時合併（結果在 /api/backup/last-import）
import_upload() {
	local f="$RUN/import.kuroshio"
	[ -s "$f" ] || { echo '{"ok":false,"error":"沒有收到檔案"}'; return 0; }
	running || { rm -f "$f"; echo '{"ok":false,"error":"黑潮 DNS 沒有執行，請先啟用"}'; return 0; }
	api_fetch /api/backup/import '' '' "$f"
	rm -f "$f"
}

# 是 JSON 物件就原樣輸出，否則輸出錯誤
json_or() { case "$1" in '{'*) printf '%s' "$1" ;; *) printf '{"ok":false,"error":"%s"}' "$2" ;; esac; }

# 字串轉成 JSON 字串（含引號；換行、Tab 換成空白）
json_str() { printf '"%s"' "$(printf '%s' "$1" | tr '\t\n\r' '   ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"; }

# 給後台：Padavan 這邊的狀態＋黑潮 DNS 的 status --json
status_json() {
	local core en
	en=false; [ "$(nv kuroshio_enable)" = "1" ] && en=true
	core=$(probe status --json 2>/dev/null)
	case "$core" in '{'*) ;; *) core='{"running":false}' ;; esac
	printf '{"enabled":%s,"running":%s,"use":%s,"mode":%s,"area_note":%s,"version":%s,"core":%s}' \
		"$en" "$(running && echo true || echo false)" \
		"$(json_str "$(cat "$USE" 2>/dev/null)")" "$(json_str "$(cat "$RUN/mode" 2>/dev/null)")" \
		"$(json_str "$(cat "$RUN/area_note" 2>/dev/null)")" \
		"$(json_str "$($BIN --version 2>/dev/null | head -n 1)")" "$core"
}

# 最近的執行紀錄（syslog 裡黑潮 DNS 的部分）
log_json() {
	local n="${1:-200}"
	case "$n" in ''|*[!0-9]*) n=200 ;; esac
	grep "$TAG" /tmp/syslog.log 2>/dev/null | tail -n "$n" | awk '
		BEGIN { printf "{\"ok\":true,\"lines\":[" }
		{ gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, " "); gsub(/\r/, ""); gsub(/[\001-\037\177]/, " ")
		  printf "%s\"%s\"", (NR > 1 ? "," : ""), $0 }
		END { printf "]}" }'
}

# 匯出學習資料到 $RUN/export.kuroshio（後台再下載）；share＝分享檔（不含私鑰與自己的網域）
backup_export() {
	local out="$RUN/export.kuroshio" tmp msg
	mkdir -p "$RUN"
	rm -f "$out"
	tmp="$out.tmp"
	if [ "$1" = share ]; then set -- --share; else set --; fi
	if msg=$(umask 077; $BIN export --uci "$@" -o "$tmp" 2>&1) && [ -s "$tmp" ]; then
		mv -f "$tmp" "$out"
		printf '{"ok":true,"size":%s}' "$(wc -c < "$out" | tr -d ' ')"
	else
		rm -f "$tmp"
		printf '{"ok":false,"error":%s}' "$(json_str "${msg:-匯出失敗}")"
	fi
}

status() {
	echo "狀態：$(main_pid >/dev/null && echo 執行中 || echo 沒有執行)"
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
reload) reload ;;
guard) guard ;;
save) save ;;
storage-save) storage_save ;;
acme) shift; acme "$@" ;;
acme-bg) shift; acme_bg "$@" ;;
acme-log) cat "$RUN/acme.log" 2>/dev/null; [ -f "$RUN/acme.pid" ] && echo "（申請中…）" ;;
acme-log-json) acme_log_json ;;
certsync) certsync ;;
status) status ;;
notify) shift; notify "$@" ;;
flush) flush ;;
api) api_view "$2" "$3" ;;
action) api_action "$2" "$3" ;;
status-json) status_json ;;
defaults) json_or "$($BIN defaults --json 2>/dev/null)" "讀不到預設值" ;;
about) json_or "$($BIN about --uci --qr 2>/dev/null)" "讀不到版本資訊" ;;
dnr) json_or "$($BIN dnr --uci --lan "$(lan_ip)" 2>/dev/null)" "黑潮 DNS 沒有回應" ;;
log) log_json "$2" ;;
backup-export) backup_export "$2" ;;
import-upload) import_upload ;;
*) echo "用法：$0 start | stop | restart | reload | status | acme [force] | save | storage-save | notify wan-changed | notify trim [秒] | flush" ;;
esac
