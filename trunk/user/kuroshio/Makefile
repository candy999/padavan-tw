# padavan-tw：黑潮 DNS（https://github.com/candy999/kuroshio-dns，GPL-3.0-or-later）
#
# - 執行檔＋唯讀資料 data/：官方 Release 的「Linux 通用包」kuroshio-linux-mipsel-unknown-linux-musl.tar.gz
#   （同一版打包在一起，不會版本不一致；data/manifest.json 標示版本），核對 SHA256
# - 預設 UCI 設定：同一個標籤 commit 的 openwrt/kuroshio/files/kuroshio.config，核對 SHA256
# - 憑證：acme.sh（Cloudflare DNS 驗證），核對 SHA256
# 升級時改 KUROSHIO_VER、KUROSHIO_COMMIT 與兩個 SHA256（Release 的 SHA256SUMS）

KUROSHIO_VER	:= v3.1.0
KUROSHIO_COMMIT	:= ca3a0e64ba24fe38d743da388bfbb637fd270ec7
KUROSHIO_PKG_SHA256	:= 4d6f8c4e66eb02d893d1c668bffc5b585be5a0fd3f3709e23e256e7d2b8bd7eb
KUROSHIO_UCI_SHA256	:= f0cbe30c3856635eb6a28621ee3d84b88fa9a9b5fe38d07ddaa1ef310b6df66e
KUROSHIO_REPO	:= https://github.com/candy999/kuroshio-dns
KUROSHIO_RAW	:= https://raw.githubusercontent.com/candy999/kuroshio-dns/$(KUROSHIO_COMMIT)

ACME_VER	:= 3.1.1
ACME_BASE	:= https://raw.githubusercontent.com/acmesh-official/acme.sh/$(ACME_VER)
ACME_SHA256	:= e80e3e6d66ab02f7b448c55129c70ec57089a286d7df95282a68d607b4df7ed7
DNSCF_SHA256	:= 741f2c740ca258471f2dbec7233a9177ed879bd640353acbefe87a2d63193292
ACMELIC_SHA256	:= 3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986

# acme.sh 用 curl 連 Let's Encrypt 與 Cloudflare 時要驗證憑證；韌體沒有內建 CA 清單，帶一份 Mozilla 的
# （黑潮 DNS 自己的 TLS 用內建根憑證，不需要這份）
CACERT_URL	:= https://curl.se/ca/cacert-2025-12-02.pem
CACERT_SHA256	:= f1407d974c5ed87d544bd931a278232e13925177e239fca370619aba63c757b4

THISDIR		:= $(shell pwd)

all: dl/.ok

# fetch <網址> <檔案> <SHA256>
define fetch
	curl -fsSL --retry 3 --connect-timeout 20 -o "$(2)" "$(1)"
	echo "$(3)  $(2)" | sha256sum -c -
endef

dl/.ok:
	rm -rf ./dl
	mkdir -p dl/acme/dnsapi
	$(call fetch,$(KUROSHIO_REPO)/releases/download/$(KUROSHIO_VER)/kuroshio-linux-mipsel-unknown-linux-musl.tar.gz,dl/kuroshio.tar.gz,$(KUROSHIO_PKG_SHA256))
	tar -xzf dl/kuroshio.tar.gz -C dl
	test -x dl/kuroshio/kuroshio
	grep -q '"version": *"$(patsubst v%,%,$(KUROSHIO_VER))"' dl/kuroshio/data/manifest.json
	$(call fetch,$(KUROSHIO_RAW)/openwrt/kuroshio/files/kuroshio.config,dl/kuroshio.uci.default,$(KUROSHIO_UCI_SHA256))
	$(call fetch,$(ACME_BASE)/acme.sh,dl/acme/acme.sh,$(ACME_SHA256))
	$(call fetch,$(ACME_BASE)/dnsapi/dns_cf.sh,dl/acme/dnsapi/dns_cf.sh,$(DNSCF_SHA256))
	$(call fetch,$(ACME_BASE)/LICENSE.md,dl/acme/LICENSE.md,$(ACMELIC_SHA256))
	$(call fetch,$(CACERT_URL),dl/acme/cacert.pem,$(CACERT_SHA256))
	echo "$(KUROSHIO_VER)" > dl/.ok

clean:
	rm -rf ./dl

romfs:
	$(ROMFSINST) -S -p +x $(THISDIR)/dl/kuroshio/kuroshio /usr/bin/kuroshio
	mkdir -p $(ROMFSDIR)/usr/share/kuroshio
	cp -a $(THISDIR)/dl/kuroshio/data/. $(ROMFSDIR)/usr/share/kuroshio/
	$(ROMFSINST) -d -p 644 $(THISDIR)/dl/kuroshio/LICENSE /usr/share/kuroshio/LICENSE
	$(ROMFSINST) -p 644 $(THISDIR)/dl/kuroshio.uci.default /usr/share/kuroshio/kuroshio.uci.default
	$(ROMFSINST) -d -p +x $(THISDIR)/dl/acme/acme.sh /usr/lib/acme/acme.sh
	$(ROMFSINST) -d -p +x $(THISDIR)/dl/acme/dnsapi/dns_cf.sh /usr/lib/acme/dnsapi/dns_cf.sh
	$(ROMFSINST) -p 644 $(THISDIR)/dl/acme/LICENSE.md /usr/lib/acme/LICENSE.md
	$(ROMFSINST) -p 644 $(THISDIR)/dl/acme/cacert.pem /usr/lib/acme/cacert.pem
	$(ROMFSINST) -p +x $(THISDIR)/kuroshio.sh /usr/bin/kuroshio.sh
