# Historical comparison: Capture Screen Go vs. JS/Tiny.js

> This report describes the version before the initial fixes. Its findings were addressed in later iterations. See [WINDOW_LIFECYCLE.md](WINDOW_LIFECYCLE.md) for the subsequent process lifecycle and measurements, and [FULL_REVIEW.md](FULL_REVIEW.md) for the later review.

Checked on October 12, 2026, on macOS 26.6.2 / ARM64. Original project: sibling `../captureScreen`; running binary: `/Users/ma/.local/bin/captureScreen`, PID 2081. Port runtime: Tiny.js **0.50.1**, txiki.js **26.6.0**, official macOS ARM64 archive with verified SHA256.

The editor core was copied faithfully, but two missing awaits prevented the native backend from starting and changing folders correctly. The JS version's persistent memory cost exceeded the Go daemon's; total memory with an open editor was comparable. This conclusion applies to that historical implementation.

## Measured memory

Physical footprint was measured with `vmmap -summary PID`, with an additional `footprint --noCategories --swapped` check. Values are rounded MiB and include memory attributed by macOS, including compressed memory. Footprint is more useful here than RSS or virtual address-space size.

| State | Footprint | Included processes |
| --- | ---: | --- |
| Existing Go daemon before opening its editor | **6.6 MiB** | One daemon, running almost eight days |
| Go after serving a screenshot over HTTP | **8.7 MiB** | Same daemon, without restarting |
| Original JS build, empty window with folder error | **≈82 MiB** | Launcher, tjs, WebContent, GPU, Networking |
| JS with two await fixes, empty folder and window | **76.9 MiB** | Same five process types |
| Fixed JS with screenshot loaded at startup | **146.5 MiB** | Same five process types |
| JS after receiving a new screenshot, window hidden | **155.2 MiB** | Image remains in memory |
| Go editor in a separate test Chromium | **155.8 MiB** | Four browser processes, excluding Go daemon |
| Go plus that test Chromium | **≈164 MiB** | Browser and running Go daemon |

Both editors used the same **2336×1540** image, a **387,126-byte** PNG, and a 1180×820 window/viewport. Both loaded the image at those dimensions and exported canvas to PNG.

| JS process with an open image | Footprint, MiB |
| --- | ---: |
| Native window / launcher | 26.2 |
| JS backend / tjs | 6.6 |
| WebKit WebContent | 76.6 |
| WebKit GPU | 29.7 |
| WebKit Networking | 7.3 |
| **Total** | **146.5** |

The backend itself was not appreciably heavier than Go. The main cost was the persistent WebKit window and its processes: roughly 12 times the original background Go daemon even without an image. The hidden JS editor retained about 155 MiB, while Go after closing its browser editor remained one process at 7–9 MiB.

The 146.5 and 155.2 MiB values came from different launches and do not prove hiding increases memory. They show that hiding does not release the image or editor. Summed process footprint estimates application cost rather than the exact change in system free RAM.

Chromium ran headless with one page specifically for this comparison. This is not a measurement of a tab in an everyday browser: existing tabs can share infrastructure, and Safari differs. The 146 vs. 164 MiB difference does not establish a winner between browser engines.

## Port fidelity

At that time, **14 of 18 original UI files** matched byte for byte, including editor, renderer, state, history, hit-test, text metrics, CSS, and all six tools. app.js, api.js, export.js, and index.html changed, and a native shell was added. Drawing, undo/redo, crop, and tool logic had not been rewritten.

Watcher filters, 500/200 ms delays, and deduplication broadly followed Go. Claims of verified one-to-one native/configuration behavior were premature because runtime integration errors passed the existing tests.

## Findings from that version

1. **Saved folder read without await.** `app.store.get(STORE_KEY)` was asynchronous. The truthy Promise bypassed the fallback folder, failed validation, and prevented Watcher startup in a real launch. Make initialization asynchronous, await the preference, and require a nonempty string. The store contained `watchFolder: {}`.
2. **Folder normalization returned a Promise.** `tjs.realPath(abs)` was not awaited, returning `{ok:true, path:Promise}`. A direct probe showed `pathType: object` and `promise: true`; tjs.watch failed with ENOENT. The existing 31 checks tested only the success flag, not the resolved path. Await realPath and test real initialization/folder switching.
3. **Redundant screenshot reads and base64.** The watcher read and encoded the entire file for newShot, but the frontend used only its name and opened it again through fileURL or another base64 request. Send only the name; use base64 only for fallback loading. Measurements above did not include this optimization.
4. **Missing symlink rejection.** Unlike Go's resolveScreenshotPath, JS readShot/readShotBase64 checked names and extensions without a matching lstat check. A symlink inside the folder could point outside and appear in history. Require a regular, non-symlink file before returning or reading it.
5. **Incoming screenshot destroyed unsaved work.** newShot always loaded a replacement and reset history. Go opened a new browser page and preserved the old tab. Require confirmation or otherwise preserve the previous editing session.
6. **Fallback blob URLs leaked.** Each fallback image created an object URL that was not released on replacement. The measured home-directory path used direct loading, so long-term fallback growth was not measured. Tiny.js readAccess true grants home-directory access; external volumes may require fallback. Revoke obsolete blob URLs.
7. **Test commands and configuration were incorrect.** `tinyjs build` passed, but `tjs tests/backend.test.js` printed help and exited 1; `tjs run tests/backend.test.js` passed **31/31**. Playwright without configuration collected backend.test.js and failed with tjs undefined. A temporary config/server on 8091 produced **2 passes and 1 failure**: the empty-state test contradicted automatic loading from a nonempty folder. Browser tests did not verify native initialization, store, folder dialogs, or launch at login. Clipboard copy also left a temporary PNG on disk.

## Disk footprint

Installed Go binary: **11.72 MiB**. Built JS .app: approximately **9.12 MiB** allocated on disk; standalone backend: **5.75 MiB**; launcher: **3.11 MiB**. A smaller distribution does not imply lower runtime memory. Browser and system WebKit sizes are excluded.

The recommended order was to fix both awaits and test commands, remove redundant base64, restore file validation and blob cleanup, protect unsaved work, and keep the background watcher separate from a disposable editor. At that point, retaining the Go version for daily use was recommended until these issues were addressed.

## Method and limitations

Repository sources were not modified during those measurements. A copy in `/tmp/capturescreen-review/working` included the two await fixes, a separate app ID, and diagnostic timers; watcher, base64, and editor logic were otherwise unchanged. Diagnostics exported PNG in memory rather than to the clipboard. Launch at login was not enabled, and Go was not stopped.

Native close-button clicks, dialogs, actual clipboard contents, login launch, and long-running stability were not checked. Programmatic tiny.win.close() terminated the application, but this was not equivalent to a physical close with setHideOnClose; no separate physical-close measurement was recorded.

Raw vmmap and JSON results were saved in `.build/review-results`, ignored by Git. loaded.json corresponds to a hidden-window measurement; visible.json to an open window in the following launch. The JS application, test Chromium, and development server were stopped afterwards, and the test screenshot copy was removed.

Runtime sources used then: [official Tiny.js v0.50.1](https://github.com/tarwin/tinyjsapp/releases/tag/v0.50.1) and [Tiny.js documentation](https://tinyjs.app/docs.html). Async store/realPath behavior and closing semantics were checked against the source and running runtime of that version.
