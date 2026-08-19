// Performance — north-star metrics per project, tracked over time. A target,
// a baseline, and the readings since: enough to answer "did this work?"
// without a BI tool, and enough to make a decision's outcome measurable.
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { I } from './icons';
import {
  useWS, mutate, uid, now, todayISO, shortDate, findProject, can,
  metricsOf, updateMetrics, emptyMetric, latestPoint, metricHealth
} from './workspace';

const HEALTH_LABEL = { hit: 'On target', near: 'Close', behind: 'Behind', unknown: 'No reading yet' };

export default function PerformancePage() {
  const { pid } = useParams();
  const ws = useWS();
  const project = findProject(ws, pid);
  const editable = can(ws, 'edit');
  const metrics = metricsOf(project);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', unit: '%', target: '', baseline: '' });

  const save = (next) => mutate((w) => updateMetrics(w, pid, next));
  const patchMetric = (id, p) => save(metrics.map((m) => (m.id === id ? { ...m, ...p } : m)));

  const addMetric = () => {
    if (!draft.name.trim()) { setAdding(false); return; }
    save([...metrics, emptyMetric({ name: draft.name.trim(), unit: draft.unit, target: Number(draft.target) || 0, baseline: Number(draft.baseline) || 0 })]);
    setDraft({ name: '', unit: '%', target: '', baseline: '' });
    setAdding(false);
  };
  const addPoint = (m, value) => {
    const v = Number(value);
    if (Number.isNaN(v)) return;
    patchMetric(m.id, { points: [...(m.points || []).filter((p) => p.date !== todayISO()), { date: todayISO(), value: v }] });
  };

  if (!project) return <div className="docwrap"><p className="railempty">Project not found.</p></div>;

  return (
    <div className="docwrap">
      <h1 className="doch1">Performance</h1>
      <p className="docsub">North-star metrics for {project.name} — what success was defined as, and what actually happened since.</p>

      {metrics.map((m) => {
        const last = latestPoint(m);
        const health = metricHealth(m);
        return (
          <div key={m.id} className="metriccard">
            <div className="metrichead">
              <div>
                <b>{m.name}</b>
                <span className="metricsub">target {m.target}{m.unit} · baseline {m.baseline}{m.unit} · {(m.points || []).length} readings</span>
              </div>
              <span className={'metrichealth h-' + health}>{HEALTH_LABEL[health]}</span>
            </div>
            <div className="metricbody">
              <Spark points={m.points || []} target={m.target} baseline={m.baseline} />
              <div className="metricnow">
                <b>{last ? `${last.value}${m.unit}` : '—'}</b>
                <span>{last ? `as of ${shortDate(last.date + 'T00:00:00')}` : 'no reading'}</span>
              </div>
            </div>
            {editable && (
              <div className="metricadd">
                <input type="number" placeholder={`Today's value (${m.unit})`} onKeyDown={(e) => { if (e.key === 'Enter') { addPoint(m, e.target.value); e.target.value = ''; } }} />
                <span className="hint">Press Enter to record today's reading</span>
                <button className="fs-linkbtn" onClick={() => save(metrics.filter((x) => x.id !== m.id))}>Remove metric</button>
              </div>
            )}
          </div>
        );
      })}
      {!metrics.length && <p className="railempty">No metrics defined. A north star turns a decision's success criteria into something you can actually check.</p>}

      {editable && (adding ? (
        <div className="metricnew">
          <input autoFocus placeholder="Metric name — e.g. Quote-to-policy conversion" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input placeholder="Unit" style={{ maxWidth: 80 }} value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
          <input type="number" placeholder="Target" style={{ maxWidth: 100 }} value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} />
          <input type="number" placeholder="Baseline" style={{ maxWidth: 100 }} value={draft.baseline} onChange={(e) => setDraft({ ...draft, baseline: e.target.value })} />
          <button onClick={addMetric}>Add</button>
        </div>
      ) : (
        <button className="btn" style={{ marginTop: 16 }} onClick={() => setAdding(true)}><I n="plus" s={13} /> Define a north-star metric</button>
      ))}
    </div>
  );
}

// Tiny inline trend — no chart library, just the shape of the story.
function Spark({ points, target, baseline }) {
  const pts = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return <div className="sparkempty">{pts.length ? 'One reading so far' : 'No readings yet'}</div>;
  const W = 320, H = 60, pad = 4;
  const vals = [...pts.map((p) => p.value), target || 0, baseline || 0];
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {target ? <line x1={pad} x2={W - pad} y1={y(target)} y2={y(target)} className="sparktarget" /> : null}
      <path d={d} className="sparkline" />
      {pts.map((p, i) => <circle key={p.date} cx={x(i)} cy={y(p.value)} r={2.5} className="sparkdot" />)}
    </svg>
  );
}
