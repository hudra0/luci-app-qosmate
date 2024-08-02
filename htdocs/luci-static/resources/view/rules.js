'use strict';
'require view';
'require ui';
'require uci';
'require form';
'require rpc';
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
            .then(() => {
                return ui.changes.apply();
            })
            .then(() => {
                return uci.load('qosmate');
            })
            .then(() => {
                return uci.get_first('qosmate', 'global', 'enabled');
            })
            .then(enabled => {
                if (enabled === '0') {
                    return callInitAction('qosmate', 'stop');
                } else {
                    // Prüfen, ob es Änderungen gab
                    return uci.changes().then(changes => {
                        if (Object.keys(changes).length > 0) {
                            // Es gab Änderungen, also neu starten
                            return callInitAction('qosmate', 'restart');
                        }
                        // Keine Änderungen, nichts tun
                        return Promise.resolve();
                    });
                }
            })
            .then(() => {
                ui.hideModal();
                window.location.reload();
            })
            .catch((err) => {
                ui.hideModal();
                ui.addNotification(null, E('p', _('Failed to save settings or update QoSmate service: ') + err.message));
            });
    },

    render: function() {
        var m, s, o;

        m = new form.Map('qosmate', _('QoSmate Rules'),
            _('Configure QoS rules for marking packets with DSCP values.'));

        s = m.section(form.GridSection, 'rule', _('Rules'));
        s.addremove = true;
        s.anonymous = true;
        s.sortable  = true;

        s.tab('general', _('General Settings'));
        s.tab('mapping', _('DSCP Mapping'));

        // Add mapping information to the description
        s.description = E('div', { 'class': 'cbi-section-descr' }, [

            E('h4', _('HFSC Mapping:')),
            E('pre', [
                'High Priority (1:11): EF, CS5, CS6, CS7\n',
                'Fast Non-Realtime (1:12): CS4, AF41, AF42\n',
                'Normal (1:13): CS0\n',
                'Low Priority (1:14): CS2\n',
                'Bulk (1:15): CS1'
            ].join('')),
            E('h4', _('CAKE Mapping (diffserv4):')),
            E('pre', [
                'Priority    Tin     Service Class           DSCP\n',
                '-----------------------------------------------\n',
                'Highest     Tin 4   Voice                   CS7, CS6, EF, VA, CS5, CS4\n',
                '            Tin 3   Video                   CS3, AF4, AF3, CS2, TOS1\n',
                '            Tin 2   Best Effort             CS0, AF1, AF2, TOS0\n',
                'Lowest      Tin 1   Background Traffic      CS1, LE in kernel v5.9+\n'
            ].join(''))
        ]);

        o = s.taboption('general', form.Value, 'name', _('Name'));
        o.rmempty = false;

        o = s.taboption('general', form.ListValue, 'proto', _('Protocol'));
        o.value('tcp', _('TCP'));
        o.value('udp', _('UDP'));
        o.value('icmp', _('ICMP'));
        o.rmempty = true;

        o = s.taboption('general', form.DynamicList, 'src_ip', _('Source IP'));
        o.datatype = 'or(ip4addr, string)';
        o.placeholder = _('any');
        o.rmempty = true;
        o.write = function(section_id, formvalue) {
            var values = formvalue.map(function(v) {
                return v.replace(/^!(?!=)/, '!=');
            });
            return this.super('write', [section_id, values]);
        };
        o.validate = function(section_id, value) {
            if (value === '')
                return true;
            
            if (!value.match(/^(!|!=)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(\/\d{1,2})?|[a-zA-Z0-9_]+)$/))
                return _('Invalid IP address or hostname');
            return true;
        };
        
        o = s.taboption('general', form.DynamicList, 'src_port', _('Source port'));
        o.datatype = 'or(port, portrange, string)';
        o.placeholder = _('any');
        o.rmempty = true;
        o.write = function(section_id, formvalue) {
            var values = formvalue.map(function(v) {
                return v.replace(/^!(?!=)/, '!=');
            });
            return this.super('write', [section_id, values]);
        };
        o.validate = function(section_id, value) {
            if (value === '')
                return true;
            
            if (!value.match(/^(!|!=)?(\d+(-\d+)?|[a-zA-Z0-9]+)$/))
                return _('Invalid port or port range');
            return true;
        };
        
        o = s.taboption('general', form.DynamicList, 'dest_ip', _('Destination IP'));
        o.datatype = 'or(ip4addr, string)';
        o.placeholder = _('any');
        o.rmempty = true;
        o.write = function(section_id, formvalue) {
            var values = formvalue.map(function(v) {
                return v.replace(/^!(?!=)/, '!=');
            });
            return this.super('write', [section_id, values]);
        };
        o.validate = function(section_id, value) {
            if (value === '')
                return true;
            
            if (!value.match(/^(!|!=)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(\/\d{1,2})?|[a-zA-Z0-9_]+)$/))
                return _('Invalid IP address or hostname');
            return true;
        };
        
        o = s.taboption('general', form.DynamicList, 'dest_port', _('Destination port'));
        o.datatype = 'or(port, portrange, string)';
        o.placeholder = _('any');
        o.rmempty = true;
        o.write = function(section_id, formvalue) {
            var values = formvalue.map(function(v) {
                return v.replace(/^!(?!=)/, '!=');
            });
            return this.super('write', [section_id, values]);
        };
        o.validate = function(section_id, value) {
            if (value === '')
                return true;
            
            if (!value.match(/^(!|!=)?(\d+(-\d+)?|[a-zA-Z0-9]+)$/))
                return _('Invalid port or port range');
            return true;
        };

        o = s.taboption('general', form.ListValue, 'class', _('DSCP Class'));
        o.value('ef', _('EF - Expedited Forwarding (46)'));
        o.value('cs5', _('CS5 (40)'));
        o.value('cs6', _('CS6 (48)'));
        o.value('cs7', _('CS7 (56)'));
        o.value('cs4', _('CS4 (32)'));
        o.value('af41', _('AF41 (34)'));
        o.value('af42', _('AF42 (36)'));
        o.value('cs2', _('CS2 (16)'));
        o.value('cs1', _('CS1 (8)'));
        o.value('cs0', _('CS0 - Best Effort (0)'));
        o.rmempty = false;

        o = s.taboption('general', form.Flag, 'counter', _('Enable counter'));
        o.rmempty = false;

        return m.render();
    }
});