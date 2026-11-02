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
// QoSmate Next-Gen Real-Time Telemetry & Analytics Dashboard
// Architecture: Atomic Design (Tokens -> Atoms -> Molecules -> Organisms)
// Features: Dual-CAKE Pre/Post Proxy Pipeline, Diffserv8 RFC 8290 Engine,
//           Multi-Stream Throughput History, Bufferbloat Gauges, Live Rules.
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
// Design Tokens & Formatting Helpers
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

// RFC 8290 CAKE Diffserv8 Specifications (Linux Kernel sch_cake.c alignment)
var DIFFSERV8_META = [
    { id: 0, name: 'Background / Scavenger', dscp: 'LE', priority: 'Tin 0 (Lowest)', color: '#64748b', icon: '⏳', desc: 'Low Effort background traffic, scavenger downloads' },
    { id: 1, name: 'High Throughput Bulk', dscp: 'CS1 / AF11-AF13', priority: 'Tin 1', color: '#475569', icon: '📦', desc: 'Bulk P2P BitTorrent, large sustained file downloads (>750MB)' },
    { id: 2, name: 'Best Effort', dscp: 'CS0 / Default', priority: 'Tin 2 (Standard)', color: '#16a34a', icon: '🌐', desc: 'Standard unclassified internet traffic, general HTTPS browsing' },
    { id: 3, name: 'Streaming & Video', dscp: 'AF31-AF33 / AF41-AF43 / CS3', priority: 'Tin 3', color: '#ea580c', icon: '📺', desc: 'RTMP live streams, video call media STUN, TCP upgrade bursts' },
    { id: 4, name: 'Low-Latency Homelab', dscp: 'AF21-AF23', priority: 'Tin 4', color: '#0d9488', icon: '☁️', desc: 'Cloudflare Argo Tunnel (:7844), homelab web hosting (:8000, :8088)' },
    { id: 5, name: 'Interactive Shell', dscp: 'CS2', priority: 'Tin 5', color: '#2563eb', icon: '💻', desc: 'SSH remote management (:22), interactive shell sessions' },
    { id: 6, name: 'Realtime Gaming & Voice', dscp: 'CS4 / CS5 / EF / VA', priority: 'Tin 6 (High)', color: '#dc2626', icon: '🎮', desc: 'PC & LAN Gaming UDP (!80/443), Discord voice, WebRTC, SIP, CS2, Warzone' },
    { id: 7, name: 'Network Control', dscp: 'CS6 / CS7', priority: 'Tin 7 (Highest)', color: '#7c3aed', icon: '👑', desc: 'DNS (:53), DoH/DoT (:853), NTP (:123), ICMP ping, routing control' }
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
// Real-Time Canvas Multi-Stream Throughput Chart (Organism)
// ==============================================================================

var LiveTrafficChart = {
    draw: function(canvas, history) {
        if (!canvas || !canvas.getContext) return;
        var ctx = canvas.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        var w = canvas.clientWidth;
        var h = canvas.clientHeight;
        if (w <= 0 || h <= 0) return;

        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        var pad = { top: 18, right: 20, bottom: 25, left: 75 };
        var cw = w - pad.left - pad.right;
        var ch = h - pad.top - pad.bottom;
        if (cw <= 0 || ch <= 0) return;

        if (!history || history.length < 2) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(_('Accumulating real-time telemetry stream...'), w / 2, h / 2);
            return;
        }

        // Find maximum rate for auto-scaling
        var maxRate = 0;
        history.forEach(function(s) {
            var m = Math.max(s.egressBps || 0, s.ingressBps || 0, s.lanBps || 0, s.cfBps || 0);
            if (m > maxRate) maxRate = m;
        });
        if (maxRate <= 0) maxRate = 125000; // default 1 Mbps baseline
        maxRate = maxRate * 1.15; // 15% headroom

        var n = history.length;
        var xS = function(idx) { return pad.left + (idx / (n - 1)) * cw; };
        var yS = function(val) { return pad.top + ch - (Math.min(val, maxRate) / maxRate) * ch; };

        // Grid lines & Y-axis labels
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 0.5;
        ctx.font = '10px -apple-system, sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'right';

        var ySteps = 4;
        for (var step = 0; step <= ySteps; step++) {
            var val = (maxRate / ySteps) * step;
            var y = yS(val);
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(pad.left + cw, y);
            ctx.stroke();
            ctx.fillText(formatRate(val), pad.left - 6, y + 3);
        }

        // Time markers on X-axis
        ctx.textAlign = 'center';
        var tLabels = [
            { idx: 0, text: '-' + Math.round(n * 2) + 's' },
            { idx: Math.floor(n / 2), text: '-' + Math.round(n) + 's' },
            { idx: n - 1, text: 'now' }
        ];
        tLabels.forEach(function(lbl) {
            var x = xS(lbl.idx);
            ctx.fillText(lbl.text, x, pad.top + ch + 15);
        });

        // Clip area for graph
        ctx.save();
        ctx.beginPath();
        ctx.rect(pad.left, pad.top, cw, ch);
        ctx.clip();

        // Helper to draw smooth series
        var drawSeries = function(accessor, strokeColor, fillColor) {
            ctx.beginPath();
            ctx.moveTo(xS(0), yS(accessor(history[0])));
            for (var i = 1; i < n; i++) {
                ctx.lineTo(xS(i), yS(accessor(history[i])));
            }
            if (fillColor) {
                ctx.lineTo(xS(n - 1), yS(0));
                ctx.lineTo(xS(0), yS(0));
                ctx.closePath();
                ctx.fillStyle = fillColor;
                ctx.fill();
            }
            ctx.beginPath();
            ctx.moveTo(xS(0), yS(accessor(history[0])));
            for (var j = 1; j < n; j++) {
                ctx.lineTo(xS(j), yS(accessor(history[j])));
            }
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 2;
            ctx.stroke();
        };

        // Draw Ingress (Download)
        drawSeries(function(d) { return d.ingressBps || 0; }, '#16a34a', 'rgba(22, 163, 74, 0.08)');
        // Draw Pre-Proxy LAN (br-lan Ingress)
        drawSeries(function(d) { return d.lanBps || 0; }, '#0d9488', 'rgba(13, 148, 136, 0.06)');
        // Draw Egress (Upload)
        drawSeries(function(d) { return d.egressBps || 0; }, '#2563eb', 'rgba(37, 99, 235, 0.08)');
        // Draw Cloudflare & Homelab Web
        drawSeries(function(d) { return d.cfBps || 0; }, '#7c3aed', 'rgba(124, 58, 237, 0.12)');

        ctx.restore();

        // Border
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.strokeRect(pad.left, pad.top, cw, ch);
    }
};

// ==============================================================================
// Diffserv8 Traffic Distribution Donut Chart (Organism)
// ==============================================================================

var TinDonutChart = {
    draw: function(canvas, tins, totalBytes) {
        if (!canvas || !canvas.getContext) return;
        var ctx = canvas.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        var w = canvas.clientWidth;
        var h = canvas.clientHeight;
        if (w <= 0 || h <= 0) return;

        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        var cx = w / 2;
        var cy = h / 2;
        var radius = Math.min(cx, cy) - 10;
        var innerRadius = radius * 0.62;

        if (!totalBytes || totalBytes <= 0 || !tins || tins.length === 0) {
            ctx.fillStyle = '#cbd5e1';
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
            ctx.arc(cx, cy, innerRadius, 2 * Math.PI, 0, true);
            ctx.fill();

            ctx.fillStyle = '#64748b';
            ctx.font = '11px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(_('Zero bytes'), cx, cy + 4);
            return;
        }

        var startAngle = -Math.PI / 2;
        for (var i = 7; i >= 0; i--) {
            var sent = (tins[i] && tins[i].sent_bytes) ? tins[i].sent_bytes : 0;
            if (sent <= 0) continue;
            var sliceAngle = (sent / totalBytes) * (2 * Math.PI);
            var endAngle = startAngle + sliceAngle;
            var color = DIFFSERV8_META[i].color;

            ctx.beginPath();
            ctx.arc(cx, cy, radius, startAngle, endAngle);
            ctx.arc(cx, cy, innerRadius, endAngle, startAngle, true);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();

            startAngle = endAngle;
        }

        // Center cutout info
        ctx.fillStyle = 'var(--color-text-primary, #0f172a)';
        ctx.font = 'bold 12px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(formatSize(totalBytes), cx, cy - 2);
        ctx.font = '10px -apple-system, sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText(_('Total Volume'), cx, cy + 12);
    }
};

// ==============================================================================
// LuCI Modern View Architecture
// ==============================================================================

return view.extend({
    pollInterval: 2,
    pollHandler: null,
    activeTab: 'overview',
    searchQuery: '',
    lastPollTime: 0,
    lastStats: null,
    prevRulePackets: {},
    trafficHistory: [],
    matrixView: 'egress',
    maxHistoryPoints: 30,

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
                console.error('QoSmate poll error:', err);
                return null;
            });
        };
    },

    render: function(data) {
        var view = this;
        var qosStats = data[0] || {};

        view.lastStats = qosStats;
        view.lastPollTime = Date.now();

        var mainContainer = E('div', { 'class': 'cbi-map qosmate-dashboard-root', 'style': 'max-width: 100%; overflow-x: hidden;' });

        // Scoped Atomic Design System Tokens
        var styleEl = E('style', {}, [
            '.qosmate-dashboard-root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--color-text-primary, #0f172a); }',
            '.qm-grid { display: grid; gap: 1rem; margin-bottom: 1.25rem; }',
            '.qm-grid-4 { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }',
            '.qm-grid-2 { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }',
            '.qm-grid-3 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }',
            '.qm-card { background: var(--background-color-card, #ffffff); border: 1px solid var(--border-color-medium, #e2e8f0); border-radius: 12px; padding: 1.15rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); transition: transform 0.15s ease, box-shadow 0.15s ease; }',
            '.qm-card:hover { box-shadow: 0 4px 10px rgba(0,0,0,0.06); }',
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
            '.qm-search { padding: 0.45rem 0.85rem; border: 1px solid var(--border-color-medium, #cbd5e1); border-radius: 6px; font-size: 0.84rem; width: 280px; outline: none; }',
            '.qm-search:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.15); }',
            '.qm-pulse { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 0 rgba(34,197,94,0.7); animation: qm-pulse-anim 1.5s infinite; }',
            '@keyframes qm-pulse-anim { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.7); } 70% { box-shadow: 0 0 0 6px rgba(34,197,94,0); } 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); } }',
            '.qm-pipeline-strip { display: flex; align-items: center; justify-content: space-between; overflow-x: auto; gap: 0.5rem; padding: 0.85rem 1rem; background: var(--background-color-card, #ffffff); border: 1px solid var(--border-color-medium, #e2e8f0); border-radius: 10px; margin-bottom: 1.25rem; font-size: 0.78rem; -webkit-overflow-scrolling: touch; }',
            '.qm-pipeline-node { display: flex; flex-direction: column; align-items: center; text-align: center; min-width: 130px; }',
            '.qm-pipeline-arrow { font-size: 1.1rem; color: #94a3b8; }',
            '@media (max-width: 640px) { .qm-card-value { font-size: 1.3rem; } .qm-tab-btn { padding: 0.4rem 0.65rem; font-size: 0.8rem; } .qm-search { width: 100%; } }'
        ].join('\n'));
        mainContainer.appendChild(styleEl);

        // Header Top Bar: Status + Telemetry Controls
        var topBar = E('div', { 'style': 'display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.8rem; margin-bottom: 1.25rem; background: var(--background-color-card, #ffffff); border: 1px solid var(--border-color-medium, #e2e8f0); border-radius: 12px; padding: 0.85rem 1.2rem;' }, [
            E('div', { 'style': 'display: flex; align-items: center; gap: 0.75rem;' }, [
                E('div', { 'style': 'width: 40px; height: 40px; border-radius: 10px; background: linear-gradient(135deg, #2563eb, #1d4ed8); display: flex; align-items: center; justify-content: center; font-size: 1.35rem; color: #fff; box-shadow: 0 2px 6px rgba(37,99,235,0.3);' }, '⚡'),
                E('div', {}, [
                    E('div', { 'style': 'font-size: 1.15rem; font-weight: 700; line-height: 1.2;' }, _('QoSmate Live Telemetry & Traffic Matrix')),
                    E('div', { 'style': 'font-size: 0.78rem; color: #64748b; display: flex; align-items: center; gap: 0.4rem;' }, [
                        E('span', { 'class': 'qm-pulse' }),
                        E('span', {}, _('Engine: CAKE Diffserv8 RFC 8290') + ' | ' + _('Dual-CAKE Pre-Proxy') + ' | ' + _('Interface: ') + (qosStats.wan_interface || 'wan'))
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
        var qosStats = data[0] || {};
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

        // Compute Cloudflare / Homelab Web throughput
        var cfRule = ruleStats.find(function(r) { return r.rule_name === 'Cloudflare Tunnel UDP' || r.rule_name === 'Cloudflare Tunnel TCP'; });
        var cfBytes = cfRule ? cfRule.total_bytes : 0;
        var webOut = ruleStats.find(function(r) { return r.rule_name === 'Homelab Web 8000 Out'; });
        var webBytes = webOut ? webOut.total_bytes : 0;
        var combinedCfWebBytes = cfBytes + webBytes;

        var prevCfBytes = view.prevCfBytes || combinedCfWebBytes;
        var cfBps = (combinedCfWebBytes >= prevCfBytes) ? ((combinedCfWebBytes - prevCfBytes) / dt) : 0;
        view.prevCfBytes = combinedCfWebBytes;

        // Append to circular history buffer
        view.trafficHistory.push({
            time: now,
            egressBps: egressBps,
            ingressBps: ingressBps,
            lanBps: lanBps,
            cfBps: cfBps
        });
        if (view.trafficHistory.length > view.maxHistoryPoints) {
            view.trafficHistory.shift();
        }

        // 1. Packet Lifecycle Pipeline Strip (Pre-Xray vs Post-Xray Visual Trace)
        var pipelineStrip = E('div', { 'class': 'qm-pipeline-strip' }, [
            E('div', { 'class': 'qm-pipeline-node' }, [
                E('div', { 'style': 'font-size: 1.1rem;' }, '💻'),
                E('b', {}, _('1. LAN Ingress')),
                E('span', { 'style': 'color: #64748b;' }, '10.10.10.0/24')
            ]),
            E('span', { 'class': 'qm-pipeline-arrow' }, '➔'),
            E('div', { 'class': 'qm-pipeline-node' }, [
                E('div', { 'style': 'font-size: 1.1rem;' }, '⚡'),
                E('b', { 'style': 'color: #0d9488;' }, _('2. Dual-CAKE (ifb)')),
                E('span', { 'class': 'qm-pill', 'style': 'background: rgba(13,148,136,0.12); color: #0d9488; margin-top: 2px;' }, _('Pre-Xray Shaper'))
            ]),
            E('span', { 'class': 'qm-pipeline-arrow' }, '➔'),
            E('div', { 'class': 'qm-pipeline-node' }, [
                E('div', { 'style': 'font-size: 1.1rem;' }, '🏷️'),
                E('b', { 'style': 'color: #2563eb;' }, _('3. DSCP Tagging')),
                E('span', { 'style': 'color: #64748b;' }, 'Netfilter -160')
            ]),
            E('span', { 'class': 'qm-pipeline-arrow' }, '➔'),
            E('div', { 'class': 'qm-pipeline-node' }, [
                E('div', { 'style': 'font-size: 1.1rem;' }, '🔀'),
                E('b', { 'style': 'color: #7c3aed;' }, _('4. Passwall2 / Xray')),
                E('span', { 'style': 'color: #64748b;' }, 'Direct vs GID 9912')
            ]),
            E('span', { 'class': 'qm-pipeline-arrow' }, '➔'),
            E('div', { 'class': 'qm-pipeline-node' }, [
                E('div', { 'style': 'font-size: 1.1rem;' }, '🛡️'),
                E('b', { 'style': 'color: #16a34a;' }, _('5. WAN CAKE Egress')),
                E('span', { 'class': 'qm-pill', 'style': 'background: rgba(22,163,74,0.12); color: #16a34a; margin-top: 2px;' }, _('Diffserv8 (wan)'))
            ]),
            E('span', { 'class': 'qm-pipeline-arrow' }, '➔'),
            E('div', { 'class': 'qm-pipeline-node' }, [
                E('div', { 'style': 'font-size: 1.1rem;' }, '🌐'),
                E('b', {}, _('6. Physical ISP')),
                E('span', { 'style': 'color: #64748b;' }, (qosStats.wan_interface || 'wan'))
            ])
        ]);
        contentArea.appendChild(pipelineStrip);

        // 2. Hero Metric Cards Grid (Atoms -> Molecules -> Organism)
        var heroGrid = E('div', { 'class': 'qm-grid qm-grid-4' }, [
            // Card 1: Egress (WAN)
            E('div', { 'class': 'qm-card' }, [
                E('div', { 'class': 'qm-card-title' }, [
                    E('span', {}, _('WAN Egress (Upload)')),
                    E('span', { 'class': 'qm-pill', 'style': 'background: rgba(37,99,235,0.12); color: #2563eb;' }, (egress.options && egress.options.bandwidth ? (egress.options.bandwidth / 1000000).toFixed(0) + 'M' : '120M'))
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
                    E('span', { 'class': 'qm-pill', 'style': 'background: rgba(22,163,74,0.12); color: #16a34a;' }, (ingress.options && ingress.options.bandwidth ? (ingress.options.bandwidth / 1000000).toFixed(0) + 'M' : '600M'))
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
                    E('span', {}, _('Active Queues: ') + (lan.active_queues || 0) + ' | ' + _('Memory: ') + formatSize(lan.memory_used || 0))
                ])
            ]),

            // Card 4: Cloudflare Argo Tunnel & Homelab Web
            E('div', { 'class': 'qm-card' }, [
                E('div', { 'class': 'qm-card-title' }, [
                    E('span', {}, _('Cloudflare Argo & Web')),
                    E('span', { 'class': 'qm-pill', 'style': 'background: rgba(124,58,237,0.12); color: #7c3aed;' }, 'Tin 4 AF21')
                ]),
                E('div', { 'class': 'qm-card-value', 'style': 'color: #7c3aed;' }, formatRate(cfBps)),
                E('div', { 'class': 'qm-card-sub' }, [
                    E('span', {}, _('Volume: ') + formatSize(combinedCfWebBytes) + ' (' + (cfRule ? cfRule.total_packets : 0).toLocaleString() + ' pkts)'),
                    E('br'),
                    E('span', {}, _('Homelab Origin: ') + formatSize(webBytes) + ' (:8000)')
                ])
            ])
        ]);
        contentArea.appendChild(heroGrid);

        // 3. Creative Real-Time Visual Charts Panel (Overview Tab)
        var visualChartSection = E('div', { 'class': 'qm-grid qm-grid-3' }, [
            // Left Chart: Live Multi-Stream Throughput History (Area Chart)
            E('div', { 'class': 'qm-card', 'style': 'grid-column: span 2;' }, [
                E('div', { 'style': 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.6rem;' }, [
                    E('div', { 'style': 'font-weight: 700; font-size: 0.92rem; display: flex; align-items: center; gap: 0.4rem;' }, [
                        E('span', {}, '📈'),
                        E('span', {}, _('Live Throughput Telemetry Stream (Last 60s)'))
                    ]),
                    E('div', { 'style': 'display: flex; align-items: center; gap: 0.75rem; font-size: 0.75rem; font-weight: 600;' }, [
                        E('span', { 'style': 'color: #2563eb; display: inline-flex; align-items: center; gap: 3px;' }, [ E('span', { 'style': 'width: 8px; height: 8px; border-radius: 50%; background: #2563eb; display: inline-block;' }), _('WAN Up') ]),
                        E('span', { 'style': 'color: #16a34a; display: inline-flex; align-items: center; gap: 3px;' }, [ E('span', { 'style': 'width: 8px; height: 8px; border-radius: 50%; background: #16a34a; display: inline-block;' }), _('WAN Down') ]),
                        E('span', { 'style': 'color: #0d9488; display: inline-flex; align-items: center; gap: 3px;' }, [ E('span', { 'style': 'width: 8px; height: 8px; border-radius: 50%; background: #0d9488; display: inline-block;' }), _('Pre-Xray LAN') ]),
                        E('span', { 'style': 'color: #7c3aed; display: inline-flex; align-items: center; gap: 3px;' }, [ E('span', { 'style': 'width: 8px; height: 8px; border-radius: 50%; background: #7c3aed; display: inline-block;' }), _('Argo/Web') ])
                    ])
                ]),
                E('canvas', { 'class': 'qm-live-traffic-canvas', 'style': 'width: 100%; height: 180px; display: block;' })
            ]),

            // Right Chart: Diffserv8 Traffic Distribution Donut
            E('div', { 'class': 'qm-card' }, [
                E('div', { 'style': 'font-weight: 700; font-size: 0.92rem; margin-bottom: 0.6rem; display: flex; align-items: center; gap: 0.4rem;' }, [
                    E('span', {}, '🍩'),
                    E('span', {}, _('CAKE Tin Distribution'))
                ]),
                E('canvas', { 'class': 'qm-tin-donut-canvas', 'style': 'width: 100%; height: 180px; display: block;' })
            ])
        ]);
        contentArea.appendChild(visualChartSection);

        // Schedule Canvas Renders
        window.requestAnimationFrame(function() {
            var trafficCanvas = contentArea.querySelector('.qm-live-traffic-canvas');
            if (trafficCanvas) {
                LiveTrafficChart.draw(trafficCanvas, view.trafficHistory);
            }

            var donutCanvas = contentArea.querySelector('.qm-tin-donut-canvas');
            if (donutCanvas) {
                var activeInstance = view.matrixView === 'ingress' ? ingress : (view.matrixView === 'lan' ? lan : egress);
                var tins = activeInstance.tins || [];
                var totalBytes = tins.reduce(function(acc, t) { return acc + (t.sent_bytes || 0); }, 0);
                TinDonutChart.draw(donutCanvas, tins, totalBytes);
            }
        });

        // 4. Tab Navigation
        var tabItems = [
            { key: 'overview', label: _('Diffserv8 RFC 8290 Tins Matrix'), icon: '📊' },
            { key: 'rules', label: _('Active QoS Rules (' + ruleStats.length + ')'), icon: '🎯' },
            { key: 'tc', label: _('Engine Diagnostics & TC Hierarchy'), icon: '⚙️' }
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

        // 5. Render Tab Contents
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
        var activeName = activeMatrix === 'ingress' ? _('WAN Ingress Path (Downloads from Internet)') : (activeMatrix === 'lan' ? _('Pre-Proxy LAN Ingress Path (Dual-CAKE Uploads)') : _('WAN Egress Path (Physical Post-NAT/Proxy Uploads)'));

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

            var avgDelayUs = tin.avg_delay_us || 0;
            var peakDelayUs = tin.peak_delay_us || 0;
            var avgDelay = formatTime(avgDelayUs);
            var peakDelay = formatTime(peakDelayUs);

            // Latency health indicator (against 5ms RFC target)
            var latStatus = 'Optimal';
            var latColor = '#16a34a';
            if (avgDelayUs > 10000) {
                latStatus = 'Congested';
                latColor = '#dc2626';
            } else if (avgDelayUs > 5000) {
                latStatus = 'Elevated';
                latColor = '#ea580c';
            } else if (avgDelayUs > 2000) {
                latStatus = 'Good';
                latColor = '#0d9488';
            }

            var tinCard = E('div', { 'class': 'qm-card qm-tin-card', 'style': 'border-left-color: ' + meta.color + ';' }, [
                E('div', { 'style': 'display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 0.4rem;' }, [
                    E('div', { 'style': 'display: flex; align-items: center; gap: 0.45rem;' }, [
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

                // Metrics Matrix Grid with Latency Status
                E('div', { 'style': 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-top: 0.6rem; padding-top: 0.5rem; border-top: 1px dashed var(--border-color-medium, #e2e8f0); font-size: 0.78rem;' }, [
                    E('div', {}, [
                        E('div', { 'style': 'color: #64748b; font-size: 0.7rem;' }, _('Packets Sent')),
                        E('div', { 'style': 'font-weight: 700;' }, sentPackets.toLocaleString())
                    ]),
                    E('div', {}, [
                        E('div', { 'style': 'color: #64748b; font-size: 0.7rem;' }, _('Avg Delay')),
                        E('div', { 'style': 'font-weight: 700; color: ' + latColor + ';' }, avgDelay + ' (' + latStatus + ')')
                    ]),
                    E('div', {}, [
                        E('div', { 'style': 'color: #64748b; font-size: 0.7rem;' }, _('Peak Delay')),
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
                'placeholder': _('Filter by name, port, DSCP, tin...'),
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
                E('th', {}, _('Activity Rate')),
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

                // Infer DSCP and Tin accurately from rule name
                var dscp = 'CS0';
                var tinId = 2;
                var nameLower = r.rule_name.toLowerCase();

                if (nameLower.includes('dns') || nameLower.includes('ntp') || nameLower.includes('icmp')) {
                    dscp = 'CS6'; tinId = 7;
                } else if (nameLower.includes('gaming') || nameLower.includes('pc_gaming')) {
                    dscp = 'CS5'; tinId = 6;
                } else if (nameLower.includes('voice') || nameLower.includes('sip') || nameLower.includes('webrtc')) {
                    dscp = 'EF'; tinId = 6;
                } else if (nameLower.includes('ssh')) {
                    dscp = 'CS2'; tinId = 5;
                } else if (nameLower.includes('cloudflare') || nameLower.includes('homelab') || nameLower.includes('uptime')) {
                    dscp = 'AF21'; tinId = 4;
                } else if (nameLower.includes('stun') || nameLower.includes('rtmp') || nameLower.includes('streaming')) {
                    dscp = 'AF41'; tinId = 3;
                } else if (nameLower.includes('torrent') || nameLower.includes('bulk')) {
                    dscp = 'CS1'; tinId = 1;
                }

                var meta = DIFFSERV8_META[tinId] || DIFFSERV8_META[2];
                var badgeColor = getDscpBadgeColor(dscp);

                var tr = E('tr', {
                    'class': 'qm-rule-row',
                    'data-filter': r.rule_name + ' ' + dscp + ' ' + meta.name + ' Tin ' + tinId
                }, [
                    E('td', { 'style': 'text-align: center;' }, [
                        isLive ? E('span', { 'class': 'qm-pulse' }) : E('span', { 'style': 'display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #cbd5e1;' })
                    ]),
                    E('td', { 'style': 'font-weight: 600;' }, r.rule_name),
                    E('td', {}, [
                        E('span', { 'class': 'qm-pill', 'style': 'background: ' + badgeColor + '22; color: ' + badgeColor + ';' }, dscp)
                    ]),
                    E('td', {}, [
                        E('span', { 'style': 'font-weight: 600; color: ' + meta.color + ';' }, 'Tin ' + tinId + ' (' + meta.name + ')')
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

        container.appendChild(wrap);
    },

    handleSaveApply: null,
    handleSave: null,
    handleReset: null
});
