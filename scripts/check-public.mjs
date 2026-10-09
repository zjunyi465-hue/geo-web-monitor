import { readFile, readdir, lstat, access } from 'node:fs/promises';
import { resolve, join, relative, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(process.argv[2] || '.');
const manifest = JSON.parse(await readFile(join(root, 'PUBLIC-MANIFEST.json'), 'utf8').catch(() => {
  throw new Error('Pass an exported directory: node scripts/check-public.mjs <public-directory>');
}));
const listed = new Map(manifest.files.map(file => [file.path, file]));
let count = 0;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = relative(root, path).replaceAll('\\', '/');
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Symlink not allowed: ' + name);
    if (/(^|\/)(\.git|node_modules|profiles|data|results|backups|work|release-preview|\.codex|\.agents|\.aws|\.ssh)(\/|$)|(^|\/)\.env(?:\.|$)|(^|\/)PROJECT_MEMORY\.md$|\.db(?:-|$)|\.sqlite(?:-|$)|\.log$|codex-clipboard/i.test(name)) {
      throw new Error('Runtime or private file in export: ' + name);
    }
    if (entry.isDirectory()) { await inspect(path); continue; }
    if (name === 'PUBLIC-MANIFEST.json') continue;
    const expected = listed.get(name);
    if (!expected) throw new Error('Unlisted file: ' + name);
    const bytes = await readFile(path);
    if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error('Hash mismatch: ' + name);
    count++;
    if (!name.endsWith('.md')) continue;
    for (const match of bytes.toString('utf8').matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].trim();
      if (/^(https?:|mailto:|#)/.test(link)) continue;
      const destination = resolve(dirname(path), decodeURIComponent(link.split('#')[0]));
      if (!destination.startsWith(root + sep) && destination !== root) throw new Error('Link escapes package: ' + name);
      await access(destination).catch(() => { throw new Error('Broken local link in ' + name + ': ' + link); });
    }
  }
}
await inspect(root);
if (count !== listed.size) throw new Error('Missing manifest file');
console.log('PASS ' + count + ' files: hashes, excluded paths and local Markdown links. Manually review sensitive content before publication.');
