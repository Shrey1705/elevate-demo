// ⌘K command palette — navigation as search, Linear-style. One box that
// jumps to any document across every product, any workspace view, any
// project, or runs a quick action. The fastest path between "I need X"
// and X, which is the whole product philosophy in one component.
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { I, TypeIcon } from './icons';
import { useWS, mutate, mergedProject, ROUTE_OF, DECISION_STATUS_LABEL } from './workspace';
import { startCoach } from './DemoCoach';

const VIEWS = [
  { label: 'Timelines — portfolio & go-lives', to: '/ai/timelines', glyph: 'target' },
  { label: 'Reviews & approvals', to: '/ai/reviews', glyph: 'check' },
  { label: 'Connected Data (EDW)', to: '/ai/data', glyph: 'archive' },
  { label: 'Sprint Board', to: '/ai/board', glyph: 'checks' },
  { label: 'Signals — funnel & insights', to: '/ai/signals', glyph: 'scatter' },
  { label: 'Knowledge Graph', to: '/ai/graph', glyph: 'network' },
  { label: 'Semantic Map', to: '/ai/map', glyph: 'globe' },
  { label: 'Settings', to: '/ai/settings', glyph: 'sliders' }
];

// Rank: prefix match beats substring; no match excludes. Titles only — fast
// and predictable, which matters more in a palette than recall depth.
const scoreOf = (label, q) => {
  const i = label.toLowerCase().indexOf(q);
  return i < 0 ? -1 : i === 0 ? 0 : 1;
};

export default function CommandPalette({ open, onClose }) {
  const nav = useNavigate();
  const ws = useWS();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  const groups = useMemo(() => {
    if (!open) return [];
    const query = q.trim().toLowerCase();
    const merged = mergedProject(ws);

    const actions = [
      { label: 'New chat', glyph: 'pen', run: () => { mutate((w) => ({ ...w, activeSessionId: null })); nav('/ai'); } },
      { label: 'Start the guided demo', glyph: 'play', run: () => startCoach() },
      { label: 'Open the buy journey (generate real signals)', glyph: 'rocket', run: () => nav('/buy') }
    ];
    const views = VIEWS.map((v) => ({ label: v.label, glyph: v.glyph, run: () => nav(v.to) }));
    const projects = (ws.projects || []).map((p) => ({
      label: p.name, glyph: 'folder', meta: 'Project', run: () => nav(`/ai/p/${p.id}/decisions`)
    }));
    const docs = [
      ...merged.decisions.map((d) => ({ type: 'decision', d })),
      ...merged.research.map((d) => ({ type: 'research', d })),
      ...merged.brds.map((d) => ({ type: 'brd', d })),
      ...merged.pdns.map((d) => ({ type: 'pdn', d })),
      ...merged.epics.map((d) => ({ type: 'epic', d })),
      ...merged.stories.map((d) => ({ type: 'story', d })),
      ...merged.frs.map((d) => ({ type: 'fr', d })),
      ...merged.tests.map((d) => ({ type: 'test', d }))
    ].map(({ type, d }) => ({
      label: d.title, type,
      meta: `${type === 'decision' ? DECISION_STATUS_LABEL[d.status] || 'Decision' : type.toUpperCase()} · ${d._pname || ''}`,
      run: () => nav(`/ai/p/${d._pid}/${ROUTE_OF[type]}/${d.id}`)
    }));

    const pick = (items, max) => {
      if (!query) return items.slice(0, max);
      return items
        .map((it) => ({ it, s: scoreOf(it.label, query) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => a.s - b.s)
        .slice(0, max)
        .map((x) => x.it);
    };

    const out = [];
    const acts = pick(actions, 3); if (acts.length) out.push({ name: 'Actions', items: acts });
    const vws = pick(views, 5); if (vws.length) out.push({ name: 'Views', items: vws });
    const projs = pick(projects, 4); if (projs.length) out.push({ name: 'Projects', items: projs });
    const dcs = pick(query ? docs : docs.slice(0, 6), query ? 8 : 5);
    if (dcs.length) out.push({ name: 'Documents', items: dcs });
    return out;
  }, [open, q, ws, nav]);

  const flat = groups.flatMap((g) => g.items);
  const clamped = Math.min(idx, Math.max(0, flat.length - 1));

  const go = (item) => { onClose(); item.run(); };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && flat[clamped]) { e.preventDefault(); go(flat[clamped]); }
    else if (e.key === 'Escape') onClose();
  };

  useEffect(() => {
    listRef.current?.querySelector('.pal-item.sel')?.scrollIntoView({ block: 'nearest' });
  }, [clamped]);

  if (!open) return null;
  let running = -1;
  return (
    <div className="pal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pal" role="dialog" aria-label="Command palette">
        <div className="pal-inputrow">
          <I n="search" s={15} />
          <input ref={inputRef} value={q} placeholder="Search documents, views, projects — or run an action…"
            onChange={(e) => { setQ(e.target.value); setIdx(0); }} onKeyDown={onKey} />
          <kbd>esc</kbd>
        </div>
        <div className="pal-list" ref={listRef}>
          {groups.map((g) => (
            <div key={g.name}>
              <p className="pal-group">{g.name}</p>
              {g.items.map((item) => {
                running++;
                const sel = running === clamped;
                const at = running;
                return (
                  <button key={g.name + item.label + at} className={'pal-item' + (sel ? ' sel' : '')}
                    onMouseEnter={() => setIdx(at)} onClick={() => go(item)}>
                    {item.type ? <TypeIcon type={item.type} s={14} /> : <I n={item.glyph || 'dot'} s={14} />}
                    <span className="pal-label">{item.label}</span>
                    {item.meta && <span className="pal-meta">{item.meta}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {!flat.length && <p className="railempty" style={{ padding: 14 }}>Nothing matches “{q}”.</p>}
        </div>
      </div>
    </div>
  );
}
