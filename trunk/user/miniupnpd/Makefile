include $(ROOTDIR)/rules.mk

PKG_NAME:=miniupnpd
PKG_VERSION:=2.3.7

include $(INCLUDE_DIR)/package.mk

# padavan-tw：2.0（2017）→ 2.3.7（CVE-2019-12107～12111、CallStranger CVE-2020-12695 等）。
# 原始碼取自 vb1980/padavan-4.4（padavan-ng 的移植：2.3.7 之後的 PCP nonce 修正、
# configure 固定為 RT-N56U 平台＝iptables、lease file、vendorcfg、停用 WANPPPConnection，
# 設定檔維持 /etc/miniupnpd.conf，rc 寫的就是這個位置）
SRC_DIR=./miniupnpd-2.x

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
