// Generic artifact workspace — one component drives PDNs, Epics, User
// Stories, Functional Requirements and Test Cases. A typographic list on
// the left of the route; the selected document in the centre; traceability
// and inline AI actions on the right.
import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ai } from '../lib/api';
import { useWorkspace } from './AiPortal';
import {
  useWS, mutate, uid, now, TYPES, ROUTE_OF, findProject, findDoc, parentOf,
  updateDoc, addDoc, staleInfo, deriveEpics, deriveStories, deriveFrs, deriveTests,
  generateAc, edgeCasesFor, downloadText, shortDate
} from './workspace';
import { TypeIcon } from './icons';
import Attachments from './Attachments';
import TraceRail, { StaleBanner } from './TraceRail';

const EMPTY_HINT = {
  pdn: 'PDNs are generated from a BRD — open a BRD and use "Generate PDN".',
  epic: 'Epics arrive when you generate the delivery chain from a PDN.',
  story: 'User stories arrive with the delivery chain, or by splitting an existing story.',
  fr: 'Functional requirements are derived from a story\'s acceptance criteria.',
  test: 'Test cases are derived from functional requirements.'
};

export default function ArtifactPage({ type }) {
  const { pid, docId } = useParams();
  const nav = useNavigate();
  const ws = useWS();
  const { token } = useWorkspace();
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenErr, setRegenErr] = useState('');
  const project = findProject(ws, pid);
  const t = TYPES[type];
  const docs = project[t.key];
  const doc = docId ? findDoc(project, type, docId) : null;

  if (!doc) {
    return (
      <div className="docwrap">
        <h1 className="doch1">{t.label}</h1>
        <p className="docsub">{docs.length ? `${docs.length} in this project — every one traceable to its source.` : EMPTY_HINT[type]}</p>
        <div className="klist">
          {docs.map((d) => {
            const stale = staleInfo(project, type, d);
            const parent = parentOf(project, type, d);
            return (
              <button key={d.id} className="krow" onClick={() => nav(d.id)}>
                <span className="krowmain">
                  <span className="krowtitle">{d.title}</span>
                  <span className="krowmeta">
                    {metaLine(type, d, parent)}
                    {stale && <span className="staletag"> · upstream changed</span>}
                  </span>
                </span>
                <span className="krowside">{d.points ? `${d.points} pts` : ''}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const stale = staleInfo(project, type, doc);
  const brd = type === 'pdn' ? findDoc(project, 'brd', doc.brdId) : null;

  // ---- inline AI actions per type ----
  const actions = [];
  if (type === 'pdn') {
    const hasChain = project.epics.some((e) => e.pdnId === doc.id);
    actions.push({
      label: hasChain ? 'Delivery chain generated' : 'Generate delivery chain',
      done: hasChain, disabled: hasChain,
      hint: 'Epics → stories → functional requirements → test cases, all traced to this PDN',
      run: () => {
        const epics = deriveEpics(doc);
        const stories = deriveStories(doc, epics);
        const frs = deriveFrs(stories);
        const tests = deriveTests(doc, stories, frs);
        mutate((w) => {
          let next = w;
          epics.forEach((e) => { next = addDoc(next, pid, 'epic', e); });
          stories.forEach((s) => { next = addDoc(next, pid, 'story', s); });
          frs.forEach((f) => { next = addDoc(next, pid, 'fr', f); });
          tests.forEach((x) => { next = addDoc(next, pid, 'test', x); });
          return next;
        });
      }
    });
    actions.push({ label: 'Download markdown', run: () => downloadText('pdn.md', doc.content) });
  }
  if (type === 'story') {
    actions.push({
      label: 'Generate acceptance criteria', hint: 'Adds structured ACs to this story',
      run: () => mutate((w) => updateDoc(w, pid, 'story', doc.id, { ac: [...new Set([...(doc.ac || []), ...generateAc(doc)])] }))
    });
    actions.push({
      label: 'Estimate effort', done: !!doc.points, disabled: !!doc.points,
      run: () => mutate((w) => updateDoc(w, pid, 'story', doc.id, { points: 3 + Math.min(5, (doc.ac || []).length * 2) }))
    });
    actions.push({
      label: 'Split story', hint: 'Moves half the acceptance criteria into a sibling story',
      disabled: (doc.ac || []).length < 2,
      run: () => {
        const half = Math.ceil(doc.ac.length / 2);
        const sibling = { id: uid(), epicId: doc.epicId, title: doc.title + ' — part 2', description: doc.description, ac: doc.ac.slice(half), points: null, component: doc.component, createdAt: now() };
        mutate((w) => addDoc(updateDoc(w, pid, 'story', doc.id, { ac: doc.ac.slice(0, half) }), pid, 'story', sibling));
      }
    });
    const uncovered = (doc.ac || []).filter((ac) => !project.frs.some((f) => f.storyId === doc.id && f.description.includes(ac.slice(0, 40))));
    actions.push({
      label: 'Derive functional requirements', disabled: uncovered.length === 0,
      done: (doc.ac || []).length > 0 && uncovered.length === 0,
      hint: 'One FR per acceptance criterion not yet covered',
      run: () => mutate((w) => {
        let next = w;
        uncovered.forEach((ac) => {
          next = addDoc(next, pid, 'fr', { id: uid(), storyId: doc.id, title: `FR — ${ac.length > 70 ? ac.slice(0, 70) + '…' : ac}`, description: `The system shall satisfy: ${ac}`, createdAt: now() });
        });
        return next;
      })
    });
  }
  if (type === 'fr') {
    actions.push({
      label: 'Generate test case', hint: 'A happy-path case for this requirement',
      run: () => mutate((w) => addDoc(w, pid, 'test', {
        id: uid(), frId: doc.id, title: `Verify — ${doc.title.replace(/^FR — /, '').slice(0, 50)}`,
        gherkin: `Given the system implements this requirement\nWhen the primary flow is exercised\nThen: ${doc.description.replace(/^The system shall /, 'the system does ')}`,
        createdAt: now()
      }))
    });
  }
  if (type === 'test') {
    const fr = parentOf(project, 'test', doc)?.doc;
    actions.push({
      label: 'Generate edge cases', hint: 'Concurrency and boundary variants under the same requirement',
      disabled: !fr,
      run: () => mutate((w) => {
        let next = w;
        edgeCasesFor(fr).forEach((c) => { next = addDoc(next, pid, 'test', { id: uid(), frId: fr.id, ...c, createdAt: now() }); });
        return next;
      })
    });
  }

  // Regenerate = re-ground against the CURRENT BRD version: re-run the real
  // code analysis on today's requirements, refresh the PDN, and grow the
  // delivery chain with any artifacts the new scope demands (new stories get
  // their FRs and test cases derived too). Clears staleness chain-wide.
  const regenerate = type === 'pdn' && stale ? async () => {
    setRegenBusy(true); setRegenErr('');
    try {
      const srcBrd = stale.brd;
      const r2 = await ai.analyze(token, srcBrd.sections.requirements.join('. ') || srcBrd.title);
      if (!r2.matched) { setRegenErr(r2.note || 'Could not ground the updated BRD in the connected code.'); setRegenBusy(false); return; }
      mutate((w) => {
        let next = w;
        const proj = findProject(next, pid);
        const existingTitles = new Set(proj.stories.map((s) => s.title));
        const pdnEpics = proj.epics.filter((e) => e.pdnId === doc.id);
        const newStories = [];
        for (const s of (r2.stories || [])) {
          if (existingTitles.has(s.summary)) continue;
          let epic = pdnEpics.find((e) => e.system === s.component);
          if (!epic) {
            epic = { id: uid(), pdnId: doc.id, title: `${s.component} — ${r2.title || 'additional scope'}`, system: s.component, summary: s.description, createdAt: now() };
            next = addDoc(next, pid, 'epic', epic);
            pdnEpics.push(epic);
          }
          const story = { id: uid(), epicId: epic.id, title: s.summary, description: s.description, ac: [...(s.ac || [])], points: s.points, component: s.component, createdAt: now() };
          next = addDoc(next, pid, 'story', story);
          newStories.push(story);
        }
        const newFrs = deriveFrs(newStories);
        for (const f of newFrs) next = addDoc(next, pid, 'fr', f);
        const suites = (r2.test_suites || []).filter((su) => newStories.some((s) => su.story === s.title));
        for (const t of deriveTests({ analysis: { test_suites: suites } }, newStories, newFrs)) next = addDoc(next, pid, 'test', t);
        return updateDoc(next, pid, 'pdn', doc.id, {
          brdVersion: stale.current,
          analysis: r2,
          researchIds: [...(srcBrd.researchIds || [])],
          content: (r2.pdn_markdown || doc.content) + `\n\n---\n_Regenerated from BRD "${srcBrd.title}" v${stale.current} on ${shortDate(now())} · ${r2.verified}/${r2.impacts.length} impacts verified against source code._`
        });
      });
    } catch (e) { setRegenErr(e.message); }
    setRegenBusy(false);
  } : null;

  return (
    <div className="docwrap">
      <button className="linkbtn" onClick={() => nav(`/ai/p/${pid}/${ROUTE_OF[type]}`)}>← {t.label}</button>
      <div className="docpane">
        <article className="docbody">
          <p className="doctype"><TypeIcon type={type} s={13} /> {t.one}{doc.createdAt ? ` · ${shortDate(doc.createdAt)}` : ''}</p>
          <h1>{doc.title}</h1>
          <StaleBanner project={project} stale={stale} onRegenerate={regenerate} busy={regenBusy} />
          {regenErr && <p className="error">{regenErr}</p>}

          {type === 'pdn' && (
            <>
              <p className="docmeta">Generated from <b>{brd?.title}</b> v{doc.brdVersion} · {doc.researchIds?.length || 0} research documents in context</p>
              <pre className="prose">{doc.content}</pre>
            </>
          )}
          {type === 'epic' && (
            <>
              <p className="docmeta">{doc.system}</p>
              <p className="proseline">{doc.summary}</p>
            </>
          )}
          {type === 'story' && (
            <>
              <p className="docmeta">{doc.component || '—'} · {doc.points ? `${doc.points} points` : 'unestimated'}</p>
              <p className="proseline">{doc.description}</p>
              <h3 className="docsecth">Acceptance criteria</h3>
              {(doc.ac || []).length === 0 && <p className="railempty">None yet — use the AI action to generate them.</p>}
              <ul className="doclist">{(doc.ac || []).map((a, i) => <li key={i}>{a}</li>)}</ul>
            </>
          )}
          {type === 'fr' && <p className="proseline">{doc.description}</p>}
          {type === 'test' && <pre className="gherkin" style={{ marginTop: 14 }}>{doc.gherkin}</pre>}
          <Attachments pid={pid} type={type} doc={doc} />
        </article>

        <TraceRail project={project} type={type} doc={doc} actions={actions} />
      </div>
    </div>
  );
}

function metaLine(type, d, parent) {
  if (type === 'pdn') return `from BRD v${d.brdVersion}`;
  if (type === 'epic') return d.system || '';
  if (type === 'story') return parent ? parent.doc.title : '';
  if (type === 'fr' || type === 'test') return parent ? parent.doc.title.replace(/^FR — /, '') : '';
  return '';
}
