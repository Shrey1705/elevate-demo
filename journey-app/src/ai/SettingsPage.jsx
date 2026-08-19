// Settings — connected systems, model routing, appearance and API access in
// one tabbed screen. Connectors are the ground truth behind every verdict.
import React, { useState, useEffect } from 'react';
import { ai } from '../lib/api';
import { useWorkspace } from './AiPortal';
import { detectOllama } from '../lib/ollama';
import { clearIndex } from './rag';
import { I } from './icons';
import {
  useWS, mutate, uid, usingLocal, DEFAULT_THEME, ROLES, ROLE_IDS, roleLabel, myRole, can,
  planOf, PLAN_LIMITS, PLAN_LABEL, usageOf, MODULES, DEFAULT_ROLE_MODULES
} from './workspace';

const TABS = [
  { id: 'Connected Systems', glyph: 'plug', admin: true },
  { id: 'Model Hub', glyph: 'cpu', admin: true },
  { id: 'Integrations', glyph: 'network', admin: true },
  { id: 'Team & Roles', glyph: 'user' },
  { id: 'Module Access', glyph: 'lock' },
  { id: 'Plan & Usage', glyph: 'card' },
  { id: 'Appearance', glyph: 'sliders' },
  { id: 'API & Webhooks', glyph: 'code', admin: true }
];

// Freemium meters: what you've used, what the plan allows, where to upgrade.
// Local AI is deliberately called out as unlimited on every plan — it runs
// on the user's machine, so generosity costs nothing and sells the moat.
function PlanTab() {
  const ws = useWS();
  const { session } = useWorkspace();
  const plan = planOf(session);
  const limits = PLAN_LIMITS[plan];
  const usage = usageOf(ws);
  const METER = [
    { k: 'products', label: 'Products' },
    { k: 'projects', label: 'Projects' },
    { k: 'decisions', label: 'Decisions' },
    { k: 'research', label: 'Research notes' }
  ];
  return (
    <div>
      <h3 className="ws-h3">You're on <b>{PLAN_LABEL[plan]}</b>{session?.mode === 'demo' ? ' (showcase demo — everything unlocked)' : ''}</h3>
      {METER.map(({ k, label }) => {
        const cap = limits[k];
        const pct = cap === Infinity ? 0 : Math.min(100, Math.round((usage[k] / cap) * 100));
        return (
          <div className="planmeter" key={k}>
            <span className="planmeterlabel">{label}</span>
            <span className="planmeterbar"><span style={{ width: `${pct}%` }} className={pct >= 100 ? 'full' : ''} /></span>
            <span className="planmeterval">{usage[k]} / {cap === Infinity ? '∞' : cap}</span>
          </div>
        );
      })}
      <p className="hint" style={{ marginTop: 14 }}><b>Local AI is unlimited on every plan</b> — it runs on your machine, so we never meter it. Your documents never leave your laptop either way.</p>
      {plan === 'free' && (
        <>
          <h3 className="ws-h3" style={{ marginTop: 22 }}>Founding Pro — unlimited everything</h3>
          <p className="hint">Unlimited products, projects, decisions and research · integrations & API token · scheduled WhatsApp/Gmail reminders · founding price locked for life.</p>
          <a className="btn" href="/pricing">See founding plans →</a>
        </>
      )}
    </div>
  );
}

// Shown in place of an admin-only tab when previewing a lower role — the
// lock itself is the demo: this is what an editor or viewer actually gets.
function LockedTab({ role }) {
  return (
    <div>
      <h3 className="ws-h3">Not available for your role</h3>
      <p className="hint">You're working as <b>{roleLabel(role)}</b>. {ROLES[role]?.desc}</p>
      <p className="hint">Switch role from the picker at the top of the sidebar, or ask an admin to grant this module in <b>Module Access</b>.</p>
    </div>
  );
}

// Team: people hold several roles at once (a Director who also PMs a
// product), and switch between them in the UI without logging out.
function TeamTab() {
  const ws = useWS();
  const team = ws.team || { members: [], activeRole: 'admin' };
  const isAdmin = can(ws, 'admin');
  const [email, setEmail] = useState('');

  const patchTeam = (p) => mutate((w) => ({ ...w, team: { ...(w.team || team), ...p } }));
  const addMember = () => {
    const e = email.trim().toLowerCase();
    if (!e.includes('@')) return;
    patchTeam({ members: [...team.members, { id: uid(), email: e, roles: ['viewer'] }] });
    setEmail('');
  };
  const toggleRole = (id, r) => patchTeam({
    members: team.members.map((m) => {
      if (m.id !== id) return m;
      const roles = m.roles.includes(r) ? m.roles.filter((x) => x !== r) : [...m.roles, r];
      return { ...m, roles: roles.length ? roles : ['viewer'] };
    })
  });
  const remove = (id) => patchTeam({ members: team.members.filter((m) => m.id !== id) });

  return (
    <div>
      <h3 className="ws-h3">People &amp; roles</h3>
      <p className="hint">Everyone can hold more than one role. Tick every role a person performs — they choose which one they're working as from the sidebar, without logging out.</p>
      <table className="dashtable rolegrid">
        <thead>
          <tr><th>Member</th>{ROLE_IDS.map((r) => <th key={r} className="rolecol">{ROLES[r].label}</th>)}<th /></tr>
        </thead>
        <tbody>
          {team.members.map((m) => (
            <tr key={m.id}>
              <td>{m.email}{m.owner ? ' · you' : ''}</td>
              {ROLE_IDS.map((r) => (
                <td key={r} className="rolecol">
                  <input type="checkbox" checked={(m.roles || []).includes(r)} disabled={!isAdmin}
                    onChange={() => toggleRole(m.id, r)} />
                </td>
              ))}
              <td>{!m.owner && isAdmin && <button className="fs-linkbtn" onClick={() => remove(m.id)}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isAdmin && (
        <div className="fs-onboardrow" style={{ maxWidth: 460, marginTop: 12 }}>
          <input value={email} placeholder="teammate@company.com" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addMember()} />
          <button onClick={addMember}>Add person</button>
        </div>
      )}
    </div>
  );
}

// Module access: the matrix an org signs off on — which roles see which
// parts of the product. Changing a row changes the sidebar immediately.
function ModulesTab() {
  const ws = useWS();
  const isAdmin = can(ws, 'admin');
  const matrix = ws.moduleAccess || DEFAULT_ROLE_MODULES;
  const toggle = (role, mod) => mutate((w) => {
    const base = w.moduleAccess || DEFAULT_ROLE_MODULES;
    const have = base[role] || [];
    const next = have.includes(mod) ? have.filter((x) => x !== mod) : [...have, mod];
    return { ...w, moduleAccess: { ...base, [role]: next } };
  });
  return (
    <div>
      <h3 className="ws-h3">Module access by role</h3>
      <p className="hint">Every capability in the product, grouped into modules. Tick which roles can open each one — the sidebar and routes follow this matrix live.</p>
      <div className="modtablewrap">
        <table className="dashtable rolegrid">
          <thead>
            <tr><th>Module</th>{ROLE_IDS.map((r) => <th key={r} className="rolecol">{ROLES[r].label}</th>)}</tr>
          </thead>
          <tbody>
            {Object.entries(MODULES).map(([id, m]) => (
              <tr key={id}>
                <td>
                  <b>{m.label}</b>
                  <span className="modfns">{m.fns.join(' · ')}</span>
                </td>
                {ROLE_IDS.map((r) => (
                  <td key={r} className="rolecol">
                    <input type="checkbox" checked={(matrix[r] || []).includes(id)} disabled={!isAdmin}
                      onChange={() => toggle(r, id)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IntegrationsTab() {
  const { session } = useWorkspace();
  const isUser = session?.mode === 'user';
  const [tok, setTok] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const base = `${window.location.origin}/api/ai`;

  const mint = async () => {
    setBusy(true);
    try { const r = await ai.apiToken(session.token); setTok(r.token); }
    catch (e) { setTok(''); alert(e.message); }
    finally { setBusy(false); }
  };
  const copy = (label, text) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(label); setTimeout(() => setCopied(''), 1600); });
  };

  if (!isUser) {
    return (
      <div>
        <h3 className="ws-h3">Send anything into your workspace</h3>
        <p className="hint">Connect Slack, email, Jira — anything n8n speaks — to a private Feasly workspace: saved messages and forwarded mails land as research notes, and a scheduled workflow can post your stakeholder update every Friday. Self-hosted n8n keeps the whole chain on your own machines.</p>
        <p className="hint"><b>Sign in with your email</b> (log out and use the email option) to mint an integration token — the demo workspace lives only in this browser, so there is nothing for a webhook to write to.</p>
      </div>
    );
  }

  const curlExample = `curl -X POST ${base}/inbox \\
  -H "Authorization: Bearer ${tok || '<your-token>'}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"From Slack","content":"…","source":"slack"}'`;

  return (
    <div>
      <h3 className="ws-h3">Integration token</h3>
      <p className="hint">A long-lived token (365 days) for n8n, curl or any webhook tool. Treat it like a password — anyone holding it can write into your Inbox and read your status updates.</p>
      {tok
        ? <div className="tokenbox"><code>{tok}</code><button className="fs-linkbtn" onClick={() => copy('token', tok)}>{copied === 'token' ? 'Copied ✓' : 'Copy'}</button></div>
        : <button className="btn" disabled={busy} onClick={mint}>{busy ? 'Generating…' : 'Generate integration token'}</button>}

      <h3 className="ws-h3" style={{ marginTop: 26 }}>Endpoints</h3>
      <table className="dashtable">
        <thead><tr><th>What</th><th>Call</th></tr></thead>
        <tbody>
          <tr><td>Send anything into your Inbox project</td><td><code>POST {base}/inbox</code> · body <code>{'{ title, content, source? }'}</code></td></tr>
          <tr><td>Fetch a finished stakeholder update</td><td><code>GET {base}/playbooks/stakeholder-update?project=first</code></td></tr>
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 8 }}>Try it: <button className="fs-linkbtn" onClick={() => copy('curl', curlExample)}>{copied === 'curl' ? 'Copied ✓' : 'copy a working curl'}</button> — the item appears in your <b>Inbox</b> project on next load.</p>

      <h3 className="ws-h3" style={{ marginTop: 26 }}>Ready-made n8n workflows</h3>
      <p className="hint">Run n8n locally with <code>npx n8n</code>, import a template from the repo's <code>integrations/n8n/</code> folder, paste your token, activate:</p>
      <ul className="hint" style={{ lineHeight: 2, paddingLeft: 18 }}>
        <li><b>gmail-to-inbox</b> — tag a Gmail with your <code>Feasly</code> label → it lands as a research note</li>
        <li><b>email-forward-to-inbox</b> — forward any email to a watched mailbox → research note</li>
        <li><b>friday-update-to-gmail</b> — every Friday 4pm, your status update emails itself to stakeholders</li>
        <li><b>whatsapp-update</b> — the same update, delivered on WhatsApp</li>
      </ul>
    </div>
  );
}

const CONNECTORS = [
  { name: 'zenith-core-service', kind: 'Core policy system', lang: 'Node · Express', files: ['rules/premium.rules.yaml', 'rules/underwriting.rules.yaml', 'db/schema.sql', 'api/contracts/proposal-v2.contract.json', 'services/*.js'] },
  { name: 'zenith-journey-app', kind: 'Frontend application', lang: 'React · Vite', files: ['journey/steps.jsx', 'lib/validation.js', 'pay/PayLink.jsx'] }
];
const EVENTS = [
  { t: '12 min ago', e: 'analysis.completed', d: 'verdict=red · 3/5 evidence resolved' },
  { t: '1 hr ago', e: 'graph.reindexed', d: 'push to zenith-core-service (rules changed)' },
  { t: '3 hrs ago', e: 'webhook.delivered', d: 'PDN pushed to Jira (PROD board)' }
];

function SystemsTab() {
  return (
    <div>
      {CONNECTORS.map((c) => (
        <div className="connector" key={c.name}>
          <div>
            <h4><I n="plug" s={14} /> {c.name}</h4>
            <p className="hint">{c.kind} · {c.lang}</p>
            <p className="hint">Indexed: {c.files.join(' · ')}</p>
          </div>
          <div className="connector-status">
            <span className="status issued">CONNECTED</span>
            <span className="hint">read-only · webhook active</span>
          </div>
        </div>
      ))}
      <h3 className="ws-h3">Recent events</h3>
      <table className="dashtable">
        <thead><tr><th>When</th><th>Event</th><th>Detail</th></tr></thead>
        <tbody>
          {EVENTS.map((ev, i) => <tr key={i}><td>{ev.t}</td><td><code>{ev.e}</code></td><td>{ev.d}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

function ModelsTab() {
  const ws = useWS();
  const local = ws.local || { endpoint: 'http://localhost:11434', chatModel: '', embedModel: '', temperature: 0.1 };
  const [detected, setDetected] = useState(null);   // null = not tried · [] = ollama up, no models · false = unreachable
  const [detecting, setDetecting] = useState(false);
  const [cloud, setCloud] = useState({ provider: 'anthropic', name: '', key: '' });

  const patchLocal = (p) => {
    // Changing the embedding model or endpoint invalidates stored vectors.
    if (p.embedModel !== undefined || p.endpoint !== undefined) clearIndex();
    mutate((w) => ({ ...w, local: { ...(w.local || local), ...p } }));
  };
  const detect = async (endpoint = local.endpoint) => {
    setDetecting(true);
    const models = await detectOllama(endpoint);
    setDetected(models === null ? false : models);
    if (models?.length) {
      const chat = models.filter((m) => !/embed/i.test(m.name));
      const embed = models.filter((m) => /embed/i.test(m.name));
      mutate((w) => {
        const cur = w.local || local;
        return { ...w, local: { ...cur,
          chatModel: chat.some((m) => m.name === cur.chatModel) ? cur.chatModel : (chat[0]?.name || ''),
          embedModel: embed.some((m) => m.name === cur.embedModel) ? cur.embedModel : (embed[0]?.name || '')
        } };
      });
    }
    setDetecting(false);
  };
  useEffect(() => { detect(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const chatModels = (detected || []).filter((m) => !/embed/i.test(m.name));
  const embedModels = (detected || []).filter((m) => /embed/i.test(m.name));
  const localReady = detected && detected.length > 0 && local.chatModel && local.embedModel;
  const isLocalActive = usingLocal(ws);

  const addCloud = () => {
    if (!cloud.name.trim() || cloud.key.length < 8) return;
    mutate((w) => ({ ...w, models: [...(w.models || []), { id: uid(), name: cloud.name.trim(), provider: cloud.provider, keyMasked: '••••' + cloud.key.slice(-4) }] }));
    setCloud({ provider: 'anthropic', name: '', key: '' });
  };

  return (
    <div>
      <h3 className="ws-h3" style={{ marginTop: 0 }}>Active model</h3>
      <div className="modelgrid">
        <button className={'modelcard' + (!isLocalActive ? ' on' : '')} onClick={() => mutate((w) => ({ ...w, activeModelId: null }))}>
          <b><I n="lock" s={14} /> Feasly demo brain</b>
          <small>Offline · deterministic · code-grounded feasibility. Works everywhere, zero setup.</small>
          {!isLocalActive && <span className="status issued">ACTIVE</span>}
        </button>
        <div className={'modelcard' + (isLocalActive ? ' on' : '')}>
          <b><I n="cpu" s={14} /> Ollama on this machine</b>
          <small>
            {detected === null && 'Checking for a local Ollama server…'}
            {detected === false && `No Ollama server at ${local.endpoint}. Start it with \`ollama serve\`, then detect again.`}
            {detected && detected.length === 0 && 'Ollama is running but has no models. Try `ollama pull llama3.2` and `ollama pull nomic-embed-text`.'}
            {detected && detected.length > 0 && `${detected.length} model${detected.length > 1 ? 's' : ''} available · real LLM + RAG over this project's documents and code, fully on-device.`}
          </small>
          <span className="modelops">
            {isLocalActive
              ? <span className="status issued">ACTIVE</span>
              : <button className="linkbtn" disabled={!localReady} onClick={() => mutate((w) => ({ ...w, activeModelId: 'local' }))}>Set active</button>}
            <button className="linkbtn" disabled={detecting} onClick={() => detect()}><I n="refresh" s={12} /> {detecting ? 'Detecting…' : 'Detect Ollama'}</button>
          </span>
        </div>
      </div>

      <div className="modelforms">
        <div>
          <h3 className="ws-h3">Local model configuration</h3>
          <label>Ollama endpoint</label>
          <input value={local.endpoint} onChange={(e) => patchLocal({ endpoint: e.target.value })} onBlur={() => detect()} />
          <label>Chat model (answers questions)</label>
          {chatModels.length > 0 ? (
            <select value={local.chatModel} onChange={(e) => patchLocal({ chatModel: e.target.value })}>
              {chatModels.map((m) => <option key={m.name} value={m.name}>{m.name} · {m.sizeGb} GB</option>)}
            </select>
          ) : <p className="hint">No chat models detected. <code>ollama pull llama3.2</code></p>}
          <label>Embedding model (turns documents into vectors)</label>
          {embedModels.length > 0 ? (
            <select value={local.embedModel} onChange={(e) => patchLocal({ embedModel: e.target.value })}>
              {embedModels.map((m) => <option key={m.name} value={m.name}>{m.name} · {m.sizeGb} GB</option>)}
            </select>
          ) : <p className="hint">No embedding models detected. <code>ollama pull nomic-embed-text</code></p>}
          <label>Temperature — {Number(local.temperature ?? 0.1).toFixed(2)} {Number(local.temperature ?? 0.1) <= 0.2 ? '· factual, minimal hallucination' : Number(local.temperature) <= 0.5 ? '· balanced' : '· creative (not recommended for grounded answers)'}</label>
          <input type="range" min="0" max="1" step="0.05" value={local.temperature ?? 0.1} onChange={(e) => patchLocal({ temperature: Number(e.target.value) })} />
          <p className="hint">Kept low (0.1) so the model sticks to the retrieved documents and code instead of inventing details.</p>
        </div>
        <div>
          <h3 className="ws-h3">Connect a cloud API key</h3>
          <label>Provider</label>
          <select value={cloud.provider} onChange={(e) => setCloud({ ...cloud, provider: e.target.value })}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
          <label>Display name</label>
          <input value={cloud.name} placeholder="e.g. Claude via my key" onChange={(e) => setCloud({ ...cloud, name: e.target.value })} />
          <label>API key</label>
          <input type="password" value={cloud.key} placeholder="sk-…" onChange={(e) => setCloud({ ...cloud, key: e.target.value })} />
          <button className="btn" onClick={addCloud}>Add cloud model</button>
          <p className="hint">Cloud keys are stored masked in this demo and not used for routing — local + demo brain are the two live engines.</p>
        </div>
      </div>
    </div>
  );
}

// ---- appearance: the user's three colour tokens ----
const PRESETS = [
  { name: 'Zenith', primary: '#0071e3', secondary: '#5e5ce6', tertiary: '#30b0c7' },
  { name: 'Graphite', primary: '#3a3a3c', secondary: '#6e6e73', tertiary: '#8e8e93' },
  { name: 'Sage', primary: '#2e7d5b', secondary: '#5fa777', tertiary: '#30b0c7' },
  { name: 'Sunset', primary: '#e8590c', secondary: '#e64980', tertiary: '#f2a30f' },
  { name: 'Orchid', primary: '#7048e8', secondary: '#bf5af2', tertiary: '#f26eb1' }
];
const COLOR_ROLES = [
  { k: 'primary', label: 'Primary', hint: 'Buttons, active navigation, links, focus rings' },
  { k: 'secondary', label: 'Secondary', hint: 'Gradients, secondary accents and highlights' },
  { k: 'tertiary', label: 'Tertiary', hint: 'Badges, tags and tertiary highlights' }
];

function AppearanceTab() {
  const ws = useWS();
  const theme = ws.theme || DEFAULT_THEME;
  const set = (k, v) => mutate((w) => ({ ...w, theme: { ...(w.theme || DEFAULT_THEME), [k]: v } }));
  const apply = (p) => mutate((w) => ({ ...w, theme: { primary: p.primary, secondary: p.secondary, tertiary: p.tertiary } }));
  const isCurrent = (p) => p.primary === theme.primary && p.secondary === theme.secondary && p.tertiary === theme.tertiary;

  return (
    <div className="appearance">
      <h3 className="ws-h3" style={{ marginTop: 0 }}>Theme colours</h3>
      <p className="hint" style={{ marginBottom: 14 }}>Changes apply live across the whole workspace and survive demo resets.</p>
      {COLOR_ROLES.map((r) => (
        <div className="colorrow" key={r.k}>
          <label className="colorwell" style={{ background: theme[r.k] }}>
            <input type="color" value={theme[r.k]} onChange={(e) => set(r.k, e.target.value)} />
          </label>
          <span className="colormain">
            <b>{r.label}</b>
            <small>{r.hint}</small>
          </span>
          <code>{theme[r.k]}</code>
        </div>
      ))}

      <h3 className="ws-h3">Presets</h3>
      <div className="presetrow">
        {PRESETS.map((p) => (
          <button key={p.name} className={'preset' + (isCurrent(p) ? ' on' : '')} onClick={() => apply(p)}>
            <span className="presetdots">
              <i style={{ background: p.primary }} /><i style={{ background: p.secondary }} /><i style={{ background: p.tertiary }} />
            </span>
            {p.name}
          </button>
        ))}
      </div>
      <button className="linkbtn" style={{ marginTop: 14 }} onClick={() => apply(DEFAULT_THEME)}>Reset to default</button>
    </div>
  );
}

function ApiTab() {
  const [key, setKey] = useState('');
  const [copied, setCopied] = useState('');
  const origin = window.location.origin;
  const generate = async () => { const r = await ai.login('pm', 'zenith@123'); setKey(r.token); };
  const copy = (label, s) => { navigator.clipboard.writeText(s); setCopied(label); setTimeout(() => setCopied(''), 1500); };
  const curl = `curl -X POST ${origin}/api/ai/analyze \\
  -H "Authorization: Bearer ${key || '<YOUR_API_KEY>'}" \\
  -H "Content-Type: application/json" \\
  -d '{"text": "Offer monthly premium payment EMI"}'`;

  return (
    <div>
      <p className="hint" style={{ marginBottom: 16 }}>Feasly is API-first — everything the workspace does is available over REST. This demo key is real — the curl below works from your terminal, right now.</p>
      {key
        ? <div className="keybox"><code>{key}</code><button className="btn ghost" onClick={() => copy('key', key)}>{copied === 'key' ? 'Copied ✓' : 'Copy'}</button></div>
        : <button className="btn" onClick={generate}>Generate demo API key</button>}
      <h3 className="ws-h3">Call the API</h3>
      <div className="codeblock">
        <button className="linkbtn copybtn" onClick={() => copy('curl', curl)}>{copied === 'curl' ? 'Copied ✓' : 'Copy'}</button>
        <pre>{curl}</pre>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState('Connected Systems');
  const ws = useWS();
  const role = myRole(ws);
  const locked = TABS.find((t) => t.id === tab)?.admin && !can(ws, 'admin');
  return (
    <div className="docwrap">
      <h1 className="doch1">Settings</h1>
      <p className="docsub">Connected systems, model routing, appearance and API access.</p>
      <div className="undertabs">
        {TABS.map((t) => (
          <button key={t.id} className={'undertab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
            <I n={t.glyph} s={13} /> {t.id}
          </button>
        ))}
      </div>
      {locked ? <LockedTab role={role} /> : (
        <>
          {tab === 'Connected Systems' && <SystemsTab />}
          {tab === 'Model Hub' && <ModelsTab />}
          {tab === 'Integrations' && <IntegrationsTab />}
          {tab === 'Team & Roles' && <TeamTab />}
          {tab === 'Module Access' && <ModulesTab />}
          {tab === 'Plan & Usage' && <PlanTab />}
          {tab === 'Appearance' && <AppearanceTab />}
          {tab === 'API & Webhooks' && <ApiTab />}
        </>
      )}
    </div>
  );
}
