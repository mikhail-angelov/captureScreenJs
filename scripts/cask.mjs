// Prints the Homebrew cask for a release; CI writes it to mikhail-angelov/homebrew-tap on every tag.
// Usage: node scripts/cask.mjs <version> [release dir with ShotMark-<version>-macos-<arch>.zip.sha256, default release]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [version, dir = 'release'] = process.argv.slice(2);
if (!version) throw new Error('Usage: node scripts/cask.mjs <version> [release dir]');
const sha256 = (arch) => readFileSync(join(dir, `ShotMark-${version}-macos-${arch}.zip.sha256`), 'utf8').split(/\s/)[0];

process.stdout.write(`cask "shotmark" do
  arch arm: "arm64", intel: "x86_64"

  version "${version}"
  sha256 arm:   "${sha256('arm64')}",
         intel: "${sha256('x86_64')}"

  url "https://github.com/mikhail-angelov/captureScreenJs/releases/download/v#{version}/ShotMark-#{version}-macos-#{arch}.zip"
  name "ShotMark"
  desc "Screenshot annotator: arrows, text, shapes, marker, blur and crop"
  homepage "https://github.com/mikhail-angelov/captureScreenJs"

  depends_on macos: :sonoma

  app "ShotMark.app"

  # ShotMark isn't notarized, so Gatekeeper would refuse to open the quarantined download.
  # Cleared on the staged copy, before Homebrew moves it to the Applications folder.
  preflight_steps do
    run "/usr/bin/xattr",
        args:           ["-dr", "com.apple.quarantine", "ShotMark.app"],
        chdir:          ".",
        writable_paths: ["ShotMark.app"]
  end

  # The menu bar agent and its editor keep running from the old bundle otherwise.
  uninstall quit: [
    "com.mikhailangelov.shotmark",
    "com.mikhailangelov.shotmark.editor",
  ]

  zap trash: [
    "~/Library/Application Support/com.mikhailangelov.shotmark",
    "~/Library/LaunchAgents/com.mikhailangelov.shotmark.watcher.plist",
  ]

  caveats <<~EOS
    Start ShotMark from the Applications folder or with:
      open -a ShotMark
    It lives in the menu bar and opens new screenshots from the watched folder (~/Documents by default).
    Upgrades quit it; open it again afterwards.
  EOS
end
`);
