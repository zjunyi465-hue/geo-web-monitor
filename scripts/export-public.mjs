import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const target = resolve(root, 'release-preview', 'geo-web-monitor-' + new Date().toISOString().replace(/[:.]/g, '-'));
// Explicitly allowed files and code directories. Never copy the entire workspace.
const entries = ['README.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md', '.gitignore', 'package.json', 'pnpm-lock.yaml',
  'CHANGELOG.md', '.editorconfig', '.gitattributes',
  'src', 'public', 'test', 'scripts', '.github', 'examples',
  'docs/README.en.md', 'docs/quickstart.md', 'docs/privacy.md', 'docs/troubleshooting.md', 'docs/architecture.md',
  'docs/how-it-works.md', 'docs/roadmap.md', 'docs/demo.md', 'docs/sharing.md', 'docs/releasing.md', 'docs/validation.md', 'docs/assets'];
await mkdir(target, { recursive: true });
for (const entry of entries) {
  await mkdir(dirname(join(target, entry)), { recursive: true });
  await cp(join(root, entry), join(target, entry), { recursive: true, dereference: false,
    filter: async path => {
      const { lstat } = await import('node:fs/promises');
      if ((await lstat(path)).isSymbolicLink()) throw new Error('Refusing symlink: ' + relative(root, path));
      return true;
    } });
}
const manifest = [];
async function inspect(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else {
      const bytes = await readFile(path);
      manifest.push({ path: relative(target, path).replaceAll('\\', '/'), bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
await inspect(target);
manifest.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(join(target, 'PUBLIC-MANIFEST.json'), JSON.stringify({ version: 1, files: manifest }, null, 2) + '\n');
console.log('Public preview: ' + target);
console.log(manifest.length + ' allowlisted files. No runtime data or Git history copied. Review before publishing.');
