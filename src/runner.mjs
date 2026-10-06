import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { validateCase, prepareWorkflow } from './workflow.mjs';
import { startMock } from './mock.mjs';
import { executionFrom, executionChecks, junit } from './report.mjs';

export async function checkNetwork(allowNetwork) {
  if (allowNetwork) return { mode: 'host-network', enforced: false };
  if (process.platform === 'linux') {
    const interfaces = (await readFile('/proc/self/net/dev', 'utf8')).trim().split('\n').slice(2).map(line => line.split(':')[0].trim());
    if (interfaces.length === 1 && interfaces[0] === 'lo') return { mode: 'loopback-only', enforced: true, interfaces };
  }
  throw new Error('Run in a loopback-only network namespace (Docker --network none), or use --allow-network for a trusted local development run. See README Quick start.');
}

export function runtimeEnv(home) {
  const env = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TZ']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return {
    ...env, HOME: home, USERPROFILE: home, TMPDIR: join(home, 'tmp'), TEMP: join(home, 'tmp'), TMP: join(home, 'tmp'),
    N8N_USER_FOLDER: home, DB_TYPE: 'sqlite', N8N_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    N8N_DIAGNOSTICS_ENABLED: 'false', N8N_VERSION_NOTIFICATIONS_ENABLED: 'false', N8N_TEMPLATES_ENABLED: 'false',
    N8N_RUNNERS_MODE: 'internal', N8N_LOG_LEVEL: 'info', N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'true',
    N8N_BLOCK_ENV_ACCESS_IN_NODE: 'true', N8N_COMMUNITY_PACKAGES_ENABLED: 'false',
  };
}

export async function command(binary, args, env, timeoutMs = 120000) {
  return new Promise(resolve => {
    let child;
    let stdout = '', stderr = '', bytes = 0, error, settled = false;
    const stop = () => {
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {}
    };
    try { child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' }); }
    catch (e) { return resolve({ stdout, stderr, exitCode: null, error: e.message }); }
    const timer = setTimeout(() => { error = `Process timeout after ${timeoutMs} ms`; stop(); }, timeoutMs);
    const capture = stream => chunk => {
      bytes += chunk.length;
      if (bytes > 16 * 1024 * 1024) { error = 'Process output exceeded 16 MiB'; stop(); return; }
      if (stream === 'stdout') stdout += chunk.toString(); else stderr += chunk.toString();
    };
    child.stdout.on('data', capture('stdout')); child.stderr.on('data', capture('stderr'));
    child.on('error', e => { error = e.message; });
    child.on('close', (exitCode, signal) => {
      if (settled) return; settled = true; clearTimeout(timer);
      // Ensure task-runner descendants terminate with their CLI parent.
      stop();
      resolve({ stdout, stderr, exitCode, signal, error });
    });
  });
}

export async function runCase(options) {
  const start = Date.now();
  const out = resolve(options.out ?? '.n8n-check');
  const report = { schemaVersion: 1, runnerVersion: '0.1.0', name: 'n8n-check', startedAt: new Date().toISOString(), nodeVersion: process.version, status: 'error', checks: [], artifacts: out };
  let mock;
  await mkdir(out, { recursive: true });
  try {
    const spec = validateCase(JSON.parse(await readFile(resolve(options.caseFile), 'utf8')));
    report.name = spec.name;
    report.network = await checkNetwork(options.allowNetwork);
    const source = JSON.parse(await readFile(resolve(options.workflowFile), 'utf8'));
    mock = await startMock(spec);
    const prepared = prepareWorkflow(source, spec, mock.baseUrl);
    report.preparation = { inputNode: spec.input.node, changes: prepared.changes, omittedNodes: prepared.omittedNodes };
    const runDir = await mkdtemp(join(out, 'run-'));
    report.runDirectory = runDir;
    const home = join(runDir, 'n8n-home');
    await mkdir(join(home, 'tmp'), { recursive: true });
    const env = runtimeEnv(home);
    const n8n = options.n8n ?? process.env.N8N_BINARY ?? 'n8n';
    const invoke = async (args, name, timeout) => {
      const result = await command(n8n, args, env, timeout);
      await Promise.all(['stdout', 'stderr'].map(stream => writeFile(join(runDir, `${name}.${stream}.log`), result[stream])));
      return result;
    };
    const version = await invoke(['--version'], 'version');
    if (version.exitCode !== 0 || version.error) throw new Error(`n8n runtime unavailable: ${version.error || version.stderr || version.stdout}. Supply --n8n /path/to/n8n or use the Docker quick start.`);
    report.n8nVersion = version.stdout.trim();
    const workflowPath = join(runDir, 'workflow.json');
    await writeFile(workflowPath, JSON.stringify(prepared.workflow, null, 2) + '\n');
    const imported = await invoke(['import:workflow', `--input=${workflowPath}`], 'import');
    if (imported.exitCode !== 0 || imported.error) throw new Error(`n8n import failed: ${imported.error || imported.stderr || imported.stdout}. Logs: ${runDir}`);
    const executed = await invoke(['execute', `--id=${prepared.workflow.id}`, '--rawOutput'], 'execute', spec.timeoutMs ?? 60000);
    const execution = executionFrom(executed.stdout + '\n' + executed.stderr);
    if (execution) await writeFile(join(runDir, 'execution.json'), JSON.stringify(execution, null, 2) + '\n');
    report.checks.push(...executionChecks(execution, executed, spec.assertions), ...mock.checks());
    report.requests = mock.requests;
    report.status = report.checks.every(check => check.passed) ? 'passed' : 'failed';
  } catch (error) {
    report.status = 'error'; report.error = error.message;
  } finally {
    if (mock) { report.requests = mock.requests; await mock.close(); }
  }
  report.durationMs = Date.now() - start;
  report.exitCode = report.status === 'passed' ? 0 : report.status === 'failed' ? 1 : 2;
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(out, 'junit.xml'), junit(report));
  return report;
}
