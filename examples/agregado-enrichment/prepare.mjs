import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
// Download immutable Agregado exports; generate synthetic contracts beside them.
// Source: ffrt-labs/agregado (README declares MIT). See README for attribution.
const root=resolve(process.argv[2] ?? 'temp/agregado-enrichment');
await mkdir(root,{recursive:true});
const sources={
 original:{repo:'ffrt-labs/agregado',commit:'0cbbac9c7c6e19f2b9f82bab57cf75a171279eac'},
 fixed:{repo:'blucca/agregado',commit:'b4e4332b57341f1afdb7a3be7a9069540b8a15f4'},
};
for(const [name,source] of Object.entries(sources)){
 const url=`https://raw.githubusercontent.com/${source.repo}/${source.commit}/n8n/workflows/article-enrichment.json`;
 const bytes=execFileSync('curl',['--fail','--silent','--show-error','--location','--max-time','60',url],{maxBuffer:2*1024*1024});
 JSON.parse(bytes.toString('utf8'));
 await writeFile(`${root}/${name}.json`,bytes);
}

const ordinary=id=>({entry:{id,url:`https://example.test/article-${id}`,title:`Article ${id}`}});
const bridge=id=>({entry:{id,url:`https://bridge.example.test/p/00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,title:`Article ${id}`}});
const body=item=>({entry_id:item.entry.id,canonical_url:item.entry.url,title:item.entry.title,...(item.entry.url.includes('/p/')?{bridge_content:`<p>Content for ${item.entry.id}</p>`}:{})});
const groups={ordinary:[ordinary(101),ordinary(102)],mixed:[ordinary(101),bridge(102),ordinary(103),bridge(104)],retry:[ordinary(101),ordinary(102)]};
for(const [name,items] of Object.entries(groups)){
 const bridged=items.filter(i=>i.entry.url.includes('/p/'));
 const expected=items.map(body);
 if(name==='retry')expected.push(body(items.at(-1)));
 const spec={version:1,name:`Agregado ${name}: preserve every Article`,input:{node:'Parse entries',items},timeoutMs:90000,mocks:[
  {node:'Call enrich API',url:'/api/private/articles/enrich',routes:[{method:'POST',path:'/api/private/articles/enrich',responses:name==='retry'?[{status:200,json:{ok:true}},{status:503,json:{message:'temporary unavailable'}},{status:200,json:{ok:true}}]:[{status:200,json:{ok:true}}],expect:{count:expected.length,bodies:expected}}]},
  {node:'Lookup bridge content',url:'/d1/content',routes:[{method:'POST',path:'/d1/content',responses:bridged.length?bridged.map(i=>({status:200,json:{result:[{results:[{readable_content:`<p>Content for ${i.entry.id}</p>`}]}]}})):[{status:200,json:{result:[{results:[]}]}}],expect:{count:bridged.length}}]},
  {node:'Claim alert',url:'/d1/claim',routes:[{method:'POST',path:'/d1/claim',responses:[{status:200,json:{result:[{meta:{changes:1}}]}}],expect:{count:0}}]},
  {node:'Notify',url:'/alert',routes:[{method:'POST',path:'/alert',responses:[{status:200,json:{ok:true}}],expect:{count:0}}]},
 ],assertions:[{node:'Build enrich request',equals:items.map(i=>({entry:i.entry,body:body(i)}))}]};
 await writeFile(`${root}/${name}.case.json`,JSON.stringify(spec,null,2)+'\n');
}
await writeFile(`${root}/sources.json`,JSON.stringify(sources,null,2)+'\n');
console.log(`Prepared two pinned workflows and three synthetic cases in ${root}`);
