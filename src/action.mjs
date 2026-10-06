import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cell = value => html(value).replace(/\|/g, '&#124;').replace(/[\r\n]+/g, ' ');
const detail = value => html(JSON.stringify(value, null, 2)?.slice(0, 12000));

export function summary(report) {
  const checks = report.checks ?? [];
  const passed = checks.filter(check => check.passed).length;
  const rows = checks.map(check => `| ${check.passed ? '✅' : '❌'} | ${cell(check.name)} |`);
  const failures = checks.filter(check => !check.passed).map(check => `<details><summary>${html(check.name)}</summary>\n\nExpected:<pre>${detail(check.expected)}</pre>\nActual:<pre>${detail(check.actual)}</pre>\n</details>`);
  const requests = (report.requests ?? []).slice(0, 50).map((r, i) => `| ${i + 1} | ${cell(r.node)} | ${cell(r.method)} | ${cell(r.path)} | ${cell(r.status)} |`);
  return [
    `## n8n-check: ${cell(report.status).toUpperCase()}`,
    `**${cell(report.name)}** · ${passed}/${checks.length} checks · ${(report.requests ?? []).length} HTTP requests`,
    `n8n ${cell(report.n8nVersion ?? 'setup incomplete')} · runner ${cell(report.runnerVersion)} · ${cell(report.network?.mode ?? 'setup incomplete')}`,
    report.error ? `<pre>${html(report.error)}</pre>` : '',
    '| Result | Check |\n| --- | --- |\n' + rows.join('\n'),
    ...failures,
    requests.length ? '### Request trace\n\n| # | Node | Method | Path | Status |\n| --- | --- | --- | --- | --- |\n' + requests.join('\n') : '',
    requests.length === 50 ? 'Trace preview: first 50 requests. The JSON report contains the full sequence.' : '',
    'Reports: `report.json` and `junit.xml` in the configured output directory. Upload these files in an `if: always()` step to retain the results.',
  ].filter(Boolean).join('\n\n') + '\n';
}

// Existing ancestors are resolved too, so an output symlink follows the same boundary.
export function workspacePath(workspace, input, kind) {
  if (!input || /[\r\n:,]/.test(input)) throw new Error(`${kind}: supply a repository-relative path without newlines, colons or commas.`);
  if (isAbsolute(input)) throw new Error(`${kind}: use a repository-relative path.`);
  const root = realpathSync(workspace);
  const path = resolve(root, input);
  let ancestor = path;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const canonical = resolve(realpathSync(ancestor), relative(ancestor, path));
  const rel = relative(root, canonical);
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error(`${kind}: path must be inside the checked-out repository.`);
  if (kind !== 'out' && !statSync(canonical).isFile()) throw new Error(`${kind}: expected a JSON file.`);
  if (kind === 'out' && existsSync(canonical) && !statSync(canonical).isDirectory()) throw new Error('out: expected a directory.');
  return canonical;
}

export function dockerArguments({ workflow, caseFile, out, image, uid, gid }) {
  return ['run', '--rm', '--network', 'none', '--user', `${uid}:${gid}`,
    '--mount', `type=bind,source=${workflow},target=/inputs/workflow.json,readonly`,
    '--mount', `type=bind,source=${caseFile},target=/inputs/case.json,readonly`,
    '--mount', `type=bind,source=${out},target=/results`,
    image, '/inputs/workflow.json', '/inputs/case.json', '--out', '/results'];
}

export function buildArguments({ actionRoot, image, n8nVersion }) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(n8nVersion)) {
    throw new Error('n8n-version: supply an exact release, such as 2.41.7.');
  }
  return ['build', '--build-arg', `N8N_VERSION=${n8nVersion}`, '--tag', image, actionRoot];
}

function execute(args) {
  const result = spawnSync('docker', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Docker interrupted by ${result.signal}`);
  return result.status;
}

export function main(env = process.env) {
  let exitCode = 2;
  try {
    if (process.platform !== 'linux') throw new Error('Use a Linux runner with Docker, such as ubuntu-latest.');
    const workspace = env.GITHUB_WORKSPACE;
    const actionRoot = env.ACTION_ROOT;
    const n8nVersion = env.CHECK_N8N_VERSION || '2.41.7';
    const hash = createHash('sha256').update(`${actionRoot}\0${n8nVersion}`).digest('hex').slice(0, 16);
    const image = `n8n-check-action:${hash}`;
    const build = buildArguments({ actionRoot, image, n8nVersion });
    const workflow = workspacePath(workspace, env.CHECK_WORKFLOW, 'workflow');
    const caseFile = workspacePath(workspace, env.CHECK_CASE, 'case');
    const out = workspacePath(workspace, env.CHECK_OUT || '.n8n-check', 'out');
    for (const input of [workflow, caseFile]) {
      const rel = relative(out, input);
      if (rel && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)) throw new Error('out: choose a results directory separate from the workflow and case files.');
    }
    mkdirSync(out, { recursive: true });
    // Each invocation reports its own result, including a build or startup failure.
    for (const file of ['report.json', 'junit.xml']) rmSync(join(out, file), { force: true });
    console.log(`::group::Build n8n-check with n8n ${n8nVersion}`);
    const built = execute(build);
    console.log('::endgroup::');
    if (built !== 0) throw new Error(`Docker build exited ${built}.`);
    const code = execute(dockerArguments({ workflow, caseFile, out, image, uid: process.getuid(), gid: process.getgid() }));
    exitCode = [0, 1, 2].includes(code) ? code : 2;
    if (existsSync(join(out, 'report.json'))) {
      const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary(report));
      if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `report=${join(out, 'report.json')}\njunit=${join(out, 'junit.xml')}\n`);
    } else throw new Error(`Docker exited ${code} before producing a report.`);
  } catch (error) {
    exitCode = 2;
    console.error(`n8n-check action: ${error.message}`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `## n8n-check: SETUP ERROR\n\n<pre>${html(error.message)}</pre>\n`);
  }
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `exit-code=${exitCode}\n`);
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main();
