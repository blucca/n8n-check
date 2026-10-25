#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Blucca
"""Real parent/child execution: equal JSON projections, independent delivery oracle.

Adapted from Blucca's public PR40833 API harness. Uses a disposable local n8n
database and local HTTP recipient; no production credentials or external calls.
This first experiment covers one call and one Merge family, not arbitrary graphs.
"""
import argparse
import datetime
import http.cookiejar
import http.server
import json
import os
from pathlib import Path
import resource
import secrets
import shutil
import sqlite3
import subprocess
import threading
import time
import traceback
import urllib.error
import urllib.request
import uuid


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--runtime', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--port', type=int, default=5692)
parser.add_argument('--overlay', type=Path)
parser.add_argument('--extended', action='store_true', help='Bounded input reduction, changed IDs/order and legal fan-in')
args = parser.parse_args()
RUNTIME = args.runtime.resolve()
OUT = args.output.resolve()
OUT.mkdir(parents=True, exist_ok=False)
DATA = OUT / 'data'
BASE = f'http://127.0.0.1:{args.port}'
RUN = uuid.uuid4().hex[:10]
KEY = None
requests_received = []
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
result = {
    'status': 'preparing',
    'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'runtime': {name: json.loads((RUNTIME / 'node_modules' / name / 'package.json').read_text())['version']
                for name in ('n8n', 'n8n-core', 'n8n-nodes-base', 'n8n-workflow')},
    'node': subprocess.check_output(['node', '--version'], text=True).strip(),
    'overlay': args.overlay.name if args.overlay else None,
    'cases': [],
}


def save(name, data):
    path = OUT / name
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, indent=2) + '\n')
    temporary.replace(path)


def progress(stage, **values):
    row = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'stage': stage, **values}
    with (OUT / 'progress.jsonl').open('a') as stream:
        stream.write(json.dumps(row) + '\n')
    print(json.dumps(row), flush=True)


def request(path, body=None, public=True, method=None):
    headers = {'Content-Type': 'application/json'}
    if public:
        headers['X-N8N-API-KEY'] = KEY
    req = urllib.request.Request(BASE + path, headers=headers, method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with opener.open(req, timeout=45) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = raw.decode(errors='replace')[:1000]
        return error.code, payload


class Collector(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        if not 0 < length <= 65536:
            self.send_error(413)
            return
        payload = json.loads(self.rfile.read(length))
        requests_received.append({'path': self.path, 'body': payload})
        raw = b'{"ok":true}'
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *_):
        pass


def node(name, kind, version, parameters, x=0, y=0):
    return {'id': name, 'name': name, 'type': 'n8n-nodes-base.' + kind,
            'typeVersion': version, 'parameters': parameters, 'position': [x, y]}


def link(connections, source, target, input_index=0):
    connections.setdefault(source, {'main': [[]]})['main'][0].append(
        {'node': target, 'type': 'main', 'index': input_index})


def publish(workflow):
    status, data = request('/api/v1/workflows', workflow)
    assert status == 200, ('create workflow', status, data)
    identifier = data['id']
    status, data = request(f'/api/v1/workflows/{identifier}/activate', {})
    save(f'{identifier}-activation.json', data)
    assert status == 200, ('activate workflow', status, data)
    assert data.get('active') is True, ('workflow activation flag', data)
    return identifier


def persisted_execution(workflow_id):
    # Every test has a fresh parent. Children are read by the actual call edge.
    for _ in range(40):
        status, payload = request(f'/api/v1/executions?workflowId={workflow_id}&includeData=true&limit=1')
        assert status == 200, ('list executions', status, payload)
        rows = payload.get('data', [])
        if rows and rows[0].get('status') in ('success', 'error', 'crashed', 'canceled'):
            return read_execution(rows[0]['id'])
        time.sleep(.2)
    raise RuntimeError(f'Execution persistence timed out: {workflow_id}')


def read_execution(identifier):
    status, detail = request(f'/api/v1/executions/{identifier}?includeData=true')
    assert status == 200, ('read execution', status, detail)
    return detail


def json_projection(execution, exclude=()):
    # Preserve node/run/output/item axes; deliberately omit ancestry metadata.
    return {name: [[[item['json'] for item in (output or [])]
                    for output in task.get('data', {}).get('main', [])]
                   for task in runs]
            for name, runs in execution['data']['resultData']['runData'].items()
            if name not in exclude}


def make_child(selected_input):
    same_json = {'mode': 'raw', 'jsonOutput': '{"sku":"same-product","quantity":1}', 'options': {}}
    nodes = [
        node('Start', 'executeWorkflowTrigger', 1.1, {'inputSource': 'passthrough'}),
        node('Left Limit', 'limit', 1, {'maxItems': 2, 'keep': 'firstItems'}, 200, 0),
        node('Left Project', 'set', 3.4, same_json, 300, 0),
        node('Right Sort', 'sort', 1, {'type': 'simple', 'sortFieldsUi': {
            'sortField': [{'fieldName': 'order.sequence', 'order': 'descending'}]}, 'options': {}}, 200, 200),
        node('Right Limit', 'limit', 1, {'maxItems': 2, 'keep': 'firstItems'}, 300, 200),
        node('Right Project', 'set', 3.4, same_json, 400, 200),
        node('Select', 'merge', 3.2, {'mode': 'chooseBranch', 'numberInputs': 2,
            'chooseBranchMode': 'waitForAll', 'output': 'specifiedInput' if selected_input else 'empty',
            'useDataOfInput': selected_input}, 600, 0),
        node('Return', 'noOp', 1, {}, 800, 0),
    ]
    connections = {}
    for source, target, inlet in [('Start', 'Left Limit', 0), ('Left Limit', 'Left Project', 0),
                                  ('Start', 'Right Sort', 0), ('Right Sort', 'Right Limit', 0),
                                  ('Right Limit', 'Right Project', 0), ('Left Project', 'Select', 0),
                                  ('Right Project', 'Select', 1), ('Select', 'Return', 0)]:
        link(connections, source, target, inlet)
    return {'name': f'{RUN} child input {selected_input}', 'settings': {'executionOrder': 'v1'},
            'nodes': nodes, 'connections': connections}


def run_case(selected_input, collector_port, orders=None, label=None):
    label = label or f'input{selected_input}'
    row = {'case': label, 'selected_input': selected_input}
    result['cases'].append(row)
    progress('case_started', case=label)
    if orders is None:
        orders = [{'id': f'customer-{letter}', 'sequence': i} for i, letter in enumerate('ABCD')]
    row['input_orders'] = orders
    expected = (orders if selected_input == 1 else sorted(orders, key=lambda value: -value['sequence']))[:2]
    row['expected_recipients'] = [order['id'] for order in expected] if selected_input else ['team-inbox']
    delivery_expression = "={{ {slot: $itemIndex, recipient: $('Orders').item.json.order.id, sku: $json.sku, quantity: $json.quantity} }}"
    if selected_input == 0:
        delivery_expression = '{"slot":0,"recipient":"team-inbox","kind":"approved-aggregate"}'
    child = make_child(selected_input)
    child_id = publish(child)
    path = f'{RUN}-{label}'
    webhook = node('Webhook', 'webhook', 2, {'httpMethod': 'POST', 'path': path,
                   'responseMode': 'lastNode', 'options': {}})
    webhook['webhookId'] = str(uuid.uuid4())
    parent = {'name': f'{RUN} parent {label}', 'settings': {'executionOrder': 'v1'}, 'nodes': [
        webhook,
        node('Orders', 'splitOut', 1, {'fieldToSplitOut': 'body.orders', 'include': 'noOtherFields',
             'options': {'destinationFieldName': 'order'}}, 200),
        node('Call', 'executeWorkflow', 1.2, {'source': 'database', 'mode': 'once',
             'workflowId': {'__rl': True, 'mode': 'id', 'value': child_id},
             'options': {'waitForSubWorkflow': True}}, 400),
        node('Deliver', 'httpRequest', 4.2, {'method': 'POST',
             'url': f'http://127.0.0.1:{collector_port}/{label}', 'sendBody': True,
             'contentType': 'json', 'specifyBody': 'json',
             'jsonBody': delivery_expression,
             'options': {}}, 600),
    ], 'connections': {}}
    for source, target in [('Webhook', 'Orders'), ('Orders', 'Call'), ('Call', 'Deliver')]:
        link(parent['connections'], source, target)
    parent_id = publish(parent)
    row['workflow_ids'] = {'parent': parent_id, 'child': child_id}
    save(f'{label}-workflows.json', {'parent': parent, 'child': child, 'body': {'orders': orders}})
    # Activation has twice returned ahead of webhook visibility on this runtime.
    # Retry only its explicit pre-execution 404; executed requests are never retried.
    row['webhook_attempt_statuses'] = []
    for attempt in range(6):
        status, response = request('/webhook/' + path, {'orders': orders}, public=False)
        row['webhook_attempt_statuses'].append(status)
        if status != 404 or 'not registered' not in str(response):
            break
        time.sleep(.5)
    row['http_status'], row['response'] = status, response
    if status == 404:
        with sqlite3.connect(f'file:{DATA / ".n8n/database.sqlite"}?mode=ro', uri=True) as database:
            database.row_factory = sqlite3.Row
            row['registered_webhooks'] = [dict(value) for value in database.execute('SELECT * FROM webhook_entity')]
        raise RuntimeError(f'Webhook HTTP {status}: {response}')
    parent_execution = persisted_execution(parent_id)
    save(f'{label}-parent-execution.json', parent_execution)
    call_runs = parent_execution['data']['resultData']['runData']['Call']
    assert len(call_runs) == 1, 'First experiment expects exactly one child call'
    edge = call_runs[0].get('metadata', {}).get('subExecution')
    assert edge and edge.get('executionId'), ('missing actual child edge', call_runs[0])
    child_execution = read_execution(edge['executionId'])
    save(f'{label}-child-execution.json', child_execution)
    row['call_edge'] = {'parent_execution': parent_execution['id'], 'node': 'Call', 'run': 0,
                        'child_execution': child_execution['id'], 'child_workflow': edge.get('workflowId')}
    row['execution_statuses'] = {'parent': parent_execution['status'], 'child': child_execution['status']}
    row['requests'] = [item['body'] for item in requests_received if item['path'] == '/' + label]
    # HTTP Request executes items concurrently: arrival order is not item identity.
    delivered = sorted(row['requests'], key=lambda item: item.get('slot', -1))
    row['actual_recipients'] = [item.get('recipient') for item in delivered]
    row['delivery_slots'] = [item.get('slot') for item in delivered]
    row['identity_passed'] = (row['actual_recipients'] == row['expected_recipients']
                              and row['delivery_slots'] == list(range(len(row['expected_recipients']))))
    row['unexpected_recipients'] = sorted(set(row['actual_recipients']) - set(row['expected_recipients']))
    row['json_projection'] = {'parent': json_projection(parent_execution, exclude=('Webhook',)),
                              'child': json_projection(child_execution)}
    row['call_items'] = call_runs[0].get('data', {}).get('main')
    if selected_input == 0:
        pairs = row['call_items'][0][0].get('pairedItem', [])
        pairs = pairs if isinstance(pairs, list) else [pairs]
        row['actual_ancestor_indices'] = sorted({p if isinstance(p, int) else p['item'] for p in pairs})
        ordered_indices = sorted(range(len(orders)), key=lambda i: -orders[i]['sequence'])
        row['expected_ancestor_indices'] = sorted(set(range(min(2, len(orders)))) | set(ordered_indices[:2]))
        row['identity_passed'] &= row['actual_ancestor_indices'] == row['expected_ancestor_indices']
    save('result.json', result)
    progress('case_completed', case=label, identity_passed=row['identity_passed'],
             actual=row['actual_recipients'], expected=row['expected_recipients'])
    return row


def predicate(control, candidate):
    return (control['identity_passed'] and control['json_projection'] == candidate['json_projection']
            and bool(candidate['unexpected_recipients']))


server = None
collector = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Collector)
threading.Thread(target=collector.serve_forever, daemon=True).start()
save('result.json', result)
try:
    DATA.mkdir(mode=0o700)
    allowed_nodes = ('executeWorkflowTrigger', 'executeWorkflow', 'webhook', 'set', 'noOp',
                     'merge', 'sort', 'limit', 'splitOut', 'httpRequest')
    options = '--max-old-space-size=512'
    if args.overlay:
        options += ' --require=' + str(args.overlay.resolve())
    env = dict(os.environ, N8N_USER_FOLDER=str(DATA), N8N_PORT=str(args.port), N8N_LISTEN_ADDRESS='127.0.0.1',
               N8N_HOST='127.0.0.1', N8N_PROTOCOL='http', N8N_SECURE_COOKIE='false',
               N8N_ENCRYPTION_KEY=secrets.token_hex(32), DB_TYPE='sqlite', N8N_RUNNERS_MODE='external',
               N8N_RUNNERS_AUTH_TOKEN=secrets.token_hex(32), N8N_RUNNERS_BROKER_PORT=str(args.port + 1),
               N8N_RUNNERS_BROKER_LISTEN_ADDRESS='127.0.0.1',
               N8N_DIAGNOSTICS_ENABLED='false', N8N_VERSION_NOTIFICATIONS_ENABLED='false',
               N8N_TEMPLATES_ENABLED='false', N8N_PERSONALIZATION_ENABLED='false',
               N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS='true',
               NODES_INCLUDE=json.dumps(['n8n-nodes-base.' + name for name in allowed_nodes]),
               EXECUTIONS_DATA_SAVE_ON_SUCCESS='all', EXECUTIONS_DATA_SAVE_ON_ERROR='all',
               LINEAGE_RUNTIME=str(RUNTIME), NODE_OPTIONS=options, TMPDIR=str(OUT))
    with (OUT / 'server.log').open('w') as log:
        server = subprocess.Popen(['node', str(RUNTIME / 'node_modules/n8n/bin/n8n'), 'start'],
                                  env=env, stdout=log, stderr=subprocess.STDOUT, cwd=OUT)
    result['status'] = 'starting'
    save('result.json', result)
    progress('server_starting', pid=server.pid, port=args.port)
    for _ in range(150):
        if server.poll() is not None:
            raise RuntimeError(f'n8n exited during startup: {server.returncode}')
        try:
            status, health = request('/healthz/readiness', public=False)
            if status == 200 and health.get('status') == 'ok':
                break
        except (OSError, ValueError):
            pass
        time.sleep(1)
    else:
        raise RuntimeError('n8n readiness timed out')
    status, owner = request('/rest/owner/setup', {'email': 'test@example.com', 'firstName': 'Identity',
                           'lastName': 'Lab', 'password': secrets.token_urlsafe(24) + 'aA1!'}, public=False)
    assert status == 200, ('owner setup', status, owner)
    status, key = request('/rest/api-keys', {'label': 'local-identity-lab', 'expiresAt': int(time.time()) + 1800,
                         'scopes': ['workflow:create', 'workflow:read', 'workflow:activate',
                                    'execution:read', 'execution:list']}, public=False)
    assert status == 200, ('API key creation', status, key)
    KEY = key['data']['rawApiKey']
    result['status'] = 'running'
    save('result.json', result)
    progress('server_ready')
    for selected_input in (1, 2):
        run_case(selected_input, collector.server_port)
    control, candidate = result['cases']
    assert control['identity_passed'], 'The independent identity control must pass'
    result['json_only_equal'] = control['json_projection'] == candidate['json_projection']
    result['counterexample_found'] = (result['json_only_equal'] and not candidate['identity_passed']
                                      and bool(candidate['unexpected_recipients']))
    if args.extended:
        result['reduction'] = {'initial_items': 4, 'attempts': [], 'retained_items': 4}
        for size in ((3,) if args.overlay else (3, 2)):
            subset = control['input_orders'][:size]
            a = run_case(1, collector.server_port, subset, f'reduced{size}-input1')
            b = run_case(2, collector.server_port, subset, f'reduced{size}-input2')
            preserved = predicate(a, b)
            result['reduction']['attempts'].append({'items': size, 'same_failure': preserved})
            if preserved:
                result['reduction']['retained_items'] = size
            elif not args.overlay:
                break
        changed = [{'id': 'new-Q', 'sequence': 9}, {'id': 'new-M', 'sequence': 3},
                   {'id': 'new-R', 'sequence': 7}]
        run_case(2, collector.server_port, changed, 'changed-input')
        run_case(0, collector.server_port, label='legal-fan-in')
        result['all_identity_checks_passed'] = all(row['identity_passed'] for row in result['cases'])
        if args.overlay:
            assert result['all_identity_checks_passed'], 'Repaired runtime must pass every identity contract'
    result['status'] = 'complete'
    progress('experiment_complete', json_only_equal=result['json_only_equal'],
             counterexample_found=result['counterexample_found'])
except Exception as error:
    result['status'] = 'failed'
    result['error'] = str(error)
    progress('failed', error=str(error)[:1200])
    traceback.print_exc()
    raise
finally:
    if server and server.poll() is None:
        server.terminate()
        try:
            server.wait(timeout=15)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()
    collector.shutdown()
    collector.server_close()
    if DATA.exists():
        shutil.rmtree(DATA)
    usage = resource.getrusage(resource.RUSAGE_CHILDREN)
    result['child_cpu_seconds'] = usage.ru_utime + usage.ru_stime
    result['child_peak_rss_kib'] = usage.ru_maxrss
    result['completed_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save('result.json', result)
    save('requests.json', requests_received)
    progress('cleaned_up', server_stopped=server is None or server.poll() is not None)
