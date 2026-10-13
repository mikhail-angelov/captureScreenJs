// Launch the windowless tray agent at the next macOS login.
import { joinPath } from './config.js';
const label = 'com.mikhailangelov.shotmark.watcher';
const agentPath = () => joinPath(tjs.homeDir, `Library/LaunchAgents/${label}.plist`);
const escape = (value) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export async function getLaunchAtLogin() {
  try { await tjs.stat(agentPath()); return 'enabled'; } catch { return 'disabled'; }
}

export async function setLaunchAtLogin(enabled, command) {
  if (!enabled) {
    try { await tjs.remove(agentPath()); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return;
  }
  await tjs.makeDir(joinPath(tjs.homeDir, 'Library/LaunchAgents'), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${command.map((argument) => `<string>${escape(argument)}</string>`).join('')}</array>
<key>RunAtLoad</key><true/>
</dict></plist>\n`;
  await tjs.writeFile(agentPath(), new TextEncoder().encode(plist));
}
