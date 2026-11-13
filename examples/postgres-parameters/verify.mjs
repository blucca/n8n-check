// Verify the saved native SELECTs, including the ordinary-ID negative control.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]??fileURLToPath(new URL('.',import.meta.url)));
const expected=[{client_id:'client_demo',lead_key:'website:demo_plain'},{client_id:'client_demo',lead_key:'website:demo,a'}];
const rows=(run,node)=>run.data.resultData.runData[node][0].data.main[0].map(item=>item.json);
const runs=await Promise.all(['scalar','array'].map(async mode=>JSON.parse(await readFile(resolve(root,`${mode}-execution.json`),'utf8'))));
for (const run of runs) {
 assert.equal(run.status,'success');
 assert.equal(run.finished,true);
 assert.equal(run.data.resultData.lastNodeExecuted,'Read Bound Values');
 assert.deepEqual(rows(run,'Demo Input'),expected);
 assert.equal(rows(run,'Read Bound Values').length,2);
 assert.deepEqual(rows(run,'Read Bound Values')[0],expected[0]);
}
assert.deepEqual(rows(runs[0],'Read Bound Values')[1],{client_id:'client_demo',lead_key:'website:demo'});
assert.deepEqual(rows(runs[1],'Read Bound Values'),expected);
const workflows=await Promise.all(['scalar','array'].map(async mode=>JSON.parse(await readFile(resolve(root,`${mode}-workflow.json`),'utf8'))));
assert.equal(workflows[0].nodes[2].typeVersion,2.7);
assert.equal(workflows[0].nodes[2].parameters.options.queryReplacement,'={{ $json.client_id }},{{ $json.lead_key }}');
assert.equal(workflows[1].nodes[2].parameters.options.queryReplacement,'={{ [$json.client_id, $json.lead_key] }}');
for (const workflow of workflows) {
 delete workflow.id; delete workflow.name;
 workflow.nodes[2].parameters.options.queryReplacement='<the single tested change>';
}
assert.deepEqual(workflows[0],workflows[1]);
console.log('PASS: both native runs succeed; v2.7 scalar parameters shorten a comma-bearing ID; the array preserves both complete rows.');
