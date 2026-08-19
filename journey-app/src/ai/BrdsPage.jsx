// BRD workspace — versioned business requirement documents. Editing is live;
// "Save as new version" is the explicit moment the BRD changes, which is what
// flags every downstream PDN/epic/story/FR/test as potentially outdated.
import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ai } from '../lib/api';
import { useWorkspace } from './AiPortal';
import {
  useWS, mutate, uid, now, findProject, findDoc, updateDoc, addDoc,
  childrenOf, pdnFromAnalysis, brdCompletenessReview, shortDate
} from './workspace';
import { TypeIcon } from './icons';
import Attachments from './Attachments';
import TraceRail from './TraceRail';

const STATUSES = ['Draft', 'In review', 'Approved'];

export default function BrdsPage() {
  const { pid, docId } = useParams();
  const nav = useNavigate();
  const ws = useWS();
  const { token } = useWorkspace();
  const project = findProject(ws, pid);
  const doc = docId ? findDoc(project, 'brd', docId) : null;
  const [title, setTitle] = useState('');
  const [reqInput, setReqInput] = useState('');
  const [versionNote, setVersionNote] = useState('');
  const [review, setReview] = useState(null);
  const [viewVersion, setViewVersion] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!doc) {
    const addBrd = () => {
      if (!title.trim()) return;
      const sections = { background: '', requirements: [], stakeholders: '', success: '' };
      // No snapshot on creation — the author's first explicit save becomes v1.
      const b = { id: uid(), title: title.trim(), owner: 'PM', status: 'Draft', researchIds: [], sections, createdAt: now(), versions: [] };
      mutate((w) => addDoc(w, pid, 'brd', b));
      setTitle('');
      nav(b.id);
    };
    return (
      <div className="docwrap">
        <h1 className="doch1">BRDs</h1>
        <p className="docsub">Business requirement documents — versioned, owned, and linked to the research that motivated them.</p>
        <div className="homeadd" style={{ margin: '18px 0 6px' }}>
          <input value={title} placeholder="New BRD title…" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addBrd()} />
          <button onClick={addBrd}>Create</button>
        </div>
        <div className="klist">
          {project.brds.map((b) => (
            <button key={b.id} className="krow" onClick={() => nav(b.id)}>
              <span className="krowmain">
                <span className="krowtitle">{b.title}</span>
                <span className="krowmeta">{b.versions.length ? `v${b.versions.length}` : 'draft'} · {b.status} · {b.owner} · {b.researchIds.length} research linked · {childrenOf(project, 'brd', b).length} PDNs</span>
              </span>
              <span className="krowside">{b.status === 'Approved' ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const patch = (p) => mutate((w) => updateDoc(w, pid, 'brd', doc.id, p));
  const patchSections = (p) => patch({ sections: { ...doc.sections, ...p } });
  const s = doc.sections;
  const currentV = doc.versions.length;

  const saveVersion = () => {
    patch({
      versions: [...doc.versions, { v: currentV + 1, ts: now(), note: versionNote.trim() || 'Edited', sections: s }]
    });
    setVersionNote('');
  };

  const generatePdn = async () => {
    setBusy(true); setErr('');
    try {
      const r = await ai.analyze(token, s.requirements.join('. ') || doc.title);
      if (!r.matched) { setErr(r.note || 'Could not ground this BRD in the connected code — refine the requirements.'); setBusy(false); return; }
      // A PDN must trace to a saved version — auto-save v1 if none exists yet.
      let brdForPdn = doc;
      if (doc.versions.length === 0) {
        brdForPdn = { ...doc, versions: [{ v: 1, ts: now(), note: 'Auto-saved when generating the PDN', sections: s }] };
        mutate((w) => updateDoc(w, pid, 'brd', doc.id, { versions: brdForPdn.versions }));
      }
      const pdn = pdnFromAnalysis(brdForPdn, r);
      mutate((w) => addDoc(w, pid, 'pdn', pdn));
      setTimeout(() => { setBusy(false); nav(`/ai/p/${pid}/pdns/${pdn.id}`); }, 600);
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  const actions = [
    { label: 'Check completeness', run: () => setReview(brdCompletenessReview(doc)) },
    { label: busy ? 'Scanning connected systems…' : 'Generate PDN', disabled: busy, hint: `Grounds v${currentV} + linked research against the codebase`, run: generatePdn }
  ];

  const versionsRail = (
    <section>
      <h4>Versions</h4>
      {doc.versions.slice().reverse().map((v) => (
        <button key={v.v} className={'raillink' + (viewVersion === v.v ? ' on' : '')} onClick={() => setViewVersion(viewVersion === v.v ? null : v.v)}>
          <span className="railicon">{v.v === currentV ? '●' : '○'}</span>
          <span className="railtitle">v{v.v} — {v.note}</span>
          <span className="railtype">{shortDate(v.ts)}</span>
        </button>
      ))}
      <div className="verssave">
        <input value={versionNote} placeholder="What changed?" onChange={(e) => setVersionNote(e.target.value)} />
        <button onClick={saveVersion}>Save as v{currentV + 1}</button>
      </div>
      <p className="railempty">Saving a version flags every downstream artifact for review.</p>
    </section>
  );

  const snapshot = viewVersion ? doc.versions.find((v) => v.v === viewVersion) : null;

  return (
    <div className="docwrap">
      <button className="linkbtn" onClick={() => nav(`/ai/p/${pid}/brds`)}>← BRDs</button>
      <div className="docpane">
        <article className="docbody">
          <p className="doctype"><TypeIcon type="brd" s={13} /> BRD · {currentV ? `v${currentV}` : 'draft — no versions saved yet'}</p>
          <h1>{doc.title}</h1>
          <div className="brdmeta">
            <label>Owner <input value={doc.owner} onChange={(e) => patch({ owner: e.target.value })} /></label>
            <label>Status
              <select value={doc.status} onChange={(e) => patch({ status: e.target.value })}>
                {STATUSES.map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
          </div>

          {snapshot && (
            <div className="verspeek">
              <p><b>Viewing snapshot v{snapshot.v}</b> — {snapshot.note} · {shortDate(snapshot.ts)}</p>
              <pre className="prose">{renderSections(snapshot.sections)}</pre>
              <span>
                <button className="linkbtn" onClick={() => { patchSections(snapshot.sections); setViewVersion(null); }}>Restore these sections</button>
                <button className="linkbtn" onClick={() => setViewVersion(null)}>Close</button>
              </span>
            </div>
          )}

          {review && (
            <div className="aireview">
              <b>Completeness review</b>
              <ul>{review.map((f, i) => <li key={i}>{f}</li>)}</ul>
              <button className="linkbtn" onClick={() => setReview(null)}>Dismiss</button>
            </div>
          )}

          <h3 className="docsecth">Background &amp; context</h3>
          <textarea rows={3} value={s.background} placeholder="What's the business problem? Why now?" onChange={(e) => patchSections({ background: e.target.value })} />

          <h3 className="docsecth">Business requirements ({s.requirements.length})</h3>
          {s.requirements.map((r, i) => (
            <div className="reqrow" key={i}>
              <span>{i + 1}. {r}</span>
              <button onClick={() => patchSections({ requirements: s.requirements.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <div className="reqaddrow">
            <input value={reqInput} placeholder="Add a requirement…" onChange={(e) => setReqInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && reqInput.trim()) { patchSections({ requirements: [...s.requirements, reqInput.trim()] }); setReqInput(''); } }} />
            <button className="ghostaddbtn" onClick={() => { if (reqInput.trim()) { patchSections({ requirements: [...s.requirements, reqInput.trim()] }); setReqInput(''); } }}>Add</button>
          </div>

          <h3 className="docsecth">Stakeholders</h3>
          <input value={s.stakeholders} placeholder="Who signs off on this?" onChange={(e) => patchSections({ stakeholders: e.target.value })} />

          <h3 className="docsecth">Success criteria</h3>
          <textarea rows={2} value={s.success} placeholder="How will we know this worked?" onChange={(e) => patchSections({ success: e.target.value })} />

          <h3 className="docsecth">Research in context ({doc.researchIds.length})</h3>
          <p className="railempty" style={{ marginTop: 0 }}>These documents ride along whenever this BRD generates a PDN.</p>
          {project.research.map((r) => (
            <label className="reslink" key={r.id}>
              <input type="checkbox" checked={doc.researchIds.includes(r.id)}
                onChange={(e) => patch({ researchIds: e.target.checked ? [...doc.researchIds, r.id] : doc.researchIds.filter((x) => x !== r.id) })} />
              <span>{r.title}</span>
            </label>
          ))}
          {err && <p className="error">{err}</p>}
          <Attachments pid={pid} type="brd" doc={doc} />
        </article>

        <TraceRail project={project} type="brd" doc={doc} actions={actions} extra={versionsRail} />
      </div>
    </div>
  );
}

function renderSections(sec) {
  return `Background\n${sec.background}\n\nRequirements\n${sec.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nStakeholders\n${sec.stakeholders}\n\nSuccess criteria\n${sec.success}`;
}
