import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const ignored = new Set(['.git', 'dist', 'node_modules']);
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.sql', '.svg', '.webmanifest', '.yml', '.yaml']);
const violations = [];

async function inspect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await inspect(path);
      continue;
    }
    if (!textExtensions.has(extname(entry.name))) continue;
    const lines = (await readFile(path, 'utf8')).split('\n');
    lines.forEach((line, index) => {
      if (line.includes('\u2014')) violations.push(`${relative(root, path)}:${index + 1}`);
    });
  }
}

await inspect(root);

if (violations.length) {
  console.error(`Disallowed punctuation found in ${violations.join(', ')}`);
  process.exitCode = 1;
}
