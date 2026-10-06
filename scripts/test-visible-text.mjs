import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../content/area-selector.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('  function visibleTextRect('), source.indexOf('  function showResultPanel('));
const defaults = { opacity: '1', display: 'block', contentVisibility: 'visible', clipPath: 'none', clip: 'auto', overflowX: 'visible', overflowY: 'visible' };
const node = (style = {}, parentElement = null, bounds = {}) => ({
  style: { ...defaults, ...style }, parentElement,
  getBoundingClientRect: () => bounds, contains: () => false,
});
let hit;
const context = vm.createContext({
  window: { innerWidth: 1000, innerHeight: 800 },
  document: { elementFromPoint: () => hit },
  getComputedStyle: (element) => element.style,
});
vm.runInContext(helper, context);
const selection = { left: 0, top: 0, width: 1000, height: 800 };
const box = { left: 20, right: 60, top: 20, bottom: 40, height: 20 };
const check = (element, rect = box) => { hit = element; return context.visibleTextRect(element, rect, selection); };

assert.ok(check(node()), 'Visible text/counts must remain');
assert.equal(check(node({}, node({ opacity: '0' }))), null, 'Transparent ancestor hides player controls');
assert.equal(check(node({}, node({ display: 'none' }))), null);
const counter = node({ overflowY: 'hidden' }, null, { left: 0, right: 100, top: 100, bottom: 120 });
assert.equal(check(node({}, counter)), null, 'Hidden counter digits must not leak into the selected image');
assert.ok(check(node({}, counter), { ...box, top: 100, bottom: 120 }), 'Current visible counter digit must remain');
assert.equal(check(node({}, counter), { ...box, top: 90, bottom: 110 }), null, 'Mostly clipped adjacent counter digit is excluded');
assert.equal(check(node({ clipPath: 'inset(50%)' })), null, 'Masked text must fall back to image OCR');
const covered = node();
hit = node();
assert.equal(context.visibleTextRect(covered, box, selection), null, 'Covered text must not be extracted');
console.log('Visible-text regression checks passed (8 cases).');
