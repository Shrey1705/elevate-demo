// Review & Approval — route a project or document to several people, each
// with their own role and verdict, and keep the whole trail. The overall
// state is DERIVED from the reviewers (never set by hand) and the history is
// append-only, which is what makes it an audit trail rather than a status
// field someone can quietly flip.
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { I } from './icons';
import { useWorkspace } from './AiPortal';
import {
  useWS, mutate, shortDate, findProject, can, roleLabel, myRole,
  reviewsOf, addReview, recordVerdict, updateReview, REVIEW_STATE, openReviewsFor
} from './workspace';

const VERDICT_LABEL = { pending: 'Pending', approved: 'Approved', changes: 'Changes requested' };

// Workspace-level queue: everything waiting on me, across every project.
export function ReviewQueuePage() {
  const ws = useWS();
  const nav = useNavigate();
  const mine = openReviewsFor(ws, 'owner');
  const all = (ws.projects || []).flatMap((p) => reviewsOf(p).map((r) => ({ review: r, project: p })));
  const open = all.filter((x) => x.review.state === 'open');
  const done = all.filter((x) => x.review.state !== 'open');

  return (
    <div className="docwrap">
      <h1 className="doch1">Reviews &amp; Approvals</h1>
      <p className="docsub">Everything routed for review across the portfolio. You're acting as <b>{roleLabel(myRole(ws))}</b>.</p>

      <div className="pfkpis">
        <div className={'prodkpi' + (mine.length ? ' warn' : '')}><b>{mine.length}</b><span>Waiting on you</span></div>
        <div className="prodkpi"><b>{open.length}</b><span>Open</span></div>
        <div className="prodkpi"><b>{done.length}</b><span>Closed</span></div>
      </div>

      {mine.length > 0 && (
        <>
          <h3 className="docsecth">Waiting on you</h3>
          {mine.map(({ review, project }) => (
            <ReviewCard key={review.id} review={review} project={project} nav={nav} ws={ws} />
          ))}
        </>
      )}

      <h3 className="docsecth" style={{ marginTop: 22 }}>All open reviews</h3>
      {open.map(({ review, project }) => <ReviewCard key={review.id} review={review} project={project} nav={nav} ws={ws} />)}
      {!open.length && <p className="railempty">Nothing open.</p>}

      {done.length > 0 && (
        <>
          <h3 className="docsecth" style={{ marginTop: 22 }}>Closed</h3>
          {done.map(({ review, project }) => <ReviewCard key={review.id} review={review} project={project} nav={nav} ws={ws} />)}
        </>
      )}
    </div>
  );
}

// Project-level: raise a review and act on the ones already raised.
export default function ReviewsPage() {
  const { pid } = useParams();
  const nav = useNavigate();
  const ws = useWS();
  const project = findProject(ws, pid);
  const editable = can(ws, 'edit');
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState([]);
  const members = (ws.team?.members || []).filter((m) => !m.owner);

  if (!project) return <div className="docwrap"><p className="railempty">Project not found.</p></div>;
  const reviews = reviewsOf(project);

  const subjects = [
    { id: 'tracker', label: `Tracker — ${project.name}`, type: 'tracker' },
    ...(project.brds || []).map((b) => ({ id: b.id, label: `BRD — ${b.title}`, type: 'brd' })),
    ...(project.decisions || []).map((d) => ({ id: d.id, label: `Decision — ${d.title}`, type: 'decision' }))
  ];

  const raise = () => {
    const s = subjects.find((x) => x.id === subject) || subjects[0];
    if (!s || !picked.length) return;
    mutate((w) => addReview(w, pid, {
      subject: s.label, subjectType: s.type, subjectId: s.id, requestedBy: 'owner', note,
      reviewers: picked.map((id) => ({ memberId: id, role: (members.find((m) => m.id === id)?.roles || [])[0] || 'viewer', status: 'pending' }))
    }));
    setOpen(false); setPicked([]); setNote(''); setSubject('');
  };

  return (
    <div className="docwrap">
      <h1 className="doch1">Review &amp; Approval</h1>
      <p className="docsub">Route this project's tracker, specs or decisions to the people who must sign off — and keep the trail.</p>

      {editable && (open ? (
        <div className="reviewnew">
          <label>What needs review
            <select value={subject} onChange={(e) => setSubject(e.target.value)}>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label>Note to reviewers
            <input value={note} placeholder="Anything they should know before deciding" onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="reviewpick">
            {members.map((m) => (
              <label key={m.id} className={'reslink' + (picked.includes(m.id) ? ' on' : '')}>
                <input type="checkbox" checked={picked.includes(m.id)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, m.id] : picked.filter((x) => x !== m.id))} />
                <span>{m.email} <em className="hint">{(m.roles || []).map(roleLabel).join(', ')}</em></span>
              </label>
            ))}
          </div>
          <div>
            <button className="btn" disabled={!picked.length} onClick={raise}>Send for review</button>
            <button className="fs-linkbtn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn" onClick={() => { setSubject(subjects[0]?.id || ''); setOpen(true); }}>
          <I n="send" s={13} /> Send for review
        </button>
      ))}

      <div style={{ marginTop: 20 }}>
        {reviews.map((r) => <ReviewCard key={r.id} review={r} project={project} nav={nav} ws={ws} detailed />)}
        {!reviews.length && <p className="railempty">Nothing has been sent for review on this project yet.</p>}
      </div>
    </div>
  );
}

function ReviewCard({ review: r, project, nav, ws, detailed }) {
  const [comment, setComment] = useState('');
  const members = ws.team?.members || [];
  const name = (id) => members.find((m) => m.id === id)?.email?.split('@')[0] || id;
  const meIsReviewer = r.reviewers.find((rv) => rv.memberId === 'owner');
  const approved = r.reviewers.filter((rv) => rv.status === 'approved').length;

  const act = (memberId, verdict) => mutate((w) => recordVerdict(w, project.id, r.id, memberId, verdict, comment));

  return (
    <div className={'reviewcard st-' + r.state}>
      <div className="reviewhead">
        <span className="krowtitle"><I n="check" s={13} /> {r.subject}</span>
        <span className={'reviewstate st-' + r.state}>{REVIEW_STATE[r.state]}</span>
      </div>
      <p className="krowmeta">
        {project.name} · raised {shortDate(r.createdAt)} · {approved}/{r.reviewers.length} approved
        {r.note ? ` · “${r.note}”` : ''}
      </p>

      <div className="reviewers">
        {r.reviewers.map((rv) => (
          <div key={rv.memberId} className={'reviewerrow v-' + rv.status}>
            <span className="reviewername">{name(rv.memberId)} <em>{roleLabel(rv.role)}</em></span>
            <span className="reviewerverdict">{VERDICT_LABEL[rv.status]}</span>
            {rv.comment && <span className="reviewercomment">“{rv.comment}”</span>}
            {rv.status === 'pending' && (
              <span className="reviewacts">
                <button className="relbtn" onClick={() => act(rv.memberId, 'approved')}>Approve</button>
                <button className="relbtn ghost" onClick={() => act(rv.memberId, 'changes')}>Request changes</button>
              </span>
            )}
          </div>
        ))}
      </div>

      {detailed && r.reviewers.some((rv) => rv.status === 'pending') && (
        <input className="fieldinput" style={{ marginTop: 8 }} value={comment} placeholder="Optional comment recorded with your verdict"
          onChange={(e) => setComment(e.target.value)} />
      )}

      {detailed && (r.history || []).length > 0 && (
        <div className="reviewhistory">
          <b>Approval history</b>
          {r.history.map((h, i) => (
            <p key={i}>{shortDate(h.at)} · {name(h.memberId)} — {VERDICT_LABEL[h.verdict]}{h.comment ? `: “${h.comment}”` : ''}</p>
          ))}
        </div>
      )}

      {!detailed && (
        <button className="fs-linkbtn" onClick={() => nav(`/ai/p/${project.id}/reviews`)}>Open in project →</button>
      )}
    </div>
  );
}
