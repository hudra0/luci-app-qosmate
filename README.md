# luci-app-qosmate

Install one-liner:

```
mkdir -p /www/luci-static/resources/view/qosmate /usr/share/luci/menu.d /usr/share/rpcd/acl.d && \
wget -O /www/luci-static/resources/view/qosmate/settings.js https://raw.githubusercontent.com/hudra0/luci-app-qosmate/main/htdocs/luci-static/resources/view/settings.js && \
wget -O /www/luci-static/resources/view/qosmate/hfsc.js https://raw.githubusercontent.com/hudra0/luci-app-qosmate/main/htdocs/luci-static/resources/view/hfsc.js && \
wget -O /www/luci-static/resources/view/qosmate/cake.js https://raw.githubusercontent.com/hudra0/luci-app-qosmate/main/htdocs/luci-static/resources/view/cake.js && \
wget -O /www/luci-static/resources/view/qosmate/advanced.js https://raw.githubusercontent.com/hudra0/luci-app-qosmate/main/htdocs/luci-static/resources/view/advanced.js && \
wget -O /www/luci-static/resources/view/qosmate/rules.js https://raw.githubusercontent.com/hudra0/luci-app-qosmate/main/htdocs/luci-static/resources/view/rules.js && \
wget -O /usr/share/luci/menu.d/luci-app-qosmate.json https://raw.githubusercontent.com/hudra0/luci-app-qosmate/main/root/usr/share/luci/menu.d/luci-app-qosmate.json && \
wget -O /usr/share/rpcd/acl.d/luci-app-qosmate.json https://raw.githubusercontent.com/hudra0/luci-app-qosmate/main/root/usr/share/rpcd/acl.d/luci-app-qosmate.json && \
/etc/init.d/rpcd restart && \
/etc/init.d/uhttpd restart
```   
