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
- **CI on GitHub Actions** (ubuntu runner): the `CI` workflow is green — backend tests,
  Playwright tests, `tinyjs build` and the bundle assertion all pass.
- **Syntax** of all modules (`node --check`) and the validity of `tinyjs.json`.

## 4. Measured footprint

Measured by the project owner on macOS:

| state | the Go version | this app |
|---|---|---|
| idle, nothing open | 6.6 MiB (the daemon) | ~82 MiB with the window kept, 5.7 MiB backend-only |
| **editing one screenshot** | ~163 MiB (6.6 MiB daemon plus ~156 MiB of Chromium) | **146–155 MiB** |

On the Linux development box the same logic measured 10.0 MiB (a Go daemon) and 9.3–9.5 MiB
(a plain txiki.js watcher), and a blank Chromium instance took ~890 MB across 11 processes
(an RSS sum, so shared pages are counted repeatedly).

Reading:

- **with the editor open the JS app is not heavier than the Go one** (146–155 against ~163 MiB):
  the canvas and the decoded image dominate both, and the webview costs no more than the
  browser tab it replaces;
- the **backend is lighter than the Go daemon** (5.7 against 6.6 MiB), so the rewrite does not
  pay for the daemon part at all;
- the entire difference is therefore **idle memory**: 82 MiB against 6.6 MiB, and it is the
  window plus its renderer — 76 MiB, or 93% of the app's footprint;
- **hiding the window frees nothing** (the renderer keeps the page state, which is what makes
  showing it instant), so `setHideOnClose`, `activation: accessory` and the tray icon save CPU
  and GPU — not memory. Only destroying the window releases it.

### The shape this points to: a window on demand

Keep the backend watching with no window alive, create the editor window when a screenshot
arrives and destroy it once the work is done (copy, save, or the user closing it). Then the
idle state — the entire problem — sits at backend memory (~5.7 MiB), and the app matches or
beats the Go version in both states.

The API supports exactly this; checked in the vendor documentation shipped with the runtime
(v0.50.1):

- `export function onWindowClosed(id, app)` — the backend learns the window is gone;
- `app.openWindow(id, { page, size, chrome, … })` and `app.window(id).close()` — the backend
  creates and destroys windows (a page may only open files inside the frontend dir);
- `setHideOnClose(false)` — closing really closes instead of hiding;
- on macOS the app outlives its last window (the Dock brings it back); on Windows and Linux
  that holds only while something can bring the app back — a tray icon or accessory mode, both
  of which this app has;
- hidden and occluded windows are throttled (rAF stops), so the watcher must live in the
  backend — it already does;
- the price is window startup (a fresh renderer must boot) instead of an instant show, and the
  vendor docs advise pooling windows when they are cycled rapidly.

Not measured yet: whether destroying the window really returns the app to backend-level memory,
and how long a fresh window takes to appear (section 5).

## 5. What has NOT been verified (honestly)

These need macOS with the system WebKit — the Mini-PC cannot bring a window up (no display,
no `libwebkit2gtk`):

- launching the window with `tinyjs dev` and building the `.app` on macOS;
- the native calls: `app.show()`, the tray, the global hotkey, notifications,
  `clipboard.write`, `dialog.pickFolder/saveFile`, `launchAtLogin`;
- that `"readAccess": true` really lets the webview read screenshots from an arbitrary
  folder (if it does not, the base64 fallback still works, at the cost of traffic);
- the behaviour with the window closed (watching is supposed to continue);
- the release workflow (it needs a real tag to run);
- whether destroying the window really returns the app to backend-level memory, and how long a
  fresh window takes to appear (the design in section 4) — needs a measurement on macOS.

## 6. Runtime gotchas found

- `tjs.makeTempDir()` / `tjs.makeTempFile()` fail with `EINVAL` in this build for any
  arguments — the temporary path for the clipboard is built by hand in `tjs.tmpDir`.
- `tjs.stat` reports the modification time as `mtim` (a string), not `mtime` — handled in
  `statMtime`.
- `tjs.readDir` returns an async iterator, `tjs.readFile` returns a `Uint8Array`.
- `tjs.watch(dir, cb)`: the callback receives a file name; the handle has `close()`.
- Bytes belong off the wire: the image goes to the page as a path through
  `tiny.fileURL`, not as base64 over the socket (base64 is kept as a fallback).

## 7. Next

1. Run `tinyjs dev` on a Mac: the window, the tray, the dialogs, launch at login.
2. Decide on the window-on-demand shape (section 4) and measure it against the current build.
3. Signing and notarization: `signIdentity` / `notarize` in `tinyjs.json`, or the
   `TINYJS_SIGN_IDENTITY` and `TINYJS_NOTARY_PROFILE` secrets in CI.
4. Optional: `captureScreen()` to take screenshots itself instead of depending on a folder
   (needs the Screen Recording permission); `ocr(path)` for the text on a screenshot.
5. A license for the repository (there is none right now).
