# QoSmate Statistics Dashboard: Dual-CAKE & Diffserv8 Unified Architecture

## Overview
The QoSmate LuCI Statistics interface (`luci-app-qosmate/htdocs/luci-static/resources/view/statistics.js`) provides real-time, zero-reload traffic observability for OpenWrt network routers running CAKE and HFSC queueing disciplines.

To support complex multi-homed and transparent-proxy environments (such as Passwall 2 / Xray Core), the statistics dashboard has been re-architected into a clean, unified **2-tab layout**:
1. **Egress (Upload)**: Merges Pre-Routing (Pre-Proxy LAN on `ifb-br-lan`) and After-Routing (Post-Proxy WAN on `wan`) into a single consolidated chart and aggregated data table.
2. **Ingress (Download)**: Displays WAN downstream traffic across all 8 Diffserv8 tins via `tc-ctinfo` restoration on `ifb-wan`.

---

## Key Features & Visual Layout

### 1. Charts on Top, Tables Below
- In accordance with modern network monitoring UX paradigms, interactive visual charts are positioned at the **top** of each tab for instant visual telemetry at a glance.
- Detailed numerical metrics, latency values (Average Delay, Peak Delay), and packet loss statistics (Dropped, ECN Marked) are presented in a structured table below.

### 2. Single Unified Interactive Chart per Tab
- Replaced multiple cluttered charts with a single, responsive bar chart per tab.
- Integrated an interactive **Metric Switcher** toggle:
  - **Traffic (Bytes)**: Displays throughput volume with smart units (`B`, `KiB`, `MiB`, `GiB`).
  - **Packets**: Displays raw packet counts for connection-rate analysis.
  - **Dropped**: Instantly isolates buffer congestion or AQM drop events per tin.
- State persists smoothly across periodic poll updates without canvas flickering or UI jumps.

### 3. Merged Pre-Proxy and Post-Proxy Egress Telemetry
- For Egress upload traffic, each tin displays both:
  - **Pre-Routing (LAN)**: Traffic queued on `ifb-br-lan` before transparent proxying.
  - **After-Routing (WAN)**: Traffic transmitted directly to WAN or via encrypted tunnel.
  - **Total Upload Sent**: Combined volumetric sum.
- Stacked and grouped visual styling allows network operators to immediately see what percentage of each traffic class is handled direct vs proxied.

### 4. Typography & Layout Consistency
- Standardized font sizing across both Egress and Ingress tables to **`13px`** (`padding: 9px 10px`, `white-space: nowrap`).
- Prevents cramped multi-line text wrapping while ensuring optimal readability on desktop and mobile viewports.
- RFC 8290 Diffserv8 tin badges (`T0`–`T7`) with distinct semantic color-coding:
  - **Tin 0 (LE)**: Dark Slate
  - **Tin 1 (AF1x)**: Sky Blue
  - **Tin 2 (CS0)**: Amber / Gold
  - **Tin 3 (AF4x)**: Red
  - **Tin 4 (AF2x)**: Purple
  - **Tin 5 (CS2)**: Warm Amber / Brown
  - **Tin 6 (CS5 / EF)**: Vibrant Orange
  - **Tin 7 (CS6)**: Slate Teal

---

## Technical Integration with `luci.qosmate_stats`
- Statistics are polled asynchronously via RPCD call `luci.qosmate_stats get_stats`.
- Parser automatically aggregates `tc -s qdisc show dev <iface>` statistics for:
  - `ifb-br-lan` (Pre-Proxy LAN Ingress)
  - `wan` (WAN Egress)
  - `ifb-wan` (WAN Ingress)
- Resilient polling handles router reloads and service restarts gracefully with automatic error recovery and state preservation.
