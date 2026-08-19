// Portfolio intelligence — answers questions about the book of work from the
// workspace's own records: trackers, go-live dates, decisions, owners, events.
//
// This runs BEFORE the general chat brain because portfolio questions have
// exact answers. An LLM would paraphrase; this cites. When a question isn't
// about the portfolio it returns null and the normal RAG path takes over.
import { portfolioRows, trackerOf, sortedEvents, STATUS_LABEL, todayISO, roleLabel } from './workspace';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const fmt = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'no date');
const nameOf = (ws, id) => (ws.team?.members || []).find((m) => m.id === id)?.email?.split('@')[0] || 'unassigned';

// Resolve "the EMI project" / "sum insured" to a real project.
function matchProject(ws, q) {
  const rows = portfolioRows(ws);
  const words = q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  let best = null, bestScore = 0;
  for (const r of rows) {
    const hay = (r.project.name + ' ' + (r.tracker.description || '')).toLowerCase();
    const score = words.reduce((n, w) => n + (hay.includes(w) ? (r.project.name.toLowerCase().includes(w) ? 2 : 1) : 0), 0);
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return bestScore >= 2 ? best : null;
}

function monthWindow(q) {
  const now = new Date();
  const lower = q.toLowerCase();
  const mi = MONTHS.findIndex((m) => lower.includes(m));
  if (mi >= 0) {
    const y = now.getFullYear();
    const start = `${y}-${String(mi + 1).padStart(2, '0')}-01`;
    const end = `${y}-${String(mi + 1).padStart(2, '0')}-31`;
    return { start, end, label: `${MONTHS[mi][0].toUpperCase()}${MONTHS[mi].slice(1)} ${y}` };
  }
  const qm = lower.match(/q([1-4])/);
  if (qm) {
    const qn = Number(qm[1]);
    const y = now.getFullYear();
    const s = (qn - 1) * 3 + 1;
    return { start: `${y}-${String(s).padStart(2, '0')}-01`, end: `${y}-${String(s + 2).padStart(2, '0')}-31`, label: `Q${qn} ${y}` };
  }
  if (/last (quarter|3 months|three months)/.test(lower)) {
    const start = new Date(Date.now() - 92 * 86400e3).toISOString().slice(0, 10);
    return { start, end: todayISO(), label: 'the last quarter' };
  }
  return null;
}

export function askPortfolio(ws, question) {
  const q = (question || '').toLowerCase();
  const rows = portfolioRows(ws);
  if (!rows.length) return null;

  const src = (list) => list.map((r) => ({ type: 'project', refId: r.project.id, title: r.project.name, score: 1 }));

  // ── what shipped / went live ────────────────────────────────────────────
  if (/(went|gone|go)\s*live|shipped|released|delivered|launched/.test(q) && !/next|upcoming|coming|will|plan/.test(q)) {
    const win = monthWindow(q);
    let list = rows.filter((r) => r.shipped);
    if (win) list = list.filter((r) => r.goLive >= win.start && r.goLive <= win.end);
    list = list.sort((a, b) => b.goLive.localeCompare(a.goLive));
    if (!list.length) return { reply: `Nothing went live${win ? ` in ${win.label}` : ''} according to the trackers.`, sources: [] };
    return {
      reply: `**${list.length} project${list.length > 1 ? 's' : ''} went live${win ? ` in ${win.label}` : ''}:**\n\n` +
        list.map((r) => `• **${r.project.name}** — ${fmt(r.goLive)} · ${r.product} · owner ${nameOf(ws, r.tracker.owner)}\n  ${r.tracker.description || ''}`).join('\n\n') +
        `\n\nOpen any tracker for its full event history.`,
      sources: src(list)
    };
  }

  // ── what's coming ───────────────────────────────────────────────────────
  if (/(next|upcoming|coming|planned|pipeline|roadmap)/.test(q) && /(month|quarter|live|launch|release|ship|what)/.test(q)) {
    const list = rows.filter((r) => !r.shipped && r.goLive).sort((a, b) => a.goLive.localeCompare(b.goLive));
    if (!list.length) return { reply: 'Nothing scheduled with a go-live date yet.', sources: [] };
    return {
      reply: `**${list.length} project${list.length > 1 ? 's' : ''} in flight:**\n\n` +
        list.map((r) => {
          const days = Math.round((new Date(r.goLive) - new Date(todayISO())) / 86400e3);
          return `• **${r.project.name}** — ${fmt(r.goLive)} (${days > 0 ? `in ${days} days` : 'overdue'}) · ${STATUS_LABEL[r.tracker.status]} · owner ${nameOf(ws, r.tracker.owner)}`;
        }).join('\n') +
        (rows.some((r) => ['at-risk', 'delayed'].includes(r.tracker.status))
          ? `\n\n⚠️ ${rows.filter((r) => ['at-risk', 'delayed'].includes(r.tracker.status)).map((r) => r.project.name).join(', ')} ${rows.filter((r) => ['at-risk', 'delayed'].includes(r.tracker.status)).length > 1 ? 'need' : 'needs'} attention.`
          : ''),
      sources: src(list)
    };
  }

  // ── risk view ───────────────────────────────────────────────────────────
  if (/(at risk|at-risk|delayed|slipping|behind|blocked|on hold|problem)/.test(q)) {
    const list = rows.filter((r) => ['at-risk', 'delayed', 'on-hold'].includes(r.tracker.status));
    if (!list.length) return { reply: 'Nothing is flagged at risk, delayed or on hold right now.', sources: [] };
    return {
      reply: `**${list.length} project${list.length > 1 ? 's need' : ' needs'} attention:**\n\n` +
        list.map((r) => {
          const risk = sortedEvents(r.project).filter((e) => e.type === 'risk').slice(-1)[0];
          return `• **${r.project.name}** — ${STATUS_LABEL[r.tracker.status]}, go-live ${fmt(r.goLive)}\n  ${risk ? `Latest risk: ${risk.note} (${fmt(risk.date)})` : 'No risk event recorded.'}`;
        }).join('\n\n'),
      sources: src(list)
    };
  }

  // ── a specific project: history / why / who / status ────────────────────
  const hit = matchProject(ws, q);
  if (hit) {
    const t = trackerOf(hit.project);
    const events = sortedEvents(hit.project);
    const decisions = hit.project.decisions || [];

    if (/why|reason|rationale|decide|decision/.test(q)) {
      if (!decisions.length) {
        return { reply: `No decision record exists for **${hit.project.name}** yet — the tracker describes it as: ${t.description || '(no description)'}`, sources: src([hit]) };
      }
      return {
        reply: decisions.map((d) => {
          const alts = (d.alternatives || []).map((a) => `  – rejected *${a.option}*: ${a.whyNot}`).join('\n');
          return `**${d.title}**\n\n${d.context || ''}\n\n**We chose:** ${d.chosen || '—'}\n${alts ? `\n**Alternatives considered:**\n${alts}\n` : ''}` +
            `\nConfidence at the time: ${Math.round((d.confidence ?? 0.5) * 100)}%.` +
            (d.outcome ? `\n\n**What actually happened:** ${d.outcome}${d.lessons ? `\n**Lesson:** ${d.lessons}` : ''}` : '\n\nNo outcome recorded yet.');
        }).join('\n\n---\n\n'),
        sources: src([hit])
      };
    }

    const risks = events.filter((e) => e.type === 'risk');
    return {
      reply: `**${hit.project.name}** — ${STATUS_LABEL[t.status]}, go-live ${fmt(t.goLive)}\n` +
        `Product: ${hit.product} · Owner: ${nameOf(ws, t.owner)} · ${t.visibility === 'published' ? 'Published' : 'Private'}\n\n` +
        `${t.description || ''}\n\n` +
        (events.length ? `**History (${events.length} events):**\n` + events.map((e) => `• ${fmt(e.date)} — ${e.note}`).join('\n') : 'No events recorded yet.') +
        (risks.length ? `\n\n⚠️ Open risk: ${risks.slice(-1)[0].note}` : '') +
        (decisions.length ? `\n\n${decisions.length} decision${decisions.length > 1 ? 's' : ''} recorded — ask "why did we build ${hit.project.name}?" for the rationale.` : ''),
      sources: src([hit])
    };
  }

  // ── portfolio overview ──────────────────────────────────────────────────
  if (/(portfolio|all projects|everything|overview|status report|how are we)/.test(q)) {
    const shipped = rows.filter((r) => r.shipped);
    const flight = rows.filter((r) => !r.shipped);
    return {
      reply: `**Portfolio at a glance** (viewing as ${roleLabel(ws.team?.activeRole || 'admin')})\n\n` +
        `• ${shipped.length} delivered · ${flight.length} in flight · ${rows.filter((r) => ['at-risk', 'delayed'].includes(r.tracker.status)).length} needing attention\n\n` +
        `**In flight:**\n` + flight.sort((a, b) => (a.goLive || '9999').localeCompare(b.goLive || '9999'))
          .map((r) => `• ${r.project.name} — ${fmt(r.goLive)} · ${STATUS_LABEL[r.tracker.status]}`).join('\n') +
        `\n\n**Recently delivered:**\n` + shipped.sort((a, b) => b.goLive.localeCompare(a.goLive)).slice(0, 4)
          .map((r) => `• ${r.project.name} — ${fmt(r.goLive)}`).join('\n'),
      sources: src(rows.slice(0, 6))
    };
  }

  return null; // not a portfolio question — let the normal brain answer
}
