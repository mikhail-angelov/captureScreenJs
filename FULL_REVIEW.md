# Full ShotMark review and fixes

Reviewed on October 13, 2026. Scope: the complete working tree, including uncommitted/new backend, frontend, tools, build scripts, settings, tests, and documentation. Requirements: SPEC.md, README.md, and the project's KISS/YAGNI/DRY rules. No commit was created.

The review found **11 issues: 2 P1 and 9 P2**. All were addressed in the subsequent implementation. The sections below retain the original failure scenarios and describe their fixes. The earlier [CAPTURESCREEN_REVIEW.md](CAPTURESCREEN_REVIEW.md) covers a different version.

## Launch at login

The former `src/login.js`, now [src/launch-at-login.js](src/launch-at-login.js), configures macOS startup, not authentication. The editor checkbox calls the backend, which writes `~/Library/LaunchAgents/com.mikhailangelov.shotmark.watcher.plist` with the main agent executable in ProgramArguments and RunAtLoad enabled. Disabling removes that plist. Changes apply at the next login; they do not terminate the current agent or open an editor.

The name now states the module's purpose. Deletion errors are reported except for an already absent file. The configured state still reflects plist presence rather than verified permissions or successful login execution. An actual macOS login was not performed.

## Standards: interface and rendering correctness

1. **P1: asynchronous crop restored a stale screenshot.** [editor.js](src/frontend/editor.js): applyCrop captured an image and operations, awaited decoding, and dispatched over a newer image. It now checks image, operation-list, and crop identity after decoding, discarding stale results.
2. **P2: controls retained values after tool options reset.** [editor.js](src/frontend/editor.js): switching tools resets options to their defaults. Controls, numeric labels, and swatches now synchronize with those defaults through explicit data-option attributes.
3. **P2: committed text was invisible until another redraw.** [text.js](src/frontend/tools/text.js): commitText changed history and removed its textarea without rendering. It now redraws immediately after commit. A regression check also exposed duplicate commits when textarea removal fired blur synchronously; active text state is now cleared before removal, including on cancellation.
4. **P2: text/shape/marker swatches did nothing.** [editor.js](src/frontend/editor.js), [index.html](src/frontend/index.html): listeners were attached to color inputs instead of palette containers. Each palette now has its own ID and correct listener. Custom inputs and active swatches stay synchronized.
5. **P2: exported solid shapes had faded borders.** [export.js](src/frontend/export.js): fill alpha also affected the stroke. Full opacity is restored before stroking, matching the SVG preview.
6. **P2: blur extended beyond its rectangle after crop.** [blur-render.js](src/frontend/blur-render.js): a negative left/top coordinate did not reduce the visible width/height. Preview and export now share a clipped rectangle intersection and blur operation. For x=-20 and width=40, only the visible 20 pixels are affected.
7. **P2: clicks on visible text missed the operation.** [text-metrics.js](src/frontend/text-metrics.js), [hit-test.js](src/frontend/hit-test.js), [render.js](src/frontend/render.js): hit bounds were below the baseline while letters were above it. Hit-testing and selection bounds now share measured glyph bounds.

Seven findings in this axis; the most severe was the stale crop. Shared calculations address demonstrated rendering drift without adding a general rendering framework.

## Specification: file delivery and process lifecycle

8. **P1: multi-stage writes could lose a completed screenshot.** [watcher.js](src/watcher.js): a final write between the 500 and 700 ms size checks was ignored while pending; mismatched sizes then abandoned the file. The original reproduction returned no accepted files. Changes received during processing are now retained and trigger another stability check. This preserves the specified delayed delivery of new screenshots.
9. **P2: editor launch or folder observation could resume after stop.** [daemon.js](src/daemon.js): running was checked only before asynchronous lstat or folder validation. The original controlled lstat reproduction launched an editor with running=false. Both paths now recheck running after validation, satisfying cancellation after stop.
10. **P2: a manually opened editor did not start an agent with an unavailable folder.** [main.js](src/main.js): initialize rejected the folder before ensureWatcher. Agent startup now runs independently before folder validation, satisfying the requirement that manual editor launch starts the agent and leaves settings available.
11. **P2: callback failure permanently suppressed a screenshot.** [watcher.js](src/watcher.js): markHandled ran before onNewFile succeeded. The original reproduction returned handledAfterFailure=true and retryAllowed=false. Files are now marked accepted only after callback success; later events can retry a failed path.

Four findings in this axis; the most severe was the lost multi-stage write.

## English project content

UI labels, dialogs, error messages, logs, comments, package metadata, test descriptions, and project documentation are now in English. Unicode filenames remain covered by tests. The empty/error-state frame selector was also corrected to use the existing image-frame ID.

## Verification scope

The original review's npm test run passed 52 backend checks and 9 frontend tests despite the gaps above. The implementation extends the existing regression tests for the affected behavior; current results are reported with the implementation's final response.

Earlier missing awaits, unnecessary event base64, regular-file validation, blob URL cleanup, and screenshot replacement confirmation were already fixed before this review. Historical native memory/lifecycle measurements in WINDOW_LIFECYCLE.md have not been repeated by this change. Real macOS login, physical menu/close clicks, manual dialogs, system clipboard contents, Intel, Windows/Linux, Developer ID signing, and notarization remain outside this verification.
