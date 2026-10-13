# Tiny.js 0.51.0: windowless agent and separate editor

Historical native measurements from the previous implementation session. The latest code changes do not repeat these measurements.

The verified cycle was **menu bar agent → new file → separate editor → full editor termination → same agent continues watching**.

The main ShotMark.app uses `mainWindow: false` and accessory activation. Its backend watches the filesystem, and its launcher creates a native menu bar icon without a main window or WebView. The nested ShotMark Editor.app is a separate Tiny.js process. Closing it terminates its backend, launcher, and WebKit session.

## Measurements

Environment: macOS 26.6.2 / ARM64, official Tiny.js 0.51.0 SDK, txiki.js 26.6.0. Combined physical footprint was collected with `vmmap -summary` for the test bundle's processes and new WebKit PIDs relative to a pre-launch process snapshot. Values include compressed memory. These are local snapshots, not minimum-memory or multiday results. Concurrent WebKit activity from other applications can affect attribution.

The test used the real `tests/test-screenshot.png`. A test copy automatically closed only the editor using `tiny.win.close()` and was re-signed after instrumentation. Production bundles contain no diagnostic timers or automatic closing behavior.

| State | Footprint, MiB | Processes |
| --- | ---: | ---: |
| Agent before the first screenshot | **17.86** | 2 |
| Editor with first/second screenshot | **136.74** | 7 |
| After the first close | **17.51** | 2 |
| Fresh editor with third screenshot | **135.19** | 7 |
| After the second close | **17.51** | 2 |
| History opened from the menu bar | **138.42** | 7 |
| After closing history | **17.51** | 2 |

After each close, the same two agent processes remained, without editor launcher/backend processes or new WebKit processes. Footprint returned to the background level. Windows inside one permanently running launcher may retain WebKit caches after the last window closes.

The first and second screenshots loaded in one editor session. The third screenshot started a fresh launcher/backend with new PIDs after closing. The real page confirmed first.png, second.png, third.png and nonzero image width. Calling the same handler used by Screenshot History opened its URL and the page's actual history dialog. Native `tray.position()` confirmed a menu bar icon with nonzero height, and the history item existed and was enabled.

Earlier 4–5 MiB results applied to a standalone txiki.js watcher without a menu bar icon on 0.50.1. The current design adds a native launcher and icon, for approximately 17–18 MiB in the background. An earlier paired Tiny.js test before the windowless patch used approximately 65 MiB with a hidden main WebView. Those tests used different pages and are not a direct editor-memory comparison.

## Manually opening the editor

A separate check started the nested editor without an existing agent. The editor created the windowless agent and loaded the first screenshot. After editor termination, the agent retained its PID and handled the next file by starting a new editor. The same agent remained after the second close. Results: `build/native-test/manual.json`. Test agents and editors were stopped afterwards.

## Historical validation and artifacts

- `npm run build`: both .app bundles built; strict/deep codesign verification passed.
- `npm test`: 52 backend checks and 9 frontend tests passed at that point.
- Tests checked singleton behavior, folder changes, file validation, and save-state protection.
- History/settings requests worked before and after page readiness.
- Native checks covered actual images, editor reuse, complete process termination, a fresh editor, and history from the menu bar.

Artifacts: `build/native-test/memory.json`, `probes.json`, `native.log`, and per-process vmmap files. The tests ran against a copy of the bundle in that directory; production `dist/ShotMark.app` did not contain automatic closing.

Physical clicks on the close/menu controls, manual folder selection, login permissions, and the next macOS login were not separately verified. `tiny.win.close()` on the main window calls `app.quit()`, and production sets `setHideOnClose(false)`. Windows/Linux, Intel, Developer ID signing, and notarization were not tested.
