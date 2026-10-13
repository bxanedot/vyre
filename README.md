# VYRE

**VYRE** is a free, privacy-focused gaming network diagnostic application. It is being rebuilt for Windows 10/11 first and Linux second.

![Version](https://img.shields.io/badge/version-0.1.0-8de6bb) ![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)

## Current capabilities (0.1.0 foundation)

- Automatic recognition of a conservative list of running game executables on Windows and Linux; Windows foreground-process awareness.
- Real, local ICMP response-time sampling to a user-configured internet host and optional game host. **These are probe results, not in-game RTT.**
- Recent jitter estimated from successful consecutive ICMP probes and sample-failure statistics.
- Local-only SQLite history (maximum 2,000 rows, latest 200 loaded) and settings.
- Dark desktop dashboard showing sample history, recognized games, and honest connection assessments.
- No login, analytics, subscriptions, servers, VPN tunnels or privileged system changes.

**Not yet implemented:** automatic game-endpoint/UDP discovery, bufferbloat throughput tests, QoS/SQM actions, safe restore, community routing, automatic updates or actual traffic prioritization. The Optimizer page is deliberately disabled; VYRE does **not** claim reduced ping or optimized routes in this diagnostic release.

## Development

Prerequisites: Node.js 22+, current Rust stable, and [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.

```bash
npm install
npm run typecheck
npm run tauri dev
```

To build: `npm run tauri build`. Installers are produced only when platform prerequisites are available.

## Privacy & safety

Process names and measurement history remain on your device. Probes invoke the local operating system's `ping` executable, sending one ICMP request per target per sampling interval. The app never changes router configuration, firewall settings, DNS, registry, or OS network policies. Hosts must be set explicitly; target probing can fail where ICMP is blocked.

Local data is stored in the per-user Tauri app data directory as `vyre.sqlite3`. Use **History → Delete history** to erase stored samples.

## 0.1.0 release policy

GitHub Actions runs Windows and Linux builds, type checks, Rust tests, and package generation. A release is published from a `v*` tag **only after** both platform jobs succeed. No signing key or automatic updater is configured; do not imply packages are signed or automatically updated.

## Roadmap

1. **0.1.x:** Stabilize detection, ICMP diagnostics, SQLite history, error reporting, and packaging.
2. **0.2.x:** Game-specific profiles, reliable endpoint association on supported operating systems, and protocol-aware measurements.
3. **0.3.x:** Consent-based bufferbloat testing, scoped local QoS where supported, transactional rollback and safe recovery.
4. **Later:** Optional community routing only after security review and infrastructure exist; never automatically use unknown relays.

Licensed under **GPL-3.0-or-later**. Author: [bxane](https://github.com/bxane-dev). See the official [GPL 3 license text](https://www.gnu.org/licenses/gpl-3.0.txt).
