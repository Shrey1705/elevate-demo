// Timelines — the answer to "what went live, and what's coming?" in one
// screen. Delivered work groups backwards by month, in-flight work forwards,
// each row carrying the status, owner and product a review meeting asks for.
// Click any row to open its tracker.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { I } from './icons';
import {
  useWS, portfolioRows, STATUS_LABEL, todayISO, shortDate, roleLabel, myRole, can
} from './workspace';

const monthKey = (d) => (d || '').slice(0, 7);
const monthLabel = (k) => k
  ? new Date(k + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  : 'No date set';

export default function PortfolioPage() {
  const ws = useWS();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [productFilter, setProductFilter] = useState('all');

  const rows = portfolioRows(ws)
    .filter((r) => (productFilter === 'all' ? true : r.project.productId === productFilter))
    .filter((r) => (q ? r.project.name.toLowerCase().includes(q.toLowerCase()) : true));

  const shipped = rows.filter((r) => r.shipped).sort((a, b) => b.goLive.localeCompare(a.goLive));
  const upcoming = rows.filter((r) => !r.shipped).sort((a, b) => (a.goLive || '9999').localeCompare(b.goLive || '9999'));
  const atRisk = upcoming.filter((r) => ['at-risk', 'delayed'].includes(r.tracker.status));

  const group = (list) => {
    const out = {};
    for (const r of list) (out[monthKey(r.goLive)] = out[monthKey(r.goLive)] || []).push(r);
    return out;
  };

  return (
    <div className="docwrap">
      <h1 className="doch1">Timelines</h1>
      <p className="docsub">
        Every project across every product — what shipped and when, what's next, and what needs attention.
        You're viewing as <b>{roleLabel(myRole(ws))}</b>.
      </p>

      <div className="pfkpis">
        <div className="prodkpi"><b>{shipped.length}</b><span>Delivered</span></div>
        <div className="prodkpi"><b>{upcoming.length}</b><span>In flight</span></div>
        <div className={'prodkpi' + (atRisk.length ? ' warn' : '')}><b>{atRisk.length}</b><span>At risk / delayed</span></div>
        <div className="prodkpi"><b>{(ws.products || []).length}</b><span>Products</span></div>
      </div>

      <div className="pffilters">
        <input value={q} placeholder="Filter projects…" onChange={(e) => setQ(e.target.value)} />
        <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
          <option value="all">All products</option>
          {(ws.products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <h3 className="docsecth">Coming up</h3>
      {upcoming.length === 0 && <p className="railempty">Nothing scheduled.</p>}
      {Object.entries(group(upcoming)).map(([k, list]) => (
        <div key={k} className="pfmonth">
          <p className="pfmonthlabel">{monthLabel(k)}</p>
          {list.map((r) => <PortfolioRow key={r.project.id} row={r} nav={nav} ws={ws} />)}
        </div>
      ))}

      <h3 className="docsecth" style={{ marginTop: 26 }}>Delivered</h3>
      {shipped.length === 0 && <p className="railempty">Nothing delivered yet.</p>}
      {Object.entries(group(shipped)).map(([k, list]) => (
        <div key={k} className="pfmonth">
          <p className="pfmonthlabel">{monthLabel(k)}</p>
          {list.map((r) => <PortfolioRow key={r.project.id} row={r} nav={nav} ws={ws} />)}
        </div>
      ))}
    </div>
  );
}

function PortfolioRow({ row, nav, ws }) {
  const { project: p, tracker: t, goLive } = row;
  const owner = (ws.team?.members || []).find((m) => m.id === t.owner);
  const days = goLive ? Math.round((new Date(goLive) - new Date(todayISO())) / 86400e3) : null;
  return (
    <button className="pfrow" onClick={() => nav(`/ai/p/${p.id}/tracker`)}>
      <span className={'pfstatus s-' + t.status} title={STATUS_LABEL[t.status]} />
      <span className="pfmain">
        <span className="pfname">{p.name}</span>
        <span className="pfmeta">
          {row.product} · {t.visibility === 'published' ? 'Published' : 'Private'} · {owner?.email?.split('@')[0] || 'unassigned'}
          {(t.events || []).length ? ` · ${t.events.length} events` : ''}
        </span>
      </span>
      <span className="pfstatuslabel">{STATUS_LABEL[t.status]}</span>
      <span className="pfdate">
        {goLive ? shortDate(goLive + 'T00:00:00') : '—'}
        {days !== null && days > 0 && <em>in {days}d</em>}
      </span>
    </button>
  );
}
