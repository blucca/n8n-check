// Apply the exact Decompress-only version gate in upstream PR #42358.
// Process-local: the installed n8n package remains unchanged.
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const file = path.resolve(process.env.COMPRESSION_RUNTIME,'node_modules/n8n-nodes-base/dist/nodes/Compression/Compression.node.js');
const old = "const binaryPropertyNames = this.getNodeParameter('binaryPropertyName', 0)";
const source = fs.readFileSync(file,'utf8');
if (source.split(old).length !== 2) throw Error('Expected one exact Decompress parameter call');
const patched = source.replace(old,"const binaryPropertyNameIndex = nodeVersion > 1 ? i : 0;\n                    const binaryPropertyNames = this.getNodeParameter('binaryPropertyName', binaryPropertyNameIndex)");
const m = new Module(file,module); m.filename=file; m.paths=Module._nodeModulePaths(path.dirname(file));
Module._cache[file]=m; m._compile(patched,file); m.loaded=true;
