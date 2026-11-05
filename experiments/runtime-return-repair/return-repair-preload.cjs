// Process-local compiled-source test. It leaves the installed n8n package unchanged.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const runtime = process.env.RETURN_REPAIR_RUNTIME || '/usr/local/lib/node_modules/n8n';
const workflow = require(path.join(runtime, 'node_modules/n8n-workflow'));
workflow.resolveInputPairing = require('./input-pairing.cjs').resolveInputPairing;
const replacement = new Map([
  [fs.realpathSync(path.join(runtime, 'dist/workflow-execute-additional-data.js')), path.join(__dirname, 'patched-cli.js')],
  [fs.realpathSync(path.join(runtime, 'node_modules/n8n-nodes-base/dist/nodes/ExecuteWorkflow/ExecuteWorkflow/ExecuteWorkflow.node.js')), path.join(__dirname, 'patched-ExecuteWorkflow.js')],
]);
const load = Module._extensions['.js'];
Module._extensions['.js'] = function(module, filename) {
  const compiled = replacement.get(filename);
  if (!compiled) return load(module, filename);
  const source = fs.readFileSync(compiled, 'utf8');
  console.error('[return-repair] source-compiled module loaded: ' + filename);
  module._compile(source, filename);
};
console.error('[return-repair] explicit terminal pairing + shared output-policy projection enabled');
