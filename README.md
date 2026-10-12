# ShotMark (JS) — screenshot annotator built with tinyjs

A port of the macOS app [captureScreen](https://github.com/mikhail-angelov/captureScreen)
(Go + a browser tab) to [tinyjs](https://tinyjs.app) — a native OS window with a
JavaScript backend.

The app watches a screenshot folder: as soon as a new screenshot shows up, ShotMark
opens it in the editor (arrows, text, shapes, marker, blur, crop) with copy-to-clipboard,
save, launch at login and a menu-bar icon.

## What changed compared to the Go version

| | Go version | this repo |
|---|---|---|
| backend | Go 1.26 + `fsnotify` + `net/http` | JavaScript on the txiki.js runtime (inside tinyjs) |
| page link | HTTP on `127.0.0.1:8090` + a browser tab | `tiny.api` over a socket (no ports), a native window |
| opening a screenshot | `open http://127.0.0.1:8090/?file=…` | the app window comes up and gets the image from the backend |
| image in the editor | `GET /file/{slug}` | `tiny.fileURL(path)` plus `"readAccess"` (no bytes over the socket) |
| clipboard | `navigator.clipboard` in a browser | native `clipboard.write` (NSPasteboard) |
| saving | the browser downloads into ~/Downloads | native save dialog plus a backend write |
| launch at login | a LaunchAgent plist plus `scripts/install.sh` | `launchAtLogin` (one call) |
| background | a separate daemon plus a browser tab | a menu-bar icon; closing the window does not quit |
| hotkey | — | global `Cmd+Alt+S` brings the window up |
| notifications | — | a native notification about a new screenshot |
| size and build | a Go toolchain, a 12.9 MB binary | no compiler needed: esbuild plus an 8.5 MB runtime |

The watcher logic is ported one-to-one: a 500 ms debounce, a size-stability check
(200 ms), processed-file dedupe, the "file strictly inside the folder" guard and the
`.png/.jpg/.jpeg` extensions.

## Memory (measured)

| part | RSS |
|---|---|
| the original Go daemon (macOS) | 6.6 MiB |
| the JS backend alone, no window (macOS) | 5.7 MiB |
| the whole app with an empty window (macOS) | ~82 MiB |

The backend is *lighter* than the Go daemon it replaces; the 82 MiB is the webview
renderer plus the window. That is what a native window costs, and it replaces an entire
browser tab — for scale, a blank Chromium instance measured on the development box takes
~890 MB across 11 processes (an RSS sum, shared pages counted repeatedly).

Two consequences worth knowing:

- **hiding the window returns nothing** — the renderer stays alive with the page state,
  which is why showing it again is instant; only *destroying* the window frees the memory;
- a process that never opens a window stays at backend-level memory, so an app that only
  needs a window now and then should open it on demand instead of keeping it around.

## Running

```bash
# in the app (macOS: the system WebKit)
tinyjs dev            # development, the page hot-reloads
tinyjs build          # build the application
```

The watch folder defaults to `~/Documents` (like the original) or to the
`CAPTURE_SCREEN_WATCH_FOLDER` environment variable. The “Folder…” button switches it
through a native dialog and the choice is remembered between launches.

## Layout

```
tinyjs.json             app config (name, window size, minimum tinyjs version)
src/main.js             backend: the page API, tray, global hotkey, notifications
src/watcher.js          folder watching (a port of server/watcher.go)
src/config.js           folder selection and validation (a port of server/config.go)
src/base64.js           handing an image to the page without dependencies
src/frontend/           the editor (moved from the original ui/): canvas, tools, export
scripts/get-tjs.sh      fetch the tinyjs release and verify its checksum
scripts/run-backend-tests.sh   run the backend checks under the runtime
tests/backend.test.js   backend checks under the txiki.js runtime
tests/dev-server.mjs    debug HTTP server (not used by the app)
tests/frontend.spec.js  page smoke tests in a browser (Playwright)
```

## Tests

```bash
npm ci                      # install the test dependencies
npm run test:backend        # 31 checks: filters, base64, folder validation, watcher
npm run test:frontend       # page tests in Chromium (starts the dev server itself)
npm test                    # both
```

`npm run test:backend` uses an existing `tjs` runtime when there is one and otherwise
fetches the tinyjs release into `.tinyjs-cli` (checksum verified, no sudo). The backend
tests are synthetic: files are created in a temporary folder and the app is never launched.

## Continuous integration

- `CI` (`.github/workflows/ci.yml`) runs on every push and pull request: backend tests,
  Playwright tests and a full `tinyjs build`.
- `Release` (`.github/workflows/release.yml`) runs on a `v*` tag (or manually with a tag):
  the version is stamped into `tinyjs.json`, the macOS `.app` is built for `arm64` and
  `x86_64`, zipped with checksums and attached to the GitHub release. Signing and
  notarization happen only when the `TINYJS_SIGN_IDENTITY` and `TINYJS_NOTARY_PROFILE`
  secrets are configured.

## Page modes

The same page runs in two ways:

- **in the app** — `window.tiny.api.call(...)` and events through `tiny.api.on(...)`;
- **in a browser** (debugging and Playwright) — the HTTP fallback against
  `tests/dev-server.mjs`, a screenshot opened as `?file=<name>`.

The switch is automatic (`src/frontend/api.js`), so the editor stays debuggable without
launching the app.

## Notes

- The page loads the image from the path the backend gives it (`tiny.fileURL`), which is
  why `"readAccess": true` is set in `tinyjs.json` — without it the webview cannot read a
  screenshot from an arbitrary folder. If `fileURL` is unavailable the editor falls back
  to base64 bytes (`readShotBase64`).
- Closing the window hides it instead of quitting: screenshots keep being watched and the
  window comes back on the next one.
- No port is ever opened — everything goes through the runtime socket.
