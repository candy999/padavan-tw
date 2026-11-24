include $(ROOTDIR)/rules.mk

PKG_NAME:=miniupnpd
PKG_VERSION:=2.3.7

include $(INCLUDE_DIR)/package.mk

# padavan-tw：2.0（2017）→ 2.3.7（CVE-2019-12107～12111、CallStranger CVE-2020-12695 等）。
# 原始碼取自 vb1980/padavan-4.4（padavan-ng 的移植：2.3.7 之後的 PCP nonce 修正、
# configure 固定為 RT-N56U 平台＝iptables、lease file、vendorcfg、停用 WANPPPConnection，
# 設定檔維持 /etc/miniupnpd.conf，rc 寫的就是這個位置）
SRC_DIR=./miniupnpd-2.x
# 2026-11-24 安全修正：不換版本，從上游 git（miniupnp/miniupnp）挑 2.3.7 之後的安全修正補進來（去掉 Changelog、測試與檔頭註解）：
#   HTTP 解析：f56bd09 9b8e530 426e400 d5fd424 1917228 37656e7 4409ecb c2e1278 89231db c47f961 5d60702（請求大小上限、標頭越界、配置失敗）
#   XML：3cfb4fb 64ef08a 42965d7；SSDP：8f13b7a（CVE-2026-107159，MX: 0）；事件 URL：e5f8e26；SOAP：c0a06df（snprintf 溢位檢查）
#   PCP：5d7609a ee23ab2 d634e06 291f1ef；設定檔：d05cdf5；租約檔過濾控制字元：38a9963 7ce1ba5；READNU32：eb397ac；iptables：6f787c9
#   沒有補：ce35670/f83b5e2（PCP 選項長度改為 RFC 的不含標頭算法；這版長度含標頭、讀取前已檢查，不會越界）、
#   b24d595（PinholeVerification 只在 IPv6 pinhole 編譯，這裡 ENABLE_IPV6=0）

# disable support IPv6 yet, because no profit w/o IGDv2
# e.g. Windows not supported IGDv2 and UPnP not worked
ENABLE_IPV6:=0

# 2.3.x 自己的 configure 不是 autoconf，不收 --host 這類參數；先產生 config.h、config.mk（Makefile.linux 會 include）
define Build/Configure
	(cd $(PKG_BUILD_DIR); $(TARGET_CONFIGURE_OPTS) sh ./configure)
endef

MAKE_FLAGS += \
	-f Makefile.linux \
	ENABLE_IPV6=$(ENABLE_IPV6)

$(eval $(call BuildPackage,miniupnpd))

romfs:
	$(INSTALL_DIR) $(ROMFSDIR)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/miniupnpd $(ROMFSDIR)/usr/bin/miniupnpd
