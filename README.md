# ShotMark

A native macOS screenshot annotator built with [Tiny.js](https://github.com/tarwin/tinyjsapp), ported from [captureScreen](https://github.com/mikhail-angelov/captureScreen).

ShotMark watches a folder for PNG, JPG, and JPEG screenshots and opens an editor with arrows, text, shapes, markers, blur, crop, undo/redo, PNG export, and clipboard copy.

## Install

```sh
brew install --cask mikhail-angelov/tap/shotmark
open -a ShotMark
```

This puts ShotMark in `/Applications` and clears the macOS quarantine flag, since the app isn't notarized. Homebrew can't start apps itself, so open ShotMark once; it then lives in the menu bar.
Update with `brew upgrade --cask shotmark`; the upgrade quits ShotMark, so open it again afterwards. `brew uninstall --cask shotmark` removes the app; add `--zap` to delete its settings and the launch-at-login item too.

Without Homebrew, download the ZIP for your Mac from the [latest release](https://github.com/mikhail-angelov/captureScreenJs/releases/latest) (see [CI and macOS releases](#ci-and-macos-releases)).

## Build and run

Requires macOS, Node.js, and the system `tar` and `codesign` commands. The build downloads the official Tiny.js **0.51.0** SDK for the architecture of the current Node.js process and verifies its archive against the vendor's SHA256 checksums. Global `tinyjs` and `tjs` installations are not required. ARM64 has been tested; Intel has not.

```sh
npm ci
npm run build
open dist/ShotMark.app
```

For terminal use, `npm run watch` starts the built application. `npm run dev` builds it first and then starts it.

Distribute the complete **`dist/ShotMark.app`** bundle, including its nested editor. The editor depends on its parent bundle for starting the agent and configuring launch at login. Close the running copy before rebuilding it.

## How it works

1. The main application starts a folder watcher and a native menu bar icon without creating a window or WebView.
2. A new screenshot opens the nested `ShotMark Editor.app` through LaunchServices. Subsequent screenshots go to the existing editor. Replacing an image or changing folders requires confirmation when there are unsaved changes.
3. Closing the editor terminates its backend, launcher, and WebKit session. The menu bar agent keeps watching.
4. The next screenshot starts a fresh editor process.

The menu bar includes **Open Editor**, **Screenshot History**, **Settings**, and **Stop Watcher**. History lists the 50 most recent supported images. Stopping Watcher leaves an open editor available to finish your work. A Unix socket prevents duplicate agents. Opening the nested editor manually also starts the agent if needed, even when the configured folder is unavailable.

## Watch folder

The selected folder is saved in:

```text
~/Library/Application Support/com.mikhailangelov.shotmark/settings.json
```

Without a usable saved preference, ShotMark uses `CAPTURE_SCREEN_WATCH_FOLDER`, then `~/Documents`. The watcher follows folder changes without restarting. Invalid selections preserve the previous folder. An unavailable initial folder leaves the menu bar agent available so you can choose another folder.

Only regular, non-hidden PNG/JPG/JPEG files are accepted; symlinks and directories are rejected. Processing waits 500 ms and compares file sizes 200 ms apart. Changes received during processing trigger another check. Accepted paths are deduplicated for the watcher session; a failed callback does not mark a file as accepted.

## Launch at login

The editor's **Launch at login** checkbox creates a user LaunchAgent for the main windowless application, including its menu bar icon. It takes effect at the next macOS login and does not stop the current agent when disabled. `src/launch-at-login.js` implements this setting; it does not handle authentication. The checkbox reflects the presence of its plist, not a verified macOS permission or successful login launch.

## Development and tests

```sh
npm test
```

The backend suite runs in txiki.js from the pinned SDK. Playwright runs the browser suite with a development server on port 8091. You can run either suite with `npm run test:backend` or `npm run test:frontend`.

For manual browser development:

```sh
PORT=8091 npm run dev-server
```

The development server uses `tests/` as its screenshot folder by default; set `SHOT_FOLDER` to use another folder. It is not part of the packaged application.

## CI and macOS releases

[GitHub Actions](.github/workflows/ci.yml) runs `npm ci`, installs Playwright Chromium, runs `npm test`, builds the application, and packages it on native Apple Silicon and Intel macOS runners. Pushes and pull requests run these checks; manual workflow runs are also available. Successful builds upload ZIP archives and SHA256 files as workflow artifacts.

To publish a release, set `version` in `tinyjs.json`, commit the changes, then create and push the matching tag. For version 1.0.0:

```sh
git tag v1.0.0
git push origin v1.0.0
```

Tag builds reject a version mismatch. After both architectures pass, the workflow creates a GitHub release with generated notes and these downloads:

- `ShotMark-1.0.0-macos-arm64.zip` for Apple Silicon.
- `ShotMark-1.0.0-macos-x86_64.zip` for Intel.
- A `.sha256` checksum file for each archive.

Tags with a prerelease suffix, such as `v1.1.0-beta.1`, create prereleases. Only the release job gets permission to write repository contents; it uses GitHub's automatic token. For stable tags it also writes the Homebrew cask (generated by `scripts/cask.mjs`) to [mikhail-angelov/homebrew-tap](https://github.com/mikhail-angelov/homebrew-tap). That step needs a `HOMEBREW_TAP_TOKEN` secret, a fine-grained token with contents: write on the tap only; without it the step is skipped. Releases are ad-hoc signed, without Developer ID signing or notarization, so macOS may require approval before opening a downloaded app.

For a local package, run `npm run build` followed by `npm run package`. Output goes to `release/`. Extract the ZIP, move the complete ShotMark.app bundle to Applications, and open it. Verify a download from the directory containing both files with `shasum -a 256 -c ShotMark-1.0.0-macos-arm64.zip.sha256` (use the Intel filename for Intel downloads).

## Project layout

- `src/agent.js`: windowless backend and native menu bar commands.
- `src/daemon.js`, `src/watcher.js`: singleton coordination and file observation.
- `src/main.js`: editor backend, files, export, settings, and open-file/URL events.
- `src/processes.js`: parent agent and nested editor paths.
- `src/settings.js`, `src/launch-at-login.js`: persisted folder and login launch configuration.
- `src/frontend/`: editor UI, annotation tools, history, and shared rendering calculations.
- `scripts/tinyjs.mjs`, `scripts/build.mjs`, `scripts/package.mjs`, `scripts/cask.mjs`: pinned SDK, two-bundle build, release packaging, and the Homebrew cask.

The background agent uses two processes. Earlier native measurements found approximately 17–18 MiB of combined physical footprint without an editor. See [SPEC.md](SPEC.md) for behavior. These measurements do not establish current performance on other machines. Windows/Linux, Developer ID signing, notarization, and a real login launch have not been verified.
