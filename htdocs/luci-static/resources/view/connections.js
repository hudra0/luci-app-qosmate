'use strict';
'require view';
'require poll';
'require rpc';
'require ui';
'require form';
'require uci';

var callGetHostSummaries = rpc.declare({
    object: 'luci.qosmate',
    method: 'getHostSummaries',
    expect: { }
});

var callGetDetailedConnections = rpc.declare({
    object: 'luci.qosmate',
    method: 'getConntrackDSCP',
    params: ['ip', 'limit', 'filter'],
    expect: { }
});

var dscpMap = {
    0: 'CS0',
    8: 'CS1',
    10: 'AF11',
    12: 'AF12',
    14: 'AF13',
    16: 'CS2',
    18: 'AF21',
    20: 'AF22',
    22: 'AF23',
    24: 'CS3',
    26: 'AF31',
    28: 'AF32',
    30: 'AF33',
    32: 'CS4',
    34: 'AF41',
    36: 'AF42',
    38: 'AF43',
    40: 'CS5',
    46: 'EF',
    48: 'CS6',
    56: 'CS7'
};

var dscpToString = function(mark) {
    var dscp = (typeof mark === 'number' ? mark : parseInt(mark, 10)) & 0x3F;
    return dscpMap[dscp] || ('DSCP-' + dscp);
};

var getDscpColor = function(mark) {
    var dscp = (typeof mark === 'number' ? mark : parseInt(mark, 10)) & 0x3F;
    if (dscp === 46 || dscp >= 48) return '#d9534f'; // High / Voice / Realtime (Red)
    if (dscp >= 32 && dscp <= 40) return '#f0ad4e';  // Video / Priority (Orange)
    if (dscp >= 18 && dscp <= 30) return '#0275d8';  // Critical / Bulk (Blue)
    if (dscp >= 8 && dscp <= 16) return '#5bc0de';   // Low / Background (Cyan)
    return '#6c757d';                                 // Default CS0 (Gray)
};

var formatSize = function(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    var sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
    if (i >= sizes.length) i = sizes.length - 1;
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2) + ' ' + sizes[i];
};

var formatSpeed = function(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0) return '0 bit/s';
    var bits = bytesPerSec * 8;
    if (bits >= 1000000000) return (bits / 1000000000).toFixed(2) + ' Gbit/s';
    if (bits >= 1000000) return (bits / 1000000).toFixed(2) + ' Mbit/s';
    if (bits >= 1000) return (bits / 1000).toFixed(2) + ' Kbit/s';
    return Math.round(bits) + ' bit/s';
};

var compareIps = function(a, b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    var aOctets = a.split('.').map(function(n) { return parseInt(n, 10) || 0; });
    var bOctets = b.split('.').map(function(n) { return parseInt(n, 10) || 0; });
    for (var i = 0; i < Math.max(aOctets.length, bOctets.length); i++) {
        var aNum = aOctets[i] || 0;
        var bNum = bOctets[i] || 0;
        if (aNum !== bNum) return aNum - bNum;
    }
    return a.localeCompare(b);
};

return view.extend({
    pollInterval: 2,
    filter: '',
    sortColumn: 'total_bytes',
    sortDescending: true,
    autoRefresh: true,
    refreshTimeout: null,
    hasPolledOnce: false,

    // State for hosts and details
    expandedHosts: {},          // { '192.168.1.100': true }
    hostHistory: {},            // { '192.168.1.100': { lastInBytes, lastOutBytes, lastTime, inSpeed, outSpeed } }
    hostDetailLimits: {},       // { '192.168.1.100': 100 }
    hostDetailFilters: {},      // { '192.168.1.100': '' }
    hostDetailSortColumn: {},   // { '192.168.1.100': 'total_bytes' }
    hostDetailSortDesc: {},     // { '192.168.1.100': true }
    cachedHostSummaries: { hosts: [], total_connections: 0, total_in_bytes: 0, total_out_bytes: 0 },
    cachedHostDetails: {},      // { '192.168.1.100': { list: [], total_connections: 0 } }
    detailConnHistory: {},      // { 'key': { lastInBytes, lastOutBytes, lastTime, inSpeed, outSpeed } }

    load: function() {
        return Promise.all([
            L.resolveDefault(callGetHostSummaries(), { hosts: [], total_connections: 0, total_in_bytes: 0, total_out_bytes: 0 }),
            uci.load('qosmate')
        ]);
    },

    render: function(data) {
        var view = this;
        var rawData = data[0] || {};
        if (Array.isArray(rawData)) {
            view.cachedHostSummaries = { hosts: rawData, total_connections: rawData.length, total_in_bytes: 0, total_out_bytes: 0 };
        } else if (rawData && rawData.hosts) {
            view.cachedHostSummaries = rawData;
        } else {
            view.cachedHostSummaries = { hosts: [], total_connections: 0, total_in_bytes: 0, total_out_bytes: 0 };
        }

        var style = E('style', {}, `
            .qm-conn-container {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .qm-stat-cards {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 12px;
                margin-bottom: 8px;
            }
            .qm-stat-card {
                background: rgba(128, 128, 128, 0.08);
                border: 1px solid rgba(128, 128, 128, 0.18);
                border-radius: 8px;
                padding: 12px 16px;
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                box-shadow: 0 2px 6px rgba(0,0,0,0.06);
                color: inherit;
            }
            .qm-stat-label {
                font-size: 0.82rem;
                opacity: 0.75;
                font-weight: 500;
                margin-bottom: 4px;
            }
            .qm-stat-val {
                font-size: 1.35rem;
                font-weight: bold;
            }
            .qm-host-row {
                cursor: pointer;
                transition: background-color 0.15s ease;
            }
            .qm-host-row:hover {
                background-color: rgba(0, 123, 255, 0.1) !important;
            }
            .qm-expand-icon {
                display: inline-block;
                width: 18px;
                text-align: center;
                font-weight: bold;
                font-size: 0.9rem;
                transition: transform 0.2s ease;
                color: #007bff;
            }
            .qm-expand-icon.expanded {
                transform: rotate(90deg);
            }
            .qm-hostname-tag {
                display: inline-block;
                background: rgba(128, 128, 128, 0.18);
                color: inherit;
                font-size: 0.75rem;
                padding: 1px 6px;
                border-radius: 4px;
                margin-left: 6px;
                max-width: 160px;
                overflow: hidden;
                text-overflow: ellipsis;
                vertical-align: middle;
            }
            .qm-badge {
                display: inline-block;
                padding: 2px 6px;
                font-size: 0.72rem;
                font-weight: 600;
                border-radius: 4px;
                color: #fff;
                margin-right: 4px;
                margin-bottom: 2px;
                white-space: nowrap;
            }
            .qm-detail-container {
                background: rgba(128, 128, 128, 0.06);
                border: 1px solid rgba(128, 128, 128, 0.18);
                border-radius: 8px;
                padding: 12px 14px;
                margin: 6px 0;
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
            }
            .qm-detail-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-wrap: wrap;
                gap: 8px;
                margin-bottom: 10px;
                padding-bottom: 8px;
                border-bottom: 1px solid rgba(128, 128, 128, 0.18);
            }
            .qm-sub-table {
                width: 100%;
                font-size: 0.82rem;
                margin-bottom: 0;
            }
            .qm-sub-table th, .qm-sub-table td {
                padding: 6px 8px !important;
                vertical-align: middle;
            }
            .qm-sort-header {
                cursor: pointer;
                user-select: none;
            }
            .qm-sort-header:hover {
                text-decoration: underline;
                color: #007bff;
            }
            .qm-sort-indicator {
                margin-left: 4px;
                font-size: 0.75rem;
            }
            .qm-progress-bar {
                height: 4px;
                background-color: #007bff;
                border-radius: 2px;
                margin-top: 3px;
            }
        `);

        // Filter input
        var filterInput = E('input', {
            'type': 'text',
            'placeholder': _('Filter by Host IP / Hostname / Protocol...'),
            'style': 'width: 280px;',
            'value': view.filter
        });

        filterInput.addEventListener('input', function(ev) {
            view.filter = ev.target.value.trim().toLowerCase();
            view.renderHostTable();
        });

        // Polling interval selector
        var pollSelect = E('select', {
            'id': 'poll_interval_select',
            'style': 'margin-left: 6px; padding: 2px 6px; font-size: 0.85rem;',
            'change': function(ev) {
                var val = parseInt(ev.target.value, 10);
                if (val === 0) {
                    view.autoRefresh = false;
                    clearTimeout(view.refreshTimeout);
                    pauseBtn.textContent = _('Resume');
                    pauseBtn.classList.replace('cbi-button-neutral', 'cbi-button-apply');
                } else {
                    view.pollInterval = val;
                    view.autoRefresh = true;
                    pauseBtn.textContent = _('Pause');
                    pauseBtn.classList.replace('cbi-button-apply', 'cbi-button-neutral');
                    clearTimeout(view.refreshTimeout);
                    adaptivePoll(view);
                }
            }
        }, [
            E('option', { 'value': '1', 'selected': view.pollInterval === 1 }, _('1s')),
            E('option', { 'value': '2', 'selected': view.pollInterval === 2 }, _('2s (Default)')),
            E('option', { 'value': '3', 'selected': view.pollInterval === 3 }, _('3s')),
            E('option', { 'value': '5', 'selected': view.pollInterval === 5 }, _('5s')),
            E('option', { 'value': '10', 'selected': view.pollInterval === 10 }, _('10s')),
            E('option', { 'value': '0', 'selected': !view.autoRefresh }, _('Paused'))
        ]);

        // Pause/Resume button
        var pauseBtn = E('button', {
            'class': 'cbi-button cbi-button-neutral',
            'style': 'margin-left: 6px;',
            'click': function(ev) {
                if (view.autoRefresh) {
                    clearTimeout(view.refreshTimeout);
                    view.autoRefresh = false;
                    this.textContent = _('Resume');
                    this.classList.replace('cbi-button-neutral', 'cbi-button-apply');
                    pollSelect.value = '0';
                } else {
                    view.autoRefresh = true;
                    this.textContent = _('Pause');
                    this.classList.replace('cbi-button-apply', 'cbi-button-neutral');
                    if (view.pollInterval === 0) view.pollInterval = 2;
                    pollSelect.value = view.pollInterval.toString();
                    adaptivePoll(view);
                }
            }
        }, _('Pause'));

        // Main table container
        var hostTable = E('table', { 'class': 'table cbi-section-table', 'id': 'qosmate_hosts_table' }, [
            E('tr', { 'class': 'tr table-titles' }, [
                E('th', { 'class': 'th', 'style': 'width: 40px; text-align: center;' }, ''),
                E('th', { 'class': 'th qm-sort-header', 'click': function() { view.setSort('ip'); } }, [ _('Host'), view.createSortIndicator('ip') ]),
                E('th', { 'class': 'th qm-sort-header', 'click': function() { view.setSort('connections'); } }, [ _('Active Connections'), view.createSortIndicator('connections') ]),
                E('th', { 'class': 'th qm-sort-header', 'click': function() { view.setSort('in_bytes'); } }, [ _('Download (In)'), view.createSortIndicator('in_bytes') ]),
                E('th', { 'class': 'th qm-sort-header', 'click': function() { view.setSort('out_bytes'); } }, [ _('Upload (Out)'), view.createSortIndicator('out_bytes') ]),
                E('th', { 'class': 'th qm-sort-header', 'click': function() { view.setSort('total_bytes'); } }, [ _('Total Traffic'), view.createSortIndicator('total_bytes') ]),
                E('th', { 'class': 'th qm-sort-header', 'click': function() { view.setSort('dscp'); } }, [ _('DSCP Classes'), view.createSortIndicator('dscp') ]),
                E('th', { 'class': 'th', 'style': 'text-align: right;' }, _('Actions'))
            ])
        ]);

        view.hostTableElement = hostTable;

        // Container
        var rootNode = E('div', { 'class': 'cbi-map qm-conn-container' }, [
            style,
            E('h2', _('QoSmate Active Connections & Host Overview')),
            E('div', { 'class': 'qm-stat-cards', 'id': 'qm_stat_cards' }, view.renderStatCards()),
            E('div', { 'style': 'display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;' }, [
                E('div', { 'style': 'display: flex; align-items: center; gap: 4px;' }, [
                    filterInput,
                    E('span', { 'style': 'font-size: 0.85rem; opacity: 0.8; margin-left: 8px;' }, _('Polling: ')),
                    pollSelect,
                    pauseBtn
                ]),
                E('div', { 'style': 'font-size: 0.85rem; opacity: 0.75;' }, 
                    _('Click any host row to expand and inspect detailed top connections.'))
            ]),
            E('div', { 'class': 'cbi-section' }, [
                E('div', { 'class': 'cbi-section-node table-wrapper' }, [
                    hostTable
                ])
            ])
        ]);

        view.renderHostTable();
        adaptivePoll(view);

        return rootNode;
    },

    setSort: function(column) {
        if (this.sortColumn === column) {
            this.sortDescending = !this.sortDescending;
        } else {
            this.sortColumn = column;
            this.sortDescending = true;
        }
        this.renderHostTable();
    },

    createSortIndicator: function(column) {
        var indicator = '';
        if (this.sortColumn === column) {
            indicator = this.sortDescending ? ' ▼' : ' ▲';
        }
        return E('span', { 'class': 'qm-sort-indicator' }, indicator);
    },

    renderStatCards: function() {
        var summaries = this.cachedHostSummaries || { hosts: [], total_connections: 0, total_in_bytes: 0, total_out_bytes: 0 };
        var hostCount = summaries.hosts ? summaries.hosts.length : 0;
        var totalConns = summaries.total_connections || 0;
        var totalIn = summaries.total_in_bytes || 0;
        var totalOut = summaries.total_out_bytes || 0;

        return [
            E('div', { 'class': 'qm-stat-card' }, [
                E('div', { 'class': 'qm-stat-label' }, _('Active Connections')),
                E('div', { 'class': 'qm-stat-val' }, totalConns.toLocaleString())
            ]),
            E('div', { 'class': 'qm-stat-card' }, [
                E('div', { 'class': 'qm-stat-label' }, _('Active Local Hosts')),
                E('div', { 'class': 'qm-stat-val' }, hostCount.toString())
            ]),
            E('div', { 'class': 'qm-stat-card' }, [
                E('div', { 'class': 'qm-stat-label' }, _('Total Inbound Traffic')),
                E('div', { 'class': 'qm-stat-val', 'style': 'color: #28a745;' }, formatSize(totalIn))
            ]),
            E('div', { 'class': 'qm-stat-card' }, [
                E('div', { 'class': 'qm-stat-label' }, _('Total Outbound Traffic')),
                E('div', { 'class': 'qm-stat-val', 'style': 'color: #007bff;' }, formatSize(totalOut))
            ])
        ];
    },

    updateStatCards: function() {
        var cardsContainer = document.getElementById('qm_stat_cards');
        if (cardsContainer) {
            var newCards = this.renderStatCards();
            cardsContainer.innerHTML = '';
            newCards.forEach(function(card) {
                cardsContainer.appendChild(card);
            });
        }
    },

    toggleHostExpand: function(ip) {
        var view = this;
        if (view.expandedHosts[ip]) {
            delete view.expandedHosts[ip];
        } else {
            view.expandedHosts[ip] = true;
            if (!view.hostDetailLimits[ip]) {
                view.hostDetailLimits[ip] = 100;
            }
            if (!view.hostDetailSortColumn[ip]) {
                view.hostDetailSortColumn[ip] = 'total_bytes';
                view.hostDetailSortDesc[ip] = true;
            }
            view.fetchHostDetails(ip);
        }
        view.renderHostTable();
    },

    fetchHostDetails: function(ip) {
        var view = this;
        var limit = view.hostDetailLimits[ip] || 100;
        var filter = view.hostDetailFilters[ip] || '';

        return callGetDetailedConnections(ip, limit, filter).then(function(res) {
            view.cachedHostDetails[ip] = res || { list: [], total_connections: 0 };
            view.updateHostDetailSubTable(ip);
        }).catch(function(err) {
            console.error('Error loading details for ' + ip, err);
        });
    },

    setDetailSort: function(ip, column) {
        var view = this;
        if (view.hostDetailSortColumn[ip] === column) {
            view.hostDetailSortDesc[ip] = !view.hostDetailSortDesc[ip];
        } else {
            view.hostDetailSortColumn[ip] = column;
            view.hostDetailSortDesc[ip] = true;
        }
        view.updateHostDetailSubTable(ip);
    },

    createDetailSortIndicator: function(ip, column) {
        var indicator = '';
        if (this.hostDetailSortColumn[ip] === column) {
            indicator = this.hostDetailSortDesc[ip] ? ' ▼' : ' ▲';
        }
        return E('span', { 'class': 'qm-sort-indicator' }, indicator);
    },

    renderHostTable: function() {
        var view = this;
        var table = view.hostTableElement;
        if (!table) return;

        // Clear existing data rows (keep header)
        while (table.rows.length > 1) {
            table.deleteRow(1);
        }

        var summaries = view.cachedHostSummaries || { hosts: [], total_connections: 0, total_in_bytes: 0, total_out_bytes: 0 };
        var hosts = summaries.hosts || [];
        var totalTrafficAll = (summaries.total_in_bytes || 0) + (summaries.total_out_bytes || 0);

        // Filter hosts
        var filteredHosts = hosts.filter(function(h) {
            if (!view.filter) return true;
            var q = view.filter;
            if (h.ip && h.ip.toLowerCase().indexOf(q) !== -1) return true;
            if (h.hostname && h.hostname.toLowerCase().indexOf(q) !== -1) return true;
            return false;
        });

        // Helper to get top DSCP mark for host
        var getHostTopDscp = function(h) {
            if (!h.dscp_counts) return 0;
            var keys = Object.keys(h.dscp_counts);
            if (keys.length === 0) return 0;
            keys.sort(function(k1, k2) { return h.dscp_counts[k2] - h.dscp_counts[k1]; });
            return parseInt(keys[0], 10) || 0;
        };

        // Sort hosts
        filteredHosts.sort(function(a, b) {
            var aVal, bVal;
            switch(view.sortColumn) {
                case 'ip':
                    return view.sortDescending ? compareIps(b.ip, a.ip) : compareIps(a.ip, b.ip);
                case 'connections':
                    aVal = a.connections || 0;
                    bVal = b.connections || 0;
                    break;
                case 'in_bytes':
                    aVal = a.in_bytes || 0;
                    bVal = b.in_bytes || 0;
                    break;
                case 'out_bytes':
                    aVal = a.out_bytes || 0;
                    bVal = b.out_bytes || 0;
                    break;
                case 'dscp':
                    aVal = getHostTopDscp(a);
                    bVal = getHostTopDscp(b);
                    break;
                case 'total_bytes':
                default:
                    aVal = (a.in_bytes || 0) + (a.out_bytes || 0);
                    bVal = (b.in_bytes || 0) + (b.out_bytes || 0);
                    break;
            }

            return view.sortDescending ? (bVal - aVal) : (aVal - bVal);
        });

        if (filteredHosts.length === 0) {
            table.appendChild(E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td', 'colspan': '8', 'style': 'text-align: center; opacity: 0.7; padding: 24px;' },
                    _('No active host connections recorded.'))
            ]));
            return;
        }

        var currentTime = Date.now();

        filteredHosts.forEach(function(host) {
            var isExpanded = !!view.expandedHosts[host.ip];
            var hostTotalBytes = (host.in_bytes || 0) + (host.out_bytes || 0);
            var trafficPercent = totalTrafficAll > 0 ? ((hostTotalBytes / totalTrafficAll) * 100).toFixed(1) : 0;

            // Rate calculation for host
            var history = view.hostHistory[host.ip];
            var inSpeed = 0, outSpeed = 0;
            if (history && history.lastTime && currentTime > history.lastTime) {
                var timeDelta = (currentTime - history.lastTime) / 1000;
                if (timeDelta > 0) {
                    var inDelta = Math.max(0, (host.in_bytes || 0) - history.lastInBytes);
                    var outDelta = Math.max(0, (host.out_bytes || 0) - history.lastOutBytes);
                    inSpeed = Math.round(inDelta / timeDelta);
                    outSpeed = Math.round(outDelta / timeDelta);
                }
            }
            view.hostHistory[host.ip] = {
                lastInBytes: host.in_bytes || 0,
                lastOutBytes: host.out_bytes || 0,
                lastTime: currentTime,
                inSpeed: inSpeed,
                outSpeed: outSpeed
            };

            // DSCP Badges
            var dscpBadges = [];
            if (host.dscp_counts) {
                var dscpKeys = Object.keys(host.dscp_counts);
                dscpKeys.sort(function(k1, k2) { return host.dscp_counts[k2] - host.dscp_counts[k1]; });
                dscpKeys.slice(0, 3).forEach(function(dKey) {
                    var count = host.dscp_counts[dKey];
                    var pct = host.connections > 0 ? Math.round((count / host.connections) * 100) : 0;
                    var label = dscpToString(parseInt(dKey, 10)) + ' (' + pct + '%)';
                    dscpBadges.push(E('span', {
                        'class': 'qm-badge',
                        'style': 'background-color: ' + getDscpColor(parseInt(dKey, 10)) + ';'
                    }, label));
                });
            }

            // Expand icon
            var expandIcon = E('span', {
                'class': 'qm-expand-icon' + (isExpanded ? ' expanded' : '')
            }, '▶');

            // Host column elements
            var hostElements = [ E('strong', {}, host.ip) ];
            if (host.hostname) {
                hostElements.push(E('span', { 'class': 'qm-hostname-tag', 'title': host.hostname }, host.hostname));
            }

            // Connection breakdown info
            var protoInfo = [];
            if (host.tcp_conns > 0) protoInfo.push('TCP: ' + host.tcp_conns);
            if (host.udp_conns > 0) protoInfo.push('UDP: ' + host.udp_conns);
            if (host.other_conns > 0) protoInfo.push('Other: ' + host.other_conns);

            var hostRow = E('tr', {
                'class': 'tr qm-host-row' + (isExpanded ? ' selected' : ''),
                'click': function(ev) {
                    if (ev.target.tagName !== 'BUTTON' && ev.target.tagName !== 'SELECT' && ev.target.tagName !== 'INPUT') {
                        view.toggleHostExpand(host.ip);
                    }
                }
            }, [
                E('td', { 'class': 'td', 'style': 'text-align: center;' }, expandIcon),
                E('td', { 'class': 'td' }, hostElements),
                E('td', { 'class': 'td' }, [
                    E('span', { 'style': 'font-weight: 600;' }, (host.connections || 0).toLocaleString()),
                    E('div', { 'style': 'font-size: 0.72rem; opacity: 0.7;' }, protoInfo.join(' | '))
                ]),
                E('td', { 'class': 'td' }, [
                    E('span', {}, formatSize(host.in_bytes)),
                    inSpeed > 0 ? E('div', { 'style': 'font-size: 0.75rem; color: #28a745;' }, '↓ ' + formatSpeed(inSpeed)) : ''
                ]),
                E('td', { 'class': 'td' }, [
                    E('span', {}, formatSize(host.out_bytes)),
                    outSpeed > 0 ? E('div', { 'style': 'font-size: 0.75rem; color: #007bff;' }, '↑ ' + formatSpeed(outSpeed)) : ''
                ]),
                E('td', { 'class': 'td' }, [
                    E('span', { 'style': 'font-weight: 500;' }, formatSize(hostTotalBytes)),
                    E('div', { 'style': 'font-size: 0.72rem; opacity: 0.7;' }, trafficPercent + '%'),
                    E('div', { 'class': 'qm-progress-bar', 'style': 'width: ' + Math.min(100, trafficPercent) + '%;' })
                ]),
                E('td', { 'class': 'td' }, dscpBadges.length > 0 ? dscpBadges : '-'),
                E('td', { 'class': 'td', 'style': 'text-align: right;' }, [
                    E('button', {
                        'class': 'cbi-button ' + (isExpanded ? 'cbi-button-reset' : 'cbi-button-action'),
                        'style': 'padding: 2px 8px; font-size: 0.8rem;',
                        'click': function(ev) {
                            ev.stopPropagation();
                            view.toggleHostExpand(host.ip);
                        }
                    }, isExpanded ? _('Collapse') : _('Details'))
                ])
            ]);

            table.appendChild(hostRow);

            // If expanded, insert detailed sub-row
            if (isExpanded) {
                var detailRow = E('tr', { 'class': 'tr qm-detail-row' }, [
                    E('td', { 'class': 'td', 'colspan': '8', 'style': 'padding: 0;' }, [
                        view.renderHostDetailContainer(host.ip)
                    ])
                ]);
                table.appendChild(detailRow);
            }
        });
    },

    renderHostDetailContainer: function(ip) {
        var view = this;
        var currentLimit = view.hostDetailLimits[ip] || 100;
        var currentFilter = view.hostDetailFilters[ip] || '';
        var cached = view.cachedHostDetails[ip] || { list: [], total_connections: 0 };
        var list = cached.list || (cached.connections ? Object.values(cached.connections) : []);
        var totalConns = cached.total_connections || list.length;

        // Sub-filter input
        var subFilterInput = E('input', {
            'type': 'text',
            'placeholder': _('Filter Remote IP / Port / Protocol / DSCP...'),
            'style': 'width: 250px; font-size: 0.82rem; padding: 2px 6px;',
            'value': currentFilter
        });

        subFilterInput.addEventListener('input', function(ev) {
            view.hostDetailFilters[ip] = ev.target.value.trim().toLowerCase();
            view.fetchHostDetails(ip);
        });

        // Limit dropdown
        var limitSelect = E('select', {
            'style': 'font-size: 0.82rem; padding: 2px 4px;',
            'change': function(ev) {
                view.hostDetailLimits[ip] = parseInt(ev.target.value, 10);
                view.fetchHostDetails(ip);
            }
        }, [
            E('option', { 'value': '50', 'selected': currentLimit === 50 }, 'Top 50'),
            E('option', { 'value': '100', 'selected': currentLimit === 100 }, 'Top 100'),
            E('option', { 'value': '200', 'selected': currentLimit === 200 }, 'Top 200'),
            E('option', { 'value': '500', 'selected': currentLimit === 500 }, 'Top 500')
        ]);

        var subTable = E('table', { 'class': 'table cbi-section-table qm-sub-table', 'id': 'qm_subtable_' + ip.replace(/[^a-zA-Z0-9]/g, '_') }, [
            E('tr', { 'class': 'tr table-titles' }, [
                E('th', { 'class': 'th qm-sort-header', 'click': function() { view.setDetailSort(ip, 'protocol'); } }, [ _('Protocol'), view.createDetailSortIndicator(ip, 'protocol') ]),
                E('th', { 'class': 'th qm-sort-header', 'click': function() { view.setDetailSort(ip, 'sport'); } }, [ _('Local Endpoint'), view.createDetailSortIndicator(ip, 'sport') ]),
                E('th', { 'class': 'th qm-sort-header', 'click': function() { view.setDetailSort(ip, 'dst'); } }, [ _('Remote Endpoint'), view.createDetailSortIndicator(ip, 'dst') ]),
                E('th', { 'class': 'th qm-sort-header', 'click': function() { view.setDetailSort(ip, 'dscp'); } }, [ _('DSCP'), view.createDetailSortIndicator(ip, 'dscp') ]),
                E('th', { 'class': 'th qm-sort-header', 'click': function() { view.setDetailSort(ip, 'in_bytes'); } }, [ _('Download (In)'), view.createDetailSortIndicator(ip, 'in_bytes') ]),
                E('th', { 'class': 'th qm-sort-header', 'click': function() { view.setDetailSort(ip, 'out_bytes'); } }, [ _('Upload (Out)'), view.createDetailSortIndicator(ip, 'out_bytes') ]),
                E('th', { 'class': 'th qm-sort-header', 'click': function() { view.setDetailSort(ip, 'packets'); } }, [ _('Packets'), view.createDetailSortIndicator(ip, 'packets') ]),
                E('th', { 'class': 'th qm-sort-header', 'click': function() { view.setDetailSort(ip, 'state'); } }, [ _('State'), view.createDetailSortIndicator(ip, 'state') ])
            ])
        ]);

        view.populateSubTableRows(subTable, ip, list);

        return E('div', { 'class': 'qm-detail-container' }, [
            E('div', { 'class': 'qm-detail-header' }, [
                E('div', { 'style': 'font-size: 0.85rem;' }, [
                    E('strong', {}, _('Connections for ') + ip + ': '),
                    E('span', { 'class': 'qm-badge', 'style': 'background-color: #17a2b8;' }, totalConns.toLocaleString() + ' ' + _('total conns')),
                    E('span', { 'style': 'opacity: 0.75; margin-left: 6px;' }, _('(Showing top %d by volume)').format(list.length))
                ]),
                E('div', { 'style': 'display: flex; align-items: center; gap: 8px;' }, [
                    subFilterInput,
                    limitSelect,
                    E('button', {
                        'class': 'cbi-button cbi-button-action',
                        'style': 'padding: 2px 8px; font-size: 0.8rem;',
                        'click': function() {
                            view.fetchHostDetails(ip);
                        }
                    }, _('Refresh'))
                ])
            ]),
            E('div', { 'class': 'table-wrapper' }, [
                subTable
            ])
        ]);
    },

    populateSubTableRows: function(table, ip, list) {
        var view = this;
        // Keep header
        while (table.rows.length > 1) {
            table.deleteRow(1);
        }

        if (!list || list.length === 0) {
            table.appendChild(E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td', 'colspan': '8', 'style': 'text-align: center; opacity: 0.7; padding: 16px;' },
                    _('No matching connection details found.'))
            ]));
            return;
        }

        var sortedList = list.slice();
        var sortCol = view.hostDetailSortColumn[ip] || 'total_bytes';
        var sortDesc = view.hostDetailSortDesc[ip] !== false;

        sortedList.sort(function(a, b) {
            var aVal, bVal;
            switch(sortCol) {
                case 'protocol':
                    aVal = a.protocol || '';
                    bVal = b.protocol || '';
                    return sortDesc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
                case 'sport':
                    aVal = parseInt(a.sport, 10) || 0;
                    bVal = parseInt(b.sport, 10) || 0;
                    break;
                case 'dst':
                    var aDst = (a.dst || '') + ':' + (a.dport || '');
                    var bDst = (b.dst || '') + ':' + (b.dport || '');
                    return sortDesc ? bDst.localeCompare(aDst) : aDst.localeCompare(bDst);
                case 'dscp':
                    aVal = parseInt(a.dscp, 10) || 0;
                    bVal = parseInt(b.dscp, 10) || 0;
                    break;
                case 'in_bytes':
                    aVal = a.in_bytes || 0;
                    bVal = b.in_bytes || 0;
                    break;
                case 'out_bytes':
                    aVal = a.out_bytes || 0;
                    bVal = b.out_bytes || 0;
                    break;
                case 'packets':
                    aVal = (a.in_packets || 0) + (a.out_packets || 0);
                    bVal = (b.in_packets || 0) + (b.out_packets || 0);
                    break;
                case 'state':
                    aVal = a.state || '';
                    bVal = b.state || '';
                    return sortDesc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
                case 'total_bytes':
                default:
                    aVal = (a.in_bytes || 0) + (a.out_bytes || 0);
                    bVal = (b.in_bytes || 0) + (b.out_bytes || 0);
                    break;
            }
            return sortDesc ? (bVal - aVal) : (aVal - bVal);
        });

        var currentTime = Date.now();

        sortedList.forEach(function(conn) {
            var connKey = (conn.layer3 || 'ip') + ':' + (conn.protocol || '') + ':' + (conn.src || '') + ':' + (conn.sport || '') + ':' + (conn.dst || '') + ':' + (conn.dport || '');
            var history = view.detailConnHistory[connKey];
            var inSpeed = 0, outSpeed = 0;

            if (history && history.lastTime && currentTime > history.lastTime) {
                var timeDelta = (currentTime - history.lastTime) / 1000;
                if (timeDelta > 0) {
                    var inDelta = Math.max(0, (conn.in_bytes || 0) - history.lastInBytes);
                    var outDelta = Math.max(0, (conn.out_bytes || 0) - history.lastOutBytes);
                    inSpeed = Math.round(inDelta / timeDelta);
                    outSpeed = Math.round(outDelta / timeDelta);
                }
            }

            view.detailConnHistory[connKey] = {
                lastInBytes: conn.in_bytes || 0,
                lastOutBytes: conn.out_bytes || 0,
                lastTime: currentTime,
                inSpeed: inSpeed,
                outSpeed: outSpeed
            };

            var localEndpoint = conn.src + (conn.sport && conn.sport !== '-' ? ':' + conn.sport : '');
            var remoteEndpoint = conn.dst + (conn.dport && conn.dport !== '-' ? ':' + conn.dport : '');
            var dscpNum = typeof conn.dscp === 'number' ? conn.dscp : parseInt(conn.dscp || '0', 10);

            table.appendChild(E('tr', { 'class': 'tr' }, [
                E('td', { 'class': 'td' }, E('span', { 'class': 'qm-badge', 'style': 'background-color: #6c757d;' }, (conn.protocol || '').toUpperCase())),
                E('td', { 'class': 'td' }, localEndpoint),
                E('td', { 'class': 'td' }, remoteEndpoint),
                E('td', { 'class': 'td' }, E('span', {
                    'class': 'qm-badge',
                    'style': 'background-color: ' + getDscpColor(dscpNum) + ';'
                }, dscpToString(dscpNum))),
                E('td', { 'class': 'td' }, [
                    E('span', {}, formatSize(conn.in_bytes)),
                    inSpeed > 0 ? E('div', { 'style': 'font-size: 0.72rem; color: #28a745;' }, '↓ ' + formatSpeed(inSpeed)) : ''
                ]),
                E('td', { 'class': 'td' }, [
                    E('span', {}, formatSize(conn.out_bytes)),
                    outSpeed > 0 ? E('div', { 'style': 'font-size: 0.72rem; color: #007bff;' }, '↑ ' + formatSpeed(outSpeed)) : ''
                ]),
                E('td', { 'class': 'td', 'style': 'font-size: 0.75rem;' }, [
                    E('div', {}, '↓ ' + (conn.in_packets || 0).toLocaleString() + ' pkts'),
                    E('div', {}, '↑ ' + (conn.out_packets || 0).toLocaleString() + ' pkts')
                ]),
                E('td', { 'class': 'td' }, [
                    E('span', {
                        'class': 'qm-badge',
                        'style': 'background-color: ' + (conn.state === 'ASSURED' ? '#28a745' : '#ffc107; color: #333;')
                    }, conn.state || 'UNKNOWN')
                ])
            ]));
        });
    },

    updateHostDetailSubTable: function(ip) {
        var tableId = 'qm_subtable_' + ip.replace(/[^a-zA-Z0-9]/g, '_');
        var subTable = document.getElementById(tableId);
        if (subTable) {
            var cached = this.cachedHostDetails[ip] || { list: [] };
            var list = cached.list || (cached.connections ? Object.values(cached.connections) : []);
            this.populateSubTableRows(subTable, ip, list);
        }
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});

// Adaptive polling loop
function adaptivePoll(view) {
    if (!view.autoRefresh) {
        return;
    }

    var startTime = Date.now();
    var expandedIps = Object.keys(view.expandedHosts);

    // Prepare promises: Host summaries + Detail queries for expanded hosts
    var promises = [
        L.resolveDefault(callGetHostSummaries(), { hosts: [], total_connections: 0, total_in_bytes: 0, total_out_bytes: 0 })
    ];

    expandedIps.forEach(function(ip) {
        var limit = view.hostDetailLimits[ip] || 100;
        var filter = view.hostDetailFilters[ip] || '';
        promises.push(
            L.resolveDefault(callGetDetailedConnections(ip, limit, filter), { list: [], total_connections: 0 })
                .then(function(res) {
                    return { ip: ip, data: res };
                })
        );
    });

    Promise.all(promises).then(function(results) {
        var responseTime = Date.now() - startTime;

        // Adaptive interval adjustment
        if (!view.hasPolledOnce) {
            view.hasPolledOnce = true;
        } else if (responseTime > 2500) {
            view.pollInterval = Math.min(view.pollInterval + 1, 10);
            var pollSel = document.getElementById('poll_interval_select');
            if (pollSel && view.autoRefresh) pollSel.value = view.pollInterval.toString();
        }

        // Host summaries result
        var rawSummaries = results[0] || {};
        if (Array.isArray(rawSummaries)) {
            view.cachedHostSummaries = { hosts: rawSummaries, total_connections: rawSummaries.length, total_in_bytes: 0, total_out_bytes: 0 };
        } else if (rawSummaries && rawSummaries.hosts) {
            view.cachedHostSummaries = rawSummaries;
        }
        
        view.updateStatCards();
        view.renderHostTable();

        // Host details results
        for (var i = 1; i < results.length; i++) {
            var detailItem = results[i];
            if (detailItem && detailItem.ip) {
                view.cachedHostDetails[detailItem.ip] = detailItem.data;
                view.updateHostDetailSubTable(detailItem.ip);
            }
        }
    }).catch(function(err) {
        console.error('QoSmate connection polling error:', err);
    }).finally(function() {
        if (view.autoRefresh) {
            view.refreshTimeout = setTimeout(function() {
                adaptivePoll(view);
            }, (view.pollInterval || 2) * 1000);
        }
    });
}
