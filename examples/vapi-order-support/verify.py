#!/usr/bin/env python3
"""Run the complete template in a fresh n8n 2.41.7 instance. Python stdlib only."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True, help='New output directory for reports and isolated runtime')
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    home = out / 'runtime'
    home.mkdir()
    binary = os.environ.get('N8N_BINARY') or shutil.which('n8n')
    if not binary:
        raise SystemExit('Set N8N_BINARY to an installed n8n 2.41.7 executable.')
    binary = str(Path(binary).absolute())
    secret = secrets.token_hex(24)
    http_port, broker_port = port(), port()
    inherited = {key: value for key, value in os.environ.items()
                 if key in ('PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'SYSTEMROOT')}
    env = {**inherited, 'HOME': str(home), 'N8N_USER_FOLDER': str(home),
           'PATH': str(Path(binary).parent) + os.pathsep + os.environ.get('PATH', ''),
           'N8N_ENCRYPTION_KEY': secrets.token_hex(32), 'N8N_LISTEN_ADDRESS': '127.0.0.1',
           'N8N_PORT': str(http_port), 'N8N_PROTOCOL': 'http', 'N8N_SECURE_COOKIE': 'false',
           'DB_TYPE': 'sqlite', 'N8N_RUNNERS_MODE': 'internal',
           'N8N_RUNNERS_BROKER_PORT': str(broker_port), 'N8N_DIAGNOSTICS_ENABLED': 'false',
           'N8N_VERSION_NOTIFICATIONS_ENABLED': 'false', 'N8N_TEMPLATES_ENABLED': 'false',
           'N8N_PERSONALIZATION_ENABLED': 'false', 'N8N_LICENSE_AUTO_RENEW_ENABLED': 'false',
           'N8N_LOG_LEVEL': 'warn', 'N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS': 'true'}
    adapter = HERE.parent / 'morsof-invoice-history' / 'n8n-datatable.cjs'
    checks = []

    def command(name, argv, timeout=120):
        with (out / (name + '.log')).open('w') as log:
            result = subprocess.run(argv, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
        require(result.returncode == 0, f'{name} exited {result.returncode}: ' + (out / (name + '.log')).read_text()[-4000:])

    workflow = json.loads((HERE / 'workflow.json').read_text())
    workflow['id'] = 'VapiOrderSupportAcceptance'
    webhook = next(node for node in workflow['nodes'] if node['type'] == 'n8n-nodes-base.webhook')
    require(webhook['parameters']['authentication'] == 'headerAuth', 'Template must require Header Auth')
    webhook['credentials'] = {'httpHeaderAuth': {'id': 'vapiAcceptanceHeader', 'name': 'Local acceptance header'}}
    (out / 'workflow.json').write_text(json.dumps(workflow))
    credentials = [{'id': 'vapiAcceptanceHeader', 'name': 'Local acceptance header', 'type': 'httpHeaderAuth',
                    'data': {'name': 'X-Vapi-Secret', 'value': secret}}]
    cred_file = home / 'credentials.json'
    cred_file.write_text(json.dumps(credentials))
    cred_file.chmod(0o600)
    command('import-credentials', [binary, 'import:credentials', '--input=' + str(cred_file)])
    command('import-workflow', [binary, 'import:workflow', '--input=' + str(out / 'workflow.json')])
    command('seed', ['node', str(adapter), 'execute', '--id=' + workflow['id'], '--rawOutput'])
    command('seed-replay', ['node', str(adapter), 'execute', '--id=' + workflow['id'], '--rawOutput'])
    command('publish', [binary, 'publish:workflow', '--id=' + workflow['id']])
    spec = json.loads((HERE / 'fixtures/acceptance.json').read_text())
    captures = {}
    database = home / '.n8n/database.sqlite'

    def table_rows(name):
        with sqlite3.connect(database) as db:
            db.row_factory = sqlite3.Row
            row = db.execute('SELECT id FROM data_table WHERE name=?', (name,)).fetchone()
            require(row is not None, f'Missing Data Table: {name}')
            table = 'data_table_user_' + row['id']
            return [dict(r) for r in db.execute('SELECT * FROM "' + table.replace('"', '""') + '" ORDER BY id')]

    require(len(table_rows(spec['tables']['callbacks'])) == 0, 'Fresh callbacks table must be empty')
    seeded = table_rows(spec['tables']['orders'])
    expected_seed = json.loads((HERE / 'fixtures' / spec['preconditions']['orders']).read_text())
    require(len(seeded) == len(expected_seed), 'Seed order count')
    for wanted in expected_seed:
        require(any(all(row.get(k) == v for k, v in wanted.items()) for row in seeded), f'Seed row: {wanted}')
    checks.append({'name': 'fresh-import-and-seed', 'passed': True, 'orders': len(seeded)})
    base = f'http://127.0.0.1:{http_port}'
    url = base + '/webhook/' + webhook['parameters']['path']

    def request(payload, auth=secret):
        headers = {'Content-Type': 'application/json'}
        if auth is not None:
            headers['X-Vapi-Secret'] = auth
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers)
        try:
            response = urllib.request.urlopen(req, timeout=25)
        except urllib.error.HTTPError as error:
            response = error
        body = response.read().decode()
        try:
            body = json.loads(body)
        except ValueError:
            pass
        return response.status, body

    def check_response(scenario, code, body):
        require(code == scenario['httpStatus'], f'HTTP {code}: {body}')
        require(isinstance(body, dict) and set(body) == {'results'}, f'Envelope: {body}')
        actual = body['results']
        expected = scenario['expectedResults']
        require(len(actual) == len(expected), f'Result count: {actual}')
        mapped = {r.get('toolCallId'): r for r in actual}
        require(len(mapped) == len(actual) and set(mapped) == {r['toolCallId'] for r in expected}, f'Response IDs: {actual}')
        for target in expected:
            item = mapped[target['toolCallId']]
            field = 'error' if 'error' in target else 'result'
            require(set(item) == {'toolCallId', field}, f'Result fields: {item}')
            value = item[field]
            require(isinstance(value, str) and '\n' not in value and '\r' not in value, f'Single-line {field}: {item}')
            if field == 'error':
                require(value == target[field], f'Error: {item}')
                continue
            data = json.loads(value)
            capture = target.get('captureResultFields', {})
            equal = target.get('equalResultFields', {})
            wanted = target['resultJson']
            require(set(data) == set(wanted) | set(capture) | set(equal), f'Business result fields: {data}')
            require(all(data[k] == v for k, v in wanted.items()), f'Business result expected {wanted}, received {data}')
            for key, label in capture.items():
                require(isinstance(data[key], str) and data[key], f'Capture {key}: {data}')
                captures[label] = data[key]
            for key, label in equal.items():
                require(data[key] == captures[label], f'Replay ID expected {captures[label]}, received {data[key]}')
        rows = table_rows(spec['tables']['callbacks'])
        require(len(rows) == scenario['callbackRowCount'], f'Callback count: {rows}')
        for target in scenario.get('expectedCallbackRows', []):
            require(any(all(row.get(k) == v for k, v in target['columns'].items()) and
                        str(row['id']) == captures[target['idEqualsCapture']] for row in rows), f'Callback row: {rows}')
        for first, second in scenario.get('distinctCaptures', []):
            require(captures[first] != captures[second], f'Distinct callback IDs: {captures}')

    with (out / 'server.log').open('w') as log:
        server = subprocess.Popen([binary, 'start'], env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                require(server.poll() is None, 'Server exited: ' + (out / 'server.log').read_text()[-4000:])
                try:
                    with urllib.request.urlopen(base + '/healthz/readiness', timeout=2) as response:
                        if response.status == 200:
                            break
                except (OSError, urllib.error.URLError):
                    time.sleep(0.4)
            else:
                raise RuntimeError('Server readiness timeout')
            payload = json.loads((HERE / 'fixtures/two-orders.request.json').read_text())
            # HTTP readiness precedes asynchronous production-webhook registration.
            while time.monotonic() < deadline:
                code, body = request(payload, None)
                if code != 404:
                    break
                time.sleep(0.2)
            for name, auth in [('missing-auth', None), ('wrong-auth', 'wrong-demo-secret')]:
                code, body = request(payload, auth)
                require(code in (401, 403), f'{name}: HTTP {code}: {body}')
                require(len(table_rows(spec['tables']['callbacks'])) == 0, f'{name}: callback state')
                checks.append({'name': name, 'passed': True, 'httpStatus': code})
            for scenario in spec['scenarios']:
                payload = json.loads((HERE / 'fixtures' / scenario['request']).read_text())
                code, body = request(payload)
                (out / (scenario['name'] + '.json')).write_text(json.dumps({'httpStatus': code, 'body': body}, indent=2) + '\n')
                check_response(scenario, code, body)
                checks.append({'name': scenario['name'], 'passed': True, 'httpStatus': code, 'toolResults': len(body['results']), 'callbackRows': scenario['callbackRowCount']})
                print('PASS ' + scenario['name'], flush=True)
        finally:
            os.killpg(server.pid, signal.SIGTERM)
            try:
                server.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(server.pid, signal.SIGKILL)
                server.wait()
    result = {'runtime': 'n8n 2.41.7', 'execution': 'fresh database, native Data Tables, production webhook HTTP',
              'passed': len(checks), 'failed': 0, 'checks': checks, 'callbacks': table_rows(spec['tables']['callbacks'])}
    (out / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
    suite = ET.Element('testsuite', name='Vapi order support HTTP acceptance', tests=str(len(checks)), failures='0')
    for check in checks:
        ET.SubElement(suite, 'testcase', name=check['name'], classname='vapi-order-support')
    ET.ElementTree(suite).write(out / 'junit.xml', encoding='unicode', xml_declaration=True)
    print(f'{len(checks)}/{len(checks)} passed; reports: {out}')


if __name__ == '__main__':
    main()
