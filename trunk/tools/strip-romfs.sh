#!/bin/sh

# check env
if [ -z "$ROMFSDIR" ]; then
	echo "ROMFSDIR is not set" >&2
	exit 1
fi

if [ -z "$ROOTDIR" ]; then
	echo "ROOTDIR is not set" >&2
	exit 1
fi

if [ ! -x "$(command -v $STRIPTOOL)" ] ; then
	echo "STRIPTOOL is not set" >&2
	exit 1
fi

if [ ! -x "$(command -v $OBJCOPY)" ] ; then
	echo "OBJCOPY is not set" >&2
	exit 1
fi

echo "\033[32m======================>>> STRIP ROMFS <<<======================\033[0m"
find ${ROMFSDIR} -type f -a -exec file {} \; | \
  sed -n -e 's/^\(.*\):.*ELF.*\(executable\|relocatable\|shared object\).*,.*/\1:\2/p' | \
(
  IFS=":"
  while read F S; do
    # padavan-tw：黑潮 DNS 用官方 Release 的執行檔（已經 strip 過），原樣保留，
    # /proc/<pid>/exe 的雜湊才會跟 Release 的 SHA256SUMS 一樣（再 strip 一次大小不變，只是重排區段標頭）
    case "$F" in */usr/bin/kuroshio) echo "$F: 原樣保留（官方 Release 執行檔）"; continue ;; esac
    echo "$F: $S"
	${OBJCOPY} --strip-debug --strip-unneeded $F $F
	if [ "${S}" = "relocatable" ]; then
		${STRIPTOOL} -x \
			--strip-debug \
			--strip-unneeded \
			-R .comment \
			-R .pdr \
			-R .mdebug.abi32 \
			-R .gnu.attributes \
			-R .reginfo \
			-R .MIPS.abiflags \
			-R .note.GNU-stack \
			-R .note.gnu.build-id \
			$F
	else
		${STRIPTOOL} $F
		[ -x "${SSTRIP_TOOL}" ] && ${SSTRIP_TOOL} $F
	fi
  done
  true
)
sync
echo "\033[32m======================>>> ROMFS STRIP OK <<<======================\033[0m"
