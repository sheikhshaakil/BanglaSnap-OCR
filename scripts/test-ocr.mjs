import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../panel/panel.js', import.meta.url), 'utf8');
const context = vm.createContext({ domLines: [], selectionSize: { width: 1000, height: 1000 } });
vm.runInContext(source.slice(source.indexOf('function extractReliableOcrLines('), source.indexOf('function toggleRawText(')), context);
const word = (text, x0, confidence = 96) => ({ text, confidence, bbox: { x0, x1: x0 + Math.max(10, text.length * 10), y0: 100, y1: 120 } });
const line = (words) => ({ words, text: words.map((w) => w.text).join(' '), confidence: 96, bbox: { x0: 0, x1: 600, y0: 100, y1: 120 } });
assert.equal(context.cleanOcrLine(line([word('GTA', 0), word('6', 40), word('&', 60), word('More', 80)]), 1000, 1000).text, 'GTA 6 & More');
assert.equal(context.cleanOcrLine(line([word('9', 0), word('7', 20), word('3', 40)]), 1000, 1000), null);
assert.equal(context.isReliableWord(word('2১', 0)), false);
const groups = context.splitOcrLine(line([word('The', 0), word('GTA', 40), word('Assassin', 80), word('GP', 230)]));
assert.equal(groups.length, 2, 'Separate icons from channel labels across a large gap');
assert.equal(groups[0].text, 'The GTA Assassin');
assert.equal(context.isReliableLine(context.cleanOcrLine(groups[1], 1000, 1000)), false);
const title = { text: 'The American Dream', confidence: 90, top: 0.1, bottom: 0.15, left: 0, right: 0.4, pass: 0 };
assert.equal(context.combinePageAndImageText([title]).text, title.text, 'Keep a strong image title even if the other pass misses it');
context.domLines.push({ text: 'Another column', top: 100, height: 50, left: 600, width: 300 });
assert.ok(context.combinePageAndImageText([title]).text.includes(title.text), 'Same-row webpage text elsewhere must not erase image text');
context.domLines.length = 0;
assert.equal(context.combinePageAndImageText([title, { ...title, pass: 1 }]).text, title.text, 'Merge repeated detections');
assert.equal(context.combinePageAndImageText([{ ...title, text: 'Random texture', confidence: 60 }]).text, '', 'Do not trust an uncertain single-pass phrase');
assert.equal(context.combinePageAndImageText([{ ...title, text: '333K subscribers' }]).text, '333K subscribers');
for (const text of ['অ', 'আ', 'ক', 'খ', 'ও', 'ঈ', 'গ', 'ঘ', 'বাংলা', 'কীবোর্ড']) {
  const candidate = context.cleanOcrLine(line([word(text, 0)]), 1000, 1000);
  assert.ok(candidate && context.isReliableLine(candidate), `Preserve Bengali label ${text}`);
  assert.equal(context.combinePageAndImageText([{ ...candidate, pass: 0 }]).text, text);
}
assert.equal(context.hasBanglaLetter('১২৩'), false, 'Bengali numbers are not letters');
assert.equal(context.hasBanglaLetter('া'), false, 'A vowel mark alone is not a letter');
assert.equal(context.linesAreSimilar({ ...title, text: 'ক' }, { ...title, text: 'কী' }), false, 'Distinct short Bengali labels must not merge');
context.domLines.push({ text: 'Google Play', top: 200, height: 20, left: 0, width: 200 });
const bilingual = context.combinePageAndImageText([{ ...title, text: 'বাংলা কীবোর্ড', confidence: 90 }]).text;
assert.ok(bilingual.includes('বাংলা কীবোর্ড') && bilingual.includes('Google Play'), 'Bengali image text and English page text coexist');
console.log('OCR regression checks passed, including Bengali alphabet tiles and bilingual output.');
