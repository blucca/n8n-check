// Run the same imported workflow twice against one isolated SQLite database.
// The first pass uses n8n-check; the second uses its execution/assertion functions.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(process.argv[2]??'./n8n-check');
const {runCase,runtimeEnv,command}=await import(pathToFileURL(join(root,'src/runner.mjs')));
const {executionFrom,executionChecks,junit}=await import(pathToFileURL(join(root,'src/report.mjs')));
const out=resolve(process.argv[3]??join(here,'results/replay'));
const runtime=join(here,'n8n-datatable.cjs');
const first=await runCase({workflowFile:join(here,'fixed.workflow.json'),caseFile:join(here,'two-eligible.case.json'),n8n:runtime,out:join(out,'first')});
if(first.exitCode!==0)throw Error('Initial preparation failed: '+JSON.stringify(first));
const home=join(first.runDirectory,'n8n-home');
const dbFile=join(home,'.n8n/database.sqlite');
function rows(){const db=new DatabaseSync(dbFile,{readOnly:true});const table=db.prepare("SELECT id FROM data_table WHERE name='invoice_reminder_history'").get();if(!table)throw Error('Missing history table');const data=db.prepare('SELECT * FROM "data_table_user_'+table.id+'" ORDER BY id').all();db.close();return data;}
const before=rows();
const env=runtimeEnv(home);env.N8N_ENCRYPTION_KEY=JSON.parse(await readFile(join(home,'.n8n/config'),'utf8')).encryptionKey;
const workflow=JSON.parse(await readFile(join(first.runDirectory,'workflow.json'),'utf8'));
const start=Date.now();
const raw=await command(runtime,['execute','--id='+workflow.id,'--rawOutput'],env,60000);
await mkdir(join(out,'second'),{recursive:true});
await writeFile(join(out,'second/execute.stdout.log'),raw.stdout);await writeFile(join(out,'second/execute.stderr.log'),raw.stderr);
const execution=executionFrom(raw.stdout+'\n'+raw.stderr);if(execution)await writeFile(join(out,'second/execution.json'),JSON.stringify(execution,null,2));
const original=JSON.parse(await readFile(join(here,'two-eligible.case.json'),'utf8'));
const assertions=original.assertions.map(a=>a.node==='Contract Ready for Review'||a.node==='Contract Writes'?{...a,equals:[]}:a.node==='Contract Already Prepared'?{...a,equals:original.assertions[0].equals.map(v=>({...v,outputPath:'already_prepared',actionReason:'reminder_stage_already_prepared'}))}:a);
const after=rows();const checks=executionChecks(execution,raw,assertions);
checks.push({name:'Stored rows unchanged across replay',passed:JSON.stringify(before)===JSON.stringify(after),expected:before,actual:after});
const previousTimes=execution?.data.resultData.runData['Already Prepared']?.flatMap(run=>run.data.main[0].map(item=>({id:item.json.historyRecordId,previousPreparedAt:item.json.previousPreparedAt})))??[];
const storedTimes=before.map(row=>({id:row.id,previousPreparedAt:new Date(row.prepared_at.replace(' ', 'T') + 'Z').toISOString()}));
checks.push({name:'Replay keeps original preparation timestamps',passed:JSON.stringify(previousTimes)===JSON.stringify(storedTimes),expected:storedTimes,actual:previousTimes});
const passed=checks.every(c=>c.passed);const report={schemaVersion:1,runnerVersion:first.runnerVersion,name:'Morsof unchanged replay against persistent Data Table',status:passed?'passed':'failed',checks,requests:[],network:first.network,n8nVersion:first.n8nVersion,runDirectory:join(out,'second'),durationMs:Date.now()-start,exitCode:passed?0:1};
await writeFile(join(out,'second/report.json'),JSON.stringify(report,null,2)+'\n');await writeFile(join(out,'second/junit.xml'),junit(report));
process.stdout.write(JSON.stringify({status:report.status,checks:checks.length,rows:after.length,report:join(out,'second/report.json')})+'\n');process.exitCode=report.exitCode;
