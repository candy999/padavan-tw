#!/bin/sh
# tw-wifi-acs 離線測試（ROADMAP I13：5 GHz 鄰頻檢查）
#
# 用假的 nvram／ip／iwconfig／iwpriv／logger／radio*_restart／sleep／dmesg（stub/）執行真正的
# trunk/user/scripts/files/usr/bin/tw-wifi-acs now，餵 cases/*.case 的掃描表，檢查最後的 5 GHz 頻道。
# awk 一律用 gawk --posix，抓出 busybox awk 可能不支援的 GNU 擴充。
#
# 用法（Git Bash）：sh tools/acs-test/run.sh [案例檔…]
#   SHELLS="dash sh" 指定用哪些 shell 跑腳本（預設：有 dash 就用 dash 和 sh）
#   VERBOSE=1 顯示每個案例的 iwpriv 呼叫

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
script="$root/trunk/user/scripts/files/usr/bin/tw-wifi-acs"
stub="$here/stub"
chmod +x "$stub"/* 2>/dev/null	# 從 Windows 取出的檔案可能沒有執行權限

if [ -z "$SHELLS" ]; then
	SHELLS="sh"
	command -v dash >/dev/null 2>&1 && SHELLS="dash sh"
fi
[ $# -gt 0 ] || set -- "$here"/cases/*.case

pass=0
fail=0
for sh in $SHELLS; do
	echo "=== 用 $sh 執行 ==="
	for c in "$@"; do
		# 每個案例在子 shell 裡跑，變數互不影響
		(
			DESC= BW=2 PICK5=149 OLD5= EXPECT5= ADJ= COUNTRY=TW REGION_OK=1 REGION_RESTORE_FAIL=
			SURVEY_FAIL= SCAN= DMESG= EXPECT_LOG= EXPECT_NOLOG= EXPECT_NOSCAN= EXPECT_NOREGION=
			. "$c"
			# 2026-11-23 起不重新啟動 Wi-Fi：PICK5 當作「目前的頻道」（重啟的退路才會用到驅動重選）
			[ -n "$OLD5" ] || OLD5=$PICK5
			ACS_T=$(mktemp -d)
			trap 'rm -rf "$ACS_T"' EXIT
			export ACS_T PICK5 SCAN DMESG REGION_OK REGION_RESTORE_FAIL SURVEY_FAIL
			for i in ra0 ra1 rai0 rai1; do
				mkdir -p "$ACS_T/sys/$i/statistics"
				echo 0 > "$ACS_T/sys/$i/statistics/rx_bytes"
				echo 0 > "$ACS_T/sys/$i/statistics/tx_bytes"
			done
			cat > "$ACS_T/nvram" <<-EOF
			rt_channel=0
			rt_mode_x=0
			rt_radio_x=1
			rt_HT_BW=0
			wl_channel=0
			wl_mode_x=0
			wl_radio_x=1
			wl_HT_BW=$BW
			wl_country_code=$COUNTRY
			tw_acs_adj=$ADJ
			EOF
			echo 6 > "$ACS_T/ch.ra0"
			echo "$OLD5" > "$ACS_T/ch.rai0"
			: > "$ACS_T/log"
			: > "$ACS_T/calls"

			PATH="$stub:$PATH" TW_SYS="$ACS_T/sys" TW_LOCK="$ACS_T/lock" TW_TMP="$ACS_T" \
				$sh "$script" now > "$ACS_T/out" 2>&1
			rc=$?

			got=$(cat "$ACS_T/ch.rai0")
			bad=""
			[ $rc = 0 ] || bad="$bad 結束碼 $rc；"
			[ "$got" = "$EXPECT5" ] || bad="$bad 頻道 $got（應為 $EXPECT5）；"
			[ -n "$EXPECT_LOG" ] && ! grep -q "$EXPECT_LOG" "$ACS_T/log" && bad="$bad 紀錄沒有「$EXPECT_LOG」；"
			[ -n "$EXPECT_NOLOG" ] && grep -q "$EXPECT_NOLOG" "$ACS_T/log" && bad="$bad 紀錄不該有「$EXPECT_NOLOG」；"
			[ -n "$EXPECT_NOSCAN" ] && grep -q SiteSurvey "$ACS_T/calls" && bad="$bad 不該掃描；"
			[ -n "$EXPECT_NOREGION" ] && grep -q CountryRegionABand "$ACS_T/calls" && bad="$bad 不該換頻道表；"
			# 安全檢查：頻道表最後一定回到 0（或已重啟 5 GHz）、不會設到 36–48／149–165 以外的頻道
			reg=$(cat "$ACS_T/region" 2>/dev/null)
			[ -z "$reg" ] || [ "$reg" = 0 ] || bad="$bad 頻道表停在 $reg；"
			for x in $(sed -n 's/.* set Channel=//p' "$ACS_T/calls"); do
				case " 36 40 44 48 149 153 157 161 165 " in
				*" $x "*) ;;
				*) bad="$bad 設了不允許的頻道 $x；" ;;
				esac
			done
			[ -s "$ACS_T/out" ] && bad="$bad 有多餘輸出：$(head -n 3 "$ACS_T/out")；"

			if [ -z "$bad" ]; then
				echo "通過 $(basename "$c")：$DESC"
			else
				echo "失敗 $(basename "$c")：$DESC"
				echo "      $bad"
			fi
			echo "      驅動選 $PICK5 → 最後 $got"
			sed 's/^/      紀錄：/' "$ACS_T/log"
			[ -n "$VERBOSE" ] && sed 's/^/      呼叫：/' "$ACS_T/calls"
			[ -z "$bad" ]
		) && pass=$((pass + 1)) || fail=$((fail + 1))
	done
done
echo "=== 通過 $pass，失敗 $fail ==="
[ $fail = 0 ]
