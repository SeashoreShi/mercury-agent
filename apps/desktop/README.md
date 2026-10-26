# Mercury Desktop

The native desktop app for Mercury: a Tauri 2 shell (Rust, small) around the
same React dashboard the runtime serves (`../../ui`). The shell owns what a
browser tab cannot — window and tray, the OS keychain, finding/starting the
runtime on this computer, deep links, updates — and the dashboard does the
rest over the runtime's HTTP API.

```
apps/desktop/
  src/            the shell's own screens (first run, connections, status)
  src/shell/      connections store, runtime bring-up, native bridge
  src-tauri/      Rust: window, tray, keychain, local-runtime detection
  ../../ui/src    the dashboard, imported as source via the "@" alias
```

## How a connection works

| Kind   | Address                      | Credential                                              |
|--------|------------------------------|---------------------------------------------------------|
| local  | `http://127.0.0.1:<port>`    | the runtime's per-boot attach token (`~/.mercury/attach-token`), read fresh each time |
| remote | any `http(s)://` origin      | a device token (`mdt_…`) in the OS keychain, minted by `POST /api/auth/token` or `mercury devices add` |

Before the dashboard loads, the shell calls `GET /api/health` and compares
`apiVersion` with `src/shell/compat.ts`. Out of range → the user is told
which side to update and can open the runtime's own dashboard instead.

## Develop

Prerequisites: Node 22, Rust stable, and the platform bits Tauri lists at
https://v2.tauri.app/start/prerequisites/ (Xcode CLT on macOS; WebView2 +
MSVC on Windows; webkit2gtk 4.1 + libayatana-appindicator on Linux).

```sh
cd ui && npm ci && cd ..              # the dashboard's dependencies
cd apps/desktop && npm ci
npm run icons                          # once: generates src-tauri/icons from icons/source.png
npm run desktop:dev                    # Tauri window + Vite HMR
```

`npm run dev` alone serves the frontend at http://localhost:1420 in a plain
browser (native calls fall back to no-ops/localStorage); start the runtime
with `MERCURY_DESKTOP_DEV=1` so its CORS allows that origin.

## Build

```sh
npm run desktop:build                  # .dmg / .msi+.exe / .deb+.AppImage under src-tauri/target/release/bundle
```

Updater artifacts (`createUpdaterArtifacts`) are off in this config until
the signing keys exist; CI turns them on with `TAURI_SIGNING_PRIVATE_KEY`.
The update manifest the app polls is `https://mercuryagent.sh/desktop/latest.json`
(published from `website/static/desktop/`, the same path as the plugin
catalog).

## Not yet here

- Bundled runtime ("Install Mercury here" card) — next brick, as a Tauri
  sidecar fetched from the matching Mercury release at build time.
- QR pairing (`mercury://connect?...` deep link is registered; the phone
  app will emit it).
- Notifications with actions, the macOS notch capsule, auto-start toggle UI.
