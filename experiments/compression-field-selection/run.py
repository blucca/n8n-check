#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Blucca
import datetime,json,os,resource,secrets,signal,subprocess,sys,time
from pathlib import Path
root=Path(__file__).resolve().parent
runtime=Path(sys.argv[1]).resolve()
output=Path(sys.argv[2]).resolve();output.mkdir(parents=True,exist_ok=False)
results={'started_at':datetime.datetime.now().astimezone().isoformat(),'runtime':{name:json.loads((runtime/'node_modules'/name/'package.json').read_text())['version'] for name in ['n8n','n8n-nodes-base']},'node':subprocess.check_output(['node','--version'],text=True).strip(),'runs':[]}
for mode in ['stock','pr42358']:
 out=output/mode; out.mkdir()
 env=dict(os.environ,N8N_USER_FOLDER=str(out/'data'),N8N_ENCRYPTION_KEY=secrets.token_hex(32),N8N_DIAGNOSTICS_ENABLED='false',N8N_VERSION_NOTIFICATIONS_ENABLED='false',N8N_TEMPLATES_ENABLED='false',N8N_PERSONALIZATION_ENABLED='false',N8N_COMMUNITY_PACKAGES_ENABLED='false',N8N_DEFAULT_BINARY_DATA_MODE='default',N8N_RUNNERS_MODE='internal',N8N_RUNNERS_BROKER_PORT='5781',N8N_RUNNERS_BROKER_LISTEN_ADDRESS='127.0.0.1',N8N_RUNNERS_MAX_OLD_SPACE_SIZE='192',NODES_INCLUDE=json.dumps(['n8n-nodes-base.'+x for x in ['manualTrigger','code','compression']]),EXECUTIONS_DATA_SAVE_ON_SUCCESS='all',EXECUTIONS_DATA_SAVE_ON_ERROR='all',TMPDIR=str(out),COMPRESSION_RUNTIME=str(runtime),NODE_OPTIONS='--max-old-space-size=512'+(' --require='+str(root/'overlay.cjs') if mode=='pr42358' else ''))
 for stage,args in [('import',['import:workflow','--input',str(root/'workflow.json')]),('execute',['execute','--id','compressSilent267','--rawOutput'])]:
  start=time.monotonic();before=resource.getrusage(resource.RUSAGE_CHILDREN)
  with (out/(stage+'.stdout.log')).open('w') as stdout,(out/(stage+'.stderr.log')).open('w') as stderr:
   p=subprocess.Popen(['node',str(runtime/'node_modules/n8n/bin/n8n'),*args],cwd=out,env=env,stdout=stdout,stderr=stderr,start_new_session=True)
   try:rc=p.wait(timeout=90)
   except subprocess.TimeoutExpired:
    os.killpg(p.pid,signal.SIGTERM);p.wait(timeout=10);raise
   finally:
    try:os.killpg(p.pid,signal.SIGTERM)
    except ProcessLookupError:pass
  after=resource.getrusage(resource.RUSAGE_CHILDREN)
  row={'mode':mode,'stage':stage,'exit_code':rc,'elapsed_seconds':round(time.monotonic()-start,3),'cpu_seconds':round(after.ru_utime+after.ru_stime-before.ru_utime-before.ru_stime,3),'peak_rss_kib':after.ru_maxrss}
  results['runs'].append(row);(output/'run-results.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(row),flush=True)
  assert rc==0,(mode,stage,rc)
  # CLI exit 0 also occurs on some setup failures; check.py inspects real execution data.
results['finished_at']=datetime.datetime.now().astimezone().isoformat();(output/'run-results.json').write_text(json.dumps(results,indent=2)+'\n')

subprocess.run([sys.executable,str(root/"check.py"),str(output)],check=True)
