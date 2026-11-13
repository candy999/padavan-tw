# padavan-tw：黑潮 DNS（https://github.com/candy999/kuroshio-dns，GPL-3.0-or-later）
#
# - 執行檔＋唯讀資料 data/：官方 Release 的「Linux 通用包」kuroshio-linux-mipsel-unknown-linux-musl.tar.gz
#   （同一版打包在一起，不會版本不一致；data/manifest.json 標示版本），核對 SHA256
# - 預設 UCI 設定：同一個標籤 commit 的 openwrt/kuroshio/files/kuroshio.config，核對 SHA256
# - 憑證：acme.sh（Cloudflare DNS 驗證），核對 SHA256
# 升級時改 KUROSHIO_VER、KUROSHIO_COMMIT 與兩個 SHA256（Release 的 SHA256SUMS）

KUROSHIO_VER	:= v3.2.0
KUROSHIO_COMMIT	:= 9d3097870af49d53689b4beb3a86e095454c991f
KUROSHIO_PKG_SHA256	:= e9a9caf54ced7aa349cd3aac6afe2d2211e32fbbe94486e3d63f5707a4c4daaa
KUROSHIO_UCI_SHA256	:= 2d1a9a7ce393269243957adb124d31a2bf66e70e0098e29c830be6bce31d47b6
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
