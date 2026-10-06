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
  const checks = [{
    name: 'n8n execution succeeds',
    passed: Boolean(execution && !result.error && command.exitCode === 0 && !command.error),
    actual: { cliExitCode: command.exitCode, processError: command.error, lastNode: result?.lastNodeExecuted, message: result?.error?.message, description: result?.error?.description, executionFound: Boolean(execution) },
  }];
  for (const assertion of assertions) {
    const runs = result?.runData?.[assertion.node] ?? [];
    const actual = runs.flatMap(run => run.data?.main?.[assertion.output ?? 0] ?? []).map(item => item.json);
    checks.push({ name: `${assertion.node}: output ${assertion.output ?? 0}`, passed: isDeepStrictEqual(actual, assertion.equals), expected: assertion.equals, actual });
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
