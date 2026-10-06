#!/usr/bin/env node
const path = require('node:path');
const fs = require('node:fs');
const cli = (process.env.PATH ?? '').split(path.delimiter).map(dir => path.join(dir, 'n8n')).find(file => fs.existsSync(file));
if (!cli) throw new Error('Put the n8n 2.41.7 binary on PATH.');
const root = path.dirname(path.dirname(fs.realpathSync(cli)));
const {createRequire} = require('node:module');
const req = createRequire(path.join(root,'package.json'));
if (req('./package.json').version !== '2.41.7') throw new Error('This Data Table CLI adapter is pinned to n8n 2.41.7.');
if (process.argv[2] === 'execute') {
  process.env.NODE_CONFIG_DIR = path.join(root,'bin/config');
  req('reflect-metadata');
  req('./dist/config');
  const {Execute} = req('./dist/commands/execute');
  const {Container} = req('@n8n/di');
  const {DataTableModule} = req('./dist/modules/data-table/data-table.module');
  const originalInit = Execute.prototype.init;
  // The server start command performs this module setup; the execute command omits it.
  // Keep the real Data Table storage, proxies, validation, and node implementation.
  Execute.prototype.init = async function() {
    await originalInit.call(this);
    const module = Container.get(DataTableModule);
    await module.init();
    this.moduleRegistry.context.set('data-table', await module.context());
    this.moduleRegistry.activeModules.push('data-table');
  };
}
req('./bin/n8n');
