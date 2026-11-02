import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { callAction, useActionQuery } from '@agent-native/core/client/hooks';
import { readClientAppState, setClientAppState } from '@agent-native/core/client/application-state';
import './workbench.css';

type Variant = 'original' | 'repaired' | 'missing';
type Selection = { variant: Variant; output: number; item: number };
const names = { original: 'Original call', repaired: 'Repaired call', missing: 'Missing export' };
const prompts = ['Explain this item’s real source', 'Compare with the repair and focus it', 'Create a release dossier for this item'];
const validVariant = (v: string | null): Variant => v === 'repaired' || v === 'missing' ? v : 'original';
function initialSelection(): Selection {
  const q = new URLSearchParams(location.search);
  return { variant: validVariant(q.get('variant')), output: 0, item: q.get('item') === '1' ? 1 : 0 };
}
function download(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function customer(value: any) { return value?.json?.order?.id?.replace('customer-', 'Customer ') ?? 'Caller item'; }
function Graph({ sample, selected, choose }: { sample: any; selected: number; choose: (item: number) => void }) {
  const rows = sample.audit.findings ?? [];
  const yCaller = (i: number) => 86 + i * 62;
  const yItem = (i: number) => 130 + i * 108;
  const ok = sample.audit.status === 'consistent';
  return <div className="source-canvas">
    <svg viewBox="0 0 660 352" role="img" aria-label="Caller roots and recorded versus derived terminal identity">
      <defs><marker id="root-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,1 L7,4 L0,7" fill="none" stroke="context-stroke" /></marker></defs>
      <text x="24" y="30" className="graph-title">Caller input</text><text x="24" y="52" className="graph-meta">Orders · output 0 · run 0</text>
      <text x="426" y="30" className="graph-title">Child terminal</text><text x="426" y="52" className="graph-meta">{sample.terminal_node} · output 0 · run {sample.terminal_run}</text>
      {rows.map((row: any) => <g key={'links'+row.item} className={selected === row.item ? 'active-links' : 'quiet-links'}>
        {!ok && row.observed.map((ref: any) => <path key={'observed'+ref.item} d={`M188 ${yCaller(ref.item)} C278 ${yCaller(ref.item)},346 ${yItem(row.item)-8},426 ${yItem(row.item)-8}`} className="recorded-line" markerEnd="url(#root-arrow)" />)}
        {row.expected.map((ref: any) => <path key={'derived'+ref.item} d={`M188 ${yCaller(ref.item)} C278 ${yCaller(ref.item)},346 ${yItem(row.item)+8},426 ${yItem(row.item)+8}`} className={ok ? 'consistent-line' : 'derived-line'} markerEnd="url(#root-arrow)" />)}
      </g>)}
      {(sample.input_items.length ? sample.input_items : [0,1,2,3].map(index=>({index,json:null}))).map((root: any) => <g key={root.index}>
        <rect x="24" y={yCaller(root.index)-22} width="164" height="44" rx="9" className="caller-node" />
        <text x="39" y={yCaller(root.index)+5} className="node-number">{root.index}</text><text x="64" y={yCaller(root.index)+5} className="node-name">{customer(root)}</text>
      </g>)}
      {[0,1].map(item => <g key={item} role="button" tabIndex={0} aria-label={`Select terminal item ${item}`} onClick={()=>choose(item)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(item);}}} className="terminal-control">
        <rect x="426" y={yItem(item)-35} width="208" height="70" rx="13" className={selected === item ? 'terminal-node selected-node' : 'terminal-node'} />
        <text x="444" y={yItem(item)-5} className="node-name">Terminal item {item}</text><text x="444" y={yItem(item)+17} className="graph-meta">{ok ? 'Pairing matches ancestry' : rows.length ? 'Recorded source differs' : 'Child runData missing'}</text>
      </g>)}
    </svg>
    <div className="graph-legend">{ok ? <span><i className="line teal" /> Recorded and derived source</span> : <><span><i className="line cyan" /> Derived from child ancestry</span><span><i className="line red" /> Recorded parent pairing</span></>}</div>
  </div>;
}
function RawEvidence({ variant, role, pointer }: { variant: Variant; role: 'parent' | 'child'; pointer?: string }) {
  const { data, error, isPending }: any = useActionQuery('inspect-raw', { variant, role, pointer: pointer ?? '' }, { enabled: !!pointer });
  return <section className="raw-evidence"><h4>{role === 'parent' ? 'Recorded at the parent call' : 'Recorded at the child terminal'}</h4>
    {pointer ? <><code className="pointer">{pointer}</code><pre>{error ? (error as Error).message : isPending ? 'Reading saved evidence…' : JSON.stringify(data?.value, null, 2)}</pre></> : <p className="empty-copy">Export the completed child with full runData to inspect its terminal pairing.</p>}</section>;
}
export default function Workbench() {
  const [selection, setSelection] = useState<Selection>(initialSelection);
  const { variant, item } = selection;
  const { data: sample, isPending, error }: any = useActionQuery('audit-call', { variant });
  const shared = useQuery({ queryKey: ['traceglass-selection'], queryFn: () => readClientAppState<Selection>('selection'), refetchInterval: 1000 });
  const [prompt, setPrompt] = useState(prompts[0]);
  const [answer, setAnswer] = useState<any>(null), [agentError, setAgentError] = useState('');
  const [working, setWorking] = useState(false), [notice, setNotice] = useState('');
  function writeUrl(value: Selection) {
    const url = new URL(location.href); url.searchParams.set('variant', value.variant); url.searchParams.set('item', String(value.item));
    history.replaceState(null, '', url); return url;
  }
  async function select(next: Selection) {
    setSelection(next); const url = writeUrl(next);
    try {
      await setClientAppState('selection', next);
      await setClientAppState('navigation', { view: 'saved-call', variant: next.variant, terminalItem: next.item });
      await setClientAppState('__url__', { pathname: url.pathname, search: url.search, searchParams: Object.fromEntries(url.searchParams) });
    } catch (error) { setNotice(`Shared context: ${(error as Error).message}`); }
  }
  useEffect(() => { void select(initialSelection()); }, []);
  useEffect(() => {
    const value = shared.data;
    if (value && (value.variant !== variant || value.item !== item)) { setSelection(value); writeUrl(value); }
  }, [shared.data]);
  async function ask() {
    setWorking(true); setAgentError(''); setAnswer(null);
    try {
      const result: any = await callAction('investigate', { prompt }, { timeoutMs: 360000 });
      setAnswer(result); if (result.selection) { setSelection(result.selection); writeUrl(result.selection); }
    } catch (error) { setAgentError((error as Error).message); }
    finally { setWorking(false); }
  }
  async function exportDossier() {
    try { const result: any = await callAction('export-dossier', { variant, item }); download(result.filename, result.content); setNotice('Release dossier downloaded.'); }
    catch (error) { setNotice((error as Error).message); }
  }
  const finding = sample?.audit.findings?.find((row: any) => row.item === item);
  const raw = sample?.raw_refs?.find((row: any) => row.item === item);
  const status = sample?.audit.status;
  const expected = finding?.expected?.map((ref: any) => ref.item).join(', ');
  const observed = finding?.observed?.map((ref: any) => ref.item).join(', ');
  return <div className="traceglass">
    <header className="app-header"><a className="brand" href="/"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="12" cy="14" r="8"/><circle cx="20" cy="18" r="8"/></svg><span>Traceglass</span></a><span className="brand-description">Follow the real source</span><a className="source-link" href="https://github.com/blucca/n8n-check/tree/main/traceglass" target="_blank" rel="noreferrer">Source & self-hosting</a></header>
    <main>
      <div className="case-toolbar"><div className="case-tabs" aria-label="Saved case">{Object.entries(names).map(([v,name])=><button key={v} aria-pressed={variant===v} onClick={()=>void select({variant:v as Variant,item:0,output:0})}>{name}</button>)}</div><span className="sample-note">Synthetic recorded n8n executions</span></div>
      <section className="case-heading"><div><span className={'status-label '+(status??'loading')}>{isPending ? 'Reading saved call' : status === 'mismatch' ? 'Caller identity mismatch' : status === 'consistent' ? 'Caller identity consistent' : 'Source evidence incomplete'}</span><h1>{status === 'mismatch' ? 'Both runs succeeded. The source moved.' : status === 'consistent' ? 'The repair preserves the real source.' : 'A source decision needs the child export.'}</h1><p>{status==='mismatch' ? 'Equal business JSON hides the wrong caller pairing. Follow a terminal item back to its actual input.' : status==='consistent' ? 'The same business output now carries the child-derived caller pairing.' : 'This case deliberately removes child runData from an in-memory copy. Load the full saved child to complete the trace.'}</p></div><button className="download-button" onClick={()=>void exportDossier()}>Download release dossier <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10m-4-4 4 4 4-4M4 14v3h12v-3"/></svg></button></section>
      {notice && <div role="status" className="notice">{notice}<button aria-label="Dismiss message" onClick={()=>setNotice('')}>×</button></div>}
      {error ? <section className="load-error"><h2>Saved-call audit failed</h2><p>{(error as Error).message}</p><button onClick={()=>location.reload()}>Reload workbench</button></section> : isPending ? <div className="loading-canvas">Reading the saved parent and child…</div> : <>
        <div className="execution-strip"><span><i/>Parent execution {sample.audit.parent_execution ?? '7'} <strong>success</strong></span><span><i/>Child execution {sample.audit.child_execution ?? '8'} <strong>success</strong></span><span>Scope <strong>One waiting, once-mode call</strong></span><span>HTTP acceptance <strong>Separate business check</strong></span></div>
        <div className="evidence-workspace"><section className="graph-panel"><div className="panel-heading"><h2>One terminal. Two source stories.</h2><span>{sample.audit.checked_items??0} items traced</span></div><Graph sample={sample} selected={item} choose={i=>void select({...selection,item:i})}/><div className="source-summary"><div><span>Selected terminal</span><strong>{sample.terminal_node} / item {item}</strong></div><div><span>Derived caller root</span><strong className={status==='consistent'?'consistent-text':'derived-text'}>{finding ? `[${expected}]` : 'Needs full child'}</strong></div><div><span>Recorded caller pairing</span><strong className={status==='mismatch'?'mismatch-text':''}>{finding ? `[${observed}]` : 'Needs full child'}</strong></div></div><p className="scope-copy">Child traversal resolves caller-root sets through saved node source links and pairedItem references. Exports stay read-only.</p></section>
        <aside className="inspector"><div className="panel-heading"><h2>Exact raw evidence</h2><span>Item {item}</span></div><RawEvidence variant={variant} role="parent" pointer={raw?.parent_pair}/><RawEvidence variant={variant} role="child" pointer={raw?.child_pair}/><p className="inspector-note">JSON pointers identify the recorded values. The ancestry audit computes the expected root set.</p></aside></div>
      </>}
      <section className="agent-workspace"><div className="agent-intro"><div className="agent-title"><span className="agent-mark">✳</span><h2>Work with the evidence agent</h2></div><p>Select an item, then ask about “this.” The agent reads the same screen, uses the same actions, and can move your focus to the repair.</p><div className="context-tag"><span className="context-dot"/>Shared selection: {names[variant]}, terminal {item}</div><p className="model-note">Real free-model agent · Native tools available through MCP & CLI</p></div><div className="agent-conversation"><div className="suggestions">{prompts.map(p=><button disabled={working} key={p} onClick={()=>setPrompt(p)}>{p}</button>)}</div><form onSubmit={e=>{e.preventDefault();void ask();}}><label className="sr-only" htmlFor="agent-prompt">Ask the evidence agent</label><textarea id="agent-prompt" value={prompt} onChange={e=>setPrompt(e.target.value)} rows={2} maxLength={3000}/><button className="ask-button" disabled={working||!prompt.trim()} type="submit">{working ? 'Investigating…' : 'Investigate selection'}</button></form>{working && <div role="status" className="agent-running"><span/>The agent is inspecting saved sources. Changing focus appears in the workbench above.</div>}{agentError && <p role="alert" className="agent-error">{agentError}</p>}{answer && <div className="agent-result"><div className="agent-answer">{answer.answer}</div><div className="tool-evidence">{answer.steps.map((step:any,i:number)=><details key={i}><summary><span className="tool-dot"/>{step.tool}<span>Native action</span></summary><pre>{JSON.stringify({input:step.input,result:step.result},null,2)}</pre></details>)}</div>{answer.dossier && <button className="inline-download" onClick={()=>download(answer.dossier.filename,answer.dossier.content)}>Download the agent’s dossier</button>}<p className="model-receipt">{answer.model} · {answer.steps.length} native tool results</p></div>}</div></section>
      <footer><span>Built by Blucca, an AI-led software studio.</span><span>Agent-Native workbench · Pre-existing MIT audit & synthetic raw fixtures.</span></footer>
    </main>
  </div>;
}
