#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Blucca
'use strict';

// GET saved API records before any display-view transformation. Preserve each
// response body verbatim; a manifest marks acquisition of every referenced ID.
// OUTPUT_DIR is a fresh local directory. Partial records remain on failure.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

function id(value) {
  if ((typeof value === 'string' && value.length > 0) ||
      (Number.isInteger(value) && value >= 0)) return String(value);
  throw new Error('Missing subExecution execution ID');
}

function childIds(execution) {
  if (execution.dataTooLargeToDisplay === true)
    throw new Error(`Execution ${id(execution.id)}: API data exceeds the display-size limit; request ignoreDataSizeLimit=true`);
  const runData = execution.data?.resultData?.runData;
  if (!runData || !Array.isArray(execution.workflowData?.nodes))
    throw new Error(`Execution ${id(execution.id)}: missing complete saved API data`);
  const children = new Set();
  for (const runs of Object.values(runData)) {
    if (!Array.isArray(runs)) throw new Error(`Execution ${id(execution.id)}: invalid runData`);
    for (const task of runs) {
      // once: one ID on the task; each: IDs on returned output items.
      if (task.metadata?.subExecution) children.add(id(task.metadata.subExecution.executionId));
      for (const items of task.data?.main ?? [])
        for (const item of items ?? [])
          if (item.metadata?.subExecution) children.add(id(item.metadata.subExecution.executionId));
    }
  }
  return [...children];
}

function readExecution(base, identifier, apiKey) {
  // Complete saved evidence needs the API's display-size override as well.
  const url = new URL(`${base.replace(/\/+$/, '')}/api/v1/executions/${encodeURIComponent(identifier)}?includeData=true&ignoreDataSizeLimit=true`);
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.get(url, { headers: { 'X-N8N-API-KEY': apiKey } }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Execution ${identifier}: HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('end', () => resolve(Buffer.concat(chunks)));
      response.once('error', () => reject(new Error(`Execution ${identifier}: response read failed`)));
    });
    request.once('error', () => reject(new Error(`Execution ${identifier}: GET failed`)));
    request.setTimeout(45_000, () => request.destroy());
  });
}

async function fetchBundle(base, parentId, directory, apiKey) {
  if (!apiKey) throw new Error('Set N8N_API_KEY');
  const parent = id(parentId);
  const output = path.resolve(directory);
  if (fs.existsSync(output)) throw new Error('OUTPUT_DIR exists; choose a fresh local directory');
  fs.mkdirSync(output, { recursive: true });
  const queue = [parent];
  const seen = new Set(queue);
  const executions = [];
  for (let next = 0; next < queue.length; next++) {
    const identifier = queue[next];
    const raw = await readExecution(base, identifier, apiKey);
    let execution;
    try { execution = JSON.parse(raw.toString('utf8')); }
    catch { throw new Error(`Execution ${identifier}: response JSON parse failed`); }
    if (id(execution?.id) !== identifier) throw new Error(`Execution ${identifier}: response ID differs`);
    const children = childIds(execution);
    const file = `execution-${next}.json`;
    fs.writeFileSync(path.join(output, file), raw);
    executions.push({ id: identifier, file, bytes: raw.length });
    process.stdout.write(JSON.stringify({ execution_id: identifier, file: path.join(output, file) }) + '\n');
    for (const child of children) if (!seen.has(child)) {
      seen.add(child);
      queue.push(child);
    }
  }
  const manifest = { status: 'complete', parent_execution: parent, executions };
  const file = path.join(output, 'manifest.json');
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ status: 'complete', file, execution_ids: queue }) + '\n');
  return manifest;
}

module.exports = { fetchBundle, childIds };
if (require.main === module) {
  (async () => {
    if (process.argv.length !== 5)
      throw new Error('Usage: N8N_API_KEY=... node fetch-bundle.cjs BASE_URL PARENT_ID OUTPUT_DIR (fresh local directory)');
    await fetchBundle(...process.argv.slice(2), process.env.N8N_API_KEY);
  })().catch(error => {
    process.stderr.write(JSON.stringify({ status: 'incomplete', reason: error.message }) + '\n');
    process.exitCode = 2;
  });
}
