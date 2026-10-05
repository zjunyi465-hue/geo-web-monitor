import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/browser-window.ps1', import.meta.url));

export async function captureForeground() {
  if (process.platform !== 'win32') return '0';
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'capture'], { windowsHide: true });
  return stdout.trim();
}

export async function placeBrowserWindow(context, action, foreground = '0') {
  if (process.platform !== 'win32') return;
  const session = await context.browser().newBrowserCDPSession();
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    const browser = processInfo.find(item => item.type === 'browser');
    if (!browser) throw new Error('无法识别监测浏览器进程');
    await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Action', action, '-BrowserProcessId', String(browser.id), '-PreviousWindow', foreground], { windowsHide: true });
  } finally { await session.detach(); }
}
