include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-qosmate
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

PKG_MAINTAINER:=Markus Hütter <mh@hudra.net>
PKG_LICENSE:=GPL-3.0-or-later

LUCI_TITLE:=LuCI support for QoSmate
LUCI_DEPENDS:=+luci-base +qosmate +kmod-sched +ip-full +kmod-veth +tc-full +kmod-netem +kmod-sched-ctinfo +kmod-ifb +kmod-sched-cake
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature