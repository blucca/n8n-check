// Characterise the captured revision; replay the current browser product with the two CSVs above.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync(new URL('./observed.json', import.meta.url)));
assert.equal(new TextDecoder('gb18030').decode(new TextEncoder().encode('é')), '茅');
assert.equal(new TextDecoder('utf-8').decode(new TextEncoder().encode('茅')), '茅');
assert.deepEqual(r.controls.map(x => [x.actual, x.met_expected]), [['Demo Küçük', true], ['示例 茅', true], ['é', false]]);
assert.equal(r.healthy_surname_report.repaired_cells, 1);
console.log('Captured revision: known damage restored; healthy single-surname control failed.');
