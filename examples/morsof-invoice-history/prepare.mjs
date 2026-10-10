import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
const here=dirname(fileURLToPath(import.meta.url));
const sources={fixed:'3d8c61ee5b0e37e7e0052f53e7839db011b9c0de',broken:'adb2d3c3aa7534bcce53d955938e24c9f061b315'};
const cloned=x=>JSON.parse(JSON.stringify(x));
const save=async(n,x)=>writeFile(join(here,n),JSON.stringify(x,null,2)+'\n');
const fixtureName='Start Manual Test';
const edge=n=>({node:n,type:'main',index:0});
function code(w,name,js){w.nodes.push({id:'contract-'+name.replaceAll(' ','-'),name,type:'n8n-nodes-base.code',typeVersion:2,position:[2000,2000],parameters:{mode:'runOnceForAllItems',jsCode:js}});}
function then(w,from,to){w.connections[from]??={main:[[]]};w.connections[from].main[0]??=[];w.connections[from].main[0].push(edge(to));}
const projectCode=`return $input.all().map(({json:v})=>({json:{invoiceId:v.invoiceId,customerId:v.customerId,email:v.email,classification:v.classification,stage:v.reminderStage,outputPath:v.outputPath,actionReason:v.actionReason,historyRecordId:v.historyRecordId??null,draftCustomerId:v.draft?.recipient?.customerId??null,draftInvoiceId:v.draft?.invoice?.invoiceId??null}}));`;
for(const [kind,sha] of Object.entries(sources)){
 let bytes;try{bytes=await readFile(join(here,kind+'.source.json'));}catch{const r=await fetch(`https://raw.githubusercontent.com/Morsoflab/n8n-automation-templates/${sha}/templates/invoice-payment-follow-up/invoice-payment-follow-up.json`,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('download '+r.status);bytes=Buffer.from(await r.arrayBuffer());await writeFile(join(here,kind+'.source.json'),bytes);}
 const w=JSON.parse(bytes);
 const node=n=>w.nodes.find(x=>x.name===n);
 node('Load Fictional Invoice Samples').parameters.jsCode=`return $('${fixtureName}').first().json.invoices.map(json=>({json}));`;
 const config=node(kind==='fixed'?'Validate Workflow Configuration':'Validate Normalize and Classify');
 config.parameters.jsCode=config.parameters.jsCode.replace("const EVALUATION_DATE = '';","const EVALUATION_DATE = '2030-06-20';");
 for(const name of ['Ready for Review','Already Prepared','No Action Required','Manual Review','Invalid Record']){code(w,'Contract '+name,projectCode);then(w,name,'Contract '+name);}
 code(w,'Contract Writes',`return $input.all().map(({json:r})=>({json:{invoiceId:r.invoice_id,stage:r.reminder_stage,customerId:r.customer_id,email:r.recipient_email,amount:r.outstanding_amount,id:r.id}}));`);
 then(w,'Store Reminder Preparation','Contract Writes');
 if(kind==='fixed'){
  // Fixture-only history setup. Every operation uses the real Data Table node.
  w.connections['Create or Reuse Reminder History'].main[0]=[edge('Fixture History Rows')];
  code(w,'Fixture History Rows',`const rows=$('${fixtureName}').first().json.history??[];return rows.length?rows.map(json=>({json})):[{json:{emptyHistory:true}}];`);
  const branch=cloned(node('Invalid Record?'));branch.id='fixture-history-empty';branch.name='Fixture Empty History?';branch.parameters.conditions.conditions[0]={id:'empty-history',leftValue:'={{ $json.emptyHistory === true }}',rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}};w.nodes.push(branch);
  const insert=cloned(node('Store Reminder Preparation'));insert.id='fixture-seed-history';insert.name='Fixture Seed History';delete insert.onError;
  insert.parameters.columns.value=Object.fromEntries(Object.keys(insert.parameters.columns.value).map(k=>[k,'={{ $json.'+k+' }}']));w.nodes.push(insert);
  code(w,'Fixture Seed Complete','return [{json:{}}];');
  w.connections['Fixture History Rows']={main:[[edge('Fixture Empty History?')]]};
  w.connections['Fixture Empty History?']={main:[[edge('Load Reminder History')],[edge('Fixture Seed History')]]};
  w.connections['Fixture Seed History']={main:[[edge('Fixture Seed Complete')]]};
  w.connections['Fixture Seed Complete']={main:[[edge('Load Reminder History')]]};
 }
 await save(kind+'.workflow.json',w);
}
const invoice=(id,dueDate='2030-06-22',extra={})=>({invoiceId:id,customer:{id:'CUST-'+id,name:'Fictional '+id,email:id.toLowerCase()+'@fixture.example',phone:''},currency:'EUR',totalAmount:100,paidAmount:0,outstandingAmount:100,dueDate,paymentStatus:'unpaid',disputed:false,updatedAt:'2030-06-19T10:00:00.000Z',...extra});
const A=invoice('INV-A'),B=invoice('INV-B','2030-06-20'),C=invoice('INV-C','2030-06-12'),P=invoice('INV-P','2030-06-15',{paymentStatus:'paid',paidAmount:100,outstandingAmount:0});
const stage=x=>x.paymentStatus==='paid'?'':x.dueDate==='2030-06-22'?'upcoming_3_days':x.dueDate==='2030-06-20'?'due_today':'overdue_7_days';
const classification=x=>x.paymentStatus==='paid'?'paid':stage(x)==='upcoming_3_days'?'upcoming':stage(x)==='due_today'?'due':'overdue';
const expected=(x,path='ready_for_review',id=null,reason=path==='already_prepared'?'reminder_stage_already_prepared':path==='no_action_required'?'invoice_paid':'reminder_stage_eligible')=>({invoiceId:x.invoiceId,customerId:x.customer.id,email:x.customer.email,classification:classification(x),stage:stage(x),outputPath:path,actionReason:reason,historyRecordId:id,draftCustomerId:path==='no_action_required'?null:x.customer.id,draftInvoiceId:path==='no_action_required'?null:x.invoiceId});
const history=(x,prepared_at='2030-06-19T09:00:00.000Z')=>({invoice_id:x.invoiceId,reminder_stage:stage(x),classification:classification(x),customer_id:x.customer.id,recipient_email:x.customer.email,recipient_phone:'',currency:'EUR',outstanding_amount:100,due_date:x.dueDate,review_status:'pending_manual_approval',draft_subject:'Payment reminder review: invoice '+x.invoiceId,prepared_at,source_updated_at:x.updatedAt});
const write=(x,id)=>({invoiceId:x.invoiceId,stage:stage(x),customerId:x.customer.id,email:x.customer.email,amount:x.outstandingAmount,id});
const specs=[
 ['two-eligible',[A,B],[],[expected(A,'ready_for_review',1),expected(B,'ready_for_review',2)],[],[],[write(A,1),write(B,2)]],
 ['eligible-paid',[A,P],[],[expected(A,'ready_for_review',1)],[],[expected(P,'no_action_required')],[write(A,1)]],
 ['existing-new',[A,B],[history(A)],[expected(B,'ready_for_review',2)],[expected(A,'already_prepared',1)],[],[write(B,2)]],
 ['duplicate',[A,A],[],[expected(A,'ready_for_review',1),expected(A,'already_prepared',1,'duplicate_in_execution')],[],[],[write(A,1)]],
 ['reordered',[B,A],[history(A)],[expected(B,'ready_for_review',2)],[expected(A,'already_prepared',1)],[],[write(B,2)]],
 ['empty-history',[A,B,C],[],[expected(A,'ready_for_review',1),expected(B,'ready_for_review',2),expected(C,'ready_for_review',3)],[],[],[write(A,1),write(B,2),write(C,3)]],
 ['multiple-existing',[A,B,C],[history(A,'2030-06-18T09:00:00.000Z'),history(A),history(B)],[expected(C,'ready_for_review',4)],[expected(A,'already_prepared',2),expected(B,'already_prepared',3)],[],[write(C,4)]],
];
for(const[name,invoices,rows,ready,already,paid,writes]of specs){await save(name+'.case.json',{version:1,name:'Morsof invoice history: '+name,input:{node:fixtureName,items:[{invoices,history:rows}]},mocks:[],assertions:[{node:'Contract Ready for Review',equals:ready},{node:'Contract Already Prepared',equals:already},{node:'Contract No Action Required',equals:paid},{node:'Contract Manual Review',equals:[]},{node:'Contract Invalid Record',equals:[]},{node:'Contract Writes',equals:writes}]});}
await save('manifest.json',{sources,configuration:{EVALUATION_DATE:'2030-06-20'},cases:specs.map(x=>x[0]),adaptations:['Replace fictional sample generator with case JSON input.','Set documented EVALUATION_DATE test override.','Append read-only terminal output projections.','For fixed graph, insert fixture-only Data Table seed branch before original Load Reminder History.'],runtime:'n8n 2.41.7 with DataTableModule initialized for execute CLI'});
