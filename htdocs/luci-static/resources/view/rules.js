'use strict';
'require view';
'require ui';
'require uci';
'require form';
'require rpc';
'require fs';
'require poll';
'require validation';
'require tools.widgets as widgets';

var callInitAction = rpc.declare({
    object: 'luci',
    method: 'setInitAction',
    params: ['name', 'action'],
    expect: { result: false }
});

var callRuleCounters = rpc.declare({
    object: 'luci.qosmate_stats',
    method: 'getRuleCounters',
    expect: { rule_counters: [] }
});

// Bridges LuCI's validation types into plain functions; see LuCI.validation docs
var stubValidator = {
    factory: validation,
    apply: function(type, value, args) {
        if (value != null)
            this.value = value;
        return validation.types[type].apply(this, args);
    },
    assert: function(condition) { return !!condition; }
};

// IPv6 suffix matching validation helpers
function isIPv6SuffixFormat(value) {
    // Format: ::suffix/::mask - allow empty suffix/mask with * instead of +
    return /^::([0-9a-fA-F:]*)\/::([0-9a-fA-F:]*)$/.test(value);
}

function validateIPv6Part(part) {
    // Special case: empty part is valid (for ::/::mask)
    if (part === '') return true;
    
    // Check for multiple consecutive colons (:: can only appear once)
    if (/:{3,}/.test(part)) return false;
    if (/[^0-9a-fA-F:]/.test(part)) return false; // Only hex and colons allowed
    
    // Check if :: appears more than once
    var doubleColonCount = (part.match(/::/g) || []).length;
    if (doubleColonCount > 1) return false;
    
    // For suffix matching, we already have :: at the start, so no more :: allowed
    if (doubleColonCount > 0) return false;
    
    // Split by colons and check each segment
    var segments = part.split(':');
    
    // Can't have more than 8 segments (for a full IPv6) 
    if (segments.length > 8) return false;
    
    for (var i = 0; i < segments.length; i++) {
        var seg = segments[i];
        // Each segment must be 0-4 hex digits
        if (!/^[0-9a-fA-F]{0,4}$/.test(seg)) {
            return false;
        }
    }
    
    return true;
}

function parseIPv6Suffix(value) {
    const match = value.match(/^::([0-9a-fA-F:]*)\/::([0-9a-fA-F:]*)$/);
    if (!match) return null;
    
    // Validate both parts
    if (!validateIPv6Part(match[1]) || !validateIPv6Part(match[2])) {
        return null;
    }
    
    return {
        suffix: match[1],
        mask: match[2],
        isSuffixMatch: true
    };
}

// Common IP validation function for src_ip and dest_ip fields
function validateIPField(section_id, value) {
    if (!value || value.length === 0) {
        return true;
    }
    
    var values = Array.isArray(value) ? value : value.split(/\s+/);
    var ipCidrRegex = /^(?:(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)){3})(?:\/(?:[0-9]|[1-2]\d|3[0-2]))?|(?:(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){1,7}:|(?:[A-Fa-f0-9]{1,4}:){1,6}:[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){1,5}(?::[A-Fa-f0-9]{1,4}){1,2}|(?:[A-Fa-f0-9]{1,4}:){1,4}(?::[A-Fa-f0-9]{1,4}){1,3}|(?:[A-Fa-f0-9]{1,4}:){1,3}(?::[A-Fa-f0-9]{1,4}){1,4}|(?:[A-Fa-f0-9]{1,4}:){1,2}(?::[A-Fa-f0-9]{1,4}){1,5}|[A-Fa-f0-9]{1,4}:(?:(?::[A-Fa-f0-9]{1,4}){1,6})|:(?:(?::[A-Fa-f0-9]{1,4}){1,7}|:))(?:\/(?:[0-9]|[1-9]\d|1[0-1]\d|12[0-8]))?)$/;
    
    // Check for mixed IPv4/IPv6 within this field
    var hasIPv4 = false;
    var hasIPv6 = false;
    
    for (var i = 0; i < values.length; i++) {
        var v = values[i].replace(/^!(?!=)/, '!=');
        
        // Check for set reference
        if (v.startsWith('@') || v.startsWith('!=@')) {
            var setName = v.replace(/^(!=)?@/, '');
            if (!/^[a-zA-Z0-9_]+$/.test(setName)) {
                return _('Invalid set name format. Must start with @ followed by letters, numbers, or underscore');
            }
            continue; // Don't check IP version for sets
        } 
        
        // Strip != prefix for validation
        var isNegated = v.startsWith('!=');
        var valueToValidate = isNegated ? v.substring(2) : v;
        
        // Check for IPv6 suffix format
        if (isIPv6SuffixFormat(valueToValidate)) {
            var suffixData = parseIPv6Suffix(valueToValidate);
            if (!suffixData) {
                return _('Invalid IPv6 suffix format. Use ::suffix/::mask with valid IPv6 segments (e.g. ::1234:5678/::ffff:ffff)');
            }
            hasIPv6 = true;
        }
        // nftables accepts address ranges wherever a plain address is allowed
        else if (valueToValidate.indexOf('-') !== -1) {
            if (!stubValidator.apply('iprange', valueToValidate)) {
                return _('Invalid IP range: ') + v;
            }
            if (valueToValidate.indexOf(':') !== -1) {
                hasIPv6 = true;
            } else {
                hasIPv4 = true;
            }
        }
        else {
            if (!ipCidrRegex.test(valueToValidate)) {
                return _('Invalid IP address or CIDR format: ') + v;
            }
            // Detect IP version
            if (valueToValidate.indexOf(':') !== -1) {
                hasIPv6 = true;
            } else {
                hasIPv4 = true;
            }
        }
    }
    
    return true;
}

return view.extend({
    // Rule counter polling
    counterData: {},
    pollHandler: null,
    pollInterval: 8,
    
    load: function() {
        this.counterData = {};
        return this.super && this.super('load') || Promise.resolve();
    },
    
    // Create polling function for rule counter updates
    createPollFunction: function() {
        var view = this;
        return function() {

            return callRuleCounters().then(function(result) {

                if (result && Array.isArray(result)) {

                    view.updateCounterData(result);
                } else {

                }
                return result;
            }).catch(function(err) {

                return null;
            });
        };
    },
    
    // Start counter polling
    startCounterPolling: function() {
        if (this.pollHandler) {
            return; // Already polling
        }
        
        var view = this;
        var startPollingWhenReady = function() {
            var luciTable = document.querySelector('.cbi-section-table');

            
            if (luciTable) {

                view.pollHandler = view.createPollFunction();
                poll.add(view.pollHandler, view.pollInterval);
                view.pollHandler(); // Initial call
            } else {

                setTimeout(startPollingWhenReady, 1000); // Retry after 1 second
            }
        };
        
        startPollingWhenReady();
    },
    
    // Stop counter polling
    stopCounterPolling: function() {
        if (this.pollHandler) {
            poll.remove(this.pollHandler);
            this.pollHandler = null;

        }
    },
    
    // Update counter data and refresh UI
    updateCounterData: function(ruleCounters) {
        var view = this;
        view.counterData = {};
        
        if (Array.isArray(ruleCounters)) {
            ruleCounters.forEach(function(rule) {
                view.counterData[rule.rule_name] = {
                    packets: rule.total_packets || 0,
                    bytes: rule.total_bytes || 0,
                    ipv4_packets: rule.ipv4_packets || 0,
                    ipv6_packets: rule.ipv6_packets || 0
                };
            });
            view.updateActivityColumnInTable();
        }
    },
    
    // Update Activity column in LuCI table
    updateActivityColumnInTable: function() {
        var view = this;
        setTimeout(function() {
            // Find LuCI table and Activity column
            var table = document.querySelector('.cbi-section-table');
            if (!table) {

                return;
            }
            

            var headerRow = table.querySelector('tr');
            var activityColumnIndex = -1;
            
            if (headerRow) {
                var headers = headerRow.querySelectorAll('th');
                headers.forEach(function(th, index) {
                    if (th.textContent.includes(_('Activity'))) {
                        activityColumnIndex = index;

                    }
                });
            }
            
            if (activityColumnIndex >= 0) {
                var dataRows = table.querySelectorAll('tr[data-sid]');

                
                dataRows.forEach(function(row) {
                    var sectionId = row.getAttribute('data-sid');
                    var cells = row.querySelectorAll('td');
                    if (cells[activityColumnIndex] && sectionId) {
                        var ruleName = uci.get('qosmate', sectionId, 'name');
                        var counterEnabled = uci.get('qosmate', sectionId, 'counter');
                        

                        
                        var activityCell = cells[activityColumnIndex];
                        var content = view.formatCounterDisplay(ruleName, counterEnabled);
                        activityCell.innerHTML = '';
                        activityCell.appendChild(content);
                    }
                });
            }
        }, 200); // Give LuCI time to render
    },
    
    // Format counter display
    formatCounterDisplay: function(ruleName, counterEnabled) {
        if (counterEnabled !== '1') {
            return E('span', {'style': 'color: #999; font-size: 0.9em;'}, '-');
        }
        
        var stats = this.counterData[ruleName];
        if (!stats || stats.packets === 0) {
            return E('span', {'style': 'color: #999; font-size: 0.9em;'}, _('no activity'));
        }
        
        var totalPackets = stats.packets;
        var displayText = '';
        
        // Format packet count for readability
        if (totalPackets >= 1000000) {
            displayText = (totalPackets / 1000000).toFixed(1) + 'M pkts';
        } else if (totalPackets >= 1000) {
            displayText = (totalPackets / 1000).toFixed(1) + 'K pkts';
        } else {
            displayText = totalPackets + ' pkts';
        }
        
        // Add IPv4/IPv6 breakdown if both are present
        var breakdown = '';
        if (stats.ipv4_packets > 0 && stats.ipv6_packets > 0) {
            breakdown = ` (v4:${stats.ipv4_packets}, v6:${stats.ipv6_packets})`;
        }
        
        return E('span', {
            'style': 'color: #0a84ff; font-size: 0.9em; font-weight: 500;',
            'title': `Total: ${totalPackets} packets, ${(stats.bytes / 1024).toFixed(1)} KB${breakdown}`
        }, displayText);
    },

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

        m = new form.Map('qosmate', _('QoSmate Rules'),
            _('Configure QoS rules for marking packets with DSCP values.'));

        s = m.section(form.GridSection, 'rule', _('Rules'));
        s.addremove = true;
        s.anonymous = true;
        s.sortable  = true;

        s.tab('general', _('General Settings'));
        s.tab('mapping', _('DSCP Mapping'));

        // Add mapping information to the description - CAKE Diffserv8 is primary
        s.description = E('div', { 'class': 'cbi-section-descr' }, [
            E('h4', _('CAKE Diffserv8 Mapping (RFC 8290 - 8 Priority Tins):')),
            E('table', { 'class': 'table' }, [
                E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td left', 'width': '22%' }, E('strong', { 'style': 'color: #8e44ad;' }, _('Tin 7: Network Control'))),
                    E('td', { 'class': 'td left', 'width': '25%' }, 'CS7, CS6'),
                    E('td', { 'class': 'td left' }, _('DNS (Port 53), NTP (Port 123), Routing protocols, ICMP ping'))
                ]),
                E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td left' }, E('strong', { 'style': 'color: #27ae60;' }, _('Tin 6: Realtime / Gaming'))),
                    E('td', { 'class': 'td left' }, 'EF, VA, CS5, CS4'),
                    E('td', { 'class': 'td left' }, _('PC Gaming & console UDP (!53 !80 !443), Discord Voice, WebRTC, Minimum Latency'))
                ]),
                E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td left' }, E('strong', { 'style': 'color: #17a2b8;' }, _('Tin 5: Interactive Shell'))),
                    E('td', { 'class': 'td left' }, 'CS2'),
                    E('td', { 'class': 'td left' }, _('SSH (Port 22), Interactive terminal sessions, low-latency control signaling'))
                ]),
                E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td left' }, E('strong', { 'style': 'color: #d35400;' }, _('Tin 4: Low-Latency Data'))),
                    E('td', { 'class': 'td left' }, 'AF21, AF22, AF23'),
                    E('td', { 'class': 'td left' }, _('Cloudflare Argo Tunnel (:7844), Homelab web hosting origin (:8000), Uptime API'))
                ]),
                E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td left' }, E('strong', { 'style': 'color: #b7950b;' }, _('Tin 3: Video Streaming'))),
                    E('td', { 'class': 'td left' }, 'CS3, AF41, AF42, AF43, AF31..33'),
                    E('td', { 'class': 'td left' }, _('RTMP live video streaming (:1935), STUN media (3478-3481), video conference media'))
                ]),
                E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td left' }, E('strong', { 'style': 'color: #566573;' }, _('Tin 2: Best Effort'))),
                    E('td', { 'class': 'td left' }, 'CS0 (default)'),
                    E('td', { 'class': 'td left' }, _('Standard web browsing, HTTPS (Port 443), unclassified general household traffic'))
                ]),
                E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td left' }, E('strong', { 'style': 'color: #2e4053;' }, _('Tin 1: High Throughput'))),
                    E('td', { 'class': 'td left' }, 'AF11, AF12, AF13, CS1'),
                    E('td', { 'class': 'td left' }, _('Heavy sustained TCP transfers (>750MB), bulk downloads, BitTorrent / P2P'))
                ]),
                E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td left' }, E('strong', { 'style': 'color: #7f8c8d;' }, _('Tin 0: Low Priority'))),
                    E('td', { 'class': 'td left' }, 'LE (1)'),
                    E('td', { 'class': 'td left' }, _('Background updates, scavenger traffic, lower-effort transfers'))
                ])
            ]),
            E('p', { 'style': 'font-size:0.92em; margin: -5px 0 15px 5px; color: #555;' }, [
                E('strong', _('Dual-CAKE Architecture Note:')), ' ',
                _('With Dual-CAKE active, Diffserv8 priority queues run on both LAN ingress (pre-proxy, classifying & shaping traffic before Xray Core encryption) and WAN egress. Local LAN-to-LAN gigabit traffic automatically bypasses shaping.')
            ]),
            E('h4', { 'style': 'color: #777; margin-top: 15px;' }, _('Legacy HFSC & Diffserv4 Reference:')),
            E('table', { 'class': 'table', 'style': 'opacity: 0.8;' }, [
                E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td left', 'width': '25%' }, _('HFSC Classes')),
                    E('td', { 'class': 'td left' }, '1:11 Realtime (EF/CS5..7), 1:12 Fast Non-Realtime (CS4/AF4x), 1:13 Normal (CS0), 1:14 Low Priority (CS2/AF11), 1:15 Bulk (CS1)')
                ]),
                E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td left' }, _('CAKE Diffserv4 (Legacy)')),
                    E('td', { 'class': 'td left' }, 'Tin 3 Voice (CS7/CS6/EF/VA/CS5/CS4), Tin 2 Video (CS3/AF4x/AF3x/AF2x/CS2), Tin 1 Best Effort (CS0/AF1x), Tin 0 Bulk (CS1/LE)')
                ])
            ])
        ]);

        // Grid Columns (Display in main table)
        o = s.option(form.DummyValue, 'name_display', _('Name'));
        o.modalonly = false;
        o.cfgvalue = function(section_id) {
            return uci.get('qosmate', section_id, 'name') || section_id;
        };

        o = s.option(form.DummyValue, 'proto', _('Protocol'));
        o.modalonly = false;
        o.cfgvalue = function(section_id) {
            var proto = uci.get('qosmate', section_id, 'proto');
            if (Array.isArray(proto)) {
                return proto.map(function(p) { 
                    if (p === 'ipv6-icmp') return 'ICMPv6';
                    return p.toUpperCase(); 
                }).join(', ');
            } else if (typeof proto === 'string') {
                if (proto === 'ipv6-icmp') return 'ICMPv6';
                return proto.toUpperCase();
            }
            return _('Any');
        };

        o = s.option(form.DummyValue, 'match_criteria', _('Match Criteria'));
        o.modalonly = false;
        o.cfgvalue = function(section_id) {
            var parts = [];
            var src_ip = uci.get('qosmate', section_id, 'src_ip');
            var src_port = uci.get('qosmate', section_id, 'src_port');
            var dest_ip = uci.get('qosmate', section_id, 'dest_ip');
            var dest_port = uci.get('qosmate', section_id, 'dest_port');

            var formatList = function(val) {
                if (!val) return '';
                return Array.isArray(val) ? val.join(' ') : val;
            };

            if (src_ip) parts.push(_('Src IP: ') + formatList(src_ip));
            if (src_port) parts.push(_('Src Port: ') + formatList(src_port));
            if (dest_ip) parts.push(_('Dst IP: ') + formatList(dest_ip));
            if (dest_port) parts.push(_('Dst Port: ') + formatList(dest_port));

            return parts.length > 0 ? parts.join(' | ') : _('Any');
        };

        o = s.option(form.DummyValue, 'dscp_class_tin', _('Priority Tin & DSCP Class'));
        o.modalonly = false;
        o.textvalue = function(section_id) {
            var cls = uci.get('qosmate', section_id, 'class') || 'cs0';
            cls = ('' + cls).toLowerCase();
            if (cls === 'le') cls = '1';

            var tinMeta = {
                'cs7':  { tin: 7, label: 'Tin 7: Network Control', color: '#8e44ad', bg: '#f4ecf7', dscp: 'CS7 (56)' },
                'cs6':  { tin: 7, label: 'Tin 7: Network Control', color: '#8e44ad', bg: '#f4ecf7', dscp: 'CS6 (48)' },
                'ef':   { tin: 6, label: 'Tin 6: Realtime / Gaming', color: '#27ae60', bg: '#eafaf1', dscp: 'EF (46)' },
                'va':   { tin: 6, label: 'Tin 6: Realtime / Voice', color: '#27ae60', bg: '#eafaf1', dscp: 'VA (44)' },
                'cs5':  { tin: 6, label: 'Tin 6: Realtime / Gaming', color: '#27ae60', bg: '#eafaf1', dscp: 'CS5 (40)' },
                'cs4':  { tin: 6, label: 'Tin 6: Realtime / Low Latency', color: '#27ae60', bg: '#eafaf1', dscp: 'CS4 (32)' },
                'cs2':  { tin: 5, label: 'Tin 5: Interactive Shell', color: '#17a2b8', bg: '#e8f8f5', dscp: 'CS2 (16)' },
                'af21': { tin: 4, label: 'Tin 4: Low-Latency Data', color: '#d35400', bg: '#fdf2e9', dscp: 'AF21 (18)' },
                'af22': { tin: 4, label: 'Tin 4: Low-Latency Data', color: '#d35400', bg: '#fdf2e9', dscp: 'AF22 (20)' },
                'af23': { tin: 4, label: 'Tin 4: Low-Latency Data', color: '#d35400', bg: '#fdf2e9', dscp: 'AF23 (22)' },
                'cs3':  { tin: 3, label: 'Tin 3: Video Streaming', color: '#b7950b', bg: '#fefde8', dscp: 'CS3 (24)' },
                'af41': { tin: 3, label: 'Tin 3: Video Streaming', color: '#b7950b', bg: '#fefde8', dscp: 'AF41 (34)' },
                'af42': { tin: 3, label: 'Tin 3: Video Streaming', color: '#b7950b', bg: '#fefde8', dscp: 'AF42 (36)' },
                'af43': { tin: 3, label: 'Tin 3: Video Streaming', color: '#b7950b', bg: '#fefde8', dscp: 'AF43 (38)' },
                'af31': { tin: 3, label: 'Tin 3: Multimedia Streaming', color: '#b7950b', bg: '#fefde8', dscp: 'AF31 (26)' },
                'af32': { tin: 3, label: 'Tin 3: Multimedia Streaming', color: '#b7950b', bg: '#fefde8', dscp: 'AF32 (28)' },
                'af33': { tin: 3, label: 'Tin 3: Multimedia Streaming', color: '#b7950b', bg: '#fefde8', dscp: 'AF33 (30)' },
                'cs0':  { tin: 2, label: 'Tin 2: Best Effort', color: '#566573', bg: '#ebedef', dscp: 'CS0 (0)' },
                'af11': { tin: 1, label: 'Tin 1: High Throughput', color: '#2e4053', bg: '#eaecee', dscp: 'AF11 (10)' },
                'af12': { tin: 1, label: 'Tin 1: High Throughput', color: '#2e4053', bg: '#eaecee', dscp: 'AF12 (12)' },
                'af13': { tin: 1, label: 'Tin 1: High Throughput', color: '#2e4053', bg: '#eaecee', dscp: 'AF13 (14)' },
                'cs1':  { tin: 1, label: 'Tin 1: Bulk Transfers', color: '#2e4053', bg: '#eaecee', dscp: 'CS1 (8)' },
                '1':    { tin: 0, label: 'Tin 0: Background Scavenger', color: '#7f8c8d', bg: '#f2f3f4', dscp: 'LE (1)' }
            };

            var meta = tinMeta[cls] || { tin: '?', label: 'Tin ?', color: '#888', bg: '#eee', dscp: cls.toUpperCase() };
            return E('span', {
                'style': 'display:inline-block; padding:2px 8px; border-radius:4px; font-weight:600; font-size:0.88em; color:' + meta.color + '; background-color:' + meta.bg + '; border:1px solid ' + meta.color + '40;'
            }, [
                meta.label + ' ',
                E('small', { 'style': 'font-weight:normal; opacity:0.85;' }, '[' + meta.dscp + ']')
            ]);
        };

        // Tab Options (Edit Dialog)
        o = s.taboption('general', form.Value, 'name', _('Name'));
        o.rmempty = false;
        o.modalonly = true;
              
        o = s.taboption('general', form.MultiValue, 'proto', _('Protocol'));
        o.value('tcp', _('TCP'));
        o.value('udp', _('UDP'));
        o.value('icmp', _('ICMP'));
        o.value('ipv6-icmp', _('ICMPv6'));
        o.rmempty = true;
        o.default = 'tcp udp';
        o.modalonly = true;
        
        o.cfgvalue = function(section_id) {
            var value = uci.get('qosmate', section_id, 'proto');
            if (Array.isArray(value)) {
                return value;
            } else if (typeof value === 'string') {
                return value.split(/\s+/);
            }
            return [];
        };
        
        o.write = function(section_id, value) {
            if (value && value.length) {
                uci.set('qosmate', section_id, 'proto', value.join(' '));
            } else {
                uci.unset('qosmate', section_id, 'proto');
            }
        };
        
        o.validate = function(section_id, value) {
            if (!value || value.length === 0) {
                return true;
            }
            
            var valid = ['tcp', 'udp', 'icmp', 'ipv6-icmp'];
            var toValidate = Array.isArray(value) ? value : value.split(/\s+/);
            
            for (var i = 0; i < toValidate.length; i++) {
                if (valid.indexOf(toValidate[i]) === -1) {
                    return _('Invalid protocol: %s').format(toValidate[i]);
                }
            }
            return true;
        };
        
        o.remove = function(section_id) {
            uci.unset('qosmate', section_id, 'proto');
        };

        o = s.taboption('general', form.DynamicList, 'src_ip', _('Source IP'));
        o.datatype = 'string';
        o.placeholder = _('IP address, range, @setname or ::suffix/::mask');
        o.rmempty = true;
        o.modalonly = true;
        o.validate = function(section_id, value) {
            return validateIPField(section_id, value);
        };
        o.write = function(section_id, formvalue) {
            var values = formvalue.map(function(v) {
                return v.replace(/^!(?!=)/, '!=');
            });
            return this.super('write', [section_id, values]);
        };
        
        o = s.taboption('general', form.DynamicList, 'src_port', _('Source port'));
		o.datatype = 'list(neg(portrange))';
        o.placeholder = _('any');
        o.rmempty = true;
        o.modalonly = true;
        o.write = function(section_id, formvalue) {
            var values;
            // Handle array and string inputs
            if (Array.isArray(formvalue)) {
                values = formvalue.map(function(v) {
                    // Also handle if individual values contain spaces
                    if (typeof v === 'string' && v.indexOf(' ') !== -1) {
                        return v.split(/\s+/).map(function(part) {
                            return part.replace(/^!(?!=)/, '!=');
                        }).join(' ');
                    }
                    return typeof v === 'string' ? v.replace(/^!(?!=)/, '!=') : v;
                });
            } else if (typeof formvalue === 'string') {
                // If it's a string, split by spaces and process each part
                values = formvalue.split(/\s+/).map(function(v) {
                    return v.replace(/^!(?!=)/, '!=');
                });
            } else {
                values = formvalue;
            }
            return this.super('write', [section_id, values]);
        };
        
        o = s.taboption('general', form.DynamicList, 'dest_ip', _('Destination IP'));
        o.datatype = 'string';
        o.placeholder = _('IP address, range, @setname or ::suffix/::mask');
        o.rmempty = true;
        o.modalonly = true;
        o.validate = function(section_id, value) {
            return validateIPField(section_id, value);
        };
        o.write = function(section_id, formvalue) {
            var values = formvalue.map(function(v) {
                return v.replace(/^!(?!=)/, '!=');
            });
            return this.super('write', [section_id, values]);
        };
        
        o = s.taboption('general', form.DynamicList, 'dest_port', _('Destination port'));
		o.datatype = 'list(neg(portrange))';
        o.placeholder = _('any');
        o.rmempty = true;
        o.modalonly = true;
        o.write = function(section_id, formvalue) {
            var values;
            // Handle array and string inputs
            if (Array.isArray(formvalue)) {
                values = formvalue.map(function(v) {
                    // Also handle if individual values contain spaces
                    if (typeof v === 'string' && v.indexOf(' ') !== -1) {
                        return v.split(/\s+/).map(function(part) {
                            return part.replace(/^!(?!=)/, '!=');
                        }).join(' ');
                    }
                    return typeof v === 'string' ? v.replace(/^!(?!=)/, '!=') : v;
                });
            } else if (typeof formvalue === 'string') {
                // If it's a string, split by spaces and process each part
                values = formvalue.split(/\s+/).map(function(v) {
                    return v.replace(/^!(?!=)/, '!=');
                });
            } else {
                values = formvalue;
            }
            return this.super('write', [section_id, values]);
        };

        o = s.taboption('general', form.ListValue, 'class', _('DSCP Class'));
        o.value('cs7', _('CS7 (56) - Tin 7: Network Control'));
        o.value('cs6', _('CS6 (48) - Tin 7: Network Control (DNS / NTP)'));
        o.value('ef', _('EF (46) - Tin 6: Realtime / Minimum Latency / Gaming'));
        o.value('va', _('VA (44) - Tin 6: Voice / Minimum Latency'));
        o.value('cs5', _('CS5 (40) - Tin 6: Gaming / Realtime'));
        o.value('cs4', _('CS4 (32) - Tin 6: Realtime / Low Latency'));
        o.value('cs2', _('CS2 (16) - Tin 5: Interactive Shell (SSH)'));
        o.value('af21', _('AF21 (18) - Tin 4: Low-Latency Data / Cloudflare Tunnel / Homelab'));
        o.value('af22', _('AF22 (20) - Tin 4: Low-Latency Data (Medium Drop)'));
        o.value('af23', _('AF23 (22) - Tin 4: Low-Latency Data (High Drop)'));
        o.value('cs3', _('CS3 (24) - Tin 3: Video Streaming'));
        o.value('af41', _('AF41 (34) - Tin 3: Video Streaming'));
        o.value('af42', _('AF42 (36) - Tin 3: Video Streaming (Boosted TCP)'));
        o.value('af43', _('AF43 (38) - Tin 3: Video Streaming'));
        o.value('af31', _('AF31 (26) - Tin 3: Multimedia Streaming'));
        o.value('af32', _('AF32 (28) - Tin 3: Multimedia Streaming'));
        o.value('af33', _('AF33 (30) - Tin 3: Multimedia Streaming'));
        o.value('cs0', _('CS0 (0) - Tin 2: Best Effort (General Web)'));
        o.value('af11', _('AF11 (10) - Tin 1: High Throughput'));
        o.value('af12', _('AF12 (12) - Tin 1: High Throughput'));
        o.value('af13', _('AF13 (14) - Tin 1: High Throughput'));
        o.value('cs1', _('CS1 (8) - Tin 1: Bulk Transfers / P2P'));
        o.value('1', _('LE (1) - Tin 0: Low Priority / Background Scavenger'));
        o.rmempty = false;
        o.modalonly = true;
        o.cfgvalue = function(section_id) {
            var val = uci.get('qosmate', section_id, 'class');
            if (!val) return 'cs0';
            val = ('' + val).toLowerCase();
            if (val === 'le' || val === 'lephb') return '1';
            return val;
        };
        o.write = function(section_id, formvalue) {
            if (formvalue) {
                var val = ('' + formvalue).toLowerCase();
                if (val === 'le' || val === 'lephb') val = '1';
                uci.set('qosmate', section_id, 'class', val);
            } else {
                uci.unset('qosmate', section_id, 'class');
            }
        };

        o = s.taboption('general', form.Flag, 'counter', _('Enable counter'));
        o.rmempty = false;
        o.modalonly = true;

        o = s.taboption('general', form.Flag, 'trace', _('Enable trace'));
        o.rmempty = false;
        o.default = '0';  // Default to disabled
        o.description = _('Debug only');
        o.modalonly = true;

        o = s.taboption('general', form.Flag, 'enabled', _('Enable'));
        o.rmempty = false;
        o.editable = true;
        o.default = '1';  // Set default value to enabled
        o.write = function(section_id, formvalue) {
            // Always write the value, whether it's '0' or '1'
            uci.set('qosmate', section_id, 'enabled', formvalue);
        };
        o.load = function(section_id) {
            var value = uci.get('qosmate', section_id, 'enabled');
            // If the value is undefined (not set in config), return '1' (enabled)
            return (value === undefined) ? '1' : value;
        };

        // Add counter activity column for live monitoring
        o = s.option(form.DummyValue, 'counter_activity', _('Activity'));
        o.modalonly = false;
        o.cfgvalue = function(section_id) {
            var counterEnabled = uci.get('qosmate', section_id, 'counter');
            if (counterEnabled !== '1') {
                return '-';
            }
            return 'loading...';
        };
        o.textvalue = function(section_id) {
            var counterEnabled = uci.get('qosmate', section_id, 'counter');
            if (counterEnabled !== '1') return '-';
            return 'loading...';
        };

        var self = this;
        // Store reference to the map for grid updates
        this.gridMap = m;
        this.gridSection = s;
        
        return m.render().then(function(rendered) {
            // Store view instance globally for textvalue access
            document.qosmateRulesView = self;
            
            // Start counter polling
            if (!self.pollHandler) {
                self.startCounterPolling();
            }
            
            return rendered;
        });
    },
    
    // Handle view destruction - cleanup polling
    handleDestroy: function() {
        this.stopCounterPolling();
    },
    
    // Handle window unload - cleanup polling
    handleUnload: function() {
        this.stopCounterPolling();
    }
});
