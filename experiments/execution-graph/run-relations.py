#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Blucca
"""Bounded native composite-key customer-recipient control and wrong single-key join.

Standard nodes aggregate both complete roles before a waiting passthrough child.
An independent Python oracle fixes allowed recipients before workflow creation.
The official cached runtime uses its own SQLite DB and loopback HTTP receiver.
API/collector/resource scaffolding adapted from run-nested.py.
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
parser.add_argument('--port', type=int, default=5708)
parser.add_argument('--wall-limit', type=int, default=300)
args = parser.parse_args()
OUT = args.output.resolve()
OUT.mkdir(parents=True, exist_ok=False)
DATA = OUT / 'data'
DATA.mkdir(mode=0o700)
BASE = f'http://127.0.0.1:{args.port}'
RUN = uuid.uuid4().hex[:10]
CONTAINER = f'n8n-relations-402-{RUN}'
KEY = None
SERVER = None
CGROUP = None
received = []
owner_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
result = {
    'status': 'preparing', 'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'family': 'composite-key-customer-recipient', 'container': CONTAINER,
    'runtime': {'image': args.image, 'expected_n8n_version_from_existing_cache_receipt': '2.43.0'},
    'caps': {'cpu': 2, 'memory_bytes': 1536 * 1024**2, 'node_heap_mib': 640,
             'wall_seconds': args.wall_limit, 'startup_seconds': 150,
             'fresh_database': True, 'overlay': False, 'saved_data_mutation': False},
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


def workflow(name, nodes, edges):
    connections = {}
    for source, output, target, inlet in edges:
        outputs = connections.setdefault(source, {'main': []})['main']
        while len(outputs) <= output:
            outputs.append([])
        outputs[output].append({'node': target, 'type': 'main', 'index': inlet})
    return {'name': f'{RUN} {name}', 'settings': {'executionOrder': 'v1'},
            'nodes': nodes, 'connections': connections}


def make_child():
    return workflow('plain passthrough child', [
        node('Start', 'executeWorkflowTrigger', 1.1, {'inputSource': 'passthrough'}),
        node('Return', 'noOp', 1, {}, 250),
    ], [('Start', 0, 'Return', 0)])


def make_parent(child_id, label, collector_port):
    path = f'{RUN}-relations-{label}'
    webhook = node('Webhook', 'webhook', 2, {'httpMethod': 'POST', 'path': path,
        'responseMode': 'lastNode', 'options': {}})
    webhook['webhookId'] = str(uuid.uuid4())
    condition = 'x.customer.id === $json.selectedOrder.order.customerId'
    if label == 'full-key':
        condition += ' && x.customer.tenantId === $json.selectedOrder.order.tenantId'
    recipient = '={{ {slot: $itemIndex, subjectId: $json.selectedOrder.order.id, recipient: $json.customers.find(x => ' + condition + ').customer.email} }}'
    aggregate = {'aggregate': 'aggregateAllItemData', 'include': 'allFields', 'options': {}}
    return workflow(f'relations {label}', [
        webhook,
        node('Orders', 'splitOut', 1, {'fieldToSplitOut': 'body.orders', 'include': 'noOtherFields',
             'options': {'destinationFieldName': 'order'}}, 200),
        node('Customers', 'splitOut', 1, {'fieldToSplitOut': 'body.customers', 'include': 'noOtherFields',
             'options': {'destinationFieldName': 'customer'}}, 200, 250),
        node('Orders Aggregate', 'aggregate', 1, {**aggregate, 'destinationFieldName': 'orders'}, 400),
        node('Customers Aggregate', 'aggregate', 1, {**aggregate, 'destinationFieldName': 'customers'}, 400, 250),
        node('Join Envelope', 'merge', 3.2, {'mode': 'combine', 'combineBy': 'combineByPosition', 'options': {}}, 600),
        node('Select Order', 'splitOut', 1, {'fieldToSplitOut': 'orders', 'include': 'allOtherFields',
             'options': {'destinationFieldName': 'selectedOrder'}}, 800),
        node('Prepare Recipient', 'set', 3.4, {'mode': 'raw', 'jsonOutput': recipient, 'options': {}}, 1000),
        node('Call Delivery', 'executeWorkflow', 1.2, {'source': 'database', 'mode': 'once',
            'workflowId': {'__rl': True, 'mode': 'id', 'value': child_id},
            'options': {'waitForSubWorkflow': True}}, 1200),
        node('Deliver', 'httpRequest', 4.2, {'method': 'POST',
            'url': f'http://127.0.0.1:{collector_port}/{label}', 'sendBody': True,
            'contentType': 'json', 'specifyBody': 'json', 'jsonBody': '={{ $json }}', 'options': {}}, 1400),
    ], [('Webhook', 0, 'Orders', 0), ('Webhook', 0, 'Customers', 0),
        ('Orders', 0, 'Orders Aggregate', 0), ('Customers', 0, 'Customers Aggregate', 0),
        ('Orders Aggregate', 0, 'Join Envelope', 0), ('Customers Aggregate', 0, 'Join Envelope', 1),
        ('Join Envelope', 0, 'Select Order', 0), ('Select Order', 0, 'Prepare Recipient', 0),
        ('Prepare Recipient', 0, 'Call Delivery', 0), ('Call Delivery', 0, 'Deliver', 0)]), path


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


def cgroup_usage():
    if CGROUP is None:
        return {'status': 'cgroup-path-unavailable'}
    observed = {'cgroup_path': str(CGROUP)}
    for name in ('cpu.stat', 'memory.current', 'memory.peak', 'memory.events', 'cpu.max', 'memory.max'):
        p = CGROUP / name
        if p.exists():
            observed[name] = p.read_text().strip()
    return observed


def independent_oracle():
    customers = [{'tenantId': tenant, 'id': customer_id, 'email': f'{tenant}-{customer_id}@example.test'}
                 for tenant in ('amber', 'blue') for customer_id in ('c1', 'c2')]
    orders = [{'id': f'order-{i}', 'tenantId': customer['tenantId'], 'customerId': customer['id']}
              for i, customer in enumerate(customers)]
    expected = []
    for slot, order in enumerate(orders):
        matching = [(i, c) for i, c in enumerate(customers)
                    if c['tenantId'] == order['tenantId'] and c['id'] == order['customerId']]
        assert len(matching) == 1, 'Full customer key cardinality is exactly one'
        i, customer = matching[0]
        expected.append({'slot': slot, 'subjectId': order['id'], 'recipient': customer['email'],
                         'order_index': slot, 'customer_index': i})
    return {'ground_truth_source': 'Independent Python enumeration of frozen input relations before workflow creation',
            'rule': 'Each input order acts on the unique customer matching (tenantId, customerId); input order fixes HTTP slot',
            'orders': orders, 'customers': customers, 'expected': expected}


def run_control(collector_port, label, oracle):
    row = {'case': label}
    result['cases'].append(row)
    progress('case_started', case=label)
    child = make_child(); child_id = publish(child)
    parent, path = make_parent(child_id, label, collector_port); parent_id = publish(parent)
    row['workflow_ids'] = {'parent': parent_id, 'child': child_id}
    save(f'{label}-workflows.json', {'parent': parent, 'child': child, 'body': {
        'orders': oracle['orders'], 'customers': oracle['customers']}})
    attempts = []
    for _ in range(6):
        status, response = request('/webhook/' + path, {'orders': oracle['orders'], 'customers': oracle['customers']},
                                   public=False, with_owner_cookie=False)
        attempts.append(status)
        if status != 404 or 'not registered' not in str(response):
            break
        time.sleep(.5)
    row['webhook_attempt_statuses'] = attempts
    row['http_status'] = status
    saved_parent = persisted_execution(parent_id)
    save(f'{label}-parent-execution.json', saved_parent)
    assert saved_parent['status'] == 'success', ('parent execution', label, saved_parent['data']['resultData'].get('error'))
    call = saved_parent['data']['resultData']['runData']['Call Delivery'][0]
    edge = call['metadata']['subExecution']
    saved_child = read_execution(edge['executionId'])
    save(f'{label}-child-execution.json', saved_child)
    reverse = saved_child['data']['resultData']['runData']['Start'][0]['metadata']['parentExecution']
    checks = {'successful_executions': saved_child['status'] == 'success' and status == 200,
              'bilateral_call_ids': str(saved_child['workflowId']) == str(edge['workflowId']) and
                  str(reverse['executionId']) == str(saved_parent['id']) and
                  str(reverse['workflowId']) == str(saved_parent['workflowId']) and reverse['shouldResume'] is True}
    target = [item['json'] for item in call['data']['main'][0]]
    expected = [{k: item[k] for k in ('slot', 'subjectId', 'recipient')} for item in oracle['expected']]
    observed = sorted([r['body'] for r in received if r['path'] == '/' + label], key=lambda r: r['slot'])
    checks['http_matches_saved_effects'] = observed == target and len(target) == len(expected)
    checks['subject_and_slot'] = [(r['slot'], r['subjectId']) for r in observed] == [(r['slot'], r['subjectId']) for r in expected]
    mismatch_slots = [want['slot'] for want, got in zip(expected, observed) if want['recipient'] != got['recipient']]
    checks['independent_recipient_outcome'] = mismatch_slots == ([] if label == 'full-key' else [2, 3])
    row.update({'execution_statuses': {'parent': saved_parent['status'], 'child': saved_child['status']},
        'parent_execution': str(saved_parent['id']), 'child_execution': str(saved_child['id']),
        'requests': observed, 'expected_requests': expected, 'recipient_mismatch_slots': mismatch_slots,
        'checks': checks, 'passed': all(checks.values())})
    contract = {'version': 1,
        'orders': {'execution': str(saved_parent['id']), 'node': 'Orders', 'run': 0, 'output': 0, 'record_path': ['order']},
        'customers': {'execution': str(saved_parent['id']), 'node': 'Customers', 'run': 0, 'output': 0, 'record_path': ['customer']},
        'effects': {'execution': str(saved_parent['id']), 'node': 'Call Delivery', 'run': 0, 'output': 0}}
    save(f'{label}-contract.json', contract)
    save(f'{label}-http-observations.json', observed)
    save(f'{label}-receipt.json', row)
    progress('case_completed', case=label, passed=row['passed'], mismatch_slots=mismatch_slots)
    return row


def existing_services():
    p = subprocess.run(['docker', 'ps', '--filter', 'label=com.docker.compose.project=zetaris',
                        '--format', '{{json .}}'], capture_output=True, text=True, timeout=10)
    assert p.returncode == 0, ('existing service snapshot', p.stderr[:1000])
    return [{k: row.get(k) for k in ('ID', 'Names', 'State', 'HealthStatus')}
            for row in (json.loads(line) for line in p.stdout.splitlines() if line.strip())]


def wall_expired(*_):
    raise TimeoutError(f'Native batch wall cap reached: {args.wall_limit} seconds')


def render_report():
    (OUT / 'report.md').write_text('# Composite-key recipient native control\n\n' +
        'Fictional inputs; standard n8n nodes; independent Python relation oracle; actual loopback HTTP.\n\n' +
        json.dumps(result, indent=2) + '\n')


collector = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Collector)
threading.Thread(target=collector.serve_forever, daemon=True).start()
signal.signal(signal.SIGALRM, wall_expired)
signal.alarm(args.wall_limit)
try:
    result['original_services_before'] = existing_services()
    allow = ('executeWorkflowTrigger', 'executeWorkflow', 'webhook', 'noOp', 'splitOut', 'aggregate', 'merge', 'set', 'httpRequest')
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
        'NODE_OPTIONS': '--max-old-space-size=640', 'TMPDIR': '/lab',
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
    versions = subprocess.run(['docker', 'exec', CONTAINER, 'node', '-e', package_script], capture_output=True, text=True, timeout=10)
    if versions.returncode == 0:
        result['runtime']['actual_packages'] = json.loads(versions.stdout)
    else:
        result['runtime']['package_read_error'] = versions.stderr[:500]
    status, owner = request('/rest/owner/setup', {'email': 'test@example.com', 'firstName': 'Batch',
                           'lastName': 'Lab', 'password': secrets.token_urlsafe(24) + 'aA1!'}, public=False)
    assert status == 200, ('owner setup', status, owner)
    status, key = request('/rest/api-keys', {'label': 'synthetic-relations-lab', 'expiresAt': int(time.time()) + 1800,
                         'scopes': ['workflow:create', 'workflow:read', 'workflow:activate', 'execution:read', 'execution:list']}, public=False)
    assert status == 200, ('API key creation', status, key)
    KEY = key['data']['rawApiKey']
    result['status'] = 'running'
    progress('server_ready')
    oracle = independent_oracle()
    save('oracle.json', oracle)
    for label in ('full-key', 'single-key'):
        control = run_control(collector.server_port, label, oracle)
        assert control['passed'], 'Independent relation/HTTP acceptance failed' 
    result['status'] = 'complete'
    progress('experiment_complete', passed=control['passed'])
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
    result['original_services_preserved'] = (sorted(result['original_services_before'], key=lambda r: r['Names']) ==
                                             sorted(result['original_services_after'], key=lambda r: r['Names']))
    result['completed_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save('requests.json', received)
    progress('cleaned_up', container_released=result['container_released'], database_released=result['database_released'])
    render_report()
raise SystemExit(0 if result['status'] == 'complete' and result['container_released'] else 1)
