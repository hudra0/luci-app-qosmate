'use strict';
'require view';
'require rpc';
'require ui';
'require uci';
'require form';
'require fs';
'require tools.widgets as widgets';

var callInitAction = rpc.declare({
    object: 'luci',
    method: 'setInitAction',
    params: ['name', 'action'],
    expect: { result: false }
});

return view.extend({
    handleSaveApply: function(ev) {
        return this.handleSave(ev)
            .then(() => ui.changes.apply())
            .then(() => uci.load('qosmate'))
            .then(() => uci.get_first('qosmate', 'global', 'enabled'))
            .then(enabled => {
                if (enabled === '0') {
                    return fs.exec_direct('/etc/init.d/qosmate', ['stop']);
                } else {
                    return fs.exec_direct('/etc/init.d/qosmate', ['restart']);
                }
            })
            .then(() => {
                ui.hideModal();
                window.location.reload();
            })
            .catch(err => {
                ui.hideModal();
                ui.addNotification(null, E('p', _('Failed to save settings or update QoSmate service: ') + err.message));
            });
    },

    render: function() {
        var m, s, o;

        m = new form.Map('qosmate', _('QoSmate IP Rate Limits'),
            _('Configure bandwidth rate limits for specific IP addresses. These limits work in addition to global rate limiting.'));

        s = m.section(form.GridSection, 'ip_limit', _('IP Rate Limits'));
        s.addremove = true;
        s.anonymous = true;
        s.sortable = true;

        // Add description about how IP rate limiting works
        s.description = E('div', { 'class': 'cbi-section-descr' }, [
            E('p', _('Define bandwidth limits for specific IP addresses or subnets. These limits are applied in addition to global rate limiting.')),
            E('p', { 'style': 'color: #666; font-style: italic;' }, _('Note: IP-based rate limiting is independent of MAC addresses. If an IP changes its MAC address, the rate limit will still apply.'))
        ]);

        // Name field
        o = s.option(form.Value, 'name', _('Name'));
        o.rmempty = false;
        o.placeholder = _('Descriptive name for this rule');
        o.validate = function(section_id, value) {
            if (!value || value.trim() === '') {
                return _('Name is required');
            }
            return true;
        };

        // IP address field
        o = s.option(form.Value, 'ip', _('IP Address'));
        o.rmempty = false;
        o.datatype = 'string';
        o.placeholder = _('e.g. 192.168.1.100 or 192.168.1.0/24');
        o.validate = function(section_id, value) {
            if (!value || value.trim() === '') {
                return _('IP address is required');
            }

            var ip = value.trim();
            
            // Check if it's a valid IPv4 address or CIDR
            var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/([0-9]|[1-2][0-9]|3[0-2]))?$/;
            
            // Check if it's a valid IPv6 address or CIDR
            var ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}(?:\/([0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8]))?$|^::1(?:\/([0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8]))?$|^::(?:\/([0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8]))?$|^(?:[0-9a-fA-F]{1,4}:){1,7}:(?:\/([0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8]))?$|^(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}(?:\/([0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8]))?$/;

            if (!ipv4Regex.test(ip) && !ipv6Regex.test(ip)) {
                return _('Invalid IP address or CIDR notation');
            }

            return true;
        };

        // Download rate limit
        o = s.option(form.Value, 'download_rate', _('Download Rate (kbps)'));
        o.rmempty = true;
        o.datatype = 'uinteger';
        o.placeholder = _('e.g. 10000 for 10 Mbps');
        o.validate = function(section_id, value) {
            if (value && value.trim() !== '') {
                var rate = parseInt(value);
                if (isNaN(rate) || rate <= 0) {
                    return _('Download rate must be a positive integer');
                }
                if (rate > 1000000) {
                    return _('Download rate seems too high (max 1000000 kbps)');
                }
            }
            return true;
        };

        // Upload rate limit
        o = s.option(form.Value, 'upload_rate', _('Upload Rate (kbps)'));
        o.rmempty = true;
        o.datatype = 'uinteger';
        o.placeholder = _('e.g. 5000 for 5 Mbps');
        o.validate = function(section_id, value) {
            if (value && value.trim() !== '') {
                var rate = parseInt(value);
                if (isNaN(rate) || rate <= 0) {
                    return _('Upload rate must be a positive integer');
                }
                if (rate > 1000000) {
                    return _('Upload rate seems too high (max 1000000 kbps)');
                }
            }
            return true;
        };

        // Custom validation to ensure at least one rate is specified
        s.validate = function() {
            var sections = this.cfgsections();
            for (var i = 0; i < sections.length; i++) {
                var section_id = sections[i];
                var downloadRate = uci.get('qosmate', section_id, 'download_rate');
                var uploadRate = uci.get('qosmate', section_id, 'upload_rate');
                
                if ((!downloadRate || downloadRate.trim() === '') && 
                    (!uploadRate || uploadRate.trim() === '')) {
                    var name = uci.get('qosmate', section_id, 'name') || 'Unnamed rule';
                    return _('Rule "%s": At least one rate limit (download or upload) must be specified').format(name);
                }
            }
            return true;
        };

        // Enable/disable flag
        o = s.option(form.Flag, 'enabled', _('Enable'));
        o.rmempty = false;
        o.default = '1';

        return m.render();
    }
});