// Project Tracker — the module an org asks for first. What is this project,
// what has actually happened on it, when does it go live, and who may see it.
//
// The timeline can be written by hand OR generated from what the workspace
// already knows (decisions, BRD versions, delivery chain, releases, reviews)
// — so a tracker is never a blank page, and never drifts from the artifacts.
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { I } from './icons';
import {
  useWS, mutate, uid, now, shortDate, todayISO, findProject, can,
  trackerOf, sortedEvents, updateTracker, addEvent, updateEvent, removeEvent, snapshotTracker,
  EVENT_TYPES, TRACKER_STATUS, STATUS_LABEL
} from './workspace';

export default function TrackerPage() {
  const { pid } = useParams();
  const nav = useNavigate();
  const ws = useWS();
  const project = findProject(ws, pid);
  const t = trackerOf(project);
  const editable = can(ws, 'edit');
  const [showVersions, setShowVersions] = useState(false);
  const [genNote, setGenNote] = useState('');

  const patch = (p) => mutate((w) => updateTracker(w, pid, p));
  const members = ws.team?.members || [];
  const events = sortedEvents(project);

  // Derive the timeline from the artifacts the workspace already holds. This
  // is the "generate with AI" moment — and because it reads real documents,
  // it can't invent a history that didn't happen.
  const generate = () => {
    const found = [];
    const push = (date, type, note, ref) => date && found.push({ id: uid(), date: String(date).slice(0, 10), type, note, ref, createdAt: now(), source: 'ai' });

    (project.research || []).slice(0, 3).forEach((r) => push(r.createdAt, 'kickoff', `Research captured — ${r.title}`, r.id));
    (project.decisions || []).forEach((d) => {
      push(d.createdAt, 'decision', `Decision — ${d.title}${d.confidence ? ` (${Math.round(d.confidence * 100)}% confidence)` : ''}`, d.id);
      if (d.outcome) push(d.reviewDate || d.createdAt, 'review', `Outcome recorded — ${d.outcome.slice(0, 90)}`, d.id);
    });
    (project.brds || []).forEach((b) => (b.versions || []).forEach((v) => push(v.ts, 'milestone', `${b.title} — v${v.v} locked${v.note ? ` (${v.note})` : ''}`, b.id)));
    if ((project.stories || []).length) {
      const first = (project.pdns || [])[0];
      push(first?.createdAt || project.createdAt, 'milestone', `Delivery chain generated — ${project.epics.length} epics, ${project.stories.length} stories, ${project.tests.length} tests`, first?.id);
    }
    (project.reviews || []).forEach((r) => {
      push(r.createdAt, 'review', `Sent for review — ${r.subject}`, r.id);
      (r.history || []).filter((h) => h.verdict === 'approved').forEach((h) => push(h.at, 'approval', `Approved by ${members.find((m) => m.id === h.memberId)?.email?.split('@')[0] || 'reviewer'}`, r.id));
    });
    (project.releases || []).forEach((rel) => push(rel.date, 'release', `${rel.name} — ${rel.storyIds?.length || 0} stories`, rel.id));

    // Keep anything hand-written; only replace previously generated rows.
    const manual = (t.events || []).filter((e) => e.source !== 'ai');
    const seen = new Set(manual.map((e) => e.date + e.note));
    const fresh = found.filter((e) => !seen.has(e.date + e.note));
    patch({ events: [...manual, ...fresh] });
    setGenNote(`Generated ${fresh.length} event(s) from this project's documents.`);
    setTimeout(() => setGenNote(''), 4000);
  };

  const add = () => mutate((w) => addEvent(w, pid, { date: todayISO(), type: 'milestone', note: '', source: 'manual' }));

  if (!project) return <div className="docwrap"><p className="railempty">Project not found.</p></div>;

  return (
    <div className="docwrap">
      <div className="trkhead">
        <div>
          <h1 className="doch1" style={{ marginBottom: 2 }}>{project.name}</h1>
          <p className="docsub" style={{ margin: 0 }}>Tracker · {(ws.products || []).find((p) => p.id === project.productId)?.name || 'All products'}</p>
        </div>
        <span className={'trkbadge s-' + t.status}>{STATUS_LABEL[t.status]}</span>
      </div>

      <div className="trkfields">
        <label>Status
          <select value={t.status} disabled={!editable} onChange={(e) => patch({ status: e.target.value })}>
            {TRACKER_STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label>Go-live
          <input type="date" value={t.goLive || ''} disabled={!editable} onChange={(e) => patch({ goLive: e.target.value })} />
        </label>
        <label>Owner
          <select value={t.owner || 'owner'} disabled={!editable} onChange={(e) => patch({ owner: e.target.value })}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
          </select>
        </label>
        <label>Visibility
          <select value={t.visibility} disabled={!editable} onChange={(e) => patch({ visibility: e.target.value })}>
            <option value="private">Private — owner &amp; admins</option>
            <option value="published">Published — visible to everyone</option>
          </select>
        </label>
      </div>

      <h3 className="docsecth">Description</h3>
      {editable
        ? <textarea className="fieldarea" value={t.description} placeholder="What is this project, in two lines a director would understand?" onChange={(e) => patch({ description: e.target.value })} />
        : <p className="docpara">{t.description || <span className="railempty">—</span>}</p>}

      <div className="trktimelinehead">
        <h3 className="docsecth" style={{ margin: 0 }}>Major events</h3>
        {editable && (
          <span className="sigacts">
            <button className="fs-linkbtn" onClick={generate}><I n="sparkle" s={12} /> Generate from documents</button>
            <button className="fs-linkbtn" onClick={add}>+ Add event</button>
            <button className="fs-linkbtn" onClick={() => { mutate((w) => snapshotTracker(w, pid, 'Manual snapshot')); setShowVersions(true); }}>Save version</button>
          </span>
        )}
      </div>
      {genNote && <p className="hint">✓ {genNote}</p>}

      <div className="timeline">
        {events.map((e) => (
          <div key={e.id} className={'tlrow' + (e.date > todayISO() ? ' future' : '')}>
            <span className="tldot" style={{ background: EVENT_TYPES[e.type]?.tint || '#888' }} />
            <span className="tldate">
              {editable
                ? <input type="date" value={e.date || ''} onChange={(ev) => mutate((w) => updateEvent(w, pid, e.id, { date: ev.target.value }))} />
                : shortDate((e.date || todayISO()) + 'T00:00:00')}
            </span>
            <span className="tlbody">
              {editable ? (
                <>
                  <select value={e.type} onChange={(ev) => mutate((w) => updateEvent(w, pid, e.id, { type: ev.target.value }))}>
                    {Object.entries(EVENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <input className="tlnote" value={e.note} placeholder="What happened?" onChange={(ev) => mutate((w) => updateEvent(w, pid, e.id, { note: ev.target.value }))} />
                  <button className="fs-linkbtn" onClick={() => mutate((w) => removeEvent(w, pid, e.id))}>×</button>
                </>
              ) : (
                <>
                  <span className="tltype" style={{ color: EVENT_TYPES[e.type]?.tint }}>{EVENT_TYPES[e.type]?.label}</span>
                  <span>{e.note}</span>
                </>
              )}
              {e.source === 'ai' && <span className="tlai" title="Generated from this project's documents">AI</span>}
            </span>
          </div>
        ))}
        {!events.length && <p className="railempty">No events yet — add one, or generate the history from this project's documents.</p>}
      </div>

      <button className="fs-linkbtn" style={{ marginTop: 16 }} onClick={() => setShowVersions((v) => !v)}>
        {showVersions ? 'Hide' : 'Show'} version history ({(t.versions || []).length})
      </button>
      {showVersions && (
        <div className="klist" style={{ marginTop: 8 }}>
          {(t.versions || []).slice().reverse().map((v) => (
            <div key={v.v} className="krow static">
              <span className="krowmain">
                <span className="krowtitle">v{v.v} · {v.note}</span>
                <span className="krowmeta">{shortDate(v.ts)} · {v.events.length} events · status {STATUS_LABEL[v.status] || v.status} · go-live {v.goLive || '—'}</span>
              </span>
            </div>
          ))}
          {!(t.versions || []).length && <p className="railempty">No snapshots yet. "Save version" freezes the tracker as it stands today.</p>}
        </div>
      )}
    </div>
  );
}
