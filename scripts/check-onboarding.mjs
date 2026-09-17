import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

assert.match(page, /id="onboarding-dialog" aria-label="Welcome to Jotfield"/);
assert.match(app, /const ONBOARDING_KEY = 'jotfield-onboarding-v1'/);
assert.equal((page.match(/data-onboarding-step=/g) || []).length, 3);
assert.match(page, /id="open-onboarding"/);
assert.match(page, /id="onboarding-import"/);
assert.match(page, /id="onboarding-write"/);
assert.match(app, /freshNotebook.*STORAGE_KEY.*LEGACY_STORAGE_KEY/);
assert.match(app, /if \(!freshNotebook \|\| hadDurableNotebook \|\| localStorage\.getItem\(ONBOARDING_KEY\) \|\| location\.hash\) return/);
assert.match(app, /hydrateDurableState\(\)\.finally\(maybeOpenOnboarding\)/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.onboarding-step\.active/);
assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.onboarding-dialog/);
console.log('first-run onboarding checks passed');
