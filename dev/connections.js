'use strict';
'require view';
'require poll';
'require rpc';
'require ui';
'require form';

var callQoSmateConntrackDSCP = rpc.declare({
    object: 'luci.qosmate',
    method: 'getConntrackDSCP',
    expect: { }
});

var dscpToString = function(mark) {
    var dscp = mark & 0x3F;
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
    return dscpMap[dscp] || dscp.toString();
};

var formatSize = function(bytes) {
    var sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    if (bytes == 0) return '0 B';
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
};

var convertToKbps = function(bytesPerSecond) {
    return (bytesPerSecond * 8 / 1000).toFixed(2) + ' Kbit/s';
};

return view.extend({
    pollInterval: 1,
    lastData: {},
    filter: '',
    sortColumn: 'bytes',
    sortDescending: true,
    connectionHistory: {},
    historyLength: 10,
    lastUpdateTime: 0,

    load: function() {
        return Promise.all([
            callQoSmateConntrackDSCP()
        ]);
    },

    render: function(data) {
        var view = this;
        var connections = [];
        if (data[0] && data[0].connections) {
            connections = Object.values(data[0].connections);
        }

        var filterInput = E('input', {
            'type': 'text',
            'placeholder': _('Filter by IP, IP:Port, Port, Protocol or DSCP'),
            'style': 'margin-bottom: 10px; width: 300px;',
            'value': view.filter
        });

        filterInput.addEventListener('input', function(ev) {
            view.filter = ev.target.value.toLowerCase();
            view.updateTable(connections);
        });

        var table = E('table', { 'class': 'table cbi-section-table', 'id': 'qosmate_connections' }, [
            E('tr', { 'class': 'tr table-titles' }, [
                E('th', { 'class': 'th' }, E('a', { 'href': '#', 'click': this.sortTable.bind(this, 'protocol') }, [ _('Protocol'), this.createSortIndicator('protocol') ])),
                E('th', { 'class': 'th' }, E('a', { 'href': '#', 'click': this.sortTable.bind(this, 'src') }, [ _('Source'), this.createSortIndicator('src') ])),
                E('th', { 'class': 'th' }, E('a', { 'href': '#', 'click': this.sortTable.bind(this, 'dst') }, [ _('Destination'), this.createSortIndicator('dst') ])),
                E('th', { 'class': 'th' }, E('a', { 'href': '#', 'click': this.sortTable.bind(this, 'dscp') }, [ _('DSCP'), this.createSortIndicator('dscp') ])),
                E('th', { 'class': 'th' }, E('a', { 'href': '#', 'click': this.sortTable.bind(this, 'bytes') }, [ _('Bytes'), this.createSortIndicator('bytes') ])),
                E('th', { 'class': 'th' }, E('a', { 'href': '#', 'click': this.sortTable.bind(this, 'packets') }, [ _('Packets'), this.createSortIndicator('packets') ])),
                E('th', { 'class': 'th' }, E('a', { 'href': '#', 'click': this.sortTable.bind(this, 'avgPps') }, [ _('Avg PPS'), this.createSortIndicator('avgPps') ])),
                E('th', { 'class': 'th' }, E('a', { 'href': '#', 'click': this.sortTable.bind(this, 'maxPps') }, [ _('Max PPS'), this.createSortIndicator('maxPps') ])),
                E('th', { 'class': 'th' }, E('a', { 'href': '#', 'click': this.sortTable.bind(this, 'avgBps') }, [ _('Avg BPS'), this.createSortIndicator('avgBps') ]))
            ])
        ]);

        view.updateTable = function(connections) {
            // Remove all rows except the header
            while (table.rows.length > 1) {
                table.deleteRow(1);
            }

            var currentTime = Date.now() / 1000;
            var timeDiff = currentTime - view.lastUpdateTime;
            view.lastUpdateTime = currentTime;

            connections.forEach(function(conn) {
                var key = conn.layer3 + conn.protocol + conn.src + conn.sport + conn.dst + conn.dport;
                var lastConn = view.lastData[key];
                
                if (!view.connectionHistory[key]) {
                    view.connectionHistory[key] = {
                        ppsHistory: [],
                        bpsHistory: [],
                        lastPackets: conn.packets,
                        lastBytes: conn.bytes,
                        lastTimestamp: currentTime
                    };
                }

                var history = view.connectionHistory[key];
                var instantPps = 0;
                var instantBps = 0;

                if (lastConn && timeDiff > 0) {
                    var packetDiff = Math.max(0, conn.packets - history.lastPackets);
                    var bytesDiff = Math.max(0, conn.bytes - history.lastBytes);
                    instantPps = Math.round(packetDiff / timeDiff);
                    instantBps = Math.round(bytesDiff / timeDiff);

                    history.ppsHistory.push(instantPps);
                    history.bpsHistory.push(instantBps);

                    if (history.ppsHistory.length > view.historyLength) {
                        history.ppsHistory.shift();
                        history.bpsHistory.shift();
                    }
                }

                history.lastPackets = conn.packets;
                history.lastBytes = conn.bytes;
                history.lastTimestamp = currentTime;

                var avgPps = Math.round(history.ppsHistory.reduce((a, b) => a + b, 0) / history.ppsHistory.length) || 0;
                var avgBps = Math.round(history.bpsHistory.reduce((a, b) => a + b, 0) / history.bpsHistory.length) || 0;
                var maxPps = Math.max(...history.ppsHistory, 0);

                conn.avgPps = avgPps;
                conn.maxPps = maxPps;
                conn.avgBps = avgBps;
                view.lastData[key] = conn;
            });

            connections.sort(view.sortFunction.bind(view));

            connections.forEach(function(conn) {
                var srcFull = conn.src + ':' + (conn.sport || '-');
                var dstFull = conn.dst + ':' + (conn.dport || '-');
                var dscpString = dscpToString(conn.dscp);
                
                if (view.filter && !(
                    conn.protocol.toLowerCase().includes(view.filter) ||
                    srcFull.toLowerCase().includes(view.filter) ||
                    dstFull.toLowerCase().includes(view.filter) ||
                    dscpString.toLowerCase().includes(view.filter)
                )) {
                    return;
                }

                table.appendChild(E('tr', { 'class': 'tr' }, [
                    E('td', { 'class': 'td' }, conn.protocol.toUpperCase()),
                    E('td', { 'class': 'td' }, srcFull),
                    E('td', { 'class': 'td' }, dstFull),
                    E('td', { 'class': 'td' }, dscpString), 
                    E('td', { 'class': 'td' }, formatSize(conn.bytes)),
                    E('td', { 'class': 'td' }, conn.packets),
                    E('td', { 'class': 'td' }, conn.avgPps),
                    E('td', { 'class': 'td' }, conn.maxPps),
                    E('td', { 'class': 'td' }, convertToKbps(conn.avgBps))
                ]));
            });
            view.updateSortIndicators();            
        };

        view.updateTable(connections);
        this.updateSortIndicators();

        poll.add(function() {
            return callQoSmateConntrackDSCP().then(function(result) {
                if (result && result.connections) {
                    view.updateTable(Object.values(result.connections));
                } else {
                    console.error('Invalid data received:', result);
                }
            });
        }, view.pollInterval);

        var style = E('style', {}, `
            .sort-indicator {
                display: inline-block;
                width: 0;
                height: 0;
                margin-left: 5px;
                vertical-align: middle;
            }
        `);
        
        return E('div', { 'class': 'cbi-map' }, [
            style,
            E('h2', _('QoSmate Connections')),
            E('div', { 'style': 'margin-bottom: 10px;' }, [
                filterInput
            ]),
            E('div', { 'class': 'cbi-section' }, [
                E('div', { 'class': 'cbi-section-node' }, [
                    table
                ])
            ])
        ]);
    },

    sortTable: function(column, ev) {
        ev.preventDefault();
        if (this.sortColumn === column) {
            this.sortDescending = !this.sortDescending;
        } else {
            this.sortColumn = column;
            this.sortDescending = true;
        }
        var connections = Object.values(this.lastData);
        this.updateTable(connections);
        this.updateSortIndicators();
    },

    sortFunction: function(a, b) {
        var aValue = a[this.sortColumn];
        var bValue = b[this.sortColumn];
        
        if (typeof aValue === 'string') aValue = aValue.toLowerCase();
        if (typeof bValue === 'string') bValue = bValue.toLowerCase();

        if (this.sortColumn === 'bytes' || this.sortColumn === 'packets' || 
            this.sortColumn === 'avgPps' || this.sortColumn === 'maxPps' || 
            this.sortColumn === 'avgBps') {
            aValue = Number(aValue);
            bValue = Number(bValue);
        }

        if (aValue < bValue) return this.sortDescending ? 1 : -1;
        if (aValue > bValue) return this.sortDescending ? -1 : 1;
        return 0;
    },

    createSortIndicator: function(column) {
        return E('span', { 'class': 'sort-indicator', 'data-column': column }, '');
    },

    updateSortIndicators: function() {
        var indicators = document.querySelectorAll('.sort-indicator');
        indicators.forEach(function(indicator) {
            if (indicator.dataset.column === this.sortColumn) {
                indicator.textContent = this.sortDescending ? ' ▼' : ' ▲';
            } else {
                indicator.textContent = '';
            }
        }.bind(this));
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
