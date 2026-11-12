#!/bin/sh
# WireGuard：用戶端（wg0，上游原本的功能）與 padavan-tw 的伺服器（wg1，外出連回家）
#
#   wireguard.sh start | stop | restart
#   wireguard.sh status        顯示伺服器與每台裝置最後連線時間、流量

WGS_IF=wg1
WGS_CONF=/tmp/wg-server.conf
TAG="WireGuard"

log() { logger -t "$TAG" "$*"; }

# ---------- 用戶端（上游） ----------

start_client() {
	[ "$(nvram get wireguard_enable)" = "1" ] || return 0
	localip="$(nvram get wireguard_localip)"
	privatekey="$(nvram get wireguard_localkey)"
	peerkey="$(nvram get wireguard_peerkey)"
	peerip="$(nvram get wireguard_peerip)"
	log "啟動用戶端"
	ip link del dev wg0 2>/dev/null
	ip link add dev wg0 type wireguard || return 1
	ip link set dev wg0 mtu 1420
	ip addr add "$localip" dev wg0
	umask 077
	echo "$privatekey" > /tmp/wg-client.key
	wg set wg0 private-key /tmp/wg-client.key
	rm -f /tmp/wg-client.key
	wg set wg0 peer "$peerkey" persistent-keepalive 25 allowed-ips 0.0.0.0/0 endpoint "$peerip"
	iptables -t nat -C POSTROUTING -o wg0 -j MASQUERADE 2>/dev/null || \
		iptables -t nat -A POSTROUTING -o wg0 -j MASQUERADE
	ip link set dev wg0 up
}

stop_client() {
	ip link show wg0 >/dev/null 2>&1 || return 0
	iptables -t nat -D POSTROUTING -o wg0 -j MASQUERADE 2>/dev/null
	ip link del dev wg0
	log "關閉用戶端"
}

# ---------- 伺服器（padavan-tw） ----------

# 第一次啟用時產生伺服器金鑰；私鑰只存在路由器的 nvram，網頁只看得到公鑰
ensure_server_key() {
	priv="$(nvram get wgs_privkey)"
	if [ -z "$priv" ]; then
		priv="$(wg genkey)" || return 1
		nvram set wgs_privkey="$priv"
		nvram set wgs_pubkey="$(echo "$priv" | wg pubkey)"
		nvram commit
		log "已產生伺服器金鑰"
	elif [ -z "$(nvram get wgs_pubkey)" ]; then
		nvram set wgs_pubkey="$(echo "$priv" | wg pubkey)"
	fi
}

write_server_conf() {
	port="$(nvram get wgs_port)"
	case "$port" in ''|*[!0-9]*) port=51820 ;; esac
	net3="${addr%.*}"
	num="$(nvram get wgs_num_x)"
	case "$num" in ''|*[!0-9]*) num=0 ;; esac

	umask 077
	{
		echo "[Interface]"
		echo "PrivateKey = $(nvram get wgs_privkey)"
		echo "ListenPort = $port"
		i=0
		n=0
		while [ $i -lt "$num" ]; do
			pub="$(nvram get wgs_pub_x$i)"
			psk="$(nvram get wgs_psk_x$i)"
			host="$(nvram get wgs_ip_x$i)"
			i=$((i + 1))
			case "$host" in ''|*[!0-9]*) continue ;; esac
			[ -n "$pub" ] || continue
			echo ""
			echo "# $(nvram get wgs_name_x$((i - 1)))"
			echo "[Peer]"
			echo "PublicKey = $pub"
			[ -n "$psk" ] && echo "PresharedKey = $psk"
			echo "AllowedIPs = $net3.$host/32"
			n=$((n + 1))
		done
	} > "$WGS_CONF"
	peers=$n
}

start_server() {
	[ "$(nvram get wgs_enable)" = "1" ] || return 0
	addr="$(nvram get wgs_addr)"
	[ -n "$addr" ] || addr=10.66.0.1
	ensure_server_key || { log "產生金鑰失敗，伺服器沒有啟動"; return 1; }
	write_server_conf

	ip link del dev $WGS_IF 2>/dev/null
	ip link add dev $WGS_IF type wireguard || { log "無法建立 $WGS_IF（核心沒有 WireGuard？）"; return 1; }
	if ! wg setconf $WGS_IF "$WGS_CONF"; then
		log "設定檔有誤，伺服器沒有啟動"
		ip link del dev $WGS_IF
		return 1
	fi
	rm -f "$WGS_CONF"
	ip addr add "$addr/24" dev $WGS_IF
	ip link set dev $WGS_IF mtu 1420
	ip link set dev $WGS_IF up
	log "伺服器已啟動：UDP $port，VPN 網段 ${addr%.*}.0/24，$peers 台裝置"
}

stop_server() {
	ip link show $WGS_IF >/dev/null 2>&1 || return 0
	ip link del dev $WGS_IF
	rm -f "$WGS_CONF"
	log "伺服器已關閉"
}

status() {
	if ! ip link show $WGS_IF >/dev/null 2>&1; then
		echo "伺服器沒有執行"
		return
	fi
	now=$(date +%s)
	num="$(nvram get wgs_num_x)"
	case "$num" in ''|*[!0-9]*) num=0 ;; esac
	echo "伺服器：UDP $(nvram get wgs_port)，公鑰 $(nvram get wgs_pubkey)"
	wg show $WGS_IF dump | awk -F '\t' 'NR > 1 { print $1, $3, $5, $6, $7 }' | \
	while read pub endpoint hs rx tx; do
		name="?"
		i=0
		while [ $i -lt "$num" ]; do
			[ "$(nvram get wgs_pub_x$i)" = "$pub" ] && { name="$(nvram get wgs_name_x$i)"; break; }
			i=$((i + 1))
		done
		if [ "$hs" = "0" ]; then
			last="從未連線"
		else
			last="$((now - hs)) 秒前"
		fi
		echo "  $name：最後連線 $last，來源 $endpoint，收 $rx／送 $tx 位元組"
	done
}

case "$1" in
start)
	start_client
	start_server
	;;
stop)
	stop_server
	stop_client
	;;
restart)
	stop_server
	stop_client
	start_client
	start_server
	;;
status)
	status
	;;
*)
	echo "用法：$0 start | stop | restart | status"
	;;
esac
