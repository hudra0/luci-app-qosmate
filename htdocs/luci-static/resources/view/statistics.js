'use strict';
'require view';
'require poll';
'require rpc';
'require ui';
'require form';
'require dom';
'require fs';
'require uci';

// ==============================================================================
// QoSmate Modern Statistics Dashboard (Atomic Design & UI/UX Pro Max)
// ==============================================================================

// RPC declarations
var callQoSmateStats = rpc.declare({
    object: 'luci.qosmate_stats',
    method: 'getStats',
    expect: { }
});

var callQoSmateHistoricalStats = rpc.declare({
    object: 'luci.qosmate_stats',
    method: 'getHistoricalStats',
    expect: { }
});

var callQoSmateRrdData = rpc.declare({
    object: 'luci.qosmate_stats',
    method: 'getRrdData',
    expect: { }
});

var callQoSmateRuleCounters = rpc.declare({
    object: 'luci.qosmate_stats',
    method: 'getRuleCounters',
    expect: { }
});

var callQoSmateAutorateStats = rpc.declare({
    object: 'luci.qosmate_stats',
    method: 'getAutorateStats',
    expect: { }
});

// ==============================================================================
// Design Tokens & Helpers
// ==============================================================================

var formatSize = function(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)), 10);
    if (i < 0) i = 0;
    if (i >= sizes.length) i = sizes.length - 1;
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
};

var formatRate = function(bps) {
    if (!bps || bps <= 0) return '0.00 Kbit/s';
    var kbps = bps * 8 / 1000;
    if (kbps >= 1000) {
        return (kbps / 1000).toFixed(2) + ' Mbit/s';
    }
    return kbps.toFixed(2) + ' Kbit/s';
};

var formatTime = function(microseconds) {
    if (microseconds === undefined || microseconds === null || microseconds === 0) return '0 µs';
    if (microseconds >= 1000000) {
        return (microseconds / 1000000).toFixed(2) + ' s';
    } else if (microseconds >= 1000) {
        return (microseconds / 1000).toFixed(2) + ' ms';
    }
    return microseconds + ' µs';
};

var bytesToKbits = function(bytes) {
    if (!bytes) return '0.00';
    return (bytes * 8 / 1000).toFixed(2);
};

// RFC 8290 CAKE Diffserv8 Metadata
var DIFFSERV8_META = [
    { id: 0, name: 'Background', dscp: 'CS1 / LE', priority: 'Tin 0 (Lowest)', color: '#64748b', icon: '⏳', desc: 'Bulk P2P BitTorrent, low priority scavenger traffic' },
    { id: 1, name: 'High Throughput Bulk', dscp: 'CS1 / AF11', priority: 'Tin 1', color: '#475569', icon: '📦', desc: 'Heavy sustained TCP downloads (>750MB), bulk file transfers' },
    { id: 2, name: 'Best Effort', dscp: 'CS0 / General', priority: 'Tin 2 (Default)', color: '#16a34a', icon: '🌐', desc: 'General household web browsing, standard HTTPS traffic' },
    { id: 3, name: 'Streaming & Video', dscp: 'AF41 / AF42 / CS3', priority: 'Tin 3', color: '#ea580c', icon: '📺', desc: 'RTMP live streaming, video call media STUN (3478-3481)' },
    { id: 4, name: 'Low-Latency Homelab', dscp: 'AF21 / AF22', priority: 'Tin 4', color: '#0d9488', icon: '☁️', desc: 'Cloudflare Argo Tunnel (:7844), homelab web hosting (:8000, :8088)' },
    { id: 5, name: 'Voice & Interactive', dscp: 'EF / CS2', priority: 'Tin 5', color: '#2563eb', icon: '🎙️', desc: 'Discord voice, WebRTC (50000-65535), VoIP SIP, SSH (22)' },
    { id: 6, name: 'Realtime Gaming', dscp: 'CS5 / CS4 / EF', priority: 'Tin 6 (High)', color: '#dc2626', icon: '🎮', desc: 'PC & LAN Gaming UDP (!80/443), CS2, Warzone, Battlefield, Rivals' },
    { id: 7, name: 'Network Control', dscp: 'CS6 / CS7', priority: 'Tin 7 (Highest)', color: '#7c3aed', icon: '👑', desc: 'DNS (53), DoH/DoT (853), NTP (123), ICMP ping, zero-jitter control' }
];

var DSCP_COLOR_MAP = {
    'cs7': '#7c3aed', 'cs6': '#7c3aed',
    'cs5': '#dc2626', 'cs4': '#e11d48',
    'ef': '#2563eb', 'va': '#0284c7',
    'af21': '#0d9488', 'af22': '#0f766e',
    'af41': '#ea580c', 'af42': '#c2410c',
    'cs2': '#3b82f6', 'cs3': '#f59e0b',
    'cs0': '#16a34a', 'cs1': '#64748b',
    'lephb': '#94a3b8'
};

var getDscpBadgeColor = function(dscpClass) {
    if (!dscpClass) return '#64748b';
    var lower = dscpClass.toLowerCase().trim();
    return DSCP_COLOR_MAP[lower] || '#3b82f6';
};

// ==============================================================================
// Lightweight Canvas TimeSeriesChart (Autorate & Trends)
// ==============================================================================

var TimeSeriesChart = {
    draw: function(canvas, config) {
        var ctx = canvas.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        var w = canvas.clientWidth;
        var h = canvas.clientHeight;
        if (w <= 0 || h <= 0) return;

        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, w, h);

        var pad = { top: 15, right: 15, bottom: 25, left: 65 };
        var cw = w - pad.left - pad.right;
        var ch = h - pad.top - pad.bottom;
        if (cw <= 0 || ch <= 0) return;

        var allPts = [];
        (config.series || []).forEach(function(s) {
            if (s.data) allPts = allPts.concat(s.data);
        });

        if (allPts.length < 2) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(_('Collecting telemetry data...'), w / 2, h / 2);
            return;
        }

        var xMin = Infinity, xMax = -Infinity;
        var yMin = Infinity, yMax = -Infinity;

        allPts.forEach(function(pt) {
            if (pt[0] < xMin) xMin = pt[0];
            if (pt[0] > xMax) xMax = pt[0];
            if (pt[1] < yMin) yMin = pt[1];
            if (pt[1] > yMax) yMax = pt[1];
        });

        (config.hLines || []).forEach(function(hl) {
            if (hl.value < yMin) yMin = hl.value;
            if (hl.value > yMax) yMax = hl.value;
        });

        if (yMin === yMax) { yMin -= 1; yMax += 1; }
        if (xMin === xMax) { xMin -= 1; xMax += 1; }
        yMin = Math.max(0, yMin * 0.95);
        yMax = yMax * 1.05;

        var yTicks = this._ticks(yMin, yMax, 5);
        if (yTicks.length > 0) {
            yMin = Math.min(yMin, yTicks[0]);
            yMax = Math.max(yMax, yTicks[yTicks.length - 1]);
        }

        var xS = function(x) { return pad.left + (x - xMin) / (xMax - xMin) * cw; };
        var yS = function(y) { return pad.top + ch - (y - yMin) / (yMax - yMin) * ch; };

        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#64748b';

        // Y Grid
        ctx.textAlign = 'right';
        yTicks.forEach(function(v) {
            var y = yS(v);
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(pad.left + cw, y);
            ctx.stroke();
            ctx.fillText(config.yFmt ? config.yFmt(v) : String(v), pad.left - 6, y + 3);
        });

        // X Grid
        ctx.textAlign = 'center';
        this._timeTicks(xMin, xMax, 6).forEach(function(v) {
            var x = xS(v);
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(x, pad.top);
            ctx.lineTo(x, pad.top + ch);
            ctx.stroke();
            var ago = Math.round(xMax - v);
            var label = ago <= 0 ? 'now' : (ago < 60 ? '-' + ago + 's' : (ago < 3600 ? '-' + Math.round(ago / 60) + 'm' : '-' + (ago / 3600).toFixed(1) + 'h'));
            ctx.fillText(label, x, pad.top + ch + 15);
        });

        // Border
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.strokeRect(pad.left, pad.top, cw, ch);

        ctx.save();
        ctx.beginPath();
        ctx.rect(pad.left, pad.top, cw, ch);
        ctx.clip();

        // Horizontal lines
        (config.hLines || []).forEach(function(hl) {
            ctx.strokeStyle = hl.color || '#94a3b8';
            ctx.lineWidth = hl.width || 1;
            if (hl.dashed) ctx.setLineDash([4, 3]);
            ctx.beginPath();
            var y = yS(hl.value);
            ctx.moveTo(pad.left, y);
            ctx.lineTo(pad.left + cw, y);
            ctx.stroke();
            ctx.setLineDash([]);
        });

        // Series
        (config.series || []).forEach(function(s) {
            if (!s.data || s.data.length < 2) return;
            ctx.strokeStyle = s.color || '#2563eb';
            ctx.lineWidth = s.width || 2;
            if (s.dashed) ctx.setLineDash([4, 3]);

            if (s.fill) {
                ctx.fillStyle = s.fill;
                ctx.beginPath();
                ctx.moveTo(xS(s.data[0][0]), yS(yMin));
                s.data.forEach(function(pt) { ctx.lineTo(xS(pt[0]), yS(pt[1])); });
                ctx.lineTo(xS(s.data[s.data.length - 1][0]), yS(yMin));
                ctx.closePath();
                ctx.fill();
            }

            ctx.beginPath();
            ctx.moveTo(xS(s.data[0][0]), yS(s.data[0][1]));
            for (var i = 1; i < s.data.length; i++) {
                ctx.lineTo(xS(s.data[i][0]), yS(s.data[i][1]));
            }
            ctx.stroke();
            ctx.setLineDash([]);
        });

        ctx.restore();
    },

    _ticks: function(min, max, count) {
        var range = max - min;
        if (range <= 0) return [min];
        var rough = range / count;
        var mag = Math.pow(10, Math.floor(Math.log10(rough)));
        var n = rough / mag;
        var step = n <= 1.5 ? mag : n <= 3.5 ? 2 * mag : n <= 7.5 ? 5 * mag : 10 * mag;
        var ticks = [];
        for (var v = Math.ceil(min / step) * step; v <= max; v += step) {
            ticks.push(Math.round(v * 1000) / 1000);
        }
        return ticks;
    },

    _timeTicks: function(min, max, count) {
        var span = max - min;
        if (span <= 0) return [max];
        var steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400];
        var ideal = span / count;
        var step = steps[steps.length - 1];
        for (var i = 0; i < steps.length; i++) {
            if (steps[i] >= ideal) { step = steps[i]; break; }
        }
        var ticks = [];
        var maxAgo = Math.floor(span / step) * step;
        for (var ago = maxAgo; ago >= 0; ago -= step) {
            ticks.push(max - ago);
        }
        return ticks;
    }
};

// ==============================================================================
// LuCI View Object
// ==============================================================================

return view.extend({
    pollInterval: 2,
    pollHandler: null,
    activeTab: 'overview',
    searchQuery: '',
    lastPollTime: 0,
    lastStats: null,
    prevRulePackets: {},
    autorateTimeRange: '60m',

    load: function() {
        return Promise.all([
            callQoSmateStats(),
            callQoSmateHistoricalStats(),
            callQoSmateRrdData(),
            callQoSmateRuleCounters(),
            callQoSmateAutorateStats(),
            uci.load('qosmate')
        ]);
    },

    createPollFunction: function() {
        var view = this;
        return function() {
            return Promise.all([
                callQoSmateStats(),
                callQoSmateHistoricalStats(),
                callQoSmateRrdData(),
                callQoSmateRuleCounters(),
                callQoSmateAutorateStats()
            ]).then(function(data) {
                view.updateContent(data);
                return data;
            }).catch(function(err) {
                console.error('QoSmate telemetry poll error:', err);
                return null;
            });
        };
    },

    render: function(data) {
        var view = this;
        var qosStats = data[0];
        var ruleStats = data[3];
        var autorateStats = data[4];

        view.lastStats = qosStats;
        view.lastPollTime = Date.now();

        var mainContainer = E('div', { 'class': 'cbi-map qosmate-dashboard-root', 'style': 'max-width: 100%; overflow-x: hidden;' });

        // Inject Scoped Atomic Styles
        var styleEl = E('style', {}, [
            '.qosmate-dashboard-root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--color-text-primary, #0f172a); }',
            '.qm-grid { display: grid; gap: 1rem; margin-bottom: 1.25rem; }',
            '.qm-grid-4 { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }',
            '.qm-grid-2 { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }',
            '.qm-card { background: var(--background-color-card, #ffffff); border: 1px solid var(--border-color-medium, #e2e8f0); border-radius: 10px; padding: 1.1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); transition: transform 0.15s ease, box-shadow 0.15s ease; }',
            '.qm-card:hover { box-shadow: 0 4px 8px rgba(0,0,0,0.06); }',
            '.qm-card-title { font-size: 0.82rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-muted, #64748b); margin-bottom: 0.4rem; display: flex; align-items: center; justify-content: space-between; }',
            '.qm-card-value { font-size: 1.55rem; font-weight: 700; color: var(--color-text-primary, #0f172a); line-height: 1.2; margin-bottom: 0.25rem; }',
            '.qm-card-sub { font-size: 0.8rem; color: var(--color-text-muted, #64748b); }',
            '.qm-pill { display: inline-flex; align-items: center; font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.55rem; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.04em; }',
            '.qm-tin-card { border-left: 5px solid #cbd5e1; position: relative; overflow: hidden; }',
            '.qm-bar-bg { background: rgba(0,0,0,0.06); border-radius: 4px; height: 8px; overflow: hidden; width: 100%; margin: 0.4rem 0; }',
            '.qm-bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s ease; }',
            '.qm-tab-nav { display: flex; flex-wrap: wrap; gap: 0.4rem; border-bottom: 2px solid var(--border-color-medium, #e2e8f0); margin-bottom: 1.25rem; padding-bottom: 0.25rem; }',
            '.qm-tab-btn { background: none; border: none; padding: 0.55rem 1rem; font-size: 0.88rem; font-weight: 600; color: var(--color-text-muted, #64748b); cursor: pointer; border-radius: 6px; transition: all 0.15s ease; display: inline-flex; align-items: center; gap: 0.4rem; }',
            '.qm-tab-btn:hover { background: rgba(0,0,0,0.04); color: var(--color-text-primary, #0f172a); }',
            '.qm-tab-btn.active { background: #3b82f6; color: #ffffff; }',
            '.qm-table-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid var(--border-color-medium, #e2e8f0); border-radius: 8px; }',
            '.qm-table { width: 100%; border-collapse: collapse; font-size: 0.84rem; text-align: left; }',
            '.qm-table th { background: rgba(0,0,0,0.02); font-weight: 600; padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-color-medium, #e2e8f0); color: var(--color-text-muted, #64748b); white-space: nowrap; }',
            '.qm-table td { padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--border-color-medium, #e2e8f0); vertical-align: middle; }',
            '.qm-table tr:last-child td { border-bottom: none; }',
            '.qm-table tr:hover td { background: rgba(0,0,0,0.015); }',
            '.qm-search { padding: 0.45rem 0.85rem; border: 1px solid var(--border-color-medium, #cbd5e1); border-radius: 6px; font-size: 0.84rem; width: 260px; outline: none; }',
            '.qm-search:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.15); }',
            '.qm-pulse { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 0 rgba(34,197,94,0.7); animation: qm-pulse-anim 1.5s infinite; }',
            '@keyframes qm-pulse-anim { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.7); } 70% { box-shadow: 0 0 0 6px rgba(34,197,94,0); } 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); } }',
            '@media (max-width: 640px) { .qm-card-value { font-size: 1.3rem; } .qm-tab-btn { padding: 0.4rem 0.65rem; font-size: 0.8rem; } .qm-search { width: 100%; } }'
        ].join('\n'));
        mainContainer.appendChild(styleEl);

        // Header Top Bar: Status + Refresh Controls
        var topBar = E('div', { 'style': 'display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.8rem; margin-bottom: 1.25rem; background: var(--background-color-card, #ffffff); border: 1px solid var(--border-color-medium, #e2e8f0); border-radius: 10px; padding: 0.8rem 1.1rem;' }, [
            E('div', { 'style': 'display: flex; align-items: center; gap: 0.75rem;' }, [
                E('div', { 'style': 'width: 38px; height: 38px; border-radius: 8px; background: #3b82f6; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; color: #fff;' }, '⚡'),
                E('div', {}, [
                    E('div', { 'style': 'font-size: 1.1rem; font-weight: 700; line-height: 1.2;' }, _('QoSmate Telemetry Dashboard')),
                    E('div', { 'style': 'font-size: 0.78rem; color: #64748b; display: flex; align-items: center; gap: 0.4rem;' }, [
                        E('span', { 'class': 'qm-pulse' }),
                        E('span', {}, _('Engine: CAKE Diffserv8 RFC 8290') + ' | ' + _('Dual-CAKE Active') + ' | ' + _('WAN: ') + (qosStats.wan_interface || 'wan'))
                    ])
                ])
            ]),
            E('div', { 'style': 'display: flex; align-items: center; gap: 0.6rem;' }, [
                E('span', { 'style': 'font-size: 0.82rem; font-weight: 600; color: #64748b;' }, _('Poll:')),
                E('select', {
                    'class': 'cbi-input-select',
                    'style': 'padding: 0.35rem 0.6rem; border-radius: 6px; font-size: 0.82rem;',
                    'change': function(ev) {
                        var interval = parseInt(ev.target.value, 10);
                        if (view.pollHandler) poll.remove(view.pollHandler);
                        view.pollInterval = interval;
                        view.pollHandler = view.createPollFunction();
                        poll.add(view.pollHandler, view.pollInterval);
                    }
                }, [2, 5, 10, 15, 30].map(function(s) {
                    var opt = E('option', { 'value': s }, s + ' ' + _('sec'));
                    if (s === view.pollInterval) opt.selected = true;
                    return opt;
                }))
            ])
        ]);
        mainContainer.appendChild(topBar);

        // Content Area Container (dynamically updated on polling)
        var contentArea = E('div', { 'class': 'qosmate-dynamic-content' });
        mainContainer.appendChild(contentArea);

        // Setup polling
        if (!view.pollHandler) {
            view.pollHandler = view.createPollFunction();
            poll.add(view.pollHandler, view.pollInterval);
        }

        // Render initial content
        view.updateContent(data);

        return mainContainer;
    },

    updateContent: function(data) {
        var view = this;
        var qosStats = data[0];
        var ruleStats = data[3] ? (data[3].rule_counters || []) : [];
        var autorateStats = data[4];

        var contentArea = document.querySelector('.qosmate-dynamic-content');
        if (!contentArea) return;
        dom.content(contentArea, '');

        var now = Date.now();
        var dt = view.lastPollTime > 0 ? ((now - view.lastPollTime) / 1000) : view.pollInterval;
        if (dt <= 0) dt = 2;
        view.lastPollTime = now;

        var prevStats = view.lastStats;
        view.lastStats = qosStats;

        // Extract root qdisc instances
        var egress = qosStats.cake_egress || {};
        var ingress = qosStats.cake_ingress || {};
        var lan = qosStats.cake_lan || {};

        var prevEgress = prevStats ? (prevStats.cake_egress || {}) : {};
        var prevIngress = prevStats ? (prevStats.cake_ingress || {}) : {};
        var prevLan = prevStats ? (prevStats.cake_lan || {}) : {};

        // Compute real-time throughput rates
        var egressBps = (prevEgress.bytes && egress.bytes && egress.bytes >= prevEgress.bytes) ? ((egress.bytes - prevEgress.bytes) / dt) : 0;
        var ingressBps = (prevIngress.bytes && ingress.bytes && ingress.bytes >= prevIngress.bytes) ? ((ingress.bytes - prevIngress.bytes) / dt) : 0;
        var lanBps = (prevLan.bytes && lan.bytes && lan.bytes >= prevLan.bytes) ? ((lan.bytes - prevLan.bytes) / dt) : 0;

        // 1. Hero Metric Cards Grid (Atoms -> Molecules -> Organism)
        var heroGrid = E('div', { 'class': 'qm-grid qm-grid-4' }, [
            // Card 1: Egress (WAN)
            E('div', { 'class': 'qm-card' }, [
                E('div', { 'class': 'qm-card-title' }, [
                    E('span', {}, _('WAN Egress (Upload)')),
                    E('span', { 'class': 'qm-pill', 'style': 'background: rgba(37,99,235,0.12); color: #2563eb;' }, (egress.options ? (egress.options.bandwidth ? (egress.options.bandwidth / 1000000).toFixed(0) + 'M' : '120M') : '120M'))
                ]),
                E('div', { 'class': 'qm-card-value', 'style': 'color: #2563eb;' }, formatRate(egressBps)),
                E('div', { 'class': 'qm-card-sub' }, [
                    E('span', {}, _('Total: ') + formatSize(egress.bytes || 0) + ' (' + (egress.packets || 0).toLocaleString() + ' pkts)'),
                    E('br'),
                    E('span', { 'style': (egress.drops > 0 ? 'color: #e11d48; font-weight: 600;' : '') }, _('Drops: ') + (egress.drops || 0) + ' | ' + _('Overlimits: ') + (egress.overlimits || 0).toLocaleString())
                ])
            ]),

            // Card 2: Ingress (WAN)
            E('div', { 'class': 'qm-card' }, [
                E('div', { 'class': 'qm-card-title' }, [
                    E('span', {}, _('WAN Ingress (Download)')),
                    E('span', { 'class': 'qm-pill', 'style': 'background: rgba(22,163,74,0.12); color: #16a34a;' }, (ingress.options ? (ingress.options.bandwidth ? (ingress.options.bandwidth / 1000000).toFixed(0) + 'M' : '600M') : '600M'))
                ]),
                E('div', { 'class': 'qm-card-value', 'style': 'color: #16a34a;' }, formatRate(ingressBps)),
                E('div', { 'class': 'qm-card-sub' }, [
                    E('span', {}, _('Total: ') + formatSize(ingress.bytes || 0) + ' (' + (ingress.packets || 0).toLocaleString() + ' pkts)'),
                    E('br'),
                    E('span', {}, _('Host Isolation: dual-dsthost') + ' | ' + _('Drops: ') + (ingress.drops || 0))
                ])
            ]),

            // Card 3: Pre-Proxy LAN Ingress (Dual-CAKE on ifb-br-lan)
            E('div', { 'class': 'qm-card' }, [
                E('div', { 'class': 'qm-card-title' }, [
                    E('span', {}, _('Pre-Proxy LAN (br-lan)')),
                    E('span', { 'class': 'qm-pill', 'style': 'background: rgba(13,148,136,0.12); color: #0d9488;' }, 'Pre-Xray')
                ]),
                E('div', { 'class': 'qm-card-value', 'style': 'color: #0d9488;' }, formatRate(lanBps)),
                E('div', { 'class': 'qm-card-sub' }, [
                    E('span', {}, _('Total: ') + formatSize(lan.bytes || 0) + ' (' + (lan.packets || 0).toLocaleString() + ' pkts)'),
                    E('br'),
                    E('span', {}, _('Memory: ') + formatSize(lan.memory_used || 0) + ' | ' + _('Queues: ') + (lan.active_queues || 0))
                ])
            ]),

            // Card 4: Cloudflare Argo Tunnel & Homelab
            (function() {
                var cfRule = ruleStats.find(function(r) { return r.rule_name === 'Cloudflare Tunnel UDP' || r.rule_name === 'Cloudflare Tunnel TCP'; });
                var cfPackets = cfRule ? cfRule.total_packets : 0;
                var cfBytes = cfRule ? cfRule.total_bytes : 0;
                var webOut = ruleStats.find(function(r) { return r.rule_name === 'Homelab Web 8000 Out'; });
                var webBytes = webOut ? webOut.total_bytes : 0;
                return E('div', { 'class': 'qm-card' }, [
                    E('div', { 'class': 'qm-card-title' }, [
                        E('span', {}, _('Cloudflare Argo & Homelab')),
                        E('span', { 'class': 'qm-pill', 'style': 'background: rgba(124,58,237,0.12); color: #7c3aed;' }, 'Tin 4 AF21')
                    ]),
                    E('div', { 'class': 'qm-card-value', 'style': 'color: #7c3aed;' }, formatSize(cfBytes + webBytes)),
                    E('div', { 'class': 'qm-card-sub' }, [
                        E('span', {}, _('Tunnel Packets: ') + cfPackets.toLocaleString()),
                        E('br'),
                        E('span', {}, _('Status: ') + (cfPackets > 0 ? _('Active & Classified') : _('Standby')))
                    ])
                ]);
            })()
        ]);
        contentArea.appendChild(heroGrid);

        // 2. Tab Navigation
        var tabItems = [
            { key: 'overview', label: _('CAKE Tins Matrix'), icon: '📊' },
            { key: 'rules', label: _('Active Rules Live (' + ruleStats.length + ')'), icon: '🎯' },
            { key: 'tc', label: _('Detailed TC Hierarchy'), icon: '⚙️' }
        ];

        if (autorateStats && autorateStats.autorate_enabled) {
            tabItems.push({ key: 'autorate', label: _('Autorate Analytics'), icon: '📈' });
        }

        var tabNav = E('div', { 'class': 'qm-tab-nav' }, tabItems.map(function(t) {
            var btn = E('button', {
                'class': 'qm-tab-btn' + (view.activeTab === t.key ? ' active' : ''),
                'click': function() {
                    view.activeTab = t.key;
                    view.updateContent([qosStats, null, null, { rule_counters: ruleStats }, autorateStats]);
                }
            }, [
                E('span', {}, t.icon),
                E('span', {}, t.label)
            ]);
            return btn;
        }));
        contentArea.appendChild(tabNav);

        // 3. Tab Contents Rendering
        if (view.activeTab === 'overview') {
            view.renderTinsMatrix(contentArea, egress, ingress, lan);
        } else if (view.activeTab === 'rules') {
            view.renderRulesTable(contentArea, ruleStats, dt);
        } else if (view.activeTab === 'tc') {
            view.renderTcDetails(contentArea, qosStats);
        } else if (view.activeTab === 'autorate') {
            view.renderAutorateSection(contentArea, autorateStats);
        }
    },

    // --------------------------------------------------------------------------
    // Render Diffserv8 Tin Hierarchy Matrix (Molecules -> Organism)
    // --------------------------------------------------------------------------
    renderTinsMatrix: function(container, egress, ingress, lan) {
        var view = this;

        // Sub-selector: Egress WAN vs Ingress WAN vs Pre-Proxy LAN
        var activeMatrix = view.matrixView || 'egress';
        var activeInstance = activeMatrix === 'ingress' ? ingress : (activeMatrix === 'lan' ? lan : egress);
        var activeName = activeMatrix === 'ingress' ? _('WAN Ingress (Download Path)') : (activeMatrix === 'lan' ? _('Pre-Proxy LAN (br-lan Ingress)') : _('WAN Egress (Upload Path)'));

        var switchBar = E('div', { 'style': 'display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.6rem; margin-bottom: 1rem;' }, [
            E('div', { 'style': 'font-size: 0.95rem; font-weight: 700;' }, activeName),
            E('div', { 'style': 'display: inline-flex; background: rgba(0,0,0,0.05); padding: 2px; border-radius: 8px;' }, [
                E('button', {
                    'class': 'qm-tab-btn' + (activeMatrix === 'egress' ? ' active' : ''),
                    'style': 'padding: 0.35rem 0.8rem; font-size: 0.8rem;',
                    'click': function() { view.matrixView = 'egress'; view.updateContent([view.lastStats, null, null, null, null]); }
                }, _('WAN Egress')),
                E('button', {
                    'class': 'qm-tab-btn' + (activeMatrix === 'lan' ? ' active' : ''),
                    'style': 'padding: 0.35rem 0.8rem; font-size: 0.8rem;',
                    'click': function() { view.matrixView = 'lan'; view.updateContent([view.lastStats, null, null, null, null]); }
                }, _('Pre-Proxy LAN')),
                E('button', {
                    'class': 'qm-tab-btn' + (activeMatrix === 'ingress' ? ' active' : ''),
                    'style': 'padding: 0.35rem 0.8rem; font-size: 0.8rem;',
                    'click': function() { view.matrixView = 'ingress'; view.updateContent([view.lastStats, null, null, null, null]); }
                }, _('WAN Ingress'))
            ])
        ]);
        container.appendChild(switchBar);

        var tins = activeInstance.tins || [];
        var totalBytes = tins.reduce(function(acc, t) { return acc + (t.sent_bytes || 0); }, 0);
        var totalPackets = tins.reduce(function(acc, t) { return acc + (t.sent_packets || 0); }, 0);

        var tinsGrid = E('div', { 'class': 'qm-grid qm-grid-2' });

        // Iterate tins in descending order of priority (Tin 7 down to Tin 0)
        for (var i = 7; i >= 0; i--) {
            var meta = DIFFSERV8_META[i] || { name: 'Tin ' + i, dscp: 'Class', color: '#64748b', icon: '⚡', desc: '' };
            var tin = tins[i] || {};
            var sentBytes = tin.sent_bytes || 0;
            var sentPackets = tin.sent_packets || 0;
            var pct = totalBytes > 0 ? (sentBytes / totalBytes * 100).toFixed(1) : '0.0';

            var avgDelay = formatTime(tin.avg_delay_us);
            var peakDelay = formatTime(tin.peak_delay_us);
            var baseDelay = formatTime(tin.base_delay_us);

            var tinCard = E('div', { 'class': 'qm-card qm-tin-card', 'style': 'border-left-color: ' + meta.color + ';' }, [
                E('div', { 'style': 'display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 0.4rem;' }, [
                    E('div', { 'style': 'display: flex; align-items: center; gap: 0.4rem;' }, [
                        E('span', { 'style': 'font-size: 1.25rem;' }, meta.icon),
                        E('div', {}, [
                            E('div', { 'style': 'font-weight: 700; font-size: 0.95rem; color: ' + meta.color + ';' }, 'Tin ' + i + ': ' + meta.name),
                            E('div', { 'style': 'font-size: 0.72rem; color: #64748b;' }, meta.desc)
                        ])
                    ]),
                    E('span', { 'class': 'qm-pill', 'style': 'background: ' + meta.color + '22; color: ' + meta.color + ';' }, meta.dscp)
                ]),

                // Progress Bar of Traffic Share
                E('div', { 'style': 'display: flex; justify-content: space-between; font-size: 0.76rem; color: #64748b; font-weight: 600;' }, [
                    E('span', {}, _('Traffic Share')),
                    E('span', {}, pct + '% (' + formatSize(sentBytes) + ')')
                ]),
                E('div', { 'class': 'qm-bar-bg' }, [
                    E('div', { 'class': 'qm-bar-fill', 'style': 'width: ' + pct + '%; background: ' + meta.color + ';' })
                ]),

                // Metrics Matrix Grid
                E('div', { 'style': 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-top: 0.6rem; padding-top: 0.5rem; border-top: 1px dashed var(--border-color-medium, #e2e8f0); font-size: 0.78rem;' }, [
                    E('div', {}, [
                        E('div', { 'style': 'color: #64748b; font-size: 0.7rem;' }, _('Packets Sent')),
                        E('div', { 'style': 'font-weight: 700;' }, sentPackets.toLocaleString())
                    ]),
                    E('div', {}, [
                        E('div', { 'style': 'color: #64748b; font-size: 0.7rem;' }, _('Avg Latency')),
                        E('div', { 'style': 'font-weight: 700; color: ' + (tin.avg_delay_us > 10000 ? '#e11d48' : '#16a34a') + ';' }, avgDelay)
                    ]),
                    E('div', {}, [
                        E('div', { 'style': 'color: #64748b; font-size: 0.7rem;' }, _('Peak Latency')),
                        E('div', { 'style': 'font-weight: 700;' }, peakDelay)
                    ]),
                    E('div', {}, [
                        E('div', { 'style': 'color: #64748b; font-size: 0.7rem;' }, _('Flows (Sp / Blk)')),
                        E('div', { 'style': 'font-weight: 700;' }, (tin.sparse_flows || 0) + ' / ' + (tin.bulk_flows || 0))
                    ]),
                    E('div', {}, [
                        E('div', { 'style': 'color: #64748b; font-size: 0.7rem;' }, _('Buffer Drops')),
                        E('div', { 'style': 'font-weight: 700; color: ' + (tin.drops > 0 ? '#e11d48' : '#64748b') + ';' }, tin.drops || 0)
                    ]),
                    E('div', {}, [
                        E('div', { 'style': 'color: #64748b; font-size: 0.7rem;' }, _('ACK Drops')),
                        E('div', { 'style': 'font-weight: 700;' }, tin.ack_drops || 0)
                    ])
                ])
            ]);

            tinsGrid.appendChild(tinCard);
        }

        container.appendChild(tinsGrid);
    },

    // --------------------------------------------------------------------------
    // Render Active QoS Rules Live Table (Searchable & Filterable)
    // --------------------------------------------------------------------------
    renderRulesTable: function(container, rules, dt) {
        var view = this;

        // Search & Filter Bar
        var filterBar = E('div', { 'style': 'display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.8rem; margin-bottom: 0.9rem;' }, [
            E('div', { 'style': 'font-size: 0.95rem; font-weight: 700;' }, _('Configured Classification Rules')),
            E('input', {
                'type': 'text',
                'class': 'qm-search',
                'placeholder': _('Filter by name, port, DSCP...'),
                'value': view.searchQuery,
                'input': function(ev) {
                    view.searchQuery = ev.target.value.toLowerCase();
                    var rows = container.querySelectorAll('.qm-rule-row');
                    rows.forEach(function(r) {
                        var txt = (r.getAttribute('data-filter') || '').toLowerCase();
                        r.style.display = txt.includes(view.searchQuery) ? '' : 'none';
                    });
                }
            })
        ]);
        container.appendChild(filterBar);

        // Table Wrapper
        var tableWrap = E('div', { 'class': 'qm-table-wrap' });
        var table = E('table', { 'class': 'qm-table' });

        var thead = E('thead', {}, [
            E('tr', {}, [
                E('th', { 'style': 'width: 32px;' }, ''),
                E('th', {}, _('Rule Name')),
                E('th', {}, _('DSCP Class')),
                E('th', {}, _('Assigned Tin')),
                E('th', {}, _('Total Packets')),
                E('th', {}, _('Total Bytes')),
                E('th', {}, _('Traffic Rate')),
                E('th', {}, _('IPv4 / IPv6 Breakdown'))
            ])
        ]);
        table.appendChild(thead);

        var tbody = E('tbody', {});

        if (!rules || rules.length === 0) {
            tbody.appendChild(E('tr', {}, [
                E('td', { 'colspan': '8', 'style': 'text-align: center; color: #64748b; padding: 1.5rem;' }, _('No active rules detected or service restarting.'))
            ]));
        } else {
            // Sort by total bytes descending
            var sortedRules = rules.slice().sort(function(a, b) {
                return (b.total_bytes || 0) - (a.total_bytes || 0);
            });

            sortedRules.forEach(function(r) {
                var prevPkts = view.prevRulePackets[r.rule_name] || 0;
                var deltaPkts = r.total_packets - prevPkts;
                view.prevRulePackets[r.rule_name] = r.total_packets;
                var isLive = deltaPkts > 0;

                // Infer DSCP and Tin from rule name
                var dscp = 'CS0';
                var tinName = 'Tin 2 (Best Effort)';
                var tinColor = '#16a34a';

                var nameLower = r.rule_name.toLowerCase();
                if (nameLower.includes('dns') || nameLower.includes('ntp') || nameLower.includes('icmp')) {
                    dscp = 'CS6'; tinName = 'Tin 7 (Network Control)'; tinColor = '#7c3aed';
                } else if (nameLower.includes('gaming') || nameLower.includes('pc_gaming')) {
                    dscp = 'CS5'; tinName = 'Tin 6 (Realtime Gaming)'; tinColor = '#dc2626';
                } else if (nameLower.includes('voice') || nameLower.includes('sip') || nameLower.includes('webrtc')) {
                    dscp = 'EF'; tinName = 'Tin 5 (Voice & Interactive)'; tinColor = '#2563eb';
                } else if (nameLower.includes('ssh')) {
                    dscp = 'CS2'; tinName = 'Tin 5 (Interactive Shell)'; tinColor = '#2563eb';
                } else if (nameLower.includes('cloudflare') || nameLower.includes('homelab') || nameLower.includes('uptime')) {
                    dscp = 'AF21'; tinName = 'Tin 4 (Low-Latency Services)'; tinColor = '#0d9488';
                } else if (nameLower.includes('stun') || nameLower.includes('rtmp') || nameLower.includes('streaming')) {
                    dscp = 'AF41'; tinName = 'Tin 3 (Streaming & Video)'; tinColor = '#ea580c';
                } else if (nameLower.includes('torrent') || nameLower.includes('bulk')) {
                    dscp = 'CS1'; tinName = 'Tin 1 (High Throughput Bulk)'; tinColor = '#64748b';
                }

                var badgeColor = getDscpBadgeColor(dscp);

                var tr = E('tr', {
                    'class': 'qm-rule-row',
                    'data-filter': r.rule_name + ' ' + dscp + ' ' + tinName
                }, [
                    E('td', { 'style': 'text-align: center;' }, [
                        isLive ? E('span', { 'class': 'qm-pulse' }) : E('span', { 'style': 'display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #cbd5e1;' })
                    ]),
                    E('td', { 'style': 'font-weight: 600;' }, r.rule_name),
                    E('td', {}, [
                        E('span', { 'class': 'qm-pill', 'style': 'background: ' + badgeColor + '22; color: ' + badgeColor + ';' }, dscp)
                    ]),
                    E('td', {}, [
                        E('span', { 'style': 'font-weight: 600; color: ' + tinColor + ';' }, tinName)
                    ]),
                    E('td', { 'style': 'font-variant-numeric: tabular-nums;' }, (r.total_packets || 0).toLocaleString()),
                    E('td', { 'style': 'font-weight: 600; font-variant-numeric: tabular-nums;' }, formatSize(r.total_bytes || 0)),
                    E('td', { 'style': 'color: #64748b; font-size: 0.78rem;' }, isLive ? ('+' + deltaPkts + ' pkts/poll') : 'idle'),
                    E('td', { 'style': 'color: #64748b; font-size: 0.78rem;' }, 'v4: ' + (r.ipv4_packets || 0).toLocaleString() + ' | v6: ' + (r.ipv6_packets || 0).toLocaleString())
                ]);

                tbody.appendChild(tr);
            });
        }

        table.appendChild(tbody);
        tableWrap.appendChild(table);
        container.appendChild(tableWrap);
    },

    // --------------------------------------------------------------------------
    // Render Detailed Technical Engine Diagnostics (tc options)
    // --------------------------------------------------------------------------
    renderTcDetails: function(container, qosStats) {
        var egress = qosStats.cake_egress || {};
        var opts = egress.options || {};

        var card = E('div', { 'class': 'qm-card', 'style': 'margin-bottom: 1rem;' }, [
            E('div', { 'style': 'font-size: 1rem; font-weight: 700; margin-bottom: 0.75rem;' }, _('Kernel TC CAKE Parameters')),
            E('div', { 'style': 'display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.8rem; font-size: 0.82rem;' }, [
                E('div', {}, [ E('span', { 'style': 'color: #64748b;' }, _('Bandwidth Cap: ')), E('b', {}, (opts.bandwidth ? (opts.bandwidth / 1000000).toFixed(2) + ' Mbit/s' : '120 Mbit/s')) ]),
                E('div', {}, [ E('span', { 'style': 'color: #64748b;' }, _('Diffserv Scheme: ')), E('b', {}, opts.diffserv || 'diffserv8') ]),
                E('div', {}, [ E('span', { 'style': 'color: #64748b;' }, _('Flow Isolation: ')), E('b', {}, opts.flowmode || 'dual-srchost') ]),
                E('div', {}, [ E('span', { 'style': 'color: #64748b;' }, _('NAT Awareness: ')), E('b', {}, opts.nat ? 'Enabled' : 'Disabled') ]),
                E('div', {}, [ E('span', { 'style': 'color: #64748b;' }, _('TCP ACK Filter: ')), E('b', {}, opts['ack-filter'] || 'enabled') ]),
                E('div', {}, [ E('span', { 'style': 'color: #64748b;' }, _('Split GSO: ')), E('b', {}, opts.split_gso ? 'Enabled' : 'Disabled') ]),
                E('div', {}, [ E('span', { 'style': 'color: #64748b;' }, _('Target RTT: ')), E('b', {}, formatTime(opts.rtt || 100000)) ]),
                E('div', {}, [ E('span', { 'style': 'color: #64748b;' }, _('Link Framing: ')), E('b', {}, (opts.atm || 'noatm') + ' (overhead: ' + (opts.overhead || 40) + 'B)') ])
            ])
        ]);
        container.appendChild(card);
    },

    // --------------------------------------------------------------------------
    // Render Autorate Panel & Time Series Charts (preserves full autorate telemetry)
    // --------------------------------------------------------------------------
    renderAutorateSection: function(container, ar) {
        var view = this;
        var cur = ar.current || {};
        var cfg = ar.config || {};
        var range = view.autorateTimeRange || '60m';

        var wrap = E('div', { 'class': 'qm-card' });

        var timeRangeBar = E('div', { 'style': 'display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.6rem; margin-bottom: 1rem;' }, [
            E('div', { 'style': 'font-size: 1rem; font-weight: 700;' }, _('Dynamic Autorate Telemetry')),
            E('div', { 'style': 'display: flex; align-items: center; gap: 0.5rem;' }, [
                E('span', { 'style': 'font-size: 0.8rem; color: #64748b;' }, _('Range:')),
                E('select', {
                    'class': 'cbi-input-select',
                    'style': 'padding: 0.35rem 0.6rem; border-radius: 6px; font-size: 0.82rem;',
                    'change': function(ev) {
                        view.autorateTimeRange = ev.target.value;
                        view.updateContent([view.lastStats, null, null, null, ar]);
                    }
                }, [
                    ['60m', '60 ' + _('min')],
                    ['6h', '6 ' + _('hours')],
                    ['24h', '24 ' + _('hours')],
                    ['7d', '7 ' + _('days')],
                    ['30d', '30 ' + _('days')]
                ].map(function(opt) {
                    var o = E('option', { 'value': opt[0] }, opt[1]);
                    if (opt[0] === range) o.selected = true;
                    return o;
                }))
            ])
        ]);
        wrap.appendChild(timeRangeBar);

        // Status row
        var latMs = (cur.latency / 10).toFixed(1);
        var blMs = (cur.baseline / 10).toFixed(1);
        var ulMbps = (cur.ul_rate / 1000).toFixed(1);
        var dlMbps = (cur.dl_rate / 1000).toFixed(1);

        var statusRow = E('div', { 'style': 'display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.8rem; background: rgba(0,0,0,0.02); padding: 0.8rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.82rem;' }, [
            E('div', {}, [ E('span', { 'style': 'color: #64748b;' }, _('Live Latency: ')), E('b', {}, latMs + ' ms'), E('span', { 'style': 'color: #94a3b8;' }, ' (base: ' + blMs + ' ms)') ]),
            E('div', {}, [ E('span', { 'style': 'color: #64748b;' }, _('Upload Rate: ')), E('b', {}, ulMbps + ' Mbit/s'), E('span', { 'style': 'color: #94a3b8;' }, ' (' + (cur.ul_load_pct || 0) + '% load)') ]),
            E('div', {}, [ E('span', { 'style': 'color: #64748b;' }, _('Download Rate: ')), E('b', {}, dlMbps + ' Mbit/s'), E('span', { 'style': 'color: #94a3b8;' }, ' (' + (cur.dl_load_pct || 0) + '% load)') ])
        ]);
        wrap.appendChild(statusRow);

        // Canvas Latency Chart
        var latWrap = E('div', { 'style': 'margin-bottom: 1.25rem;' }, [
            E('div', { 'style': 'font-weight: 600; font-size: 0.88rem; margin-bottom: 0.4rem;' }, _('RTT Latency vs Baseline')),
            E('canvas', { 'class': 'autorate-latency-canvas', 'style': 'width: 100%; height: 200px; display: block; border-radius: 6px;' })
        ]);
        wrap.appendChild(latWrap);

        // Canvas Bandwidth Chart
        var bwWrap = E('div', {}, [
            E('div', { 'style': 'font-weight: 600; font-size: 0.88rem; margin-bottom: 0.4rem;' }, _('Adaptive Upload & Download Bandwidth')),
            E('canvas', { 'class': 'autorate-bw-canvas', 'style': 'width: 100%; height: 200px; display: block; border-radius: 6px;' })
        ]);
        wrap.appendChild(bwWrap);

        container.appendChild(wrap);

        // Render Canvas Charts
        window.requestAnimationFrame(function() {
            var raw = ar.history || [];
            if (!raw || raw.length < 2) return;

            var latCanvas = wrap.querySelector('.autorate-latency-canvas');
            if (latCanvas) {
                var latData = raw.map(function(h) { return [h[0], h[5] / 10]; });
                var blData = raw.map(function(h) { return [h[0], h[6] / 10]; });
                TimeSeriesChart.draw(latCanvas, {
                    series: [
                        { data: latData, color: '#2563eb', width: 2 },
                        { data: blData, color: '#16a34a', dashed: true, width: 1.5 }
                    ],
                    yFmt: function(v) { return v.toFixed(1) + ' ms'; }
                });
            }

            var bwCanvas = wrap.querySelector('.autorate-bw-canvas');
            if (bwCanvas) {
                var ulData = raw.map(function(h) { return [h[0], h[1] / 1000]; });
                var dlData = raw.map(function(h) { return [h[0], h[2] / 1000]; });
                TimeSeriesChart.draw(bwCanvas, {
                    series: [
                        { data: dlData, color: '#16a34a', fill: 'rgba(22,163,74,0.1)', width: 2 },
                        { data: ulData, color: '#2563eb', fill: 'rgba(37,99,235,0.1)', width: 2 }
                    ],
                    yFmt: function(v) { return v.toFixed(1) + ' M'; }
                });
            }
        });
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
