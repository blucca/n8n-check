#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Blucca
"""Bounded native nested execution, with independent semantic and HTTP oracles.

API/collector scaffolding adapted from experiments/lineage-boundary/run.py.
The workflow family is parent -> bridge -> leaf, with two waiting once calls.
Use the already cached image, its own SQLite DB and a loopback-only receiver.
Round408 adds an optional same-directory compiled runtime preload; native API data stays intact.
"""
import argparse
import datetime
import http.cookiejar
import http.server
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import threading
import time
import traceback
import urllib.error
import urllib.request
import uuid


DEFAULT_IMAGE = 'docker.n8n.io/n8nio/n8n@sha256:c6a3a0461d1d3ffc16d849adf57606c2b028667ade70cce2faa2ff094734873c'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--image', default=DEFAULT_IMAGE)
parser.add_argument('--port', type=int, default=5702)
parser.add_argument('--legacy-auditor', type=Path, default=Path(__file__).parent / 'legacy/audit-executions.cjs')
parser.add_argument('--child-save', choices=('all', 'none'), default='all')
parser.add_argument('--wall-limit', type=int, default=360)
parser.add_argument('--patch-dir', type=Path,
                    help='Copy same-directory .cjs/.js runtime modules into output/patch; fixed return-repair-preload.cjs entry')
parser.add_argument('--expect', choices=('original', 'repaired'), default='original')
parser.add_argument('--graph-auditor', type=Path, default=Path(__file__).with_name('audit-bundle.cjs'))
args = parser.parse_args()
if not 1 <= args.wall_limit <= 360:
    parser.error('wall-limit must be 1..360 seconds')
if args.expect == 'repaired' and args.patch_dir is None:
    parser.error('repaired acceptance requires --patch-dir')
OUT = args.output.resolve()
OUT.mkdir(parents=True, exist_ok=False)
DATA = OUT / 'data'
DATA.mkdir(mode=0o700)
PATCH = {'enabled': args.patch_dir is not None, 'files': {}}
if args.patch_dir is not None:
    patch_source = args.patch_dir.resolve()
    entry = patch_source / 'return-repair-preload.cjs'
    if not entry.is_file():
        raise SystemExit('Patch directory requires return-repair-preload.cjs')
    patch_target = OUT / 'patch'
    patch_target.mkdir()
    for source in sorted(patch_source.iterdir()):
        if source.is_file() and source.suffix in ('.cjs', '.js'):
            target = patch_target / source.name
            shutil.copy2(source, target)
            PATCH['files'][source.name] = 'copied'
    PATCH['source_directory'] = str(patch_source)
    PATCH['entry'] = '/lab/patch/return-repair-preload.cjs'
BASE = f'http://127.0.0.1:{args.port}'
RUN = uuid.uuid4().hex[:10]
CONTAINER = f'n8n-nested-408-{RUN}'
KEY = None
SERVER = None
CGROUP = None
received = []
owner_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
result = {
    'status': 'preparing', 'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'family': 'nested-once-passthrough-depth2', 'container': CONTAINER,
    'runtime': {'image': args.image, 'expected_n8n_version_from_existing_cache_receipt': '2.43.0'},
    'caps': {'cpu': 2, 'memory_bytes': 1536 * 1024**2, 'node_heap_mib': 640,
             'wall_seconds': args.wall_limit, 'startup_seconds': 150,
             'fresh_database': True, 'overlay': PATCH['enabled'], 'saved_data_mutation': False},
    'patch': PATCH, 'expect': args.expect, 'child_save': args.child_save,
    'cases': [],
}


def save(name, value):
    p = OUT / name
    temporary = p.with_suffix(p.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(p)


def progress(stage, **values):
    row = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'stage': stage, **values}
    with (OUT / 'progress.jsonl').open('a') as f:
        f.write(json.dumps(row) + '\n')
    save('result.json', result)
    save('state.json', {'status': result['status'], 'stage': stage, 'at': row['at'],
                        'container': CONTAINER, 'output': str(OUT)})
    print(json.dumps(row), flush=True)


def request(path, body=None, public=True, method=None, with_owner_cookie=True):
    headers = {'Content-Type': 'application/json'}
    if public:
        headers['X-N8N-API-KEY'] = KEY
    req = urllib.request.Request(BASE + path, headers=headers, method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    open_request = owner_opener.open if with_owner_cookie else urllib.request.urlopen
    try:
        with open_request(req, timeout=45) as response:
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
        n = int(self.headers.get('Content-Length', '0'))
        if not 0 < n <= 65536:
            self.send_error(413)
            return
        payload = json.loads(self.rfile.read(n))
        received.append({'path': self.path, 'body': payload,
                         'at': datetime.datetime.now(datetime.timezone.utc).isoformat()})
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


def link(connections, source, target, inlet=0):
    connections.setdefault(source, {'main': [[]]})['main'][0].append(
        {'node': target, 'type': 'main', 'index': inlet})


def workflow(name, nodes, edges):
    connections = {}
    for source, target, inlet in edges:
        link(connections, source, target, inlet)
    return {'name': f'{RUN} {name}', 'settings': {'executionOrder': 'v1'},
            'nodes': nodes, 'connections': connections}


def make_leaf(selected_input):
    same = {'mode': 'raw', 'jsonOutput': '{"sku":"same-product","quantity":1}', 'options': {}}
    return workflow(f'leaf input {selected_input}', [
        node('Start', 'executeWorkflowTrigger', 1.1, {'inputSource': 'passthrough'}),
        node('Left Limit', 'limit', 1, {'maxItems': 2, 'keep': 'firstItems'}, 200),
        node('Left Project', 'set', 3.4, same, 300),
        node('Right Sort', 'sort', 1, {'type': 'simple', 'sortFieldsUi': {
            'sortField': [{'fieldName': 'order.sequence', 'order': 'descending'}]}, 'options': {}}, 200, 200),
        node('Right Limit', 'limit', 1, {'maxItems': 2, 'keep': 'firstItems'}, 300, 200),
        node('Right Project', 'set', 3.4, same, 400, 200),
        node('Select', 'merge', 3.2, {'mode': 'chooseBranch', 'numberInputs': 2,
            'chooseBranchMode': 'waitForAll', 'output': 'specifiedInput',
            'useDataOfInput': selected_input}, 600),
        node('Return', 'noOp', 1, {}, 800),
    ], [('Start', 'Left Limit', 0), ('Left Limit', 'Left Project', 0),
        ('Start', 'Right Sort', 0), ('Right Sort', 'Right Limit', 0),
        ('Right Limit', 'Right Project', 0), ('Left Project', 'Select', 0),
        ('Right Project', 'Select', 1), ('Select', 'Return', 0)])


def call_node(name, child_id, x=0):
    return node(name, 'executeWorkflow', 1.2, {'source': 'database', 'mode': 'once',
                'workflowId': {'__rl': True, 'mode': 'id', 'value': child_id},
                'options': {'waitForSubWorkflow': True}}, x)


def make_bridge(leaf_id, label):
    return workflow(f'bridge {label}', [
        node('Start', 'executeWorkflowTrigger', 1.1, {'inputSource': 'passthrough'}),
        call_node('Call Leaf', leaf_id, 250),
        node('Return', 'noOp', 1, {}, 500),
    ], [('Start', 'Call Leaf', 0), ('Call Leaf', 'Return', 0)])


def make_parent(bridge_id, label, collector_port):
    path = f'{RUN}-{label}'
    webhook = node('Webhook', 'webhook', 2, {'httpMethod': 'POST', 'path': path,
                    'responseMode': 'lastNode', 'options': {}})
    webhook['webhookId'] = str(uuid.uuid4())
    return workflow(f'parent {label}', [
        webhook,
        node('Orders', 'splitOut', 1, {'fieldToSplitOut': 'body.orders', 'include': 'noOtherFields',
             'options': {'destinationFieldName': 'order'}}, 200),
        call_node('Call Bridge', bridge_id, 400),
        node('Deliver', 'httpRequest', 4.2, {'method': 'POST',
            'url': f'http://127.0.0.1:{collector_port}/{label}', 'sendBody': True,
            'contentType': 'json', 'specifyBody': 'json',
            'jsonBody': "={{ {slot: $itemIndex, recipient: $('Orders').item.json.order.id, sku: $json.sku, quantity: $json.quantity} }}",
            'options': {}}, 600),
    ], [('Webhook', 'Orders', 0), ('Orders', 'Call Bridge', 0), ('Call Bridge', 'Deliver', 0)]), path


def publish(value):
    status, payload = request('/api/v1/workflows', value)
    assert status == 200, ('create workflow', status, payload)
    identifier = payload['id']
    status, activated = request(f'/api/v1/workflows/{identifier}/activate', {})
    assert status == 200 and activated.get('active') is True, ('activate workflow', status, activated)
    return identifier


def read_execution(identifier):
    status, payload = request(f'/api/v1/executions/{identifier}?includeData=true')
    assert status == 200, ('read saved execution', status, payload)
    return payload


def persisted_execution(workflow_id):
    for _ in range(50):
        status, payload = request(f'/api/v1/executions?workflowId={workflow_id}&includeData=true&limit=1')
        assert status == 200, ('list saved executions', status, payload)
        rows = payload.get('data', [])
        if rows and rows[0].get('status') in ('success', 'error', 'crashed', 'canceled'):
            return read_execution(rows[0]['id'])
        time.sleep(.2)
    raise RuntimeError(f'Execution persistence timed out: {workflow_id}')


def follow_child(parent, call_name):
    runs = parent.get('data', {}).get('resultData', {}).get('runData', {}).get(call_name, [])
    if len(runs) != 1:
        return None, {'node': call_name, 'saved_call_runs': len(runs), 'status': 'call-evidence-absent'}
    edge = runs[0].get('metadata', {}).get('subExecution')
    if not edge or not edge.get('executionId'):
        return None, {'node': call_name, 'status': 'saved-child-edge-absent'}
    status, child = request(f"/api/v1/executions/{edge['executionId']}?includeData=true")
    receipt = {'parent_execution': str(parent['id']), 'node': call_name, 'run': 0,
               'child_execution': str(edge['executionId']), 'child_workflow': str(edge['workflowId']),
               'api_read_status': status}
    if status != 200:
        receipt['status'] = 'child-saved-data-absent' if status == 404 else 'child-api-read-failed'
        receipt['api_read_response'] = child
        return None, receipt
    reverse = child.get('data', {}).get('resultData', {}).get('runData', {}).get('Start', [{}])[0].get('metadata', {}).get('parentExecution', {})
    receipt['reverse_edge'] = reverse
    receipt['parent_edge_matches'] = (str(child.get('workflowId')) == str(edge['workflowId']) and
        str(reverse.get('executionId')) == str(parent['id']) and
        str(reverse.get('workflowId')) == str(parent['workflowId']) and reverse.get('shouldResume') is True)
    receipt['status'] = 'saved'
    return child, receipt


def projection(execution, exclude=()):
    return {name: [[[item['json'] for item in (output or [])]
                    for output in task.get('data', {}).get('main', [])] for task in runs]
            for name, runs in execution['data']['resultData']['runData'].items()
            if name not in exclude}


def semantic_oracle(orders, selected_input):
    # Independent ground truth: enumerate business input, then apply the actual
    # Limit / Sort / Select rules. No pairedItem, saved source edge or JS resolver.
    indexed = list(enumerate(orders))
    selected = (indexed if selected_input == 1 else sorted(indexed, key=lambda row: -row[1]['sequence']))[:2]
    indices = [i for i, _ in selected]
    return {'selected_input': selected_input, 'orders': orders,
            'rules': 'input1 = first two; input2 = descending order.sequence then first two; project removes identity',
            'expected_recipients_by_slot': [order['id'] for _, order in selected],
            'expected_root_order_indices_by_slot': indices,
            'expected_boundary_input_indices_by_slot': {'Call Leaf': indices, 'Call Bridge': indices},
            'ground_truth_source': 'Python business-input enumeration and workflow semantics, before execution'}


def legacy_audit(parent_path, child_path, label):
    p = subprocess.run(['node', str(args.legacy_auditor.resolve()), str(parent_path), str(child_path)],
                       capture_output=True, text=True, timeout=20)
    (OUT / f'{label}-legacy-audit.stdout').write_text(p.stdout)
    (OUT / f'{label}-legacy-audit.stderr').write_text(p.stderr)
    (OUT / f'{label}-legacy-audit.exit').write_text(str(p.returncode) + '\n')
    try:
        report = json.loads(p.stdout)
    except json.JSONDecodeError:
        report = {'status': 'execution-failed', 'stderr': p.stderr[:1000]}
    report['exit_code'] = p.returncode
    return report



def pair_indices(value):
    # Canonical pairing stays on the caller's local input 0, independent of JSON.
    if value is None:
        return None
    pairs = value if isinstance(value, list) else [value]
    if not pairs:
        return None
    rows = []
    for pair in pairs:
        p = {'item': pair} if isinstance(pair, int) else pair
        if not isinstance(p, dict) or not isinstance(p.get('item'), int) or p.get('input', 0) != 0 or 'sourceOverwrite' in p:
            return None
        rows.append(p['item'])
    return sorted(set(rows))


def graph_audit(paths, label):
    p = subprocess.run(['node', str(args.graph_auditor.resolve()), *[str(path) for path in paths]],
                       capture_output=True, text=True, timeout=20)
    (OUT / f'{label}-graph-audit.stdout').write_text(p.stdout)
    (OUT / f'{label}-graph-audit.stderr').write_text(p.stderr)
    (OUT / f'{label}-graph-audit.exit').write_text(str(p.returncode) + '\n')
    try:
        report = json.loads(p.stdout)
    except json.JSONDecodeError:
        report = {'status': 'execution-failed', 'stderr': p.stderr[:1000]}
    report['exit_code'] = p.returncode
    save(f'{label}-graph-audit.json', report)
    return report


def cgroup_usage():
    if CGROUP is None:
        return {'status': 'cgroup-path-unavailable'}
    observed = {'cgroup_path': str(CGROUP)}
    for name in ('cpu.stat', 'memory.current', 'memory.peak', 'memory.events', 'cpu.max', 'memory.max'):
        p = CGROUP / name
        if p.exists():
            observed[name] = p.read_text().strip()
    return observed


def run_case(selected_input, collector_port):
    label = f'nested-input{selected_input}'
    orders = [{'id': f'customer-{letter}', 'sequence': i} for i, letter in enumerate('ABCD')]
    oracle = semantic_oracle(orders, selected_input)
    # This oracle file is committed to disk before any workflow is created.
    save(f'{label}-oracle.json', oracle)
    row = {'case': label, 'oracle': oracle, 'child_save': args.child_save}
    result['cases'].append(row)
    progress('case_started', case=label)
    leaf = make_leaf(selected_input)
    leaf['settings'].update({'saveDataSuccessExecution': args.child_save, 'saveDataErrorExecution': 'all'})
    leaf_id = publish(leaf)
    bridge = make_bridge(leaf_id, label)
    bridge['settings'].update({'saveDataSuccessExecution': args.child_save, 'saveDataErrorExecution': 'all'})
    bridge_id = publish(bridge)
    parent, path = make_parent(bridge_id, label, collector_port)
    parent['settings'].update({'saveDataSuccessExecution': 'all', 'saveDataErrorExecution': 'all'})
    parent_id = publish(parent)
    row['workflow_ids'] = {'parent': parent_id, 'bridge': bridge_id, 'leaf': leaf_id}
    save(f'{label}-workflows.json', {'parent': parent, 'bridge': bridge, 'leaf': leaf, 'body': {'orders': orders}})
    row['webhook_attempt_statuses'] = []
    for _ in range(6):
        status, response = request('/webhook/' + path, {'orders': orders}, public=False, with_owner_cookie=False)
        row['webhook_attempt_statuses'].append(status)
        if status != 404 or 'not registered' not in str(response):
            break
        time.sleep(.5)
    row['http_status'], row['response'] = status, response
    assert status != 404, ('webhook registration', status, response)
    parent_execution = persisted_execution(parent_id)
    save(f'{label}-parent-execution.json', parent_execution)
    executions = {'parent': parent_execution}
    bridge_execution, edge1 = follow_child(parent_execution, 'Call Bridge')
    row['call_edges'] = [edge1]
    if bridge_execution is not None:
        executions['bridge'] = bridge_execution
        save(f'{label}-bridge-execution.json', bridge_execution)
        leaf_execution, edge2 = follow_child(bridge_execution, 'Call Leaf')
        row['call_edges'].append(edge2)
        if leaf_execution is not None:
            executions['leaf'] = leaf_execution
            save(f'{label}-leaf-execution.json', leaf_execution)
    row['execution_statuses'] = {role: v['status'] for role, v in executions.items()}
    row['requests'] = [r['body'] for r in received if r['path'] == '/' + label]
    delivered = sorted(row['requests'], key=lambda r: r.get('slot', -1))
    row['actual_recipients_by_slot'] = [r.get('recipient') for r in delivered]
    row['delivery_slots'] = [r.get('slot') for r in delivered]
    row['identity_passed'] = (status == 200 and row['actual_recipients_by_slot'] == oracle['expected_recipients_by_slot']
                              and row['delivery_slots'] == list(range(len(oracle['expected_recipients_by_slot']))))
    row['unexpected_recipients'] = sorted(set(row['actual_recipients_by_slot']) - set(oracle['expected_recipients_by_slot']))
    row['json_projection'] = {role: projection(v, exclude=('Webhook',) if role == 'parent' else ()) for role, v in executions.items()}
    row['call_items'] = {}
    row['call_pair_checks'] = {}
    for role, name in [('parent', 'Call Bridge'), ('bridge', 'Call Leaf')]:
        if role not in executions:
            continue
        runs = executions[role]['data']['resultData']['runData'].get(name, [])
        outputs = runs[0].get('data', {}).get('main', []) if len(runs) == 1 else []
        row['call_items'][role] = outputs
        items = outputs[0] if len(outputs) == 1 and outputs[0] is not None else []
        row['call_pair_checks'][role] = (len(items) == len(oracle['expected_root_order_indices_by_slot']) and
            all(pair_indices(v.get('pairedItem')) == [index]
                for v, index in zip(items, oracle['expected_root_order_indices_by_slot'])))
    checks = {'parent_success': parent_execution['status'] == 'success', 'http_identity': row['identity_passed'],
              'parent_call_pair': row['call_pair_checks'].get('parent', False)}
    if args.child_save == 'all':
        checks['full_saved_bundle'] = len(executions) == 3
        checks['all_execution_statuses'] = len(executions) == 3 and all(v == 'success' for v in row['execution_statuses'].values())
        checks['dual_call_pair'] = len(row['call_pair_checks']) == 2 and all(row['call_pair_checks'].values())
        checks['dual_parent_edges'] = len(row['call_edges']) == 2 and all(e.get('parent_edge_matches') for e in row['call_edges'])
        paths = [OUT / f'{label}-{role}-execution.json' for role in ('parent', 'bridge', 'leaf') if role in executions]
        graph = graph_audit(paths, label)
        row['graph_audit'] = graph
        findings = [f for boundary in graph.get('boundaries', []) for f in boundary.get('findings', [])]
        expected_indices = oracle['expected_root_order_indices_by_slot']
        checks['graph_consistent'] = graph.get('status') == 'consistent' and graph.get('boundary_count') == 2 and graph.get('checked_items') == 4
        checks['graph_roots_match_input_oracle'] = (len(findings) == 4 and all(
            f.get('roots') == [{'execution': str(parent_execution['id']), 'node': 'Orders', 'run': 0, 'output': 0,
                               'item': expected_indices[f['caller']['item']]}] for f in findings))
        if len(executions) == 3:
            row['legacy_pair_audits'] = {
                'parent_bridge': legacy_audit(OUT / f'{label}-parent-execution.json', OUT / f'{label}-bridge-execution.json', label + '-parent-bridge'),
                'bridge_leaf': legacy_audit(OUT / f'{label}-bridge-execution.json', OUT / f'{label}-leaf-execution.json', label + '-bridge-leaf'),
            }
    else:
        row['saved_child_lists'] = {}
        for role, identifier in [('bridge', bridge_id), ('leaf', leaf_id)]:
            api_status, payload = request(f'/api/v1/executions?workflowId={identifier}&includeData=true&limit=10')
            row['saved_child_lists'][role] = {'http_status': api_status, 'response': payload}
        checks['child_success_saving_disabled'] = all(
            v['http_status'] == 200 and v['response'].get('data') == [] for v in row['saved_child_lists'].values())
        row['graph_audit'] = {'status': 'saved-child-data-absent', 'scope': 'HTTP and saved parent pair acceptance; child graph export is disabled by workflow settings'}
    row['checks'] = checks
    row['passed'] = all(checks.values())
    save(f'{label}-receipt.json', row)
    result['resource_usage_so_far'] = cgroup_usage()
    progress('case_completed', case=label, passed=row['passed'], identity_passed=row['identity_passed'],
             expected=oracle['expected_recipients_by_slot'], actual=row['actual_recipients_by_slot'], checks=checks)
    return row



def existing_services():
    p = subprocess.run(['docker', 'ps', '--filter', 'label=com.docker.compose.project=zetaris',
                        '--format', '{{json .}}'], capture_output=True, text=True, timeout=10)
    assert p.returncode == 0, ('existing service snapshot', p.stderr[:1000])
    return [{k: row.get(k) for k in ('ID', 'Names', 'State', 'HealthStatus')}
            for row in (json.loads(line) for line in p.stdout.splitlines() if line.strip())]


def controller_interrupted(signum, _frame):
    raise InterruptedError(f'Native controller interrupted: {signum}')


def wall_expired(*_):
    raise TimeoutError(f'Native batch wall cap reached: {args.wall_limit} seconds')


collector = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Collector)
threading.Thread(target=collector.serve_forever, daemon=True).start()
signal.signal(signal.SIGALRM, wall_expired)
# An interrupted controller still writes its receipt and releases its own lab.
signal.signal(signal.SIGTERM, controller_interrupted)
signal.signal(signal.SIGINT, controller_interrupted)
signal.alarm(args.wall_limit)
try:
    result['original_services_before'] = existing_services()
    allow = ('executeWorkflowTrigger', 'executeWorkflow', 'webhook', 'set', 'noOp', 'merge', 'sort', 'limit', 'splitOut', 'httpRequest')
    env = {
        'N8N_USER_FOLDER': '/lab/data', 'N8N_PORT': str(args.port), 'N8N_LISTEN_ADDRESS': '127.0.0.1',
        'N8N_HOST': '127.0.0.1', 'N8N_PROTOCOL': 'http', 'N8N_SECURE_COOKIE': 'false',
        'N8N_ENCRYPTION_KEY': secrets.token_hex(32), 'DB_TYPE': 'sqlite', 'N8N_RUNNERS_MODE': 'external',
        'N8N_RUNNERS_AUTH_TOKEN': secrets.token_hex(32), 'N8N_RUNNERS_BROKER_PORT': str(args.port + 1),
        'N8N_RUNNERS_BROKER_LISTEN_ADDRESS': '127.0.0.1', 'N8N_DIAGNOSTICS_ENABLED': 'false',
        'N8N_VERSION_NOTIFICATIONS_ENABLED': 'false', 'N8N_TEMPLATES_ENABLED': 'false',
        'N8N_PERSONALIZATION_ENABLED': 'false', 'N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS': 'true',
        'NODES_INCLUDE': json.dumps(['n8n-nodes-base.' + n for n in allow]),
        'EXECUTIONS_DATA_SAVE_ON_SUCCESS': 'all', 'EXECUTIONS_DATA_SAVE_ON_ERROR': 'all',
        'NODE_OPTIONS': '--max-old-space-size=640' + (' --require /lab/patch/return-repair-preload.cjs' if PATCH['enabled'] else ''), 'TMPDIR': '/lab',
    }
    command = ['docker', 'run', '--rm', '--pull', 'never', '--name', CONTAINER, '--network', 'host',
               '--cpus', '2', '--memory', '1536m', '--memory-swap', '1536m',
               '--user', f'{os.getuid()}:{os.getgid()}', '-v', f'{OUT}:/lab', '--workdir', '/lab']
    for key, value in env.items():
        command.extend(['-e', f'{key}={value}'])
    command.extend([args.image, 'start'])
    with (OUT / 'server.log').open('w') as log:
        SERVER = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, cwd=OUT)
    result['status'] = 'starting'
    progress('server_starting', host_docker_client_pid=SERVER.pid, port=args.port, collector_port=collector.server_port)
    for _ in range(150):
        if SERVER.poll() is not None:
            raise RuntimeError(f'n8n exited during startup: {SERVER.returncode}')
        try:
            status, health = request('/healthz/readiness', public=False)
            if status == 200 and health.get('status') == 'ok':
                break
        except (OSError, ValueError):
            pass
        time.sleep(1)
    else:
        raise RuntimeError('n8n readiness exceeded 150 seconds')
    inspection = subprocess.run(['docker', 'inspect', CONTAINER, '--format', '{{.State.Pid}}'], capture_output=True, text=True, timeout=10)
    if inspection.returncode == 0:
        pid = int(inspection.stdout.strip())
        for line in Path(f'/proc/{pid}/cgroup').read_text().splitlines():
            if line.startswith('0::'):
                CGROUP = Path('/sys/fs/cgroup') / line[3:].lstrip('/')
    package_script = "const fs=require('node:fs');const p='/usr/local/lib/node_modules/n8n';const v={node:process.version};for(const name of ['n8n','n8n-core','n8n-nodes-base','n8n-workflow']){try{v[name]=JSON.parse(fs.readFileSync((name==='n8n'?p:p+'/node_modules/'+name)+'/package.json','utf8')).version}catch(e){v[name]={read_error:e.message}}}process.stdout.write(JSON.stringify(v))"
    versions = subprocess.run(['docker', 'exec', '-e', 'NODE_OPTIONS=--max-old-space-size=640', CONTAINER, 'node', '-e', package_script], capture_output=True, text=True, timeout=10)
    if versions.returncode == 0:
        result['runtime']['actual_packages'] = json.loads(versions.stdout)
    else:
        result['runtime']['package_read_error'] = versions.stderr[:500]
    status, owner = request('/rest/owner/setup', {'email': 'test@example.com', 'firstName': 'Nested',
                           'lastName': 'Lab', 'password': secrets.token_urlsafe(24) + 'aA1!'}, public=False)
    assert status == 200, ('owner setup', status, owner)
    status, key = request('/rest/api-keys', {'label': 'synthetic-nested-identity-lab', 'expiresAt': int(time.time()) + 1800,
                         'scopes': ['workflow:create', 'workflow:read', 'workflow:activate', 'execution:read', 'execution:list']}, public=False)
    assert status == 200, ('API key creation', status, key)
    KEY = key['data']['rawApiKey']
    result['status'] = 'running'
    progress('server_ready')
    control = run_case(1, collector.server_port)
    if args.expect == 'repaired':
        assert control['passed'], 'Repaired nested branch1 acceptance failed'
    else:
        assert control['identity_passed'], 'Independent nested branch1 HTTP control failed'
    candidate = run_case(2, collector.server_port)
    if args.expect == 'repaired':
        assert candidate['passed'], 'Repaired nested branch2 acceptance failed'
    result['acceptance_passed'] = control['passed'] and candidate['passed']
    result['json_only_equal'] = control['json_projection'] == candidate['json_projection']
    result['business_node_count'] = sum(len(v) for v in control['json_projection'].values())
    result['native_wrong_recipient_counterexample'] = (result['json_only_equal'] and not candidate['identity_passed']
                                                       and bool(candidate['unexpected_recipients']))
    result['status'] = 'complete'
    progress('experiment_complete', json_only_equal=result['json_only_equal'],
             native_wrong_recipient_counterexample=result['native_wrong_recipient_counterexample'])
except Exception as error:
    result['status'] = 'failed'
    result['error'] = str(error)
    progress('failed', error=str(error)[:1200])
    traceback.print_exc()
finally:
    signal.alarm(0)
    result['resource_usage_before_stop'] = cgroup_usage()
    stop = subprocess.run(['docker', 'stop', '--time', '15', CONTAINER], capture_output=True, text=True, timeout=30)
    result['docker_stop_exit'] = stop.returncode
    if SERVER and SERVER.poll() is None:
        try:
            SERVER.wait(timeout=10)
        except subprocess.TimeoutExpired:
            killed = subprocess.run(['docker', 'kill', CONTAINER], capture_output=True, text=True, timeout=10)
            result['docker_kill_exit'] = killed.returncode
            SERVER.wait(timeout=10)
    result['docker_client_exit'] = SERVER.returncode if SERVER else None
    verify = subprocess.run(['docker', 'ps', '-a', '--filter', f'name=^{CONTAINER}$', '--format', '{{.Names}} {{.Status}}'], capture_output=True, text=True, timeout=10)
    result['container_released'] = verify.returncode == 0 and verify.stdout.strip() == ''
    collector.shutdown()
    collector.server_close()
    shutil.rmtree(DATA)
    result['database_released'] = not DATA.exists()
    result['original_services_after'] = existing_services()
    result['original_services_preserved'] = (sorted(result.get('original_services_before', []), key=lambda r: r['Names']) ==
                                             sorted(result['original_services_after'], key=lambda r: r['Names']))
    result['completed_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save('requests.json', received)
    progress('cleaned_up', container_released=result['container_released'], database_released=result['database_released'])
raise SystemExit(0 if result['status'] == 'complete' and result['container_released'] and
                 result['database_released'] and result['original_services_preserved'] else 1)
