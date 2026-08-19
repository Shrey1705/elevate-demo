// Feasly — an AI product-management workspace, in a light "liquid glass"
// design language. One persistent shell: a floating translucent sidebar
// where everything nests (Chats, Products → Projects → the artifact chain,
// Recent), a chat-first landing, and a computed lifecycle stage on every
// project. Theme colors are user tokens.
import React, { useState, useEffect, createContext, useContext } from 'react';
import { useLocation, Routes, Route, NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { ai } from '../lib/api';
import {
  useWS, mutate, resetWS, uid, now, findProject, findProduct, projectsOf,
  ALL_PRODUCT, DEFAULT_THEME, TYPES, ROUTE_OF, enableUserSync, disableUserSync, can, projectDueCount, projectOverdueActions,
  underLimit, usageOf, PLAN_LIMITS, planOf, ROLES, myRoles, myRole, roleLabel, canModule, openReviewsFor
} from './workspace';
import { I, TypeIcon } from './icons';
import ChatHome from './ChatHome';
import ProductPage from './ProductPage';
import StageStrip from './StageStrip';
import ResearchPage from './ResearchPage';
import ConversationsPage from './ConversationsPage';
import LibraryPage from './LibraryPage';
import BrdsPage from './BrdsPage';
import ArtifactPage from './ArtifactPage';
import GraphPage from './GraphPage';
import SemanticMapPage from './SemanticMapPage';
import ReleasesPage from './ReleasesPage';
import PlaybooksPage from './PlaybooksPage';
import BoardPage from './BoardPage';
import DecisionsPage from './DecisionsPage';
import SignalsPage from './SignalsPage';
import PortfolioPage from './PortfolioPage';
import TrackerPage from './TrackerPage';
import PerformancePage from './PerformancePage';
import ReviewsPage, { ReviewQueuePage } from './ReviewsPage';
import DataPage from './DataPage';
import CommandPalette from './CommandPalette';
import SettingsPage from './SettingsPage';
import AssistPanel from './AssistPanel';
import DemoCoach, { startCoach } from './DemoCoach';

const WorkspaceContext = createContext(null);
export const useWorkspace = () => useContext(WorkspaceContext);

// Theme variables flow from the store so Appearance changes apply live.
function themeVars(ws) {
  const t = ws.theme || DEFAULT_THEME;
  return { '--p': t.primary, '--s': t.secondary, '--t': t.tertiary };
}

// Sessions persist across refreshes: { token, user, mode: 'demo' | 'user' }.
const AUTH_KEY = 'feasly-auth-v1';
const readAuth = () => { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; } };

export default function AiPortal() {
  const [session, setSession] = useState(readAuth);
  const [ready, setReady] = useState(false);
  const location = useLocation();
  const ws = useWS();
  const fromJourney = location.search.includes('from=journey');

  const setAuth = (s) => {
    try { s ? localStorage.setItem(AUTH_KEY, JSON.stringify(s)) : localStorage.removeItem(AUTH_KEY); } catch { /* ignore */ }
    setReady(false);
    setSession(s);
  };

  // Point the store at the right workspace before anything renders: cloud
  // sync for email accounts, browser-local seeded demo otherwise.
  //
  // Persisted sessions are VALIDATED against the server first: a token the
  // server rejects (secret rotation, expiry) must drop the user cleanly to
  // the login screen — never a broken shell where every call 401s. Network
  // failures keep the session (offline-first); only an explicit rejection
  // logs out. Plan also refreshes here, so founder upgrades land silently.
  useEffect(() => {
    let live = true;
    (async () => {
      if (session) {
        try {
          const r = await ai.whoami(session.token);
          if (live && session.mode === 'user' && r.plan && r.plan !== session.plan) {
            const next = { ...session, plan: r.plan };
            try { localStorage.setItem(AUTH_KEY, JSON.stringify(next)); } catch { /* ignore */ }
            setSession(next);
            return; // effect re-runs with the updated session
          }
        } catch (e) {
          if (live && /login required/i.test(e.message || '')) { setAuth(null); return; }
          // other errors: offline etc. — proceed with the cached session
        }
      }
      if (session?.mode === 'user') await enableUserSync(session.token, session.user);
      else disableUserSync();
      if (live) setReady(true);
    })();
    return () => { live = false; };
  }, [session?.token, session?.mode, session?.plan]); // eslint-disable-line

  if (location.pathname.includes('/verify')) {
    return <div className="fs-root" style={themeVars(ws)}><VerifyScreen onAuth={setAuth} /></div>;
  }
  if (!session) return <div className="fs-root" style={themeVars(ws)}><Login onAuth={setAuth} autoLogin={fromJourney} /></div>;
  if (!ready) return <div className="fs-root" style={themeVars(ws)}><div className="fs-loginwrap"><p className="hint">Opening your workspace…</p></div></div>;
  return (
    <div className="fs-root" style={themeVars(ws)}>
      <WorkspaceContext.Provider value={{ token: session.token, session, logout: () => setAuth(null) }}>
        <DemoCoach />
        <Routes>
          <Route path="/" element={<Shell />}>
            <Route index element={<ChatHome />} />
            <Route path="timelines" element={<PortfolioPage />} />
            <Route path="reviews" element={<ReviewQueuePage />} />
            <Route path="data" element={<DataPage />} />
            <Route path="board" element={<BoardPage />} />
            <Route path="signals" element={<SignalsPage />} />
            <Route path="graph" element={<GraphPage />} />
            <Route path="map" element={<SemanticMapPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="prod/:prodId" element={<ProductPage />} />
            <Route path="p/:pid/*" element={<ProjectRoutes />} />
            <Route path="*" element={<Navigate to="" replace />} />
          </Route>
        </Routes>
      </WorkspaceContext.Provider>
    </div>
  );
}

function Login({ onAuth, autoLogin }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(null); // { email, devLink? }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const demoLogin = async () => {
    try { const r = await ai.login('pm', 'zenith@123'); onAuth({ token: r.token, user: 'pm', mode: 'demo' }); }
    catch { setErr('Demo login failed — is the backend up?'); }
  };
  const sendLink = async () => {
    setErr(''); setBusy(true);
    try { const r = await ai.requestLink(email.trim()); setSent({ email: email.trim(), devLink: r.devLink }); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  React.useEffect(() => { if (autoLogin) demoLogin(); /* eslint-disable-line */ }, [autoLogin]);

  return (
    <div className="fs-loginwrap">
      <div className="fs-login">
        <div className="fs-loginbrand"><I n="sparkle" s={22} style={{ color: 'var(--p)' }} /> <b>feasly</b></div>
        <h2>PM workspace</h2>
        <p className="hint">Your documents never leave your machine — the AI runs locally. Research, BRDs, stories and tests, traceable back to the business question.</p>
        {sent ? (
          <>
            <p className="hint"><b>Check your inbox.</b> A one-time sign-in link is on its way to <code>{sent.email}</code>. It expires in 15 minutes.</p>
            {sent.devLink && <button className="btn" onClick={() => { window.location.href = sent.devLink; }}>Open sign-in link (local dev)</button>}
            <button className="fs-linkbtn" onClick={() => setSent(null)}>Use a different email</button>
          </>
        ) : (
          <>
            <label>Work email</label>
            <input type="email" value={email} placeholder="you@company.com" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendLink()} />
            {err && <p className="error">{err}</p>}
            <button className="btn" disabled={busy || !email.includes('@')} onClick={sendLink}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
          </>
        )}
        <div className="fs-logindivide"><span>or</span></div>
        <button className="btn ghost" onClick={demoLogin}>Explore the Zenith showcase demo</button>
        <p className="hint">The demo is a shared, pre-seeded workspace that resets periodically. Your own account is private and synced.</p>
      </div>
    </div>
  );
}

// Magic-link landing: /ai/verify?code=… exchanges a one-time code for a
// 30-day session; /ai/verify?token=… is a founder-minted invite link that
// already carries the session token (validated via whoami).
function VerifyScreen({ onAuth }) {
  const nav = useNavigate();
  const [err, setErr] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const token = params.get('token');
    const finish = (tok, email, plan) => { onAuth({ token: tok, user: email, mode: 'user', plan: plan || 'free' }); nav('/ai', { replace: true }); };
    if (token) {
      ai.whoami(token)
        .then((r) => finish(token, r.subject, r.plan))
        .catch(() => setErr('This invite link is invalid or expired — ask for a fresh one.'));
    } else if (code) {
      ai.verify(code)
        .then((r) => finish(r.token, r.email, r.plan))
        .catch((e) => setErr(e.message));
    } else {
      setErr('Missing sign-in code.');
    }
  }, []); // eslint-disable-line
  return (
    <div className="fs-loginwrap">
      <div className="fs-login">
        <div className="fs-loginbrand"><I n="sparkle" s={22} style={{ color: 'var(--p)' }} /> <b>feasly</b></div>
        {err ? (<><p className="error">{err}</p><button className="btn" onClick={() => nav('/ai', { replace: true })}>Back to sign-in</button></>) : <p className="hint">Signing you in…</p>}
      </div>
    </div>
  );
}

// ---- shared shell: floating sidebar + content pane ----
function Shell() {
  const ws = useWS();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [palOpen, setPalOpen] = useState(false);
  const pid = location.pathname.match(/\/ai\/p\/([^/]+)/)?.[1] || null;
  const project = pid ? findProject(ws, pid) : null;

  // ⌘K / Ctrl+K anywhere in the workspace opens the palette.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalOpen((v) => !v); }
    };
    const onOpen = () => setPalOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('feasly-palette', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('feasly-palette', onOpen); };
  }, []);

  return (
    <div className="workspace">
      <CommandPalette open={palOpen} onClose={() => setPalOpen(false)} />
      <UpgradeNudge />
      <button className="ws-hamburger" onClick={() => setDrawerOpen(true)} aria-label="Open menu"><I n="chevronLeft" s={17} style={{ transform: 'rotate(180deg)' }} /></button>
      {drawerOpen && <div className="ws-backdrop" onClick={() => setDrawerOpen(false)} />}
      <Sidebar project={project} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <main className="ws-main">
        {project && <StageStrip project={project} />}
        {project && <ReviewBanner project={project} />}
        <Outlet />
      </main>
      {project && <AssistPanel project={project} />}
    </div>
  );
}

// Surfaces decisions past their review date on every project page — the loop
// coming back to pay the PM for having recorded the decision. Dismissible per
// browser so it nudges without nagging.
function ReviewBanner({ project }) {
  const nav = useNavigate();
  const location = useLocation();
  const due = projectDueCount(project);
  const overdue = projectOverdueActions(project).length;
  const dismissed = (() => { try { return sessionStorage.getItem('fs-reviewdismiss-' + project.id) === '1'; } catch { return false; } })();
  const [hidden, setHidden] = useState(dismissed);
  if ((!due && !overdue) || hidden || location.pathname.includes('/decisions')) return null;
  const parts = [
    due ? `${due} decision${due > 1 ? 's' : ''} past review` : null,
    overdue ? `${overdue} action item${overdue > 1 ? 's' : ''} overdue` : null
  ].filter(Boolean).join(' · ');
  return (
    <div className="reviewbar">
      <span><I n="refresh" s={13} /> {parts} — close the loop.</span>
      <span className="reviewbaracts">
        <button className="reviewbtn" onClick={() => nav(`/ai/p/${project.id}/decisions`)}>Review now →</button>
        <button className="reviewx" onClick={() => { try { sessionStorage.setItem('fs-reviewdismiss-' + project.id, '1'); } catch { /* ignore */ } setHidden(true); }} aria-label="Dismiss"><I n="x" s={13} /></button>
      </span>
    </div>
  );
}

// Hitting a Free-plan limit anywhere raises this toast: what the limit is,
// where to upgrade. Fired via `window.dispatchEvent(new CustomEvent(
// 'feasly-upgrade', { detail: { kind } }))` from any creation gate.
const LIMIT_COPY = {
  products: '1 product', projects: '3 projects', decisions: '10 decisions', research: '30 research notes'
};
export const raiseUpgradeNudge = (kind) => window.dispatchEvent(new CustomEvent('feasly-upgrade', { detail: { kind } }));

function UpgradeNudge() {
  const nav = useNavigate();
  const [kind, setKind] = useState(null);
  useEffect(() => {
    const on = (e) => setKind(e.detail?.kind || 'decisions');
    window.addEventListener('feasly-upgrade', on);
    return () => window.removeEventListener('feasly-upgrade', on);
  }, []);
  if (!kind) return null;
  return (
    <div className="upgradebar" role="status">
      <span><I n="lock" s={13} /> Free plan includes {LIMIT_COPY[kind]} — you've used them all. Founding Pro is unlimited, and local AI stays free on every plan.</span>
      <span className="reviewbaracts">
        <button className="reviewbtn" onClick={() => { setKind(null); nav('/pricing'); }}>See plans →</button>
        <button className="reviewx" onClick={() => setKind(null)} aria-label="Dismiss"><I n="x" s={13} /></button>
      </span>
    </div>
  );
}

function ProjectRoutes() {
  const location = useLocation();
  const ws = useWS();
  const pid = location.pathname.match(/\/ai\/p\/([^/]+)/)?.[1];
  if (!findProject(ws, pid)) return <Navigate to="/ai" replace />;
  return (
    <Routes>
      <Route index element={<Navigate to="research" replace />} />
      <Route path="research/:docId?" element={<ResearchPage />} />
      <Route path="conversations/:convId?" element={<ConversationsPage />} />
      <Route path="library" element={<LibraryPage />} />
      <Route path="brds/:docId?" element={<BrdsPage />} />
      <Route path="pdns/:docId?" element={<ArtifactPage type="pdn" />} />
      <Route path="epics/:docId?" element={<ArtifactPage type="epic" />} />
      <Route path="stories/:docId?" element={<ArtifactPage type="story" />} />
      <Route path="frs/:docId?" element={<ArtifactPage type="fr" />} />
      <Route path="tests/:docId?" element={<ArtifactPage type="test" />} />
      <Route path="tracker" element={<TrackerPage />} />
      <Route path="performance" element={<PerformancePage />} />
      <Route path="reviews" element={<ReviewsPage />} />
      <Route path="decisions/:docId?" element={<DecisionsPage />} />
      <Route path="playbooks" element={<PlaybooksPage />} />
      <Route path="board" element={<BoardPage />} />
      <Route path="graph" element={<GraphPage />} />
      <Route path="map" element={<SemanticMapPage />} />
      <Route path="releases" element={<ReleasesPage />} />
      <Route path="settings" element={<Navigate to="/ai/settings" replace />} />
      <Route path="*" element={<Navigate to="research" replace />} />
    </Routes>
  );
}

// ---- collapsible sidebar group ----
const navState = () => { try { return JSON.parse(localStorage.getItem('fs-nav') || '{}'); } catch { return {}; } };
const setNavState = (id, v) => { try { const m = navState(); m[id] = v; localStorage.setItem('fs-nav', JSON.stringify(m)); } catch { /* ignore */ } };

function Group({ id, label, action, children, small }) {
  const [open, setOpen] = useState(() => navState()[id] ?? true);
  const toggle = () => { const v = !open; setOpen(v); setNavState(id, v); };
  return (
    <div className={'fs-group' + (small ? ' small' : '')}>
      <div className="fs-grouphead">
        <button className="fs-grouptoggle" onClick={toggle}>
          <I n="chevronDown" s={11} className={open ? '' : 'closed'} /> <span>{label}</span>
        </button>
        {action}
      </div>
      {open && <div className="fs-groupbody">{children}</div>}
    </div>
  );
}

// The project's own tree — nested under the active project row.
const PROJECT_NAV = [
  { g: 'track', label: 'Track', mod: 'portfolio', items: [
    { to: 'tracker', glyph: 'target', label: 'Tracker', mod: 'portfolio' },
    { to: 'performance', glyph: 'scatter', label: 'Performance', mod: 'performance' },
    { to: 'reviews', glyph: 'check', label: 'Reviews', mod: 'reviews', count: (p) => (p.reviews || []).filter((r) => r.state === 'open').length }
  ] },
  { g: 'decide', label: 'Decide', mod: 'decisions', items: [
    { to: 'decisions', glyph: 'target', label: 'Decisions', mod: 'decisions', count: (p) => (p.decisions || []).length }
  ] },
  { g: 'knowledge', label: 'Knowledge', mod: 'knowledge', items: [
    { to: 'research', glyph: 'book', label: 'Research', count: (p) => p.research.length },
    { to: 'conversations', glyph: 'message', label: 'Conversations', count: (p) => p.conversations.length },
    { to: 'library', glyph: 'archive', label: 'Library' }
  ] },
  { g: 'delivery', label: 'Delivery', mod: 'specs', items: [
    { to: 'brds', glyph: 'clipboard', label: 'BRDs', count: (p) => p.brds.length },
    { to: 'pdns', glyph: 'file', label: 'PDNs', count: (p) => p.pdns.length },
    { to: 'epics', glyph: 'layers', label: 'Epics', count: (p) => p.epics.length },
    { to: 'stories', glyph: 'card', label: 'User Stories', count: (p) => p.stories.length },
    { to: 'frs', glyph: 'checks', label: 'Functional Reqs', count: (p) => p.frs.length },
    { to: 'tests', glyph: 'flask', label: 'Test Cases', count: (p) => p.tests.length }
  ] },
  { g: 'project', label: 'Project', mod: 'execution', items: [
    { to: 'playbooks', glyph: 'play', label: 'Playbooks', mod: 'playbooks' },
    { to: 'releases', glyph: 'rocket', label: 'Releases', mod: 'execution', count: (p) => p.releases.length }
  ] }
];

// One product in the sidebar: chevron collapses its projects, the name opens
// its dashboard, + starts a project inside it.
function ProductNode({ product, activeProject, onClose }) {
  const ws = useWS();
  const nav = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(() => navState()['prod-' + product.id] ?? true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const projects = projectsOf(ws, product.id);
  const onDash = location.pathname === `/ai/prod/${product.id}`;
  const toggle = () => { const v = !open; setOpen(v); setNavState('prod-' + product.id, v); };

  const { session: pnSession } = useWorkspace();
  const createProject = () => {
    if (!name.trim()) { setAdding(false); return; }
    if (!underLimit(ws, pnSession, 'projects')) { setAdding(false); raiseUpgradeNudge('projects'); return; }
    const p = { id: uid(), name: name.trim(), about: '', productId: product.id, createdAt: now(), folders: [], decisions: [], research: [], conversations: [], brds: [], pdns: [], epics: [], stories: [], frs: [], tests: [], releases: [] };
    mutate((w) => ({ ...w, projects: [p, ...w.projects] }));
    setName(''); setAdding(false);
    nav(`/ai/p/${p.id}/research`);
  };

  return (
    <div className="fs-prodnode">
      <div className={'fs-prodrow' + (onDash ? ' on' : '')}>
        <button className="fs-prodchev" onClick={toggle} aria-label="Toggle projects">
          <I n="chevronDown" s={10} className={open ? '' : 'closed'} />
        </button>
        <button className="fs-prodname" onClick={() => { nav(`/ai/prod/${product.id}`); onClose(); }}>
          <I n={product.id === 'all' ? 'layers' : 'target'} s={14} />
          <span className="fs-linklabel">{product.name}</span>
        </button>
        {can(ws, 'create') && <button className="fs-groupaction" title={`New project in ${product.name}`} onClick={() => { setOpen(true); setNavState('prod-' + product.id, true); setAdding(true); }}><I n="plus" s={12} /></button>}
      </div>
      {open && (
        <div className="fs-prodkids">
          {adding && (
            <div className="fs-newproj">
              <input autoFocus value={name} placeholder="Project name…" onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createProject(); if (e.key === 'Escape') setAdding(false); }}
                onBlur={() => (name.trim() ? createProject() : setAdding(false))} />
            </div>
          )}
          {projects.map((p) => (
            <div key={p.id}>
              <button className={'fs-link' + (activeProject?.id === p.id ? ' cur' : '')} onClick={() => { nav(`/ai/p/${p.id}/research`); }}>
                <I n="folder" s={14} style={activeProject?.id === p.id ? { color: 'var(--p)' } : undefined} />
                <span className="fs-linklabel">{p.name}</span>
              </button>
              {activeProject?.id === p.id && (
                <div className="fs-tree">
                  {PROJECT_NAV.filter((g) => canModule(ws, g.mod)).map((g) => (
                    <Group key={g.g} id={g.g} label={g.label} small>
                      {g.items.filter((item) => canModule(ws, item.mod || g.mod)).map((item) => (
                        <NavLink key={item.to} to={`/ai/p/${p.id}/${item.to}`} onClick={onClose}
                          className={({ isActive }) => 'fs-link sub' + (isActive ? ' on' : '')}>
                          <I n={item.glyph} s={14} />
                          <span className="fs-linklabel">{item.label}</span>
                          {item.count ? <span className="fs-count">{item.count(p)}</span> : null}
                        </NavLink>
                      ))}
                    </Group>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!projects.length && !adding && <p className="fs-empty">No projects yet.</p>}
        </div>
      )}
    </div>
  );
}

// One person, several hats. Switching here re-renders the whole workspace
// through that role's module access — no logout, which is how an org
// actually works (a Director who also PMs one product).
function RolePicker() {
  const ws = useWS();
  const roles = myRoles(ws);
  const active = myRole(ws);
  if (roles.length <= 1) return null;
  return (
    <div className="rolepicker">
      <label>Working as</label>
      <select value={active} onChange={(e) => mutate((w) => ({ ...w, team: { ...w.team, activeRole: e.target.value, viewAs: null } }))}>
        {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
      </select>
    </div>
  );
}

function Sidebar({ project, open, onClose }) {
  const ws = useWS();
  const nav = useNavigate();
  const { logout, session } = useWorkspace();
  const isDemo = session?.mode !== 'user';
  const reviewCount = openReviewsFor(ws, 'owner').length;
  const [addingProduct, setAddingProduct] = useState(false);
  const [prodName, setProdName] = useState('');

  const createProduct = () => {
    if (!prodName.trim()) { setAddingProduct(false); return; }
    if (!underLimit(ws, session, 'products')) { setAddingProduct(false); raiseUpgradeNudge('products'); return; }
    const p = { id: uid(), name: prodName.trim(), about: '', createdAt: now() };
    mutate((w) => ({ ...w, products: [...(w.products || []), p] }));
    setProdName(''); setAddingProduct(false);
    nav(`/ai/prod/${p.id}`);
  };

  // Recent documents across every project, newest first.
  const recent = ws.projects.flatMap((p) =>
    Object.keys(TYPES).flatMap((t) => (p[TYPES[t].key] || []).map((d) => ({ p, t, d })))
  ).sort((a, b) => (b.d.createdAt || '').localeCompare(a.d.createdAt || '')).slice(0, 5);

  return (
    <aside className={'ws-side' + (open ? ' open' : '')}>
      <div className="ws-sidetop">
        <NavLink to="/ai" end className="ws-brand"><I n="sparkle" s={17} style={{ color: 'var(--p)' }} /> feasly</NavLink>
        <button className="ws-drawerclose" onClick={onClose} aria-label="Close menu"><I n="x" s={16} /></button>
      </div>

      <div className="fs-nav">
        <button className="fs-link home" onClick={() => { mutate((w) => ({ ...w, activeSessionId: null })); nav('/ai'); onClose(); }}>
          <I n="pen" s={14} /> New chat
        </button>
        <button className="fs-link fs-searchtrigger" onClick={() => { window.dispatchEvent(new Event('feasly-palette')); onClose(); }}>
          <I n="search" s={14} /> Search & jump
          <kbd className="fs-kbd">⌘K</kbd>
        </button>

        {/* Linear-style workspace views: cross-product, not nested in a project. */}
        <RolePicker />

        {/* Workspace views: cross-product, each gated by the module matrix. */}
        <Group id="wsviews" label="Workspace">
          {[
            { to: '/ai/timelines', glyph: 'target', label: 'Timelines', mod: 'portfolio' },
            { to: '/ai/reviews', glyph: 'check', label: 'Reviews', mod: 'reviews', badge: reviewCount },
            { to: '/ai/board', glyph: 'checks', label: 'Sprint Board', mod: 'execution' },
            { to: '/ai/data', glyph: 'archive', label: 'Connected Data', mod: 'data' },
            { to: '/ai/signals', glyph: 'scatter', label: 'Signals', mod: 'insight' },
            { to: '/ai/graph', glyph: 'network', label: 'Knowledge Graph', mod: 'insight' },
            { to: '/ai/map', glyph: 'globe', label: 'Semantic Map', mod: 'insight' }
          ].filter((v) => canModule(ws, v.mod)).map((v) => (
            <NavLink key={v.to} to={v.to} end onClick={onClose}
              className={({ isActive }) => 'fs-link' + (isActive ? ' on' : '')}>
              <I n={v.glyph} s={14} />
              <span className="fs-linklabel">{v.label}</span>
              {v.badge ? <span className="fs-count">{v.badge}</span> : null}
            </NavLink>
          ))}
        </Group>

        <Group id="chats" label="Chats">
          {(ws.sessions || []).slice(0, 6).map((s) => (
            <button key={s.id} className={'fs-link' + (ws.activeSessionId === s.id ? ' cur' : '')}
              onClick={() => { mutate((w) => ({ ...w, activeSessionId: s.id })); nav('/ai'); onClose(); }}>
              <I n="message" s={14} />
              <span className="fs-linklabel">{s.title}</span>
              {s.projectId && <I n="folder" s={11} style={{ color: 'var(--p)', opacity: 0.7 }} />}
            </button>
          ))}
          {!(ws.sessions || []).length && <p className="fs-empty">Your chats appear here, auto-named.</p>}
        </Group>

        <Group id="products" label="Products"
          action={can(ws, 'create') ? <button className="fs-groupaction" title="New product" onClick={() => setAddingProduct(true)}><I n="plus" s={13} /></button> : null}>
          {addingProduct && (
            <div className="fs-newproj">
              <input autoFocus value={prodName} placeholder="Product name…" onChange={(e) => setProdName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createProduct(); if (e.key === 'Escape') setAddingProduct(false); }}
                onBlur={() => (prodName.trim() ? createProduct() : setAddingProduct(false))} />
            </div>
          )}
          {(ws.products || []).map((prod) => (
            <ProductNode key={prod.id} product={prod} activeProject={project} onClose={onClose} />
          ))}
          <ProductNode product={ALL_PRODUCT} activeProject={project} onClose={onClose} />
        </Group>

        <Group id="recent" label="Recent">
          {recent.map(({ p, t, d }) => (
            <button key={t + d.id} className="fs-link" onClick={() => { nav(`/ai/p/${p.id}/${ROUTE_OF[t]}/${d.id}`); onClose(); }}>
              <TypeIcon type={t} s={13} />
              <span className="fs-linklabel">{d.title}</span>
            </button>
          ))}
          {!recent.length && <p className="fs-empty">Documents you create appear here.</p>}
        </Group>
      </div>

      <div className="ws-foot">
        <div className="ws-user">
          <span className="ws-avatar">{isDemo ? 'PM' : session.user.slice(0, 2).toUpperCase()}</span>
          <span>{isDemo ? 'pm@zenith · demo' : session.user}</span>
        </div>
        {isDemo && <button className="fs-footbtn" onClick={startCoach}><I n="play" s={12} /> Guided demo</button>}
        {isDemo && <button className="fs-footbtn" onClick={() => { if (window.confirm('Reset the workspace to its seeded demo state? Everything created in this browser is discarded.')) { resetWS(); nav('/ai'); } }}><I n="refresh" s={12} /> Reset demo data</button>}
        <NavLink to="/ai/settings" className={({ isActive }) => 'fs-footbtn' + (isActive ? ' on' : '')} onClick={onClose}><I n="sliders" s={12} /> Settings</NavLink>
        <button className="fs-footbtn" onClick={() => { logout(); nav('/ai'); }}><I n="logout" s={12} /> Log out</button>
      </div>
    </aside>
  );
}
