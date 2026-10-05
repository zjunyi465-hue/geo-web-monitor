import { DatabaseSync, backup } from 'node:sqlite';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export async function createBackup({ dbPath = resolve('data', 'geo-monitor.db'),
  resultsRoot = resolve('results'), backupRoot = resolve('backups') } = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (db.prepare("SELECT count(*) AS count FROM runs WHERE status='running'").get().count) {
      throw new Error('有监测任务正在运行，请在任务结束后备份');
    }
    const folder = join(backupRoot, 'geo-' + new Date().toISOString().replace(/[:.]/g, '-'));
    await mkdir(folder, { recursive: true });
    await backup(db, join(folder, 'geo-monitor.db'));
    await cp(resultsRoot, join(folder, 'results'), { recursive: true, force: false }).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    await writeFile(join(folder, 'README.txt'),
      '此备份包含数据库和结果截图，不包含 profiles 中的网页登录状态。恢复前请停止 GEO 服务；恢复后各平台账号可能需要重新登录。\n',
      'utf8');
    return folder;
  } finally { db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  createBackup().then(folder => console.log('备份完成：' + folder), error => {
    console.error('备份失败：' + error.message);
    process.exitCode = 1;
  });
}
