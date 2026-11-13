// Check the two recorded native runs. Run the workflow commands in README first.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]??'results/http-utf8');
const reports=await Promise.all(['autodetect','explicit-json'].map(async name=>JSON.parse(await readFile(resolve(root,name,'report.json'),'utf8'))));
for(const [i,r] of reports.entries()) {
 assert.equal(r.status,i===0?'failed':'passed');
 assert.equal(r.exitCode,i===0?1:0);
 assert(r.checks.find(c=>c.name==='n8n execution succeeds').passed);
 assert.equal(r.requests.length,6);
 assert(r.requests.every(x=>x.method==='GET'&&x.status===200&&x.matched));
 assert(r.checks.filter(c=>c.name!=='Read UTF-8 JSON: output 0').every(c=>c.passed));
}
assert.equal(reports[0].n8nVersion,reports[1].n8nVersion);
const [auto,json]=reports.map(r=>r.checks.find(c=>c.name==='Read UTF-8 JSON: output 0'));
assert.deepEqual(json.actual,json.expected);
assert.deepEqual(auto.expected,json.expected);
assert.equal(auto.actual[0].titre,"Point d'茅tape");
assert.equal(auto.actual[1].name,'K眉莽眉k');
for(const i of [2,3,4,5])assert.deepEqual(auto.actual[i],json.actual[i]);
console.log(`PASS on n8n ${reports[0].n8nVersion}: both engines succeed; Auto corrupts two UTF-8 records; JSON preserves all six.`);
