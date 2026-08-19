// Connected Data — Feasly reading Zenith's enterprise data warehouse live.
//
// The EDW is a separate application (the datalake every insurer already
// runs). Feasly connects read-only: it can browse the catalog, sample rows
// and run aggregates, so evidence in a decision can point at company data
// instead of a screenshot pasted into a doc.
import React, { useState, useEffect } from 'react';
import { I } from './icons';
import { useWS, mutate, uid, now, can } from './workspace';

const api = (path, opts) => fetch('/api/edw' + path, {
  ...opts, headers: { 'Content-Type': 'application/json', ...(opts?.headers || {}) }
}).then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; });

export default function DataPage() {
  const ws = useWS();
  const [catalog, setCatalog] = useState(null);
  const [table, setTable] = useState(null);
  const [rows, setRows] = useState(null);
  const [agg, setAgg] = useState(null);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    api('/tables').then((d) => { setCatalog(d); if (d.tables?.length) open(d.tables[0].name); })
      .catch((e) => setErr(`Cannot reach the warehouse: ${e.message}`));
  }, []); // eslint-disable-line

  const open = (name) => {
    setTable(name); setRows(null); setAgg(null);
    api(`/tables/${name}?limit=25`).then(setRows).catch((e) => setErr(e.message));
  };
  const runAgg = (groupBy, metric) => {
    api('/query', { method: 'POST', body: JSON.stringify({ table, groupBy, metric, op: metric ? 'sum' : 'count' }) })
      .then(setAgg).catch((e) => setErr(e.message));
  };

  // The point of the connection: warehouse output becomes decision evidence.
  const saveAsEvidence = () => {
    const pid = ws.projects[0]?.id;
    if (!pid || !rows) return;
    const cols = Object.keys(rows.rows[0] || {});
    const content = `Query against ZENITH_EDW · table ${table} (${rows.total} rows total)\n\n` +
      cols.join(' | ') + '\n' +
      rows.rows.slice(0, 10).map((r) => cols.map((c) => r[c]).join(' | ')).join('\n') +
      (agg ? `\n\nAggregate by ${agg.groupBy}:\n` + agg.results.slice(0, 8).map((r) => `${r.key}: ${r.count} rows${r.sum ? `, sum ${r.sum.toLocaleString('en-IN')}` : ''}`).join('\n') : '');
    const doc = { id: uid(), title: `EDW — ${table} extract`, source: 'analytics', sourceDetail: 'ZENITH_EDW', createdAt: now(), content };
    mutate((w) => ({ ...w, projects: w.projects.map((p) => (p.id === pid ? { ...p, research: [doc, ...p.research] } : p)) }));
    setSaved(doc.title);
    setTimeout(() => setSaved(''), 2500);
  };

  const meta = catalog?.tables?.find((t) => t.name === table);

  return (
    <div className="docwrap">
      <h1 className="doch1">Connected Data</h1>
      <p className="docsub">
        Live read-only connection to <b>ZENITH_EDW</b> — the company's data warehouse, a separate system from this workspace.
        Feasly queries it; nothing is copied.
      </p>
      {err && <p className="error">{err}</p>}

      {catalog && (
        <div className="edwlayout">
          <aside className="edwtables">
            <p className="sigsub">Tables ({catalog.tables.length})</p>
            {catalog.tables.map((t) => (
              <button key={t.name} className={'edwtable' + (t.name === table ? ' on' : '')} onClick={() => open(t.name)}>
                <b>{t.name}</b>
                <span>{t.row_count.toLocaleString('en-IN')} rows</span>
              </button>
            ))}
          </aside>

          <div className="edwmain">
            {meta && (
              <>
                <div className="sighead">
                  <div>
                    <h3 className="docsecth" style={{ margin: 0 }}>{meta.name}</h3>
                    <p className="hint" style={{ margin: '2px 0 0' }}>{meta.description}</p>
                  </div>
                  {can(ws, 'edit') && rows && (
                    <button className="fs-linkbtn" onClick={saveAsEvidence}>Save as evidence →</button>
                  )}
                </div>
                <div className="edwaggbar">
                  <span className="hint">Group by:</span>
                  {meta.columns.slice(0, 6).map((c) => (
                    <button key={c} className="convchip ghost" onClick={() => runAgg(c)}>{c}</button>
                  ))}
                </div>
              </>
            )}

            {agg && (
              <div className="edwagg">
                <p className="sigsub">Aggregate — count by {agg.groupBy}</p>
                {agg.results.slice(0, 8).map((r) => (
                  <div className="funrow" key={r.key}>
                    <span className="funlabel">{String(r.key).slice(0, 22)}</span>
                    <span className="funbarwrap">
                      <span className="funbar" style={{ width: `${Math.max(4, (r.count / agg.results[0].count) * 100)}%` }}>{r.count}</span>
                    </span>
                    <span className="fundrop" />
                  </div>
                ))}
                <button className="fs-linkbtn" onClick={() => setAgg(null)}>Clear</button>
              </div>
            )}

            {rows ? (
              <div className="edwtablewrap">
                <table className="dashtable edwgrid">
                  <thead><tr>{Object.keys(rows.rows[0] || {}).map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>
                    {rows.rows.map((r, i) => (
                      <tr key={i}>{Object.keys(rows.rows[0]).map((c) => <td key={c}>{String(r[c] ?? '—')}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
                <p className="hint">Showing {rows.rows.length} of {rows.total.toLocaleString('en-IN')} rows.</p>
              </div>
            ) : <p className="railempty">Loading…</p>}
            {saved && <p className="hint">✓ Saved “{saved}” to research — link it on a decision as evidence.</p>}
          </div>
        </div>
      )}
      {!catalog && !err && <p className="railempty">Connecting to the warehouse…</p>}
    </div>
  );
}
