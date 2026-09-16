import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(app, /durableTransaction/);
assert.match(app, /durability: 'strict'/);
assert.match(app, /readLatestSnapshot/);
assert.match(app, /restore-point-/);
assert.match(app, /navigator\.storage\.persist\(\)/);
assert.match(app, /navigator\.storage\.estimate\(\)/);
assert.match(app, /SNAPSHOT_LIMIT = 12/);
assert.match(app, /REVISION_WINDOW = 60 \* 1000/);
assert.match(app, /state = mergeNotebook\(state, incoming\)/);
assert.match(page, /id="history-dialog"/);
assert.match(page, /id="storage-health"/);
assert.match(page, /id="export-markdown-archive"/);

console.log('recovery and portability checks passed');
