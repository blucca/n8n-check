"""Actual unpatched Hermes v0.23.0 load + AIAgent execution; all inputs are fictional.

The model boundary is blocked by the documented pre_llm_call directive, so this
is an execution-contract gate. LLM quality/demo is a later, separate investment.
"""
import inspect
import json
import os
from pathlib import Path
from types import SimpleNamespace

from hermes_cli.plugins import discover_plugins, get_plugin_command_handler
from model_tools import handle_function_call
from run_agent import AIAgent
from hermes_state import SessionDB
from tools.delegate_tool import delegate_task

discover_plugins()
root = Path(os.environ['HERMES_HOME']).parent
db = SessionDB(root / 'probe-state-v2.db')
source = root / 'selected-source.json'
source.write_text(json.dumps({'job':'northwind-renewal', 'customer_id':'nw-41'}))
a = AIAgent(base_url='http://127.0.0.1:9/v1', api_key='offline-native-probe',
            provider='openai', model='gpt-4.1-mini', enabled_toolsets=['sourcebind'],
            skip_memory=True, skip_background_review=True, skip_context_files=True,
            quiet_mode=True, pass_session_id=True, session_db=db, platform="cli")
print('AGENT_READY', a.session_id, flush=True)
print('RUN_CONVERSATION_SIGNATURE', inspect.signature(a.run_conversation), flush=True)
turn = a.run_conversation('SOURCEBIND_NATIVE_OFFLINE_GATE')
print('TURN_EXIT', turn.get('turn_exit_reason'), a.session_id, flush=True)
assert turn.get('turn_exit_reason') == 'blocked_by_plugin_pre_llm_call', turn
assert a.session_id, 'native session missing'

def execute(name, args):
    message = SimpleNamespace(tool_calls=[SimpleNamespace(
        id='sourcebind-native-' + name, type='function',
        function=SimpleNamespace(name=name, arguments=json.dumps(args)))])
    messages=[]
    a._execute_tool_calls(message, messages, a.session_id)
    assert messages and messages[-1]['role'] == 'tool', messages
    return json.loads(messages[-1]['content'])

results={'release':'v0.23.0', 'sha':'2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19',
         'native_agent_session_id':a.session_id, 'turn_exit_reason':turn['turn_exit_reason']}
results['unbound_valid_wrong_customer']=execute('sourcebind_demo_update', {'job':'northwind-renewal', 'customer_id':'ct-91'})
assert results['unbound_valid_wrong_customer'].get('ok') is True, results['unbound_valid_wrong_customer']
cmd = get_plugin_command_handler('sourcebind')
assert cmd is not None
results['bind']=cmd('northwind-renewal ' + str(source), session_id=a.session_id, platform='cli')
results['blocked_wrong_customer']=execute('sourcebind_demo_update', {'job':'northwind-renewal', 'customer_id':'ct-91'})
results['allowed_current_customer']=execute('sourcebind_demo_update', {'job':'northwind-renewal', 'customer_id':'nw-41'})
results['blocked_wrong_job']=execute('sourcebind_demo_update', {'job':'contoso-renewal', 'customer_id':'nw-41'})
assert 'error' in results['blocked_wrong_customer']
assert 'error' in results['blocked_wrong_job']
assert results['allowed_current_customer']['ok'] is True
source.write_text(json.dumps({'job':'northwind-renewal', 'customer_id':'nw-42'}))
results['blocked_stale_source']=execute('sourcebind_demo_update', {'job':'northwind-renewal', 'customer_id':'nw-41'})
results['allowed_refreshed_source']=execute('sourcebind_demo_update', {'job':'northwind-renewal', 'customer_id':'nw-42'})
assert 'error' in results['blocked_stale_source']
assert results['allowed_refreshed_source']['ok'] is True
results['current']=execute('sourcebind_current', {})
results['documented_later_conversation_id_present']=bool(results['current']['native_context'].get('conversation_id'))
results['native_handler_session_id_present']=bool(results['current']['native_context'].get('session_id'))
results['native_delegate']=json.loads(delegate_task(goal='SOURCEBIND_NATIVE_OFFLINE_GATE',
    parent_agent=a, background=False, max_iterations=1))
child_info=execute('sourcebind_current', {})['last_child']
assert child_info and child_info['parent'] == a.session_id, child_info
child_id=child_info['child']
results['child_identity']=child_info
results['child_blocked_wrong_customer']=json.loads(handle_function_call('sourcebind_demo_update',
    {'job':'northwind-renewal','customer_id':'ct-91'}, session_id=child_id, task_id=child_id))
results['child_allowed_current_customer']=json.loads(handle_function_call('sourcebind_demo_update',
    {'job':'northwind-renewal','customer_id':'nw-42'}, session_id=child_id, task_id=child_id))
assert 'error' in results['child_blocked_wrong_customer']
assert results['child_allowed_current_customer']['ok'] is True
results['child_scope']=json.loads(handle_function_call('sourcebind_current', {},
    session_id=child_id, task_id=child_id))['scope_id']
assert results['child_scope'] == results['current']['binding']['scope_id']
# Supply synthetic cached-summary input; native compressor functions stay unchanged.
from agent.prepared_compaction import PreparedCompaction, PreparedSummary, prefix_identities
cc=a.context_compressor
a._ensure_db_session()
a.compression_in_place=False
a.compression_checkpoint_required=False
a._compression_feasibility_checked=True
a._compression_feasibility_route=None
cc.context_length=100_000
cc.threshold_tokens=50_000
cc.tail_token_budget=10
cc.bind_session_state(db, a.session_id)
old_id=a.session_id
messages=[{'role':'system','content':'system prompt'}]
filler=' '.join(['context'] * 200)
for i in range(10):
    messages.extend([{'role':'user','content':f'user message {i} {filler}'},
                     {'role':'assistant','content':f'assistant reply {i} {filler}'}])
working, _, start, end=cc._plan_compaction_window(messages)
assert start < end
body='Cached fixture summary: ten exchanges completed; continue northwind-renewal.'
cc.prepared_compaction=PreparedCompaction()
cc.prepared_compaction._entry=PreparedSummary(session_id=old_id, compress_start=start, compress_end=end,
    identities=prefix_identities(working,end), summary=cc._with_summary_prefix(body), body=body)
compacted, _=a._compress_context(messages, 'system prompt', approx_tokens=80_000,
    force=False, trigger='pre_api')
assert a.session_id != old_id
assert db.get_session(a.session_id)['parent_session_id'] == old_id
results['rotation']=execute('sourcebind_current', {})
assert results['rotation']['last_rotation'] == {'old':old_id,'new':a.session_id}
assert results['rotation']['scope_id'] == results['current']['binding']['scope_id']
results['rotated_blocked_wrong_customer']=execute('sourcebind_demo_update',
    {'job':'northwind-renewal','customer_id':'ct-91'})
results['rotated_allowed_current_customer']=execute('sourcebind_demo_update',
    {'job':'northwind-renewal','customer_id':'nw-42'})
assert 'error' in results['rotated_blocked_wrong_customer']
assert results['rotated_allowed_current_customer']['ok'] is True
# A fresh native agent with a parent reference is distinct until an explicit inheritance event.
b=AIAgent(base_url='http://127.0.0.1:9/v1', api_key='offline-native-probe', provider='openai',
    model='gpt-4.1-mini', enabled_toolsets=['sourcebind'], skip_memory=True,
    skip_background_review=True, skip_context_files=True, quiet_mode=True, pass_session_id=True,
    session_db=db, parent_session_id=old_id, platform='cli')
b.run_conversation('SOURCEBIND_NATIVE_OFFLINE_GATE')
results['independent_scope']=json.loads(handle_function_call('sourcebind_current', {},
    session_id=b.session_id, task_id=b.session_id))['scope_id']
assert results['independent_scope'] == b.session_id
assert results['independent_scope'] != results['current']['binding']['scope_id']
b.close()
results['gate']='pass: native current-source, job, delegation, rotation, independent scope'
results['scope_contract']='Public v0.23.0 subagent_start and post_compaction map actual session IDs; no task label inference.'
results['fixture_inference']='pre_llm_call blocks turns; compaction consumes a synthetic native prepared-summary input'

(root / 'sourcebind-native-result.json').write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2), flush=True)
a.close()
