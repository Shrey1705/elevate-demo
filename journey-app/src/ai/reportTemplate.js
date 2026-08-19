// Executive status report — the prebuilt visual template a stakeholder takes
// into the meeting. Opens in its own window, styled for paper, and prints
// straight to PDF. Everything on it is derived from the workspace, so it can
// be regenerated in one click instead of rebuilt in slides every month.
import { STATUS_LABEL, PRIORITIES, EVENT_TYPES, todayISO, sortedEvents, metricsOf, latestPoint } from './workspace';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const d = (x) => (x ? new Date(x + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export function statusReportHTML(ws, rows) {
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const delivered = rows.filter((r) => r.shipped);
  const flight = rows.filter((r) => !r.shipped);
  const risk = rows.filter((r) => ['at-risk', 'delayed'].includes(r.tracker.status));

  const card = (r) => {
    const pri = PRIORITIES[r.priority];
    const events = sortedEvents(r.project);
    const recent = events.filter((e) => e.date <= todayISO()).slice(-3).reverse();
    const upcoming = events.filter((e) => e.date > todayISO()).slice(0, 2);
    const metrics = metricsOf(r.project);
    return `
    <div class="card">
      <div class="cardhead">
        <div>
          <span class="pri" style="background:${pri.tint}">${esc(r.priority)}</span>
          <h3>${esc(r.project.name)}</h3>
          <p class="sub">${esc(r.product)} · owner ${esc(String(r.owner).split('@')[0])} · go-live ${d(r.goLive)}</p>
        </div>
        <span class="status s-${esc(r.tracker.status)}">${esc(STATUS_LABEL[r.tracker.status])}</span>
      </div>
      <div class="bar"><span style="width:${r.progress}%"></span></div>
      <p class="pct">${r.progress}% complete</p>
      <p class="desc">${esc(r.tracker.description)}</p>
      ${r.latestRisk ? `<p class="risk"><b>Risk:</b> ${esc(r.latestRisk.note)} <em>(${d(r.latestRisk.date)})</em></p>` : ''}
      ${recent.length ? `<p class="lbl">Recent</p><ul>${recent.map((e) => `<li><i style="background:${EVENT_TYPES[e.type]?.tint || '#888'}"></i>${d(e.date)} — ${esc(e.note)}</li>`).join('')}</ul>` : ''}
      ${upcoming.length ? `<p class="lbl">Next</p><ul>${upcoming.map((e) => `<li><i style="background:${EVENT_TYPES[e.type]?.tint || '#888'}"></i>${d(e.date)} — ${esc(e.note)}</li>`).join('')}</ul>` : ''}
      ${metrics.length ? `<p class="lbl">North star</p><ul class="metrics">${metrics.map((m) => {
        const last = latestPoint(m);
        return `<li>${esc(m.name)}: <b>${last ? esc(last.value + m.unit) : '—'}</b> against ${esc(m.target + m.unit)} target</li>`;
      }).join('')}</ul>` : ''}
    </div>`;
  };

  return `<!doctype html><html><head><meta charset="utf-8"><title>Zenith — Delivery status ${today}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #16202e; margin: 0; padding: 26px; background: #f6f7f9; }
  .sheet { max-width: 920px; margin: 0 auto; background: #fff; padding: 34px 38px; box-shadow: 0 8px 40px rgba(13,36,64,.1); border-radius: 6px; }
  header { border-bottom: 3px solid #0d2440; padding-bottom: 14px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-end; }
  h1 { margin: 0; font-size: 24px; letter-spacing: -.02em; color: #0d2440; }
  .meta { font-size: 12px; color: #667; text-align: right; }
  .kpis { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 24px; }
  .kpi { border: 1px solid #e3e7ee; border-radius: 8px; padding: 12px 14px; }
  .kpi b { display: block; font-size: 26px; letter-spacing: -.03em; color: #0d2440; }
  .kpi span { font-size: 11px; color: #667; text-transform: uppercase; letter-spacing: .05em; }
  .kpi.warn b { color: #b45309; } .kpi.crit b { color: #c0392b; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .07em; color: #667; margin: 26px 0 12px; border-bottom: 1px solid #e3e7ee; padding-bottom: 6px; }
  .card { border: 1px solid #e3e7ee; border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; page-break-inside: avoid; }
  .cardhead { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .cardhead h3 { margin: 6px 0 2px; font-size: 15px; color: #0d2440; }
  .sub { margin: 0; font-size: 11.5px; color: #667; }
  .pri { display: inline-block; font-size: 10px; font-weight: 700; color: #fff; border-radius: 4px; padding: 2px 7px; }
  .status { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; border-radius: 999px; padding: 4px 11px; background: #eef1f5; color: #445; white-space: nowrap; }
  .status.s-on-track { background: #e6f7ec; color: #1a7a4a; }
  .status.s-at-risk { background: #fdf3d9; color: #8a6d1a; }
  .status.s-delayed { background: #fdeae8; color: #b3261e; }
  .status.s-live { background: #e5f0fd; color: #0a5fc0; }
  .bar { height: 7px; background: #eef1f5; border-radius: 99px; overflow: hidden; margin: 12px 0 4px; }
  .bar span { display: block; height: 100%; background: linear-gradient(90deg,#0d2440,#3b6fb6); }
  .pct { margin: 0 0 8px; font-size: 11px; color: #667; }
  .desc { margin: 0 0 8px; font-size: 12.5px; line-height: 1.55; }
  .risk { margin: 6px 0; font-size: 12px; background: #fdf3d9; border-left: 3px solid #c9a227; padding: 7px 10px; border-radius: 0 4px 4px 0; }
  .lbl { margin: 10px 0 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #889; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { font-size: 12px; line-height: 1.7; color: #334; }
  li i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 7px; }
  .metrics li { padding-left: 14px; }
  footer { margin-top: 26px; border-top: 1px solid #e3e7ee; padding-top: 12px; font-size: 11px; color: #889; display: flex; justify-content: space-between; }
  .noprint { text-align: center; margin: 0 auto 18px; max-width: 920px; }
  .noprint button { font: inherit; font-size: 13px; font-weight: 600; background: #0d2440; color: #fff; border: none; border-radius: 8px; padding: 9px 20px; cursor: pointer; }
  @media print { body { background: #fff; padding: 0; } .sheet { box-shadow: none; padding: 0; } .noprint { display: none; } }
</style></head><body>
<div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>
<div class="sheet">
  <header>
    <div><h1>Delivery status report</h1><p class="sub">Zenith · all products</p></div>
    <div class="meta">${today}<br/>${rows.length} projects in scope</div>
  </header>
  <div class="kpis">
    <div class="kpi"><b>${delivered.length}</b><span>Delivered</span></div>
    <div class="kpi"><b>${flight.length}</b><span>In flight</span></div>
    <div class="kpi ${risk.length ? 'warn' : ''}"><b>${risk.length}</b><span>At risk</span></div>
    <div class="kpi ${rows.filter((r) => r.priority === 'P0').length ? 'crit' : ''}"><b>${rows.filter((r) => r.priority === 'P0').length}</b><span>P0 critical</span></div>
  </div>
  ${risk.length ? `<h2>Needs a decision</h2>${risk.map(card).join('')}` : ''}
  ${flight.filter((r) => !risk.includes(r)).length ? `<h2>In flight</h2>${flight.filter((r) => !risk.includes(r)).map(card).join('')}` : ''}
  ${delivered.length ? `<h2>Delivered</h2>${delivered.map(card).join('')}` : ''}
  <footer><span>Generated from Feasly — every figure derived from project records</span><span>${today}</span></footer>
</div>
</body></html>`;
}
