# padavan-tw：黑潮 DNS（https://github.com/candy999/kuroshio-dns，GPL-3.0-or-later）
#
# - 執行檔：官方 Release 的 kuroshio-mipsel-unknown-linux-musl（靜態、soft-float），核對 SHA256
# - 唯讀資料 data/（種子、台灣 IP 清單、管理網頁等）與預設 UCI 設定：同一個標籤的原始碼，核對 commit
# - 憑證：acme.sh（Cloudflare DNS 驗證），核對 SHA256
# 升級時三個版本要一起改，data/ 必須跟執行檔同一版

KUROSHIO_VER	:= v3.0.1
KUROSHIO_COMMIT	:= 877f7f1620531fec45ac68612bc418df0b33c6bb
KUROSHIO_SHA256	:= be40035a09a2678ef35ebbcf625138ce62342d8375bc635fd32fafc8ceddfcc0
KUROSHIO_REPO	:= https://github.com/candy999/kuroshio-dns

ACME_VER	:= 3.1.1
ACME_BASE	:= https://raw.githubusercontent.com/acmesh-official/acme.sh/$(ACME_VER)
ACME_SHA256	:= e80e3e6d66ab02f7b448c55129c70ec57089a286d7df95282a68d607b4df7ed7
DNSCF_SHA256	:= 741f2c740ca258471f2dbec7233a9177ed879bd640353acbefe87a2d63193292
ACMELIC_SHA256	:= 3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986

# acme.sh 用 curl 連 Let's Encrypt 與 Cloudflare 時要驗證憑證；韌體沒有內建 CA 清單，帶一份 Mozilla 的
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
	$(call fetch,$(KUROSHIO_REPO)/releases/download/$(KUROSHIO_VER)/kuroshio-mipsel-unknown-linux-musl,dl/kuroshio,$(KUROSHIO_SHA256))
	git clone -q --depth 1 --branch $(KUROSHIO_VER) $(KUROSHIO_REPO).git dl/src
	test "$$(git -C dl/src rev-parse HEAD)" = "$(KUROSHIO_COMMIT)"
	$(call fetch,$(ACME_BASE)/acme.sh,dl/acme/acme.sh,$(ACME_SHA256))
	$(call fetch,$(ACME_BASE)/dnsapi/dns_cf.sh,dl/acme/dnsapi/dns_cf.sh,$(DNSCF_SHA256))
	$(call fetch,$(ACME_BASE)/LICENSE.md,dl/acme/LICENSE.md,$(ACMELIC_SHA256))
	$(call fetch,$(CACERT_URL),dl/acme/cacert.pem,$(CACERT_SHA256))
	echo "$(KUROSHIO_VER)" > dl/.ok

clean:
	rm -rf ./dl

romfs:
	$(ROMFSINST) -S -p +x $(THISDIR)/dl/kuroshio /usr/bin/kuroshio
	mkdir -p $(ROMFSDIR)/usr/share/kuroshio
	cp -a $(THISDIR)/dl/src/data/. $(ROMFSDIR)/usr/share/kuroshio/
	$(ROMFSINST) -d -p 644 $(THISDIR)/dl/src/LICENSE /usr/share/kuroshio/LICENSE
	$(ROMFSINST) -p 644 $(THISDIR)/dl/src/openwrt/kuroshio/files/kuroshio.config /usr/share/kuroshio/kuroshio.uci.default
	$(ROMFSINST) -d -p +x $(THISDIR)/dl/acme/acme.sh /usr/lib/acme/acme.sh
	$(ROMFSINST) -d -p +x $(THISDIR)/dl/acme/dnsapi/dns_cf.sh /usr/lib/acme/dnsapi/dns_cf.sh
	$(ROMFSINST) -p 644 $(THISDIR)/dl/acme/LICENSE.md /usr/lib/acme/LICENSE.md
	$(ROMFSINST) -p 644 $(THISDIR)/dl/acme/cacert.pem /usr/lib/acme/cacert.pem
	$(ROMFSINST) -p +x $(THISDIR)/kuroshio.sh /usr/bin/kuroshio.sh
