# Specification: windowless Watcher and separate editor

The editor originates from the sibling Go project `../captureScreen`. Target platform: macOS, Tiny.js 0.51.0, txiki.js 26.6.0.

## Processes

The main `ShotMark.app` uses `backend: src/agent.js`, `mainWindow: false`, and `activation: accessory`. Its launcher owns a native menu bar icon; its backend owns file observation and settings. No hidden service window or WebView is created. Closing the editor does not terminate the agent.

`Contents/Resources/ShotMark Editor.app` is a separate Tiny.js application with `src/main.js` as its backend and a 1180×820 main window. `setHideOnClose(false)` terminates the editor when the window closes, releasing its entire WebKit session.

New screenshots use `/usr/bin/open -a <editor bundle> --env SHOTMARK_DATA_DIR=... <path>`. LaunchServices starts the editor or sends files to its running instance. `onOpenFiles` accepts supported images and ignores unrelated arguments. Image names are retained until the page is ready.

Menu bar commands open the editor, history, or folder settings through `shotmark-editor://editor|history|settings`. URLs work on cold startup and in a running editor. Before page readiness, actions are returned by `editorReady`; afterwards, they are delivered as page events. History lists the newest 50 regular supported images in the selected folder.

A manually opened editor starts the agent if absent, independently of whether its initial folder is available. Singleton ownership uses a Unix socket. Probes await an acknowledgement before disconnecting to avoid txiki.js getpeername failures. Stop Watcher stops observation and terminates the agent while leaving an open editor available.

## Settings and files

The watch folder is stored in settings.json, separately from the runtime store. Without a usable saved preference, use `CAPTURE_SCREEN_WATCH_FOLDER`, then `~/Documents`. Normalize and save the folder before launching the first editor. The watcher follows saved-folder changes without restarting. Invalid new selections preserve the previous folder; an unavailable initial folder leaves the agent and settings menu available.

Await realPath. Frontend filenames must not contain path components. Accept only regular, non-hidden PNG/JPG/JPEG files and reject symlinks and directories. Debounce for 500 ms and check file-size stability over 200 ms. Retain changes received during processing and recheck before acceptance. Deduplicate accepted paths; callback failure must not mark acceptance. Cancel pending work after stopping, including work resuming from asynchronous validation.

Launch at login uses a user LaunchAgent with RunAtLoad and the executable of the main windowless bundle. Changes take effect at the next login and do not stop the current agent. Report errors when disabling the setting fails, except when the plist is already absent. Plist presence is the configured state; it does not prove system approval or a successful login launch.

## Editor

Replacing a screenshot or changing folders requires confirmation when there are unsaved changes. A stale load or crop must not replace a newer image or restore stale annotations. Release blob URLs on image replacement, clearing, and errors.

Tool controls must reflect the active options, including after switching tools or loading a new image. Color swatches must update the active tool. Committing text must redraw it immediately. Text hit-testing and selection use the rendered baseline and measured glyph bounds.

PNG export and clipboard output must agree with the preview's shape opacity and blur-region geometry. Clip blur operations to the visible image bounds, including negative coordinates after cropping.

Saving or copying marks only the exported state as saved. Cancelling the save dialog preserves unsaved status. Send base64 PNG directly to the clipboard without a temporary file. Annotation history stays in the editor and is discarded when that process exits.

## Distribution and verification

Download SDK v0.51.0 for the current macOS architecture into .vendor/tinyjs and verify SHA256. Build the parent and nested .app bundles using the vendor's stock tjs and JS resources. Verify the bundle signature; do not publish bare binaries.

`npm test` runs backend checks in the pinned txiki.js runtime and Playwright tests on port 8091. Historical native lifecycle results are in [WINDOW_LIFECYCLE.md](WINDOW_LIFECYCLE.md). Windows/Linux, Intel, Developer ID signing, notarization, and an actual login launch have not been verified.
