// Experimental process-local replacement: the installed runtime stays unchanged.
'use strict';
const path = require('node:path');
const runtime = process.env.LINEAGE_RUNTIME;
if (!runtime) throw new Error('LINEAGE_RUNTIME is required for the isolated overlay');
const target = require(path.join(runtime, 'node_modules/n8n-nodes-base/dist/utils/workflow-backtracking.js'));
if (typeof target.findPairedItemThroughWorkflowData !== 'function') throw new Error('Unexpected helper export');
target.findPairedItemThroughWorkflowData = require('./backtracking.cjs').findPairedItemThroughWorkflowData;
console.error('[lineage-boundary] experimental backtracking overlay loaded');
