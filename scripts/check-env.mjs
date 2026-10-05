import { access } from 'node:fs/promises';
import { join } from 'node:path';

let failures = 0;
function result(ok, description) {
  console.log((ok ? 'PASS ' : 'FAIL ') + description);
  if (!ok) failures++;
}
result(Number(process.versions.node.split('.')[0]) >= 24, 'Node.js 24+（当前 ' + process.versions.node + '）');
result(process.platform === 'win32', 'Windows 为本项目验收基线');
try { await import('node:sqlite'); result(true, '内置 SQLite'); } catch { result(false, '请升级 Node.js 以使用内置 SQLite'); }
try { await import('playwright'); result(true, 'Playwright 依赖已安装'); } catch { result(false, '请在项目目录执行 npm install 或 pnpm install'); }
if (process.platform === 'win32') {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const available = await Promise.all(roots.map(root => access(join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).then(() => true, () => false)));
  result(available.some(Boolean), 'Microsoft Edge 可用（标准安装位置）');
}
console.log('此检查不登录平台、不验证网络可用性，也不读取个人数据。');
process.exitCode = failures ? 1 : 0;
