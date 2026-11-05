#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Blucca
"""Bounded native each-call + allRuns control, with independent semantic and HTTP oracles.

API/collector scaffolding adapted from experiments/lineage-boundary/run.py.
The parent calls one child per order; its 1.2 trigger returns all terminal runs.
Use the already cached image, its own SQLite DB and a loopback-only receiver.
Round408 adds once/each selection and an optional compiled runtime preload; native API data stays intact.
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
parser.add_argument('--port', type=int, default=5704)
parser.add_argument('--wall-limit', type=int, default=360)
parser.add_argument('--caller-mode', choices=('each', 'once'), default='each')
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
CONTAINER = f'n8n-return-408-{RUN}'
KEY = None
SERVER = None
CGROUP = None
received = []
owner_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
result = {
    'status': 'preparing', 'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'family': args.caller_mode + '-allruns-loop-side-sink', 'container': CONTAINER,
    'runtime': {'image': args.image, 'expected_n8n_version_from_existing_cache_receipt': '2.43.0'},
    'caps': {'cpu': 2, 'memory_bytes': 1536 * 1024**2, 'node_heap_mib': 640,
             'wall_seconds': args.wall_limit, 'startup_seconds': 150,
             'fresh_database': True, 'overlay': PATCH['enabled'], 'saved_data_mutation': False},
    'patch': PATCH, 'expect': args.expect, 'caller_mode': args.caller_mode,
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
    # v1 executes the top-most branch depth-first. The bottom terminal is
    # deferred until the looping branch finishes, so batches reach Return in
    # reverse batch order, retaining each batch's internal order.
    return workflow('allRuns child', [
        node('Start', 'executeWorkflowTrigger', 1.2, {'inputSource': 'passthrough'}),
        node('Lines', 'splitOut', 1, {'fieldToSplitOut': 'order.lines',
            'include': 'allOtherFields', 'options': {'destinationFieldName': 'line'}}, 250),
        node('Loop', 'splitInBatches', 3, {'batchSize': 2, 'options': {}}, 500),
        node('Next Batch', 'noOp', 1, {}, 750),
        node('Return', 'set', 3.4, {'mode': 'raw', 'options': {},
            'jsonOutput': "={{ {orderId: $json.order.id, lineNumber: $json.line.number, sku: $json.line.sku, quantity: $json.line.quantity} }}"}, 750, 300),
    ], [('Start', 0, 'Lines', 0), ('Lines', 0, 'Loop', 0),
        ('Loop', 1, 'Next Batch', 0), ('Next Batch', 0, 'Loop', 0),
        ('Loop', 1, 'Return', 0)])


def make_parent(child_id, collector_port):
    path = f'{RUN}-{args.caller_mode}-allruns'
    webhook = node('Webhook', 'webhook', 2, {'httpMethod': 'POST', 'path': path,
        'responseMode': 'lastNode', 'options': {}})
    webhook['webhookId'] = str(uuid.uuid4())
    return workflow(args.caller_mode + ' allRuns parent', [
        webhook,
        node('Orders', 'splitOut', 1, {'fieldToSplitOut': 'body.orders', 'include': 'noOtherFields',
             'options': {'destinationFieldName': 'order'}}, 250),
        node('Call Child', 'executeWorkflow', 1.2, {'source': 'database', 'mode': args.caller_mode,
            'workflowId': {'__rl': True, 'mode': 'id', 'value': child_id},
            'options': {'waitForSubWorkflow': True}}, 500),
        node('Deliver', 'httpRequest', 4.2, {'method': 'POST',
            'url': f'http://127.0.0.1:{collector_port}/{args.caller_mode}-allruns', 'sendBody': True,
            'contentType': 'json', 'specifyBody': 'json',
            'jsonBody': "={{ {slot: $itemIndex, recipient: $('Orders').item.json.order.id, returnedOrder: $json.orderId, lineNumber: $json.lineNumber, sku: $json.sku, quantity: $json.quantity} }}",
            'options': {}}, 750),
    ], [('Webhook', 0, 'Orders', 0), ('Orders', 0, 'Call Child', 0), ('Call Child', 0, 'Deliver', 0)]), path


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


def independent_oracle(orders, batch_size=2, caller_mode='each'):
    expected = []
    children = []
    flattened = [(caller_index, order, line) for caller_index, order in enumerate(orders) for line in order['lines']]
    groups = ([[(i, order, line) for line in order['lines']] for i, order in enumerate(orders)]
              if caller_mode == 'each' else [flattened])
    for child_index, group in enumerate(groups):
        batches = [group[i:i + batch_size] for i in range(0, len(group), batch_size)]
        terminal = []
        for run, batch_index in enumerate(reversed(range(len(batches)))):
            for item, (caller_index, order, line) in enumerate(batches[batch_index]):
                payload = {'orderId': order['id'], 'lineNumber': line['number'],
                           'sku': line['sku'], 'quantity': line['quantity']}
                row = {'slot': len(expected), 'caller_input_index': caller_index,
                       'child_terminal': {'node': 'Return', 'run': run, 'output': 0, 'item': item},
                       'loop_source_run': batch_index, 'json': payload}
                expected.append(row)
                terminal.append(row)
        caller_indices = [child_index] if caller_mode == 'each' else list(range(len(orders)))
        children.append({'child_group_index': child_index, 'caller_input_indices': caller_indices,
            'caller_input_index': child_index if caller_mode == 'each' else None,
            'input_order_ids': [orders[i]['id'] for i in caller_indices],
            'input_line_count': len(group), 'expected_trigger_input_count': len(caller_indices),
            'expected_terminal_run_count': len(batches), 'expected_loop_run_count': len(batches) + 1,
            'expected_items': terminal})
    return {'ground_truth_source': 'Python input enumeration and explicit v1 loop branch scheduling, before workflow creation',
            'caller_mode': caller_mode, 'batch_size': batch_size, 'input_order_ids': [o['id'] for o in orders],
            'input_line_count': len(flattened), 'expected_child_count': len(groups),
            'expected_return_count': len(expected), 'expected_by_slot': expected, 'children': children,
            'expected_root_order_indices_by_slot': [e['caller_input_index'] for e in expected],
            'return_policy': 'Execute Workflow Trigger 1.2 default allRuns; concatenate terminal runs by executionIndex, per output branch',
            'scheduling_rule': 'Next Batch at y=0 runs depth-first before terminal Return at y=300. Return runs tail batch to head batch; within-batch order is preserved.'}


def coord(execution_id, name, run, output, item):
    return {'execution': str(execution_id), 'node': name, 'run': run, 'output': output, 'item': item}


def run_control(collector_port):
    label = args.caller_mode + '-allruns'
    orders = [{'id': f'order-{letter}', 'sequence': i,
               'lines': [{'number': 100 * (i + 1) + j + 1, 'sku': f'fictional-sku-{j + 1}', 'quantity': j + 1}
                         for j in range(count)]}
              for i, (letter, count) in enumerate(zip('ABC', [5, 3, 1]))]
    oracle = independent_oracle(orders, caller_mode=args.caller_mode)
    save('oracle.json', oracle)
    row = {'case': label, 'oracle': oracle}
    result['cases'].append(row)
    progress('case_started', case=label)
    child = make_child()
    child_id = publish(child)
    parent, path = make_parent(child_id, collector_port)
    parent_id = publish(parent)
    row['workflow_ids'] = {'parent': parent_id, 'child': child_id}
    save('workflows.json', {'parent': parent, 'child': child, 'body': {'orders': orders}})
    row['webhook_attempt_statuses'] = []
    for _ in range(6):
        status, response = request('/webhook/' + path, {'orders': orders}, public=False, with_owner_cookie=False)
        row['webhook_attempt_statuses'].append(status)
        if status != 404 or 'not registered' not in str(response):
            break
        time.sleep(.5)
    row['http_status'], row['response'] = status, response
    assert status != 404, ('webhook registration', status, response)
    saved_parent = persisted_execution(parent_id)
    save('parent-execution.json', saved_parent)
    row['execution_statuses'] = {'parent': saved_parent['status']}
    call_runs = saved_parent['data']['resultData']['runData'].get('Call Child', [])
    assert len(call_runs) == 1, ('native call run count', len(call_runs))
    call = call_runs[0]
    row['caller_run_metadata'] = call.get('metadata')
    outputs = call.get('data', {}).get('main', [])
    groups = {}
    if args.caller_mode == 'once':
        edge = call.get('metadata', {}).get('subExecution')
        assert edge and edge.get('executionId'), ('once call edge', call.get('metadata'))
        groups[str(edge['executionId'])] = {'edge': edge, 'outputs': []}
    for output, items in enumerate(outputs):
        for item, value in enumerate(items or []):
            edge = call.get('metadata', {}).get('subExecution') if args.caller_mode == 'once' else value.get('metadata', {}).get('subExecution')
            assert edge and edge.get('executionId'), ('native return edge', output, item)
            identifier = str(edge['executionId'])
            group = groups.setdefault(identifier, {'edge': edge, 'outputs': []})
            group['outputs'].append({'coord': coord(saved_parent['id'], 'Call Child', 0, output, item), 'value': value})
    assert len(groups) == oracle['expected_child_count'], ('all child acquisition', call.get('metadata'), len(groups))
    if args.caller_mode == 'each':
        assert call.get('metadata', {}).get('subExecutionsCount') == len(groups), ('each child count', call.get('metadata'))
    row['children'] = []
    checks = {'execution_statuses': saved_parent['status'] == 'success', 'input_indices': True,
              'terminal_runs': True, 'terminal_sources': True, 'terminal_json_order': True,
              'caller_pair_indices': True, 'child_parent_edges': True}
    actual_coordinates = []
    for identifier, group in groups.items():
        saved_child = read_execution(identifier)
        assert str(saved_child['workflowId']) == str(group['edge']['workflowId']), ('child workflow edge', identifier)
        start = saved_child['data']['resultData']['runData']['Start'][0]
        entered = start['data']['main'][0]
        assert len(entered) == (1 if args.caller_mode == 'each' else len(orders)), ('native trigger item count', identifier, len(entered))
        original_index = entered[0].get('index') if args.caller_mode == 'each' else 0
        assert isinstance(original_index, int) and 0 <= original_index < len(orders), ('child caller index', identifier, original_index)
        save(f'child-{original_index}-execution.json', saved_child)
        row['execution_statuses'][f'child-{original_index}'] = saved_child['status']
        reverse = start.get('metadata', {}).get('parentExecution', {})
        checks['child_parent_edges'] &= (str(reverse.get('executionId')) == str(saved_parent['id']) and
                                         str(reverse.get('workflowId')) == str(saved_parent['workflowId']) and
                                         reverse.get('shouldResume') is True)
        checks['execution_statuses'] &= saved_child['status'] == 'success'
        expected_inputs = [{'order': orders[original_index]}] if args.caller_mode == 'each' else [{'order': order} for order in orders]
        checks['input_indices'] &= [item['json'] for item in entered] == expected_inputs
        expected_child = oracle['children'][original_index]
        data = saved_child['data']['resultData']
        runs = data['runData'].get('Return', [])
        checks['terminal_runs'] &= (data.get('lastNodeExecuted') == 'Return' and
                                   len(runs) == expected_child['expected_terminal_run_count'] and
                                   len(data['runData'].get('Loop', [])) == expected_child['expected_loop_run_count'])
        flattened = []
        terminal_runs = []
        for run, task in sorted(enumerate(runs), key=lambda pair: pair[1].get('executionIndex', 0)):
            branch = task.get('data', {}).get('main', [[]])[0] or []
            terminal_runs.append({'run': run, 'executionIndex': task.get('executionIndex'),
                                  'source': task.get('source'), 'item_count': len(branch)})
            for item, value in enumerate(branch):
                flattened.append({'coord': coord(saved_child['id'], 'Return', run, 0, item),
                                  'json': value['json'], 'pairedItem': value.get('pairedItem'),
                                  'source': task.get('source')})
        expected_json = [r['json'] for r in expected_child['expected_items']]
        checks['terminal_json_order'] &= [r['json'] for r in flattened] == expected_json
        checks['terminal_sources'] &= (len(flattened) == len(expected_child['expected_items']) and
            all(a['coord'] == coord(identifier, **{'name': e['child_terminal']['node'],
                'run': e['child_terminal']['run'], 'output': e['child_terminal']['output'], 'item': e['child_terminal']['item']}) and
                a['source'] == [{'previousNode': 'Loop', 'previousNodeRun': e['loop_source_run'], 'previousNodeOutput': 1}]
                for a, e in zip(flattened, expected_child['expected_items'])))
        returned = group['outputs']
        checks['caller_pair_indices'] &= (len(returned) == len(expected_child['expected_items']) and all(
            pair_indices(r['value'].get('pairedItem')) == [e['caller_input_index']]
            for r, e in zip(returned, expected_child['expected_items'])))
        checks['terminal_json_order'] &= [r['value']['json'] for r in returned] == expected_json
        for parent_return, child_return, expected_item in zip(returned, flattened, expected_child['expected_items']):
            actual_coordinates.append({'caller': parent_return['coord'], 'terminal': child_return['coord'],
                'root': coord(saved_parent['id'], 'Orders', 0, 0, expected_item['caller_input_index']),
                'root_source': 'pre-creation Python oracle; actual saved graph roots are recorded separately in graph-audit.json',
                'caller_pairedItem': parent_return['value'].get('pairedItem'), 'json': child_return['json']})
        row['children'].append({'execution_id': identifier, 'workflow_id': str(saved_child['workflowId']),
            'caller_input_index': original_index if args.caller_mode == 'each' else None,
            'child_group_index': original_index, 'caller_input_indices': expected_child['caller_input_indices'],
            'saved_start_indices': [item.get('index') for item in entered], 'saved_start_index': entered[0].get('index'),
            'saved_start_pairedItem': entered[0].get('pairedItem'), 'reverse_edge': reverse,
            'lastNodeExecuted': data.get('lastNodeExecuted'), 'terminal_runs': terminal_runs,
            'return_item_count': len(flattened), 'caller_return_count': len(returned)})
    # This is a semantic + HTTP acceptance oracle, not a provenance resolver.
    actual_json = [v['json'] for branch in outputs for v in (branch or [])]
    checks['return_count'] = len(actual_json) == oracle['expected_return_count']
    checks['parent_return_order'] = actual_json == [e['json'] for e in oracle['expected_by_slot']]
    row['requests'] = [r['body'] for r in received if r['path'] == '/' + label]
    delivered = sorted(row['requests'], key=lambda r: r.get('slot', -1))
    expected_requests = [{'slot': e['slot'], 'recipient': e['json']['orderId'], 'returnedOrder': e['json']['orderId'],
                          'lineNumber': e['json']['lineNumber'], 'sku': e['json']['sku'], 'quantity': e['json']['quantity']}
                         for e in oracle['expected_by_slot']]
    checks['http_delivery'] = (status == 200 and delivered == expected_requests)
    paths = [OUT / 'parent-execution.json'] + [OUT / f"child-{child['child_group_index']}-execution.json" for child in row['children']]
    graph = graph_audit(paths, label)
    row['graph_audit'] = graph
    findings = [f for b in graph.get('boundaries', []) for f in b.get('findings', [])]
    checks['graph_consistent'] = (graph.get('status') == 'consistent' and
        graph.get('boundary_count') == oracle['expected_child_count'] and graph.get('checked_items') == oracle['expected_return_count'])
    checks['graph_roots_match_input_oracle'] = (len(findings) == oracle['expected_return_count'] and all(
        f.get('roots') == [coord(saved_parent['id'], 'Orders', 0, 0, oracle['expected_by_slot'][f['caller']['item']]['caller_input_index'])]
        for f in findings))
    row['checks'] = checks
    row['passed'] = all(checks.values())
    row['actual_return_count'] = len(actual_json)
    row['actual_return_json_by_slot'] = actual_json
    row['actual_coordinates'] = actual_coordinates
    save('coordinates.json', actual_coordinates)
    save('receipt.json', row)
    progress('case_completed', case=label, passed=row['passed'], return_count=len(actual_json), checks=checks)
    return row


def existing_services():
    p = subprocess.run(['docker', 'ps', '--filter', 'label=com.docker.compose.project=zetaris',
                        '--format', '{{json .}}'], capture_output=True, text=True, timeout=10)
    assert p.returncode == 0, ('existing service snapshot', p.stderr[:1000])
    return [{k: row.get(k) for k in ('ID', 'Names', 'State', 'HealthStatus')}
            for row in (json.loads(line) for line in p.stdout.splitlines() if line.strip())]


def controller_interrupted(signum, _frame):
    raise InterruptedError(f'Controller interrupted by {signal.Signals(signum).name}')


def wall_expired(*_):
    raise TimeoutError(f'Native batch wall cap reached: {args.wall_limit} seconds')


def render_report():
    row = result['cases'][0] if result['cases'] else {}
    lines = [f"# Native {args.caller_mode} + allRuns control", '',
             f"Status: **{result['status']}**; semantic, pair, graph and HTTP acceptance: **{row.get('passed', False)}**.", '',
             f"Original child graph: Trigger1.2/allRuns → Lines → Loop(batch2) → Next Batch and Return; caller mode: {args.caller_mode}.",
             'The Python oracle is saved before workflow creation. Whole returned JSON is compared independently of pairing.',
             f"Returned count: {row.get('actual_return_count')}; expected: 9; native child executions: {len(row.get('children', []))}.", '',
             '## Acceptance checks', '']
    lines.extend(f"- {name}: {passed}" for name, passed in row.get('checks', {}).items())
    lines.extend(['', '## Durable evidence and resources', '',
        'oracle.json, workflows.json, parent-execution.json, child-*-execution.json, receipt.json, *-graph-audit.json, coordinates.json and requests.json retain the native evidence.',
        'coordinates.json root fields are the pre-created business oracle; graph-audit roots are read from actual saved provenance.',
        f"Container released: {result.get('container_released')}. Dedicated SQLite released: {result.get('database_released')}. Original four services preserved: {result.get('original_services_preserved')}.",
        f"Cap: 2 CPU, 1536 MiB RAM, Node heap 640 MiB, {args.wall_limit}-second wall batch. Runtime image uses --pull never.",
        f"Remote output checkpoint: `{OUT}`.", ''])
    if result.get('error'):
        lines.extend(['## Failure', '', str(result['error']), ''])
    (OUT / 'report.md').write_text('\n'.join(lines))


collector = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Collector)
threading.Thread(target=collector.serve_forever, daemon=True).start()
signal.signal(signal.SIGALRM, wall_expired)
# An interrupted controller still writes its receipt and releases its own lab.
signal.signal(signal.SIGTERM, controller_interrupted)
signal.signal(signal.SIGINT, controller_interrupted)
signal.alarm(args.wall_limit)
try:
    result['original_services_before'] = existing_services()
    allow = ('executeWorkflowTrigger', 'executeWorkflow', 'webhook', 'set', 'noOp', 'splitInBatches', 'splitOut', 'httpRequest')
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
    status, owner = request('/rest/owner/setup', {'email': 'test@example.com', 'firstName': 'Return',
                           'lastName': 'Lab', 'password': secrets.token_urlsafe(24) + 'aA1!'}, public=False)
    assert status == 200, ('owner setup', status, owner)
    status, key = request('/rest/api-keys', {'label': 'synthetic-each-allruns-lab', 'expiresAt': int(time.time()) + 1800,
                         'scopes': ['workflow:create', 'workflow:read', 'workflow:activate', 'execution:read', 'execution:list']}, public=False)
    assert status == 200, ('API key creation', status, key)
    KEY = key['data']['rawApiKey']
    result['status'] = 'running'
    progress('server_ready')
    control = run_control(collector.server_port)
    result['acceptance_passed'] = control['passed']
    if args.expect == 'repaired' or args.caller_mode == 'each':
        assert control['passed'], 'Native return control acceptance failed'
    else:
        result['baseline_outcome'] = ('parent-error' if control['execution_statuses']['parent'] != 'success' else
            'correct-root' if control['passed'] else 'wrong-root-or-contract')
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
    result['original_services_preserved'] = (sorted(result.get('original_services_before', []), key=lambda r: r['Names']) ==
                                             sorted(result['original_services_after'], key=lambda r: r['Names']))
    result['completed_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save('requests.json', received)
    progress('cleaned_up', container_released=result['container_released'], database_released=result['database_released'])
    render_report()
raise SystemExit(0 if result['status'] == 'complete' and result['container_released'] and
                 result['database_released'] and result['original_services_preserved'] else 1)
