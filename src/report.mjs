import { isDeepStrictEqual } from 'node:util';

// n8n surrounds --rawOutput JSON with logs on some failure paths.
export function executionFrom(text) {
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{' || (start > 0 && text[start - 1] !== '\n')) continue;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try {
          const value = JSON.parse(text.slice(start, i + 1));
          if (value.data?.resultData) return value;
        } catch {}
        break;
      }
    }
  }
  return null;
}

export function executionChecks(execution, command, assertions) {
  const result = execution?.data?.resultData;
  // Preserve the runtime's explanation when it fails before emitting execution JSON,
  // including errors while serializing a node's response stream.
  const cliOutputTail = !execution
    ? (command.stderr?.trim() || command.stdout?.trim() || '').slice(-4000) || undefined
    : undefined;
  const checks = [{
    name: 'n8n execution succeeds',
    passed: Boolean(execution && !result.error && command.exitCode === 0 && !command.error),
    actual: { cliExitCode: command.exitCode, processError: command.error, lastNode: result?.lastNodeExecuted, message: result?.error?.message, description: result?.error?.description, executionFound: Boolean(execution), cliOutputTail },
  }];
  for (const assertion of assertions) {
    const runs = result?.runData?.[assertion.node] ?? [];
    const items = runs.flatMap(run => run.data?.main?.[assertion.output ?? 0] ?? []);
    const name = `${assertion.node}: output ${assertion.output ?? 0}`;
    if (assertion.count !== undefined) checks.push({ name: `${name} count`, passed: items.length === assertion.count, expected: assertion.count, actual: items.length });
    if (assertion.equals !== undefined) {
      const missingItems = [];
      const path = assertion.pluck?.split('.');
      const actual = items.map((item, index) => {
        if (!path) return item.json;
        let value = item;
        for (const key of path) {
          if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
            missingItems.push(index);
            return undefined;
          }
          value = value[key];
        }
        return value;
      });
      checks.push({ name: path ? `${name} pluck ${assertion.pluck}` : name, passed: missingItems.length === 0 && isDeepStrictEqual(actual, assertion.equals), expected: assertion.equals, actual: missingItems.length ? { values: actual, missingItems } : actual });
    }
  }
  return checks;
}

const xml = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
export function junit(report) {
  const error = report.status === 'error';
  const checks = error ? [{ name: 'setup', passed: false, actual: report.error }] : report.checks;
  const failed = checks.filter(check => !check.passed).length;
  const cases = checks.map(check => `    <testcase classname="n8n-check" name="${xml(check.name)}">${check.passed ? '' : `\n      <${error ? 'error' : 'failure'} message="${xml(check.name)}">${xml(JSON.stringify({ expected: check.expected, actual: check.actual }, null, 2))}</${error ? 'error' : 'failure'}>\n    `}</testcase>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="${checks.length}" failures="${error ? 0 : failed}" errors="${error ? 1 : 0}">\n  <testsuite name="${xml(report.name)}" tests="${checks.length}" failures="${error ? 0 : failed}" errors="${error ? 1 : 0}" time="${(report.durationMs / 1000).toFixed(3)}">\n${cases}\n  </testsuite>\n</testsuites>\n`;
}
