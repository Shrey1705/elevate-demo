// Timelines — the organisational roadmap, and the screen where a stakeholder
// decides what to prioritise. Two views over the same filtered set:
//
//   Roadmap — a Gantt across product swimlanes, with today marked, progress
//             filled inside each bar and milestones as diamonds. Answers
//             "how does this land relative to everything else?"
//   List    — the same rows as a sortable table, priority editable inline.
//
// Clicking anything opens quick highlights without leaving the page; the
// project folder is one more click. Everything visible is exportable.
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { I } from './icons';
import {
  useWS, mutate, portfolioRows, roadmapRange, pctBetween, updateTracker,
  STATUS_LABEL, TRACKER_STATUS, PRIORITIES, EVENT_TYPES, todayISO, shortDate,
  roleLabel, myRole, can, sortedEvents, metricsOf, latestPoint,
  toCSV, downloadFile, TIMELINE_COLUMNS, progressReportCSV
} from './workspace';
import { statusReportHTML } from './reportTemplate';

const monthName = (k) => new Date(k + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' });
const monthYear = (k) => new Date(k + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export default function PortfolioPage() {
  const ws = useWS();
  const nav = useNavigate();
  const [view, setView] = useState('roadmap');
  const [sel, setSel] = useState(null);          // project id for the highlights drawer
  const [exportOpen, setExportOpen] = useState(false);
  const [f, setF] = useState({ q: '', product: 'all', status: 'all', priority: 'all', startAfter: '', deliverBefore: '' });
  const [sort, setSort] = useState('date');

  const all = portfolioRows(ws);
  const rows = useMemo(() => {
    const out = all.filter((r) => {
      if (f.q) {
        const hay = `${r.project.name} ${r.tracker.description} ${r.product} ${r.owner}`.toLowerCase();
        if (!hay.includes(f.q.toLowerCase())) return false;
      }
      if (f.product !== 'all' && r.project.productId !== f.product) return false;
      if (f.status !== 'all' && r.tracker.status !== f.status) return false;
      if (f.priority !== 'all' && r.priority !== f.priority) return false;
      if (f.startAfter && (r.startDate || '') < f.startAfter) return false;
      if (f.deliverBefore && (r.goLive || '9999') > f.deliverBefore) return false;
      return true;
    });
    const by = {
      date: (a, b) => (a.goLive || '9999').localeCompare(b.goLive || '9999'),
      priority: (a, b) => PRIORITIES[a.priority].rank - PRIORITIES[b.priority].rank || (a.goLive || '9999').localeCompare(b.goLive || '9999'),
      progress: (a, b) => b.progress - a.progress,
      name: (a, b) => a.project.name.localeCompare(b.project.name)
    };
    return out.sort(by[sort] || by.date);
  }, [all, f, sort]);

  const selRow = rows.find((r) => r.project.id === sel) || all.find((r) => r.project.id === sel);
  const active = f.q || f.product !== 'all' || f.status !== 'all' || f.priority !== 'all' || f.startAfter || f.deliverBefore;

  const kpi = {
    delivered: rows.filter((r) => r.shipped).length,
    flight: rows.filter((r) => !r.shipped).length,
    risk: rows.filter((r) => ['at-risk', 'delayed'].includes(r.tracker.status)).length,
    critical: rows.filter((r) => r.priority === 'P0').length
  };

  const exportTimeline = () => {
    downloadFile(`zenith-timelines-${todayISO()}.csv`, toCSV(rows, TIMELINE_COLUMNS));
    setExportOpen(false);
  };
  const exportAllReports = () => {
    downloadFile(`zenith-portfolio-report-${todayISO()}.csv`,
      rows.map((r) => `PROJECT: ${r.project.name}\n${progressReportCSV(ws, r)}`).join('\n\n\n'));
    setExportOpen(false);
  };
  const openVisualReport = () => {
    const w = window.open('', '_blank');
    if (w) { w.document.write(statusReportHTML(ws, rows)); w.document.close(); }
    setExportOpen(false);
  };

  return (
    <div className="docwrap tl-wrap">
      <div className="tl-head">
        <div>
          <h1 className="doch1" style={{ marginBottom: 2 }}>Timelines</h1>
          <p className="docsub" style={{ margin: 0 }}>
            The organisational roadmap — what shipped, what's coming, and what needs a decision.
            Viewing as <b>{roleLabel(myRole(ws))}</b>.
          </p>
        </div>
        <div className="tl-headacts">
          <div className="tl-toggle">
            <button className={view === 'roadmap' ? 'on' : ''} onClick={() => setView('roadmap')}><I n="network" s={12} /> Roadmap</button>
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><I n="checks" s={12} /> List</button>
          </div>
          <div className="tl-exportwrap">
            <button className="tl-export" onClick={() => setExportOpen((v) => !v)}><I n="download" s={13} /> Export</button>
            {exportOpen && (
              <div className="tl-exportmenu" onMouseLeave={() => setExportOpen(false)}>
                <button onClick={exportTimeline}><b>Timeline (CSV)</b><span>{rows.length} projects, as filtered</span></button>
                <button onClick={exportAllReports}><b>Full progress report (CSV)</b><span>Events, metrics and delivery per project</span></button>
                <button onClick={openVisualReport}><b>Executive status report</b><span>Printable one-pager — ⌘P to save as PDF</span></button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="tl-kpis">
        <Kpi n={kpi.delivered} label="Delivered" />
        <Kpi n={kpi.flight} label="In flight" />
        <Kpi n={kpi.risk} label="At risk / delayed" warn={kpi.risk > 0} />
        <Kpi n={kpi.critical} label="P0 critical" crit={kpi.critical > 0} />
      </div>

      <div className="tl-filters">
        <span className="tl-search">
          <I n="search" s={13} />
          <input value={f.q} placeholder="Search projects, owners, descriptions…" onChange={(e) => setF({ ...f, q: e.target.value })} />
        </span>
        <select value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })}>
          <option value="all">All products</option>
          {(ws.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
          <option value="all">Any priority</option>
          {Object.keys(PRIORITIES).map((p) => <option key={p} value={p}>{PRIORITIES[p].label}</option>)}
        </select>
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="all">Any status</option>
          {TRACKER_STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <label className="tl-datef">Starts after<input type="date" value={f.startAfter} onChange={(e) => setF({ ...f, startAfter: e.target.value })} /></label>
        <label className="tl-datef">Delivers before<input type="date" value={f.deliverBefore} onChange={(e) => setF({ ...f, deliverBefore: e.target.value })} /></label>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="date">Sort: go-live</option>
          <option value="priority">Sort: priority</option>
          <option value="progress">Sort: progress</option>
          <option value="name">Sort: name</option>
        </select>
        {active && <button className="fs-linkbtn" onClick={() => setF({ q: '', product: 'all', status: 'all', priority: 'all', startAfter: '', deliverBefore: '' })}>Clear</button>}
        <span className="tl-count">{rows.length} of {all.length}</span>
      </div>

      {view === 'roadmap'
        ? <Roadmap ws={ws} rows={rows} onSelect={setSel} selected={sel} />
        : <ListView ws={ws} rows={rows} onSelect={setSel} nav={nav} />}

      {selRow && <Highlights ws={ws} row={selRow} onClose={() => setSel(null)} nav={nav} />}
    </div>
  );
}

const Kpi = ({ n, label, warn, crit }) => (
  <div className={'tl-kpi' + (crit ? ' crit' : warn ? ' warn' : '')}><b>{n}</b><span>{label}</span></div>
);

// ---------- roadmap (Gantt) ----------
function Roadmap({ ws, rows, onSelect, selected }) {
  const range = roadmapRange(rows);
  const todayPct = pctBetween(range, todayISO());
  // group into product swimlanes, preserving the filtered sort inside each
  const lanes = [];
  for (const r of rows) {
    let lane = lanes.find((l) => l.name === r.product);
    if (!lane) { lane = { name: r.product, rows: [] }; lanes.push(lane); }
    lane.rows.push(r);
  }

  if (!rows.length) return <p className="railempty">No projects match these filters.</p>;

  return (
    <div className="rm">
      <div className="rm-scroll">
        <div className="rm-inner" style={{ minWidth: Math.max(760, range.months.length * 96) }}>
          <div className="rm-months">
            {range.months.map((m) => (
              <div key={m} className={'rm-month' + (m === todayISO().slice(0, 7) ? ' now' : '')}>
                <span>{monthName(m)}</span>
                <em>{m.slice(2, 4)}</em>
              </div>
            ))}
          </div>

          <div className="rm-body">
            <div className="rm-today" style={{ left: `${todayPct}%` }}><span>today</span></div>
            {range.months.map((m, i) => <div key={m} className="rm-grid" style={{ left: `${(i / range.months.length) * 100}%`, width: `${100 / range.months.length}%` }} />)}

            {lanes.map((lane) => (
              <div key={lane.name} className="rm-lane">
                <p className="rm-lanename">{lane.name}</p>
                {lane.rows.map((r) => {
                  const left = pctBetween(range, r.startDate || r.goLive);
                  const right = pctBetween(range, r.goLive || r.startDate);
                  const width = Math.max(3.5, right - left);
                  const pri = PRIORITIES[r.priority];
                  return (
                    <div key={r.project.id} className="rm-row">
                      <button
                        className={'rm-bar s-' + r.tracker.status + (selected === r.project.id ? ' sel' : '')}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        onClick={() => onSelect(r.project.id)}
                        title={`${r.project.name} · ${STATUS_LABEL[r.tracker.status]} · ${r.progress}% · ${pri.label}`}
                      >
                        <span className="rm-fill" style={{ width: `${r.progress}%` }} />
                        <span className="rm-pri" style={{ background: pri.tint }} />
                        <span className="rm-label">{r.project.name}</span>
                        <span className="rm-pct">{r.progress}%</span>
                      </button>
                      {sortedEvents(r.project)
                        .filter((e) => ['milestone', 'release', 'approval'].includes(e.type) && e.date)
                        .map((e) => (
                          <span key={e.id} className="rm-mile" style={{ left: `${pctBetween(range, e.date)}%`, background: EVENT_TYPES[e.type]?.tint }}
                            title={`${shortDate(e.date + 'T00:00:00')} — ${e.note}`} />
                        ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="rm-legend">
        {Object.entries(PRIORITIES).map(([k, v]) => <span key={k}><i style={{ background: v.tint }} />{v.label}</span>)}
        <span className="rm-legendsep" />
        <span><i className="rm-legendmile" />Milestone / go-live</span>
        <span className="hint">Bar fill = progress · click any bar for highlights</span>
      </div>
    </div>
  );
}

// ---------- list ----------
function ListView({ ws, rows, onSelect, nav }) {
  const editable = can(ws, 'edit');
  const setPriority = (pid, priority) => mutate((w) => updateTracker(w, pid, { priority }));
  if (!rows.length) return <p className="railempty">No projects match these filters.</p>;
  return (
    <div className="tl-tablewrap">
      <table className="tl-table">
        <thead>
          <tr><th>Project</th><th>Priority</th><th>Status</th><th>Progress</th><th>Start</th><th>Go-live</th><th>Owner</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const days = r.goLive ? Math.round((new Date(r.goLive) - new Date(todayISO())) / 86400e3) : null;
            return (
              <tr key={r.project.id} className={r.tracker.status === 'delayed' ? 'row-late' : ''}>
                <td>
                  <button className="tl-name" onClick={() => onSelect(r.project.id)}>{r.project.name}</button>
                  <span className="tl-sub">{r.product} · {r.tracker.visibility === 'published' ? 'Published' : 'Private'}</span>
                </td>
                <td>
                  {editable ? (
                    <select className="tl-pri" style={{ color: PRIORITIES[r.priority].tint }} value={r.priority}
                      onChange={(e) => setPriority(r.project.id, e.target.value)}>
                      {Object.keys(PRIORITIES).map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  ) : <span style={{ color: PRIORITIES[r.priority].tint, fontWeight: 700 }}>{r.priority}</span>}
                </td>
                <td><span className={'tl-status s-' + r.tracker.status}>{STATUS_LABEL[r.tracker.status]}</span></td>
                <td>
                  <span className="tl-prog"><span style={{ width: `${r.progress}%` }} /></span>
                  <em>{r.progress}%</em>
                </td>
                <td className="tl-date">{r.startDate ? shortDate(r.startDate + 'T00:00:00') : '—'}</td>
                <td className="tl-date">
                  {r.goLive ? shortDate(r.goLive + 'T00:00:00') : '—'}
                  {days !== null && days > 0 && <em>in {days}d</em>}
                </td>
                <td className="tl-owner">{String(r.owner).split('@')[0]}</td>
                <td><button className="fs-linkbtn" onClick={() => nav(`/ai/p/${r.project.id}/tracker`)}>Open →</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- highlights drawer ----------
function Highlights({ ws, row, onClose, nav }) {
  const p = row.project;
  const events = sortedEvents(p);
  const past = events.filter((e) => e.date <= todayISO()).slice(-4).reverse();
  const next = events.filter((e) => e.date > todayISO()).slice(0, 3);
  const metrics = metricsOf(p);
  const pri = PRIORITIES[row.priority];

  return (
    <>
      <div className="hl-backdrop" onClick={onClose} />
      <aside className="hl">
        <div className="hl-head">
          <div>
            <span className="hl-pri" style={{ background: pri.tint }}>{row.priority}</span>
            <h2>{p.name}</h2>
            <p className="hint">{row.product} · owner {String(row.owner).split('@')[0]} · {row.tracker.visibility === 'published' ? 'Published' : 'Private'}</p>
          </div>
          <button className="reviewx" onClick={onClose} aria-label="Close"><I n="x" s={16} /></button>
        </div>

        <div className="hl-statband">
          <div><span>Status</span><b className={'tl-status s-' + row.tracker.status}>{STATUS_LABEL[row.tracker.status]}</b></div>
          <div><span>Go-live</span><b>{row.goLive ? shortDate(row.goLive + 'T00:00:00') : '—'}</b></div>
          <div><span>Progress</span><b>{row.progress}%</b></div>
        </div>
        <span className="tl-prog big"><span style={{ width: `${row.progress}%` }} /></span>

        <p className="hl-desc">{row.tracker.description || 'No description recorded.'}</p>

        {row.latestRisk && (
          <div className="hl-risk"><I n="refresh" s={13} /> <span><b>Open risk</b> — {row.latestRisk.note} <em>({shortDate(row.latestRisk.date + 'T00:00:00')})</em></span></div>
        )}

        {next.length > 0 && (
          <>
            <p className="sigsub">Coming up</p>
            {next.map((e) => (
              <p key={e.id} className="hl-ev"><i style={{ background: EVENT_TYPES[e.type]?.tint }} />{shortDate(e.date + 'T00:00:00')} — {e.note}</p>
            ))}
          </>
        )}

        <p className="sigsub">Recent highlights</p>
        {past.length ? past.map((e) => (
          <p key={e.id} className="hl-ev"><i style={{ background: EVENT_TYPES[e.type]?.tint }} />{shortDate(e.date + 'T00:00:00')} — {e.note}</p>
        )) : <p className="railempty">No events recorded yet.</p>}

        {metrics.length > 0 && (
          <>
            <p className="sigsub">North-star metrics</p>
            {metrics.map((m) => {
              const last = latestPoint(m);
              return (
                <p key={m.id} className="hl-metric">
                  <span>{m.name}</span>
                  <b>{last ? `${last.value}${m.unit}` : '—'}<em> / {m.target}{m.unit}</em></b>
                </p>
              );
            })}
          </>
        )}

        <div className="hl-acts">
          <button className="btn" onClick={() => nav(`/ai/p/${p.id}/tracker`)}>Open project folder →</button>
          <button className="fs-linkbtn" onClick={() => downloadFile(`${p.name.replace(/\W+/g, '-').toLowerCase()}-progress-${todayISO()}.csv`, progressReportCSV(ws, row))}>
            Download progress report (CSV)
          </button>
        </div>
      </aside>
    </>
  );
}
