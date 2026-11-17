# padavan-tw：黑潮 DNS（https://github.com/candy999/kuroshio-dns，GPL-3.0-or-later）
#
# - 執行檔＋唯讀資料 data/：官方 Release 的「Linux 通用包」kuroshio-linux-mipsel-unknown-linux-musl.tar.gz
#   （同一版打包在一起，不會版本不一致；data/manifest.json 標示版本），核對 SHA256
# - 預設 UCI 設定：通用包裡的 data/kuroshio.config（3.3.0 起，跟 OpenWrt 版同一份），裝成 kuroshio.uci.default
# - 原始碼（GPL-3.0）：Release 的 kuroshio-dns-<版本>-source.tar.xz，由 .github/workflows/build.yml 附在韌體的 Release
# - 憑證：acme.sh（Cloudflare DNS 驗證），核對 SHA256
# 升級時改 KUROSHIO_VER 與兩個 SHA256（Release 的 SHA256SUMS：通用包、原始碼包）

KUROSHIO_VER	:= v3.3.0
KUROSHIO_PKG_SHA256	:= 3b8167cbab4997d13f8fab8ff0a79c7727c6a385bf79aad68a2b4fc249d1ba3a
KUROSHIO_SRC_SHA256	:= 711e6bfb1f5c9a0da1db20dd56cc10007d4d456894432191cd92545ccf66ac96
KUROSHIO_REPO	:= https://github.com/candy999/kuroshio-dns

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
	grep -q '^config ' dl/kuroshio/data/kuroshio.config
	cp dl/kuroshio/data/kuroshio.config dl/kuroshio.uci.default
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
	# 預設設定另外裝成 kuroshio.uci.default（kuroshio.sh 用這個名字）；ui-core 的測試資料用不到
	rm -f $(ROMFSDIR)/usr/share/kuroshio/kuroshio.config $(ROMFSDIR)/usr/share/kuroshio/shared/ui-core.tests.json
	$(ROMFSINST) -d -p 644 $(THISDIR)/dl/kuroshio/LICENSE /usr/share/kuroshio/LICENSE
	$(ROMFSINST) -p 644 $(THISDIR)/dl/kuroshio.uci.default /usr/share/kuroshio/kuroshio.uci.default
	$(ROMFSINST) -d -p +x $(THISDIR)/dl/acme/acme.sh /usr/lib/acme/acme.sh
	$(ROMFSINST) -d -p +x $(THISDIR)/dl/acme/dnsapi/dns_cf.sh /usr/lib/acme/dnsapi/dns_cf.sh
	$(ROMFSINST) -p 644 $(THISDIR)/dl/acme/LICENSE.md /usr/lib/acme/LICENSE.md
	$(ROMFSINST) -p 644 $(THISDIR)/dl/acme/cacert.pem /usr/lib/acme/cacert.pem
	$(ROMFSINST) -p +x $(THISDIR)/kuroshio.sh /usr/bin/kuroshio.sh
