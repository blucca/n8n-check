#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const runtime = process.env.NATIVE_RUNTIME || path.resolve('node_modules/n8n');
const req = createRequire(path.join(runtime, 'package.json'));
if (req('./package.json').version !== '2.41.7') throw new Error('Use n8n 2.41.7 for this native API experiment.');
process.env.NODE_CONFIG_DIR = path.join(runtime, 'bin/config');
req('reflect-metadata');
req('./dist/config');
const {Execute} = req('./dist/commands/execute');
const {Container} = req('@n8n/di');
const {Workflow, Expression} = req('n8n-workflow');
const {WorkflowExecute, ExecutionLifecycleHooks} = req('n8n-core');
const {NodeTypes} = req('./dist/node-types');
const {getBase} = req('./dist/workflow-execute-additional-data');
const {EvalMockedCredentialsHelper} = req('./dist/modules/instance-ai/eval/eval-mocked-credentials-helper');
const {withExpressionIsolate} = req('./dist/utils');
const yaml = req('yaml');
const {assertReference} = require('./assert-reference.cjs');

const clone = (x) => JSON.parse(JSON.stringify(x));
const save = (dir, name, data) => fs.writeFileSync(path.join(dir,name), JSON.stringify(data,(_key,value) => value instanceof Error ? {name:value.name,message:value.message,stack:value.stack,...value} : value,2)+'\n');

Execute.prototype.run = async function() {
  const specFile = path.resolve(process.env.NATIVE_SPEC);
  const sourceDir = path.dirname(specFile);
  const spec = yaml.parse(fs.readFileSync(specFile,'utf8'));
  const input = JSON.parse(fs.readFileSync(process.env.NATIVE_WORKFLOW || path.join(sourceDir,'invoice-deal-sync.workflow.json'),'utf8'));
  const indexes = process.env.NATIVE_CASE === 'all' ? spec.cases.map((_,i)=>i) : [Number(process.env.NATIVE_CASE || 0)];
  const cases = process.env.NATIVE_EXTRA_CASE ? [JSON.parse(fs.readFileSync(process.env.NATIVE_EXTRA_CASE,'utf8'))] : indexes.map(i=>spec.cases[i]);
  const rootOut = path.resolve(process.env.NATIVE_OUT);
  fs.mkdirSync(rootOut,{recursive:true});
  let failed = false;
  for(let index=0;index<cases.length;index++) {
    const testCase = cases[index];
    const out = cases.length>1 ? path.join(rootOut,String(index+1)) : rootOut;
    fs.mkdirSync(out,{recursive:true});
    const requests = [];
    const mockErrors = [];
    const mocks = new Map();
    for(const mock of [...(spec.defaults?.mocks||[]),...(testCase.mocks||[])]) mocks.set(JSON.stringify([mock.node,mock.when||null]),clone(mock));
    const rules = [...mocks.values()];
    const counters = new Map();
    const pinData = { [input.nodes[0].name]: [clone(testCase.input)] };
    for(const rule of rules) if(rule.output) pinData[rule.node] = clone(rule.output);
    const workflow = new Workflow({...clone(input),id:'native-reference',active:false,nodeTypes:Container.get(NodeTypes),pinData});
    const additional = await getBase({workflowSettings:input.settings});
    additional.executionId = 'native-reference';
    additional.credentialsHelper = new EvalMockedCredentialsHelper(additional.credentialsHelper,undefined,this.logger);
    additional.hooks = new ExecutionLifecycleHooks('evaluation','native-reference',input);
    additional.evalLlmMockHandler = async (options,node) => {
      const url = new URL(options.url);
      const query = Object.fromEntries(url.searchParams);
      for(const [key,value] of Object.entries(options.qs||{})) query[key] = value;
      url.search = '';
      const request = {node:node.name,method:String(options.method||'GET').toUpperCase(),url:url.toString(),query,body:clone(options.body===undefined ? null : options.body),raw:clone(options)};
      requests.push(request);
      const rule = rules.find(r=>r.node===node.name && !r.output && (!r.when || ((!r.when.method || r.when.method===request.method) && (!r.when.url || r.when.url===request.url))));
      if(!rule) {
        const message = `No mock for ${node.name}: ${request.method} ${request.url}`;
        mockErrors.push(message);
        throw new Error(message);
      }
      const used = counters.get(rule)||0;
      const response = Array.isArray(rule.respond) ? rule.respond[used] : rule.respond;
      if(!response) {
        const message = `Response sequence exhausted for ${node.name} at call ${used+1}`;
        mockErrors.push(message);
        throw new Error(message);
      }
      counters.set(rule,used+1);
      const body = response.bodyFileName ? JSON.parse(fs.readFileSync(path.resolve(sourceDir,response.bodyFileName),'utf8')) : clone(response.body);
      return {statusCode:response.status,headers:{'content-type':'application/json',...(response.headers||{})},body};
    };
    let run;
    try {
      run = await withExpressionIsolate(workflow,()=>new WorkflowExecute(additional,'evaluation').run({workflow,startNode:workflow.getNode(input.nodes[0].name),pinData}));
    } catch(error) {
      run = {status:'harness-error',error:{message:error.message,stack:error.stack}};
    }
    save(out,'run.json',run);
    save(out,'requests.json',requests);
    save(out,'case.json',testCase);
    const checks = await assertReference(testCase,run,requests,Expression);
    if(mockErrors.length) {
      checks.checks.push({name:'strict mock routing',passed:false,expected:[],actual:mockErrors});
      checks.passed = false;
    }
    save(out,'checks.json',checks);
    save(out,'metadata.json',{n8n:req('./package.json').version,core:req('n8n-core/package.json').version,mode:'evaluation',pinnedNodes:Object.keys(pinData),workflowFile:path.resolve(process.env.NATIVE_WORKFLOW||path.join(sourceDir,'invoice-deal-sync.workflow.json')),mockedCredentials:additional.credentialsHelper.mockedCredentials,interceptionGaps:additional.credentialsHelper.interceptionGaps});
    failed ||= !checks.passed;
    console.log(JSON.stringify({case:testCase.name,status:run.status,requests:requests.length,checks:checks.checks.filter(c=>c.passed).length,total:checks.checks.length,out}));
  }
  if(failed) throw new Error('Reference assertions failed. See checks.json.');
};
req('./bin/n8n');
