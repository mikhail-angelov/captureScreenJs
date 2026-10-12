# SPEC — porting captureScreen to tinyjs

Source: [mikhail-angelov/captureScreen](https://github.com/mikhail-angelov/captureScreen)
(Go 1.26 plus a browser UI). This repository is the same product on tinyjs: a native
window instead of a browser tab and a JavaScript backend.

## 1. What was ported

| Original | Here | Status |
|---|---|---|
| `server/watcher.go` (fsnotify, 500 ms debounce, 200 ms stability, dedupe, path guard) | `src/watcher.js` | one-to-one, covered by tests |
| `server/config.go` (`~`, env, folder validation, symlinks) | `src/config.js` | one-to-one, covered by tests |
| `ui/*` (editor, tools, export) | `src/frontend/*` | moved; only the transport and save/clipboard changed |
| `GET /file/{slug}` | `tiny.fileURL(path)` plus `api.readShot`; base64 as a fallback | replaced |
| the HTTP server on `127.0.0.1:8090` | `tiny.api` (socket) | dropped |
| `open http://…?file=` | the app window plus `app.push('newShot')` | replaced |
| `server/os_integration.go` (OpenUrl) | `app.show()` / `app.shell.open` | replaced |
| LaunchAgent plus `install.sh` | `app.launchAtLogin` | replaced |
| `navigator.clipboard` (browser) | `app.clipboard.write({ image })` | native now |
| a browser download | `tiny.dialog.saveFile()` plus `api.savePng` | native now |

Added, not present in the original: a menu-bar icon, a global `Cmd+Alt+S` hotkey, a
notification about a new screenshot, working with the window closed, and a folder bar
inside the window.

## 2. Backend API

`getState`, `listShots`, `readShot`, `readShotBase64`, `setFolder`, `savePng`, `copyImage`,
`reveal`, `openFolder`, `getLaunchAtLogin`, `setLaunchAtLogin`, `quit`.
Events pushed to the page: `ready`, `newShot`, `openShot`, `newestShot`, `folderChanged`,
`folderInvalid`, `requestFolder`.

Tray menu: “Show Window”, “Choose Folder…”, “Latest Screenshot”, “Quit”.

## 3. What has been verified (and how)

Performed on Linux (a small Mini-PC) with the txiki.js runtime v26.6.0 from the tinyjs
release; the binaries were checked against `checksums.txt`.

- **Backend logic — 31 checks, 0 failures** (`npm run test:backend`): extension and name
  filters; the path guard (`../` escaping is rejected); base64 (known vectors plus a
  1024-byte round trip); folder validation (exists / missing / a file instead of a folder /
  a symlink); the watcher end to end — a valid PNG is accepted, a rewrite is not processed
  twice, `.txt` and hidden files are refused, a second file is accepted.
- **The page in a browser** (the HTTP path) — a live Chromium: the folder bar, the toolbar,
  loading a 1000×600 screenshot through `/file/`, the empty state.
- **The page in app mode** (a `window.tiny` stub): startup from backend data, the image
  arriving both ways — through `tiny.fileURL(path)` (the primary path, no bytes over the
  socket) and through the base64 fallback (`readShotBase64` → a blob URL), the 1000×600
  screenshot loaded in both cases; all seven event handlers registered; a `newShot` event
  switching the screenshot; Copy and Save calling `copyImage` and `savePng` with a real PNG
  (`iVBORw0KGgo` prefix) and no console errors.
- **A build with the official tooling**: `tinyjs build` (v0.50.1) produced `dist/shotmark`
  (the backend, 8.3 MB) and `dist/launcher` (1.2 MB) without errors.
- **Backend method names** checked against the runtime source (`runtime/tiny.js`):
  `setHideOnClose`, `hotkey.register`, `tray.set`, `launchAtLogin`, `store`, `shell`,
  `clipboard`, `notify`, `show`, `quit`, `push` all exist.
- **Syntax** of all modules (`node --check`) and the validity of `tinyjs.json`.

## 4. What has NOT been verified (honestly)

These need macOS with the system WebKit — this Mini-PC cannot bring a window up (no display,
no `libwebkit2gtk`):

- launching the window with `tinyjs dev` and building the `.app` on macOS;
- the native calls: `app.show()`, the tray, the global hotkey, notifications,
  `clipboard.write`, `dialog.pickFolder/saveFile`, `launchAtLogin`;
- that `"readAccess": true` really lets the webview read screenshots from an arbitrary
  folder (if it does not, the base64 fallback still works, at the cost of traffic);
- the behaviour with the window closed (watching is supposed to continue).

## 5. Runtime gotchas found

- `tjs.makeTempDir()` / `tjs.makeTempFile()` fail with `EINVAL` in this build for any
  arguments — the temporary path for the clipboard is built by hand in `tjs.tmpDir`.
- `tjs.stat` reports the modification time as `mtim` (a string), not `mtime` — handled in
  `statMtime`.
- `tjs.readDir` returns an async iterator, `tjs.readFile` returns a `Uint8Array`.
- `tjs.watch(dir, cb)`: the callback receives a file name; the handle has `close()`.
- Bytes belong off the wire: the image goes to the page as a path through
  `tiny.fileURL`, not as base64 over the socket (base64 is kept as a fallback).

## 6. Next

1. Run `tinyjs dev` on a Mac: the window, the tray, the dialogs, launch at login.
2. Measure the app's memory with the window open / hidden / closed.
3. Signing and notarization: `signIdentity` / `notarize` in `tinyjs.json`, or the
   `TINYJS_SIGN_IDENTITY` and `TINYJS_NOTARY_PROFILE` secrets in CI.
4. Optional: `captureScreen()` to take screenshots itself instead of depending on a folder
   (needs the Screen Recording permission); `ocr(path)` for the text on a screenshot.
5. A license for the repository (there is none right now).
