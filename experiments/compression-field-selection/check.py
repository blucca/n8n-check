#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Blucca
import base64,json,sys
from pathlib import Path
root=Path(__file__).resolve().parent
output=Path(sys.argv[1]).resolve()
expected=[{'fileName':'target.json','payload':{'item':i+1,'file':'target','customer':'customer-'+str(i+1)}} for i in range(4)]
report={'scope':'Native n8n 2.41.7, Compression 1.1 and 1; exact Decompress-only gate from PR42358','cases':{}}
for mode in ['stock','pr42358']:
 text=(output/mode/'execute.stdout.log').read_text()
 decoder=json.JSONDecoder(); execution=None
 for i,c in enumerate(text):
  if c!='{':continue
  try:o,_=decoder.raw_decode(text[i:])
  except json.JSONDecodeError:continue
  if isinstance(o,dict) and isinstance(o.get('data'),dict) and 'resultData' in o['data']:
   execution=o;break
 assert execution and execution.get('status')=='success' and execution.get('finished') is True,(mode,'actual workflow success required')
 assert not execution['data']['resultData'].get('error')
 runData=execution['data']['resultData']['runData']
 cases={}
 for name in ['Dynamic modern','Dynamic legacy','Fixed field']:
  runs=runData[name]; assert len(runs)==1
  items=runs[0]['data']['main'][0];assert len(items)==4
  outputs=[]
  for i,item in enumerate(items):
   assert list(item['binary'])==['file_0'],item['binary'].keys()
   file=item['binary']['file_0']
   outputs.append({'fileName':file['fileName'],'payload':json.loads(base64.b64decode(file['data']))})
   assert item['json']['item']==i+1 and item['pairedItem']=={'item':i}
  cases[name]={'files':[x['fileName'] for x in outputs],'payloads':[x['payload'] for x in outputs],'mismatches':[i+1 for i,(a,b) in enumerate(zip(outputs,expected)) if a!=b]}
 report['cases'][mode]={'execution_status':execution['status'],**cases}
assert report['cases']['stock']['Dynamic modern']['mismatches']==[2,3]
assert report['cases']['pr42358']['Dynamic modern']['mismatches']==[]
assert report['cases']['stock']['Dynamic legacy']==report['cases']['pr42358']['Dynamic legacy']
assert report['cases']['stock']['Dynamic legacy']['mismatches']==[2,3]
assert all(report['cases'][mode]['Fixed field']['mismatches']==[] for mode in ['stock','pr42358'])
report['verdict']='PASS: green wrong-file reproduced, PR gate fixes both filename+payload, legacy behavior preserved, existing fixed-field workaround passes'
(output/'verified-results.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
