// Feasly workspace store — v3: a knowledge-first artifact chain.
//
//   Research → BRD (versioned) → PDN → Epic → Story → Functional Req → Test
//
// Everything lives per-project in localStorage. Traceability is computed
// from parent links, and staleness is computed — never stored: a PDN records
// the BRD version it was generated from, so when the BRD gains a version the
// entire downstream chain reports "upstream changed" with zero bookkeeping.
import { useSyncExternalStore } from 'react';
import { ai } from '../lib/api';

const DEMO_KEY = 'feasly-workspace-v3';
// Per-account cache key — two accounts on one browser must never see each
// other's local cache (the server doc is already per-email).
const userKey = (email) => `feasly-workspace-user-v1:${email}`;
let KEY = DEMO_KEY;

// ---- shared store (all components see the same snapshot) ----
let cache = null;
const subs = new Set();
// Demo mode boots the seeded showcase; a real signed-in account starts clean.
const freshState = () => (sync ? emptyState() : seedState());
const read = () => {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw === null ? freshState() : migrateState(JSON.parse(raw));
    // Persist migrations immediately so a reload can't replay them halfway.
    persist();
  } catch { cache = freshState(); }
  return cache;
};

// Older states carried a single anonymous home chat; fold it into the new
// named-sessions model so nothing a user typed is lost.
function migrateState(s) {
  if (!s.sessions) {
    const msgs = s.homeChat?.messages || [];
    s.sessions = msgs.length
      ? [{ id: uid(), title: titleFrom(msgs.find((m) => m.role === 'user')?.content || 'Earlier chat'), createdAt: now(), updatedAt: now(), messages: msgs, attachments: [], projectId: null }]
      : [];
    s.activeSessionId = s.sessions[0]?.id || null;
    delete s.homeChat;
  }
  // Products layer: pre-hierarchy states get the seed products; existing
  // projects are homed sensibly (compliance work is cross-product).
  if (!s.products) {
    s.products = seedProducts();
    for (const p of s.projects || []) {
      if (!p.productId) p.productId = p.id === 'proj-kyc' ? 'all' : 'prod-retail';
    }
  }
  if (!s.team) s.team = seedTeam();
  // Multi-role members: single `role` becomes a `roles` array; the workspace
  // gains an active role that the UI switches without a logout.
  for (const m of s.team.members || []) {
    if (!m.roles) m.roles = [m.role || 'viewer'];
  }
  if (!s.team.activeRole) s.team.activeRole = (s.team.members || []).find((m) => m.owner)?.roles?.[0] || 'admin';
  // Decisions layer: back-fill the array on every project and the link field
  // on every BRD so pre-Decision workspaces keep working.
  for (const p of s.projects || []) {
    if (!p.decisions) p.decisions = [];
    for (const b of p.brds || []) if (b.decisionId === undefined) b.decisionId = null;
    // Tracker / performance / review layers.
    if (!p.tracker) p.tracker = emptyTracker();
    if (!p.metrics) p.metrics = [];
    if (!p.reviews) p.reviews = [];
  }
  return s;
}

// ---- roles & access ----
// Workspace-level RBAC: the owner is always admin; added members carry a
// role. `viewAs` lets the owner preview the workspace through a lower role —
// the same gates real members would hit (org-wide server enforcement lands
// with team workspaces; the gating contract is defined here).
// Org roles. `cap` maps each role onto the underlying capability level the
// document gates already understand (admin > editor > viewer), so adding
// org vocabulary doesn't fork the permission logic.
export const ROLES = {
  admin: { label: 'Workspace Admin', cap: 'admin', desc: 'Full control — settings, connectors, team, module access, every document.' },
  director: { label: 'Director / VP', cap: 'admin', desc: 'Portfolio oversight, approvals and performance. Sees everything across products.' },
  pm: { label: 'Product Manager', cap: 'editor', desc: 'Owns decisions, specs, trackers and playbooks for their projects.' },
  em: { label: 'Engineering Manager', cap: 'editor', desc: 'Delivery focus — board, releases, estimates and technical review.' },
  engineer: { label: 'Engineer', cap: 'editor', desc: 'Stories, requirements and tests. Reads the decisions behind them.' },
  qa: { label: 'QA', cap: 'editor', desc: 'Test cases and release readiness; reviews before go-live.' },
  stakeholder: { label: 'Stakeholder', cap: 'viewer', desc: 'Reads published trackers, performance and status. Approves when asked.' },
  viewer: { label: 'Viewer', cap: 'viewer', desc: 'Read-only across everything published to them.' },
  // legacy value kept so older saved workspaces keep resolving
  editor: { label: 'Editor', cap: 'editor', desc: 'Creates and edits documents.' }
};
export const ROLE_IDS = ['admin', 'director', 'pm', 'em', 'engineer', 'qa', 'stakeholder', 'viewer'];

// A person holds several roles and switches between them in the UI without
// logging out — the way a real org works (a Director who is also the PM on
// one product). `activeRole` is what the workspace renders as right now.
const seedTeam = () => ({
  members: [
    { id: 'owner', email: 'you (owner)', roles: ['admin', 'director', 'pm'], owner: true },
    { id: 'm-anita', email: 'anita.rao@zenith.example', roles: ['pm'] },
    { id: 'm-vikram', email: 'vikram.n@zenith.example', roles: ['director'] },
    { id: 'm-sana', email: 'sana.k@zenith.example', roles: ['em', 'engineer'] },
    { id: 'm-dev', email: 'dev.patel@zenith.example', roles: ['engineer'] },
    { id: 'm-qa', email: 'qa.desk@zenith.example', roles: ['qa'] },
    { id: 'm-compliance', email: 'compliance@zenith.example', roles: ['stakeholder'] }
  ],
  activeRole: 'admin',
  viewAs: null
});

export const myRoles = (ws) => (ws.team?.members || []).find((m) => m.owner)?.roles || ['admin'];
export const myRole = (ws) => ws.team?.viewAs || ws.team?.activeRole || 'admin';
export const roleCap = (role) => ROLES[role]?.cap || 'viewer';
export const roleLabel = (role) => ROLES[role]?.label || role;

// ---- modules ----
// The product as an org would buy it: named modules, each with the
// functionalities inside it, each exposable per role.
export const MODULES = {
  portfolio: { label: 'Portfolio & Tracker', glyph: 'target', fns: ['Go-live dashboard', 'Project trackers', 'Event timeline', 'Versions', 'Publish controls'] },
  ask: { label: 'Ask (AI copilot)', glyph: 'message', fns: ['Chat over history', 'Grounded citations', 'Local model'] },
  decisions: { label: 'Decisions', glyph: 'target', fns: ['Decision record', 'Evidence', 'Confidence', 'Review loop', 'Action items'] },
  knowledge: { label: 'Knowledge', glyph: 'book', fns: ['Research', 'Library', 'Conversations', 'Inbox capture'] },
  specs: { label: 'Specifications', glyph: 'clipboard', fns: ['BRD versions', 'PDN', 'Epics', 'Stories', 'Requirements', 'Tests'] },
  execution: { label: 'Execution', glyph: 'checks', fns: ['Sprint board', 'Releases', 'Delivery pipeline', 'Definition of Done'] },
  performance: { label: 'Performance', glyph: 'scatter', fns: ['North-star metrics', 'Trends', 'Portfolio roll-up'] },
  reviews: { label: 'Review & Approval', glyph: 'check', fns: ['Route for review', 'Approve / request changes', 'Approval history'] },
  playbooks: { label: 'Playbooks', glyph: 'play', fns: ['6 guided PM workflows'] },
  insight: { label: 'Insight', glyph: 'network', fns: ['Signals', 'Knowledge graph', 'Semantic map'] },
  data: { label: 'Connected Data (EDW)', glyph: 'archive', fns: ['Datalake tables', 'Live queries', 'Evidence from company data'] },
  admin: { label: 'Administration', glyph: 'sliders', fns: ['Team & roles', 'Module access', 'Integrations', 'Model hub'] }
};

// Which modules each role sees. Editable in Settings → Module Access.
export const DEFAULT_ROLE_MODULES = {
  admin: Object.keys(MODULES),
  director: ['portfolio', 'ask', 'decisions', 'performance', 'reviews', 'insight', 'data', 'knowledge'],
  pm: ['portfolio', 'ask', 'decisions', 'knowledge', 'specs', 'execution', 'performance', 'reviews', 'playbooks', 'insight', 'data'],
  em: ['portfolio', 'ask', 'decisions', 'knowledge', 'specs', 'execution', 'reviews', 'insight'],
  engineer: ['portfolio', 'ask', 'knowledge', 'specs', 'execution', 'decisions'],
  qa: ['portfolio', 'ask', 'specs', 'execution', 'reviews'],
  stakeholder: ['portfolio', 'ask', 'performance', 'reviews'],
  viewer: ['portfolio', 'ask'],
  editor: ['portfolio', 'ask', 'decisions', 'knowledge', 'specs', 'execution', 'playbooks', 'insight']
};
export const roleModules = (ws) => (ws.moduleAccess || DEFAULT_ROLE_MODULES)[myRole(ws)] || [];
export const canModule = (ws, moduleId) => roleModules(ws).includes(moduleId);
// Gate actions: 'edit' (documents, board, releases), 'run' (playbooks),
// 'create' (products/projects), 'admin' (settings, connectors, team, models).
export function can(ws, action) {
  const cap = roleCap(myRole(ws));
  if (cap === 'admin') return true;
  if (cap === 'editor') return action !== 'admin';
  return false; // viewer
}

// ================  PROJECT TRACKER  ================
// The module an org actually asks for first: what is this project, what has
// happened on it, when does it go live. Events are the spine; everything
// else (AI generation, versions, publishing) hangs off them.
export const EVENT_TYPES = {
  kickoff: { label: 'Kick-off', tint: '#0a84ff' },
  milestone: { label: 'Milestone', tint: '#5e5ce6' },
  decision: { label: 'Decision', tint: '#c9a227' },
  risk: { label: 'Risk / blocker', tint: '#ff453a' },
  approval: { label: 'Approval', tint: '#30b0c7' },
  release: { label: 'Go-live', tint: '#34c759' },
  review: { label: 'Review', tint: '#bf5af2' }
};
export const TRACKER_STATUS = ['on-track', 'at-risk', 'delayed', 'live', 'on-hold'];
export const STATUS_LABEL = {
  'on-track': 'On track', 'at-risk': 'At risk', 'delayed': 'Delayed', live: 'Live', 'on-hold': 'On hold'
};

export const emptyTracker = () => ({
  description: '', status: 'on-track', goLive: '', owner: 'owner',
  events: [], versions: [], visibility: 'private', sharedWith: []
});
export const trackerOf = (project) => project?.tracker || emptyTracker();
export const sortedEvents = (project) =>
  [...(trackerOf(project).events || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

export function updateTracker(ws, pid, patch) {
  return {
    ...ws,
    projects: ws.projects.map((p) => (p.id !== pid ? p : { ...p, tracker: { ...emptyTracker(), ...(p.tracker || {}), ...patch } }))
  };
}
export function addEvent(ws, pid, event) {
  const t = trackerOf(ws.projects.find((p) => p.id === pid));
  return updateTracker(ws, pid, { events: [...(t.events || []), { id: uid(), createdAt: now(), ...event }] });
}
export function updateEvent(ws, pid, eid, patch) {
  const t = trackerOf(ws.projects.find((p) => p.id === pid));
  return updateTracker(ws, pid, { events: (t.events || []).map((e) => (e.id === eid ? { ...e, ...patch } : e)) });
}
export function removeEvent(ws, pid, eid) {
  const t = trackerOf(ws.projects.find((p) => p.id === pid));
  return updateTracker(ws, pid, { events: (t.events || []).filter((e) => e.id !== eid) });
}
// Snapshot the tracker so "what did this look like at sign-off?" is answerable.
export function snapshotTracker(ws, pid, note) {
  const p = ws.projects.find((x) => x.id === pid);
  const t = trackerOf(p);
  const v = { v: (t.versions || []).length + 1, ts: now(), note: note || 'Tracker snapshot', description: t.description, status: t.status, goLive: t.goLive, events: JSON.parse(JSON.stringify(t.events || [])) };
  return updateTracker(ws, pid, { versions: [...(t.versions || []), v] });
}

// Portfolio views. "Live" is a go-live date in the past; upcoming is ahead.
export function portfolioRows(ws) {
  return (ws.projects || []).map((p) => {
    const t = trackerOf(p);
    const rel = (p.releases || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0];
    const goLive = t.goLive || (rel?.date && rel.date !== '—' ? rel.date : '');
    return {
      project: p, tracker: t, goLive,
      shipped: !!goLive && goLive <= todayISO(),
      product: (ws.products || []).find((x) => x.id === p.productId)?.name || 'All products'
    };
  });
}
export const visibleToMe = (ws, row) =>
  roleCap(myRole(ws)) === 'admin' || row.tracker.visibility === 'published' || myRole(ws) === 'pm';

// ================  PERFORMANCE (north-star metrics)  ================
export const emptyMetric = (patch = {}) => ({ id: uid(), name: 'New metric', unit: '%', target: 0, baseline: 0, source: 'manual', points: [], createdAt: now(), ...patch });
export const metricsOf = (project) => project?.metrics || [];
export function updateMetrics(ws, pid, metrics) {
  return { ...ws, projects: ws.projects.map((p) => (p.id !== pid ? p : { ...p, metrics })) };
}
export const latestPoint = (m) => (m.points || []).slice().sort((a, b) => a.date.localeCompare(b.date)).slice(-1)[0];
export function metricHealth(m) {
  const last = latestPoint(m);
  if (!last || !m.target) return 'unknown';
  const pct = (last.value / m.target) * 100;
  return pct >= 100 ? 'hit' : pct >= 75 ? 'near' : 'behind';
}

// ================  REVIEW & APPROVAL  ================
export const REVIEW_STATE = { open: 'In review', approved: 'Approved', changes: 'Changes requested', cancelled: 'Cancelled' };
export const reviewsOf = (project) => project?.reviews || [];
export function addReview(ws, pid, review) {
  return {
    ...ws,
    projects: ws.projects.map((p) => (p.id !== pid ? p : { ...p, reviews: [{ id: uid(), createdAt: now(), state: 'open', history: [], ...review }, ...(p.reviews || [])] }))
  };
}
export function updateReview(ws, pid, rid, patch) {
  return { ...ws, projects: ws.projects.map((p) => (p.id !== pid ? p : { ...p, reviews: (p.reviews || []).map((r) => (r.id === rid ? { ...r, ...patch } : r)) })) };
}
// Recording a verdict is append-only: the history is the audit trail, and the
// overall state is derived from the reviewers, never set by hand.
export function recordVerdict(ws, pid, rid, memberId, verdict, comment) {
  const p = ws.projects.find((x) => x.id === pid);
  const r = (p?.reviews || []).find((x) => x.id === rid);
  if (!r) return ws;
  const reviewers = r.reviewers.map((rv) => (rv.memberId === memberId ? { ...rv, status: verdict, at: now(), comment } : rv));
  const history = [...(r.history || []), { at: now(), memberId, verdict, comment: comment || '' }];
  const state = reviewers.some((rv) => rv.status === 'changes') ? 'changes'
    : reviewers.every((rv) => rv.status === 'approved') ? 'approved' : 'open';
  return updateReview(ws, pid, rid, { reviewers, history, state });
}
export const openReviewsFor = (ws, memberId) =>
  (ws.projects || []).flatMap((p) => (p.reviews || [])
    .filter((r) => r.state === 'open' && r.reviewers.some((rv) => rv.memberId === memberId && rv.status === 'pending'))
    .map((r) => ({ review: r, project: p })));
const persist = () => {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  schedulePush();
};

// ---- per-user cloud sync (magic-link accounts) ----
// The browser stays the source of truth and works offline; every mutation
// debounce-pushes the whole document to /ws. Demo mode never syncs.
let sync = null; // { token, timer }
const notify = () => subs.forEach((cb) => cb());

function schedulePush() {
  if (!sync) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(() => { ai.putWs(sync.token, cache).catch(() => { /* offline — next mutation retries */ }); }, 1500);
}

// A real account starts with an empty portfolio, not the Zenith demo seed.
function emptyState() {
  return { ...seedState(), products: [], projects: [], sessions: [], activeSessionId: null };
}

export async function enableUserSync(token, email) {
  sync = { token, timer: null };
  KEY = userKey(email || 'unknown');
  cache = null;
  try {
    const r = await ai.getWs(token);
    if (r.data) {
      cache = migrateState(r.data);
      try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
    } else {
      read(); // local cache if present, else a clean empty workspace
    }
  } catch { read(); /* server unreachable — offline-first on the local cache */ }
  await mergeInbox(token);
  notify();
}

// Integration inbox: items queued via POST /inbox (n8n, curl, anything) land
// as research notes in an auto-created "Inbox" project. Draining here — after
// the workspace load, before the first render — means the merged doc is what
// gets pushed back to /ws, so the queue and the document can't fight.
async function mergeInbox(token) {
  let items = [];
  try { items = (await ai.drainInbox(token)).items || []; } catch { return; /* offline — items stay queued */ }
  if (!items.length) return;
  let inbox = (cache.projects || []).find((p) => p.name === 'Inbox');
  if (!inbox) {
    inbox = {
      id: uid(), name: 'Inbox', about: 'Documents sent in from your integrations — file them into real projects as they earn a home.',
      productId: 'all', createdAt: now(),
      folders: [], decisions: [], research: [], conversations: [], brds: [], pdns: [], epics: [], stories: [], frs: [], tests: [], releases: []
    };
    cache = { ...cache, projects: [inbox, ...cache.projects] };
  }
  const notes = items.map((it) => ({
    id: uid(), title: it.title, source: 'inbox', sourceDetail: it.source || 'n8n',
    createdAt: it.receivedAt || now(), content: it.content
  }));
  cache = {
    ...cache,
    projects: cache.projects.map((p) => (p.id === inbox.id ? { ...p, research: [...notes, ...p.research] } : p))
  };
  persist();
}

export function disableUserSync() {
  if (sync) clearTimeout(sync.timer);
  sync = null;
  KEY = DEMO_KEY;
  cache = null;
  notify();
}

export const isUserMode = () => !!sync;

export function useWS() {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, read);
}
export const getWS = read;
export function mutate(fn) {
  cache = fn(JSON.parse(JSON.stringify(read())));
  persist();
  subs.forEach((cb) => cb());
}
// Rehearsal helper: wipe the workspace back to the seeded demo state
// without a reload (login token survives). Personal setup — theme colors
// and the local-model connection — deliberately survives a demo reset.
export function resetWS() {
  const keep = cache ? { theme: cache.theme, local: cache.local, activeModelId: cache.activeModelId } : null;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  cache = null;
  read();
  if (keep) {
    cache = {
      ...cache,
      ...(keep.theme ? { theme: keep.theme } : {}),
      ...(keep.local ? { local: keep.local } : {}),
      activeModelId: keep.activeModelId ?? cache.activeModelId
    };
    persist();
  }
  subs.forEach((cb) => cb());
}

// ---- appearance: user-tunable primary / secondary / tertiary ----
export const DEFAULT_THEME = { primary: '#0071e3', secondary: '#5e5ce6', tertiary: '#30b0c7' };

export const uid = () => Math.random().toString(36).slice(2, 9);
export const now = () => new Date().toISOString();
export const shortDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
// Derive a document title from a structured prompt: prefer the "Task:"
// clause, else the first sentence — so an engineered prompt doesn't become
// a wall-of-text title.
export function titleFrom(q) {
  const task = /task\s*:\s*([^.\n]+)/i.exec(q)?.[1];
  const t = (task || q.replace(/^\s*(context|role|task)\s*:\s*/i, '').split(/[.\n]/)[0]).trim();
  const clean = t.charAt(0).toUpperCase() + t.slice(1);
  return (clean.length > 64 ? clean.slice(0, 63) + '…' : clean) || q.slice(0, 48);
}

// ---- model routing ----
export const usingLocal = (ws) => ws.activeModelId === 'local' && !!ws.local?.chatModel;
export function activeModelLabel(ws) {
  if (usingLocal(ws)) return `${ws.local.chatModel} @ Ollama · temp ${ws.local.temperature ?? 0.1} · RAG`;
  const m = (ws.models || []).find((x) => x.id === ws.activeModelId);
  return m ? m.name : 'Feasly demo brain (offline)';
}

// ---- artifact type registry (chain order matters) ----
export const TYPES = {
  research: { key: 'research', label: 'Research', one: 'Research note', icon: '🔍', parent: null },
  brd: { key: 'brds', label: 'BRDs', one: 'BRD', icon: '📋', parent: null },
  pdn: { key: 'pdns', label: 'PDNs', one: 'PDN', icon: '📄', parent: 'brd', parentKey: 'brdId' },
  epic: { key: 'epics', label: 'Epics', one: 'Epic', icon: '🧱', parent: 'pdn', parentKey: 'pdnId' },
  story: { key: 'stories', label: 'User Stories', one: 'User Story', icon: '🗂', parent: 'epic', parentKey: 'epicId' },
  fr: { key: 'frs', label: 'Functional Requirements', one: 'Functional Requirement', icon: '📐', parent: 'story', parentKey: 'storyId' },
  test: { key: 'tests', label: 'Test Cases', one: 'Test Case', icon: '✅', parent: 'fr', parentKey: 'frId' }
};
export const CHAIN = ['research', 'brd', 'pdn', 'epic', 'story', 'fr', 'test'];
export const CHILD_OF = { brd: 'pdn', pdn: 'epic', epic: 'story', story: 'fr', fr: 'test' };
export const ROUTE_OF = { decision: 'decisions', research: 'research', brd: 'brds', pdn: 'pdns', epic: 'epics', story: 'stories', fr: 'frs', test: 'tests' };
// Decision isn't part of the generic chain machinery (it has its own page and
// shape), but the trace rail needs a label for it when it appears upstream.
export const DECISION_TYPE_META = { one: 'Decision', label: 'Decisions' };

export const findProject = (ws, pid) => (ws.projects || []).find((p) => p.id === pid) || null;

// Workspace-level views (Linear-style): Board / Graph / Map render ACROSS
// products by consuming a merged pseudo-project. Every doc is tagged with
// its real project id (`_pid`) so navigation and mutations resolve home.
export function mergedProject(ws) {
  const keys = ['decisions', 'research', 'conversations', 'brds', 'pdns', 'epics', 'stories', 'frs', 'tests', 'releases'];
  const m = { id: '_all', name: 'All products', about: 'Every project, one view.', productId: 'all' };
  for (const k of keys) {
    m[k] = (ws.projects || []).flatMap((p) => (p[k] || []).map((d) => ({ ...d, _pid: p.id, _pname: p.name })));
  }
  return m;
}
// Where a doc really lives — merged docs carry _pid, plain ones use context.
export const homePid = (doc, fallbackPid) => doc._pid || fallbackPid;
export const findDoc = (project, type, id) => (project?.[TYPES[type].key] || []).find((d) => d.id === id) || null;

// ---- chat sessions ----
export const findSession = (ws, id) => (ws.sessions || []).find((s) => s.id === id) || null;
export function updateSession(ws, id, patch) {
  return { ...ws, sessions: ws.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

// ---- products (portfolio layer above projects) ----
// 'all' is a pseudo-product: cross-product initiatives every product shares.
export const ALL_PRODUCT = { id: 'all', name: 'All products', about: 'Cross-product initiatives — compliance, platform and shared capabilities that apply to every product.' };
export const findProduct = (ws, id) => (id === 'all' ? ALL_PRODUCT : (ws.products || []).find((p) => p.id === id) || null);
export const projectsOf = (ws, prodId) => (ws.projects || []).filter((p) => (p.productId || 'all') === prodId);
export const defaultProductId = (ws) => (ws.products || [])[0]?.id || 'all';

// ---- lifecycle stages — computed from artifacts, never stored ----
// Same philosophy as staleness: the workspace derives where you are, so the
// stage indicator can't drift from reality.
export const STAGES = [
  { id: 'discover', label: 'Discover' },
  { id: 'define', label: 'Define' },
  { id: 'build', label: 'Build' },
  { id: 'launch', label: 'Launch' },
  { id: 'measure', label: 'Measure' }
];
export const STAGE_HINT = {
  discover: 'Add research or ask the AI — understanding comes before specifying.',
  define: 'Write the BRD and save v1 to lock the definition.',
  build: 'Generate the PDN, then the delivery chain, from the BRD.',
  launch: 'Bundle the stories into a dated release.',
  measure: 'Track the release, then review outcomes and adoption once it ships.'
};
export function stageInfo(project) {
  const today = new Date().toISOString().slice(0, 10);
  const done = {
    discover: (project.research.length + project.conversations.length) > 0,
    define: project.brds.some((b) => (b.versions || []).length > 0),
    build: project.stories.length > 0,
    launch: project.releases.length > 0,
    measure: project.releases.some((r) => r.date && r.date <= today)
  };
  const idx = STAGES.findIndex((s) => !done[s.id]);
  const currentIdx = idx === -1 ? STAGES.length - 1 : idx;
  return { done, current: STAGES[currentIdx].id, currentIdx };
}
// How many downstream artifacts are flagged "upstream changed".
export function staleCount(project) {
  let n = 0;
  for (const t of ['pdn', 'epic', 'story', 'fr', 'test']) {
    for (const d of project[TYPES[t].key] || []) if (staleInfo(project, t, d)) n++;
  }
  return n;
}

export function updateDoc(ws, pid, type, id, patch) {
  return {
    ...ws,
    projects: ws.projects.map((p) => p.id !== pid ? p : {
      ...p, [TYPES[type].key]: p[TYPES[type].key].map((d) => (d.id === id ? { ...d, ...patch } : d))
    })
  };
}
export function addDoc(ws, pid, type, doc) {
  return {
    ...ws,
    projects: ws.projects.map((p) => p.id !== pid ? p : { ...p, [TYPES[type].key]: [...p[TYPES[type].key], doc] })
  };
}
export function removeDoc(ws, pid, type, id) {
  return {
    ...ws,
    projects: ws.projects.map((p) => p.id !== pid ? p : { ...p, [TYPES[type].key]: p[TYPES[type].key].filter((d) => d.id !== id) })
  };
}

// ================  DECISIONS — the record of *why*  ================
// A decision sits above the BRD it produces. It is the first-class object
// that turns Zenith from a spec tool into organizational memory: it carries
// the alternatives, evidence, assumptions and confidence at the time, then
// closes the loop on its review date with a measured outcome and lessons.
export const DECISION_STATUS = ['waiting', 'review', 'approved', 'implemented', 'validated', 'archived'];
export const DECISION_STATUS_LABEL = {
  waiting: 'Waiting', review: 'Under review', approved: 'Approved',
  implemented: 'Implemented', validated: 'Validated', archived: 'Archived'
};
export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'];
export const confidencePct = (n) => Math.round((n ?? 0.5) * 100);

export const findDecision = (project, id) => (project?.decisions || []).find((d) => d.id === id) || null;

export function newDecision(patch = {}) {
  return {
    id: uid(), title: patch.title || 'Untitled decision', status: 'waiting',
    context: '', chosen: '', alternatives: [], evidenceIds: [], assumptions: [],
    confidence: 0.5, impact: { business: '', technical: '', customer: '' },
    ownerId: 'owner', approverId: null, brdId: null,
    reviewDate: '', outcome: '', lessons: '',
    createdAt: now(), versions: [], ...patch
  };
}
export function addDecision(ws, pid, decision) {
  return { ...ws, projects: ws.projects.map((p) => p.id !== pid ? p : { ...p, decisions: [decision, ...(p.decisions || [])] }) };
}
// Material edits bump an append-only version; the outcome/status close-out is
// not itself a new "version" of the decision, just its resolution.
export function updateDecision(ws, pid, id, patch) {
  return {
    ...ws,
    projects: ws.projects.map((p) => p.id !== pid ? p : {
      ...p, decisions: (p.decisions || []).map((d) => (d.id === id ? { ...d, ...patch } : d))
    })
  };
}
export function removeDecision(ws, pid, id) {
  return { ...ws, projects: ws.projects.map((p) => p.id !== pid ? p : { ...p, decisions: (p.decisions || []).filter((d) => d.id !== id) }) };
}

// The review loop. A decision is "due" once its review date has arrived and
// no outcome has been recorded yet — that is the moment Zenith pays the PM
// back for having written it down.
const todayISO = () => new Date().toISOString().slice(0, 10);
export const isDecisionDue = (d, windowDays = 0) => {
  if (!d.reviewDate || d.outcome) return false;
  const cutoff = new Date(Date.now() + windowDays * 86400e3).toISOString().slice(0, 10);
  return d.reviewDate <= cutoff;
};
export const decisionsDueForReview = (project, windowDays = 0) => (project.decisions || []).filter((d) => isDecisionDue(d, windowDays));
export const dueDecisionCount = (ws) => (ws.projects || []).reduce((n, p) => n + decisionsDueForReview(p).length, 0);
export const projectDueCount = (project) => decisionsDueForReview(project).length;
export { todayISO };

// ---- action items ----
// A decision's follow-ups: who does what by when, between "we decided" and
// "it's on the board". Overdue items surface next to due reviews — the
// workspace answers "what needs me?" without being asked.
export const isActionOverdue = (a) => !a.done && a.due && a.due < todayISO();

// ---- freemium plans ----
// The plan itself lives on the server user record (client can't self-edit
// it); these are the client-side limits and meters. Local AI stays unlimited
// on every plan — it runs on the user's own machine, so generosity is free.
export const PLAN_LIMITS = {
  free: { products: 1, projects: 3, decisions: 10, research: 30 },
  pro: { products: Infinity, projects: Infinity, decisions: Infinity, research: Infinity }
};
export const PLAN_LABEL = { free: 'Free', pro: 'Founding Pro' };

export function usageOf(ws) {
  const projects = ws.projects || [];
  return {
    products: (ws.products || []).length,
    projects: projects.length,
    decisions: projects.reduce((n, p) => n + (p.decisions || []).length, 0),
    research: projects.reduce((n, p) => n + (p.research || []).length, 0)
  };
}
// plan comes from the session (server-issued); demo mode explores as pro.
export const planOf = (session) => (session?.mode === 'demo' ? 'pro' : session?.plan || 'free');
export function underLimit(ws, session, kind) {
  const limit = (PLAN_LIMITS[planOf(session)] || PLAN_LIMITS.free)[kind];
  return usageOf(ws)[kind] < limit;
}
export const projectOverdueActions = (project) =>
  (project.decisions || []).flatMap((d) => (d.actions || []).filter(isActionOverdue).map((a) => ({ ...a, decision: d })));
export const overdueActionCount = (ws) => (ws.projects || []).reduce((n, p) => n + projectOverdueActions(p).length, 0);

// ---- traceability ----
export function parentOf(project, type, doc) {
  const t = TYPES[type];
  // Decision has no TYPES entry and no parent — it's the top of the chain.
  if (!t || !t.parent) return null;
  const parent = findDoc(project, t.parent, doc[t.parentKey]);
  return parent ? { type: t.parent, doc: parent } : null;
}
export function childrenOf(project, type, doc) {
  // A decision produces one or more BRDs (the specs written from it).
  if (type === 'decision') {
    return (project.brds || []).filter((b) => b.decisionId === doc.id).map((d) => ({ type: 'brd', doc: d }));
  }
  // Research fans out to whatever references it (BRDs and PDNs).
  if (type === 'research') {
    return [
      ...(project.brds || []).filter((b) => (b.researchIds || []).includes(doc.id)).map((d) => ({ type: 'brd', doc: d })),
      ...(project.pdns || []).filter((p) => (p.researchIds || []).includes(doc.id)).map((d) => ({ type: 'pdn', doc: d }))
    ];
  }
  const childType = CHILD_OF[type];
  if (!childType) return [];
  const ct = TYPES[childType];
  return (project[ct.key] || []).filter((d) => d[ct.parentKey] === doc.id).map((d) => ({ type: childType, doc: d }));
}
// Ordered chain from research/BRD down to this doc.
export function upstreamOf(project, type, doc) {
  const chain = [];
  let cur = { type, doc };
  while (cur) {
    const p = parentOf(project, cur.type, cur.doc);
    if (p) chain.unshift(p);
    cur = p;
  }
  // BRDs additionally trace back to their linked research and the decision
  // that produced them — the decision is the true top of the chain.
  const top = chain[0] || { type, doc };
  if (top.type === 'brd') {
    const research = (top.doc.researchIds || [])
      .map((rid) => findDoc(project, 'research', rid))
      .filter(Boolean)
      .map((d) => ({ type: 'research', doc: d }));
    const decision = top.doc.decisionId ? findDecision(project, top.doc.decisionId) : null;
    return [...(decision ? [{ type: 'decision', doc: decision }] : []), ...research, ...chain];
  }
  return chain;
}
// Flat downstream list (breadth-first, deduped — research can reach a PDN
// both directly and through its BRD).
export function downstreamOf(project, type, doc) {
  const out = [];
  const seen = new Set();
  let frontier = childrenOf(project, type, doc);
  while (frontier.length) {
    const fresh = frontier.filter((n) => !seen.has(n.type + n.doc.id));
    fresh.forEach((n) => seen.add(n.type + n.doc.id));
    out.push(...fresh);
    frontier = fresh.flatMap((n) => childrenOf(project, n.type, n.doc));
  }
  return out;
}

// ---- computed staleness ----
// A PDN is stale when its source BRD has moved past the version it was
// generated from; everything under a stale PDN inherits it.
export function staleInfo(project, type, doc) {
  if (type === 'research' || type === 'brd') return null;
  let pdn = doc;
  if (type !== 'pdn') {
    const chain = upstreamOf(project, type, doc);
    const hit = chain.find((n) => n.type === 'pdn');
    if (!hit) return null;
    pdn = hit.doc;
  }
  const brd = findDoc(project, 'brd', pdn.brdId);
  if (!brd) return null;
  const cur = brd.versions.length;
  if (pdn.brdVersion < cur) {
    return { brd, from: pdn.brdVersion, current: cur, pdn };
  }
  return null;
}

// ---- generation: derive the delivery chain from an ai.analyze result ----
export function pdnFromAnalysis(brd, r) {
  const version = brd.versions.length;
  const content =
    (r.pdn_markdown || `# PDN — ${brd.title}`) +
    `\n\n---\n_Generated from BRD "${brd.title}" v${version} · ${r.verified}/${r.impacts.length} impacts verified against source code._`;
  return {
    id: uid(), title: `PDN — ${brd.title}`, brdId: brd.id, brdVersion: version,
    researchIds: [...(brd.researchIds || [])],
    content, analysis: r, createdAt: now()
  };
}
export function deriveEpics(pdn) {
  const r = pdn.analysis;
  if (!r) return [];
  const byLayer = {};
  for (const im of r.impacts) {
    const sys = r.layers[im.layer]?.system || im.layer;
    (byLayer[sys] = byLayer[sys] || []).push(im);
  }
  return Object.entries(byLayer).map(([system, impacts]) => ({
    id: uid(), pdnId: pdn.id, title: `${system} — ${r.title || r.text.slice(0, 44)}`,
    summary: impacts.map((i) => i.change).join('. ') + '.',
    system, createdAt: now()
  }));
}
export function deriveStories(pdn, epics) {
  const r = pdn.analysis;
  if (!r) return [];
  return (r.stories || []).map((s) => {
    // Generated stories carry the owning system in `component`; match the
    // epic on it exactly, falling back to the first (core) epic for
    // cross-system stories like QA regression.
    const epic = epics.find((e) => e.system === s.component) || epics[0];
    return {
      id: uid(), epicId: epic?.id, title: s.summary,
      description: s.description, ac: [...(s.ac || [])], points: s.points, component: s.component, createdAt: now()
    };
  });
}
export function deriveFrs(stories) {
  return stories.flatMap((s) => (s.ac || []).map((ac, i) => ({
    id: uid(), storyId: s.id,
    title: `FR — ${ac.length > 70 ? ac.slice(0, 70) + '…' : ac}`,
    description: `The system shall satisfy: ${ac}`,
    createdAt: now()
  })));
}
export function deriveTests(pdn, stories, frs) {
  const r = pdn.analysis;
  if (!r) return [];
  const out = [];
  for (const suite of r.test_suites || []) {
    const story = stories.find((s) => suite.story.includes(s.title.slice(0, 24))) || stories[0];
    const storyFrs = frs.filter((f) => f.storyId === story?.id);
    suite.cases.forEach((c, i) => {
      const fr = storyFrs[i % Math.max(1, storyFrs.length)] || frs[0];
      if (!fr) return;
      out.push({ id: uid(), frId: fr.id, title: c.title, gherkin: c.gherkin, createdAt: now() });
    });
  }
  return out;
}

// ---- inline AI helpers (deterministic, instant) ----
export function brdCompletenessReview(brd) {
  const s = brd.sections;
  const findings = [];
  if (!s.background.trim()) findings.push('Background is empty — reviewers can\'t judge intent without the business problem.');
  if (s.requirements.length < 3) findings.push(`Only ${s.requirements.length} requirement(s) — most approved BRDs here carry 3+. Consider edge flows (failure, retry, reversal).`);
  if (!s.stakeholders.trim()) findings.push('No stakeholders named — sign-off will stall without owners.');
  if (!s.success.trim()) findings.push('Success criteria missing — add a measurable target so the PDN can carry it into test coverage.');
  if (!(brd.researchIds || []).length) findings.push('No research linked — link the notes that motivated this so traceability starts at the source.');
  if (!findings.length) findings.push('Structurally complete: background, 3+ requirements, stakeholders, success criteria and linked research are all present.');
  return findings;
}
export function generateAc(story) {
  const t = story.title.replace(/\.$/, '');
  return [
    `Given the change "${t}", the primary flow completes without regression to existing behaviour`,
    'Invalid or missing input is rejected with a clear inline message',
    'The outcome is visible on the review screen and persisted to the proposal record'
  ];
}
export function edgeCasesFor(fr) {
  const base = fr.title.replace(/^FR — /, '').replace(/…$/, '');
  return [
    { title: `Edge — ${base.slice(0, 40)} under concurrent update`, gherkin: `Given two sessions edit the same proposal\nWhen both submit within the same second\nThen the second write is rejected with a version conflict\nAnd no partial state is persisted` },
    { title: `Edge — ${base.slice(0, 40)} with boundary input`, gherkin: `Given the input is at its exact boundary value\nWhen the requirement is exercised\nThen the system accepts the boundary and rejects one unit beyond it` }
  ];
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// =====================  SEED DATA  =====================
// EMI is deliberately NOT seeded — it is the live interview walkthrough,
// built from a blank project on stage (research → conversations → BRD v1 →
// PDN → chain → v2 → staleness → regenerate). What ships pre-seeded is one
// mature showcase project (₹2 Cr sum-insured expansion, full clean chain)
// as the fallback/reference, plus a light KYC draft so Home feels lived-in.
function seedProducts() {
  return [
    { id: 'prod-retail', name: 'Retail Health Insurance', about: 'D2C individual and family-floater covers sold on the Zenith journey — quote, underwriting, payment, issuance.', createdAt: now() },
    { id: 'prod-group', name: 'Group Health Insurance', about: 'Employer-sponsored group covers — corporate onboarding, member management, renewals.', createdAt: now() },
    { id: 'prod-claims', name: 'Claims & Servicing', about: 'Claim intake, adjudication, cashless network and post-issuance servicing.', createdAt: now() },
    { id: 'prod-platform', name: 'Digital Platform', about: 'Shared platform capabilities — identity, documents, data, fraud and integrations.', createdAt: now() }
  ];
}

// ---- portfolio seed ----
// A believable book of work so the tracker opens on a real portfolio: four
// delivered this quarter, five in flight. Each carries the tracker fields an
// org actually reviews — description, status, go-live, event history, and
// north-star metrics with a short trend.
const day = (offset) => new Date(Date.now() + offset * 86400e3).toISOString().slice(0, 10);

function portfolioSeed() {
  const rows = [
    {
      id: 'proj-claims-instant', name: 'Instant Claim Settlement', productId: 'prod-claims', status: 'live', goLive: day(-97), owner: 'm-anita', visibility: 'published',
      description: 'Auto-adjudicate low-value cashless claims under ₹25,000 within 60 seconds, with a rules-based fraud screen and a manual queue for exceptions.',
      events: [
        [-180, 'kickoff', 'Kick-off with Claims Ops and Actuarial'],
        [-158, 'decision', 'Chose rules-based adjudication over ML for v1 — explainability required by compliance'],
        [-131, 'milestone', 'Adjudication engine passed regression on 12 months of historical claims'],
        [-112, 'review', 'Compliance and Underwriting sign-off completed'],
        [-97, 'release', 'Released to production — 100% of eligible claims routed automatically']
      ],
      metrics: [
        { name: 'Claims auto-settled', unit: '%', target: 60, baseline: 0, pts: [[-90, 22], [-60, 41], [-30, 55], [-5, 63]] },
        { name: 'Median settlement time', unit: 'hrs', target: 1, baseline: 72, pts: [[-90, 26], [-60, 9], [-30, 3], [-5, 1]] }
      ]
    },
    {
      id: 'proj-wa-renewals', name: 'WhatsApp Renewal Reminders', productId: 'prod-retail', status: 'live', goLive: day(-59), owner: 'm-anita', visibility: 'published',
      description: 'Renewal nudges over WhatsApp with a one-tap payment link, replacing the email-only reminder chain that customers were ignoring.',
      events: [
        [-140, 'kickoff', 'Renewals leakage analysis presented to Distribution'],
        [-121, 'decision', 'WhatsApp Business API chosen over SMS — read rates 4x in pilot'],
        [-88, 'risk', 'Template approval delayed 3 weeks by the provider'],
        [-70, 'milestone', 'Pilot on 5,000 policies — 18% lift in on-time renewal'],
        [-59, 'release', 'Rolled out to the full retail book']
      ],
      metrics: [
        { name: 'On-time renewal rate', unit: '%', target: 80, baseline: 61, pts: [[-55, 66], [-40, 71], [-20, 76], [-3, 79]] }
      ]
    },
    {
      id: 'proj-group-onboard', name: 'Corporate Group Onboarding Portal', productId: 'prod-group', status: 'live', goLive: day(-40), owner: 'm-sana', visibility: 'published',
      description: 'Self-serve portal for HR teams to upload member rosters, validate data and activate group cover without an account manager in the loop.',
      events: [
        [-165, 'kickoff', 'Three corporate clients interviewed on the current onboarding pain'],
        [-140, 'milestone', 'Roster validation engine handles the top 6 HRMS export formats'],
        [-96, 'decision', 'Deferred SSO to phase 2 — magic links unblock launch'],
        [-52, 'approval', 'VP Group Business approved go-live'],
        [-40, 'release', 'Live with 8 corporate clients onboarded in week one']
      ],
      metrics: [
        { name: 'Onboarding time', unit: 'days', target: 2, baseline: 14, pts: [[-35, 9], [-25, 5], [-12, 3], [-2, 2]] },
        { name: 'Rosters self-served', unit: '%', target: 75, baseline: 0, pts: [[-35, 31], [-25, 52], [-12, 64], [-2, 71]] }
      ]
    },
    {
      id: 'proj-cashless', name: 'Cashless Hospital Network Expansion', productId: 'prod-claims', status: 'live', goLive: day(-18), owner: 'm-vikram', visibility: 'published',
      description: 'Add 1,200 hospitals across tier-2 cities to the cashless network, with automated empanelment checks and tariff ingestion.',
      events: [
        [-120, 'kickoff', 'Network gap analysis across 40 tier-2 cities'],
        [-95, 'decision', 'Tariff ingestion automated rather than keyed by the network team'],
        [-44, 'risk', 'Two hospital chains renegotiated tariffs mid-empanelment'],
        [-18, 'release', 'Network live — 1,143 hospitals added']
      ],
      metrics: [
        { name: 'Cashless coverage (tier-2)', unit: '%', target: 70, baseline: 38, pts: [[-15, 52], [-10, 61], [-4, 66]] }
      ]
    },
    {
      id: 'proj-emi', name: 'EMI & Payment Flexibility', productId: 'prod-retail', status: 'at-risk', goLive: day(27), owner: 'owner', visibility: 'published',
      description: 'Offer interest-free monthly premium instalments alongside annual payment, including default handling that pauses rather than cancels cover.',
      events: [
        [-38, 'kickoff', 'Affordability drop-off identified in the quote funnel'],
        [-31, 'decision', 'EMI approved over third-party financing — keeps the customer relationship in-house'],
        [-16, 'milestone', 'Instalment schedule engine passing actuarial review'],
        [-6, 'risk', 'Gateway mandate cap (₹15,000/instalment) blocks the top premium band — workaround under review']
      ],
      metrics: [
        { name: 'Quote-to-policy conversion', unit: '%', target: 34, baseline: 27, pts: [[-30, 27], [-14, 28]] }
      ]
    },
    {
      id: 'proj-telemed', name: 'Telemedicine Add-on', productId: 'prod-retail', status: 'on-track', goLive: day(49), owner: 'm-anita', visibility: 'published',
      description: 'Unlimited teleconsultation as an optional add-on, bundled with a partner network and priced from utilisation modelling.',
      events: [
        [-24, 'kickoff', 'Partner shortlist narrowed to two teleconsultation providers'],
        [-9, 'decision', 'Priced as an add-on rather than bundled into base — protects the base premium']
      ],
      metrics: [
        { name: 'Add-on attach rate', unit: '%', target: 25, baseline: 0, pts: [] }
      ]
    },
    {
      id: 'proj-doc-digital', name: 'Policy Document Digitisation', productId: 'prod-platform', status: 'delayed', goLive: day(43), owner: 'm-sana', visibility: 'published',
      description: 'Replace PDF policy packs with a structured document service so policy data is queryable rather than trapped in attachments.',
      events: [
        [-88, 'kickoff', 'Document estate audit — 2.1M policy PDFs in scope'],
        [-61, 'milestone', 'Extraction accuracy at 94% on the 2019+ corpus'],
        [-27, 'risk', 'Pre-2015 scans below accuracy threshold; manual QA lane needed'],
        [-12, 'decision', 'Scope cut to 2015+ documents for phase 1 — go-live moved out four weeks']
      ],
      metrics: [
        { name: 'Documents structured', unit: '%', target: 90, baseline: 0, pts: [[-60, 12], [-30, 38], [-6, 51]] }
      ]
    },
    {
      id: 'proj-fraud', name: 'Fraud Detection Model v2', productId: 'prod-platform', status: 'on-hold', goLive: day(72), owner: 'm-vikram', visibility: 'private',
      description: 'Second-generation fraud scoring on claims, moving from static rules to a supervised model with human review on the boundary.',
      events: [
        [-54, 'kickoff', 'Model v1 false-positive review with the SIU team'],
        [-20, 'risk', 'Awaiting the labelled dataset from Claims — on hold until data lands']
      ],
      metrics: [
        { name: 'False-positive rate', unit: '%', target: 8, baseline: 23, pts: [[-40, 23]] }
      ]
    }
  ];

  return rows.map((r) => ({
    id: r.id, name: r.name, productId: r.productId, about: r.description, createdAt: now(),
    tracker: {
      description: r.description, status: r.status, goLive: r.goLive, owner: r.owner,
      visibility: r.visibility, sharedWith: [],
      events: r.events.map(([off, type, note]) => ({ id: uid(), date: day(off), type, note, createdAt: now(), source: 'seed' })),
      versions: []
    },
    metrics: (r.metrics || []).map((m) => ({
      id: uid(), name: m.name, unit: m.unit, target: m.target, baseline: m.baseline, source: 'manual', createdAt: now(),
      points: (m.pts || []).map(([off, value]) => ({ date: day(off), value }))
    })),
    reviews: [],
    folders: [], decisions: [], research: [], conversations: [], brds: [], pdns: [], epics: [], stories: [], frs: [], tests: [],
    releases: r.status === 'live' ? [{ id: uid(), name: `R-${r.goLive.slice(0, 7)}`, date: r.goLive, env: 'production', storyIds: [], createdAt: now() }] : []
  }));
}

function seedState() {
  const R1 = 'r-hni', R2 = 'r-uwband';
  const D1 = 'd-si';
  const B1 = 'b-si';
  const P1 = 'p-si';
  // Review date deliberately in the recent past with no outcome recorded, so
  // the showcase opens with a decision *due for review* — the loop is visible
  // before the user clicks anything.
  const siReview = new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10);
  const siDecision = {
    id: D1, title: 'Open a ₹2 crore sum-insured band for HNI customers',
    status: 'implemented', brdId: B1,
    context: 'HNI prospects abandon at the sum-insured step because the retail catalogue caps at ₹1 crore. Distribution loses high-premium quotes weekly to competitors offering ₹2 crore retail bands.',
    chosen: 'Add a ₹2 crore band to the retail catalogue, gated on actuarial rates and a UW medical grid, shipped once rates are certified.',
    alternatives: [
      { option: 'Do nothing — keep the ₹1 crore cap', whyNot: 'Continues to leak the highest-premium segment to competitors.' },
      { option: 'Offer ₹2 crore only via manual/offline underwriting', whyNot: 'Doesn’t fix the D2C abandonment where the drop-off happens.' }
    ],
    evidenceIds: [R1, R2],
    assumptions: [
      { text: 'Actuarial can certify a rate for the new band within one quarter', confidence: 'medium' },
      { text: 'Demand seen in lost quotes converts once the band exists', confidence: 'medium' },
      { text: 'The API contract change is additive (band list is enum-referenced)', confidence: 'high' }
    ],
    confidence: 0.62,
    impact: {
      business: 'Recovers high-premium HNI quotes lost at the SI step.',
      technical: 'Core rules + UW grid change; API additive; journey verification only.',
      customer: 'HNI buyers can complete a ₹2 crore cover self-serve.'
    },
    ownerId: 'owner', approverId: null,
    reviewDate: siReview, outcome: '', lessons: '',
    createdAt: now(), versions: []
  };
  const E1 = 'e-si-core', E2 = 'e-si-journey';
  const S1 = 's-si-band', S2 = 's-si-contract', S3 = 's-si-format';
  const F1 = 'f-si-band', F2 = 'f-si-rates', F3 = 'f-si-compat', F4 = 'f-si-format';
  const siSections = {
    background: 'HNI prospects abandon at quote because our sum-insured selector tops out at \u20b91 crore while their existing group covers already exceed it. Distribution reports losing high-premium quotes weekly to competitors with \u20b92 crore retail bands.',
    requirements: [
      'Add a \u20b92 crore sum insured band to the retail catalogue',
      'Define underwriting limits and the medical-test grid for the new band',
      'Verify no consumer hardcodes the current maximum sum insured'
    ],
    stakeholders: 'Underwriting, Actuarial, Reinsurance, D2C Journey PM',
    success: '\u22655% of new policies pick the \u20b92 crore band within two quarters; zero mispriced issuances.'
  };
  const siAnalysis = {
    matched: true, text: siSections.requirements.join('. '),
    title: 'Sum-insured bands',
    overall: 'r', verdict_label: 'Red \u2014 core system change required', effort_points: 8, size: 'M',
    sprints: '1\u20132 sprints after actuarial rates', verified: 4,
    layers: { frontend: { label: 'Journey frontend', system: 'journey-app' }, api: { label: 'API contract', system: 'core-service' }, core: { label: 'Core business rules', system: 'core-service' }, db: { label: 'Core data model', system: 'core-service' } },
    impacts: [
      { layer: 'core', v: 'r', file: 'core-service/src/rules/underwriting.rules.yaml', change: 'Extend sum_insured_bands; medical-test grid & UW limits for the new band', evidence: { line: 30, snippet: 'sum_insured_bands: [500000, 1000000, ...]' } },
      { layer: 'core', v: 'r', file: 'core-service/src/rules/premium.rules.yaml', change: 'sum_insured_multiplier has no rate for the new band \u2014 actuarial input required', evidence: { line: 18, snippet: 'sum_insured_multiplier:' } },
      { layer: 'api', v: 'g', file: 'core-service/src/api/contracts/proposal-v2.contract.json', change: 'Contract references the band list by enum_ref \u2014 additive, verify no hardcoded caps', evidence: { line: 12, snippet: '"enum_ref": "sum_insured_bands"' } },
      { layer: 'frontend', v: 'g', file: 'journey-app/src/journey/steps.jsx', change: 'SI selector renders from core catalog API \u2014 verify \u20b9-crore formatting', evidence: null }
    ],
    pdn_markdown: '# PDN \u2014 Add a \u20b92 crore sum-insured band\n\n## Impacted systems\n- Core rules: sum_insured_bands + sum_insured_multiplier (actuarial rate needed)\n- API contract: additive \u2014 band list is enum-referenced\n- Journey: selector renders from catalog; verify crore formatting\n\n## Sequencing\n1. Actuarial rate for the band\n2. Core rules + UW medical grid\n3. Journey verification\n\n## Sign-offs\n- [x] Underwriting\n- [x] Actuarial\n- [x] Reinsurance',
    stories: [], test_suites: []
  };

  return {
    models: [],           // BYO cloud-key connections (Settings \u2192 Model Hub)
    activeModelId: null,  // null = demo brain \u00b7 'local' = Ollama via ws.local
    local: { endpoint: 'http://localhost:11434', chatModel: '', embedModel: '', temperature: 0.1 },
    theme: { ...DEFAULT_THEME },
    team: seedTeam(),
    // Named chat sessions on the landing page. Each carries its own
    // attachments and can be promoted into (or linked to) a project.
    sessions: [],
    activeSessionId: null,
    products: seedProducts(),
    projects: [
      {
        id: 'proj-si', name: 'High-Value Cover Expansion', productId: 'prod-retail',
        about: 'Open a \u20b92 crore sum-insured band for HNI customers without breaking underwriting limits.',
        createdAt: now(),
        tracker: {
          description: 'Open a \u20b92 crore sum-insured band for HNI customers without breaking underwriting limits. Requires a certified actuarial rate and a medical-test grid for the new band.',
          status: 'on-track', goLive: day(12), owner: 'owner', visibility: 'published', sharedWith: [],
          events: [
            { id: uid(), date: day(-64), type: 'kickoff', note: 'Lost-quote analysis showed 38 abandoned high-premium quotes in Q1', createdAt: now(), source: 'seed' },
            { id: uid(), date: day(-51), type: 'decision', note: 'Approved the \u20b92 crore band, gated on actuarial rates (62% confidence)', createdAt: now(), source: 'seed' },
            { id: uid(), date: day(-37), type: 'milestone', note: 'BRD v1 locked; PDN and delivery chain generated', createdAt: now(), source: 'seed' },
            { id: uid(), date: day(-14), type: 'review', note: 'Underwriting and Reinsurance reviewed the medical-test grid', createdAt: now(), source: 'seed' },
            { id: uid(), date: day(12), type: 'release', note: 'Planned go-live \u2014 R-2026.07 \u20b92 Cr band', createdAt: now(), source: 'seed' }
          ],
          versions: []
        },
        metrics: [
          { id: uid(), name: 'New policies on \u20b92 Cr band', unit: '%', target: 5, baseline: 0, source: 'manual', createdAt: now(), points: [] },
          { id: uid(), name: 'Mispriced issuances', unit: 'count', target: 0, baseline: 0, source: 'manual', createdAt: now(), points: [{ date: day(-10), value: 0 }] }
        ],
        reviews: [{
          id: 'rev-si', createdAt: now(), state: 'open',
          subject: 'BRD \u2014 Add a \u20b92 crore sum-insured band', subjectType: 'brd', subjectId: 'b-si',
          requestedBy: 'owner', note: 'Rate table and UW grid need sign-off before the 30th.',
          reviewers: [
            { memberId: 'm-vikram', role: 'director', status: 'approved', at: now(), comment: 'Commercially sound. Watch the reinsurance treaty limit.' },
            { memberId: 'm-compliance', role: 'stakeholder', status: 'pending' },
            { memberId: 'm-sana', role: 'em', status: 'pending' }
          ],
          history: [{ at: now(), memberId: 'm-vikram', verdict: 'approved', comment: 'Commercially sound. Watch the reinsurance treaty limit.' }]
        }],
        decisions: [siDecision],
        research: [
          { id: R1, title: 'HNI demand \u2014 lost-quote analysis', source: 'upload', sourceDetail: 'lost-quotes-q1.pdf', createdAt: now(), content: 'Quarterly review of abandoned high-premium quotes.\n\n38 quotes above \u20b91.5L annual premium abandoned at the sum-insured step this quarter; 31 of those users tried to select a higher band before dropping. Distribution confirms competitors quote \u20b92 crore retail bands to the same profiles.' },
          { id: R2, title: 'Underwriting & rating constraints for a new SI band', source: 'ai', createdAt: now(), content: 'Saved from a Feasly conversation.\n\nThe band list lives in underwriting.rules.yaml (sum_insured_bands) and every band needs a matching rate in premium.rules.yaml (sum_insured_multiplier) \u2014 a new band without an actuarial rate fails rating. The proposal-v2 contract references the band list by enum_ref, so the API change is additive. High-SI bands typically trigger pre-policy medicals \u2014 a hidden journey branch to scope with UW.' }
        ],
        conversations: [
          {
            id: 'c-si', title: 'Can we add a \u20b92 crore sum insured band?', updatedAt: now(),
            messages: [
              { role: 'assistant', content: "Hi! I'm Feasly, connected to the Zenith Health tenant \u2014 code, contracts and docs. Ask me anything.", engine: 'deterministic' },
              { role: 'user', content: 'Can we add a \u20b92 crore sum insured band?' },
              { role: 'assistant', content: 'Feasible but core-gated: sum_insured_bands in underwriting.rules.yaml and a matching sum_insured_multiplier rate are both required \u2014 the rate needs actuarial input. The API side is additive (band list is enum-referenced). I\u2019ve saved the full constraint breakdown to Research.', engine: 'deterministic', savedAsResearchId: R2 }
            ]
          }
        ],
        brds: [
          {
            id: B1, title: 'Add a \u20b92 crore sum-insured band', owner: 'PM', status: 'Approved',
            decisionId: D1, researchIds: [R1, R2], sections: siSections, createdAt: now(),
            versions: [{ v: 1, ts: now(), note: 'Initial draft from lost-quote research', sections: siSections }]
          }
        ],
        pdns: [{ id: P1, title: 'PDN \u2014 Add a \u20b92 crore sum-insured band', brdId: B1, brdVersion: 1, researchIds: [R1, R2], content: siAnalysis.pdn_markdown + '\n\n---\n_Generated from BRD "Add a \u20b92 crore sum-insured band" v1 \u00b7 4/4 impacts verified against source code._', analysis: siAnalysis, createdAt: now() }],
        epics: [
          { id: E1, pdnId: P1, title: 'core-service \u2014 Sum-insured bands', system: 'core-service', summary: 'Extend sum_insured_bands with UW limits and the medical-test grid; add the actuarial rate to sum_insured_multiplier.', createdAt: now() },
          { id: E2, pdnId: P1, title: 'journey-app \u2014 Sum-insured bands', system: 'journey-app', summary: 'Verify the SI selector renders the new band from the catalog and formats crore amounts correctly.', createdAt: now() }
        ],
        stories: [
          { id: S1, epicId: E1, title: 'Extend sum-insured bands with UW grid and actuarial rate', component: 'core-service', points: 8, description: 'Add the \u20b92 crore band to underwriting rules with its medical-test grid, and the actuarial multiplier to the rating rules.', ac: ['Given the new band is selected, rating uses the certified actuarial multiplier', 'Existing band premiums are unchanged against the regression baseline'], createdAt: now() },
          { id: S2, epicId: E1, title: 'Verify contract consumers tolerate the extended band list', component: 'core-service', points: 3, description: 'The band list is enum-referenced in proposal-v2; confirm no consumer hardcodes the current maximum.', ac: ['Existing v2 consumers pass contract tests with the extended list'], createdAt: now() },
          { id: S3, epicId: E2, title: 'Journey SI selector renders and formats the new band', component: 'journey-app', points: 3, description: 'The selector reads bands from the catalog API; verify \u20b92 Cr renders correctly across quote, review and PDF.', ac: ['The \u20b92 crore chip renders from the catalog without a frontend release', 'Crore formatting is correct on quote, review and the proposal PDF'], createdAt: now() }
        ],
        frs: [
          { id: F1, storyId: S1, title: 'FR \u2014 New band rates from the certified multiplier', description: 'The system shall rate the \u20b92 crore band using the certified actuarial multiplier.', createdAt: now() },
          { id: F2, storyId: S1, title: 'FR \u2014 Existing band premiums unchanged', description: 'The system shall produce unchanged premiums for all existing bands after the rules change.', createdAt: now() },
          { id: F3, storyId: S2, title: 'FR \u2014 Band list remains additive for v2 consumers', description: 'The system shall accept proposal-v2 payloads from consumers unaware of the new band.', createdAt: now() },
          { id: F4, storyId: S3, title: 'FR \u2014 Crore formatting across quote, review, PDF', description: 'The system shall format the \u20b92 crore band consistently on the quote selector, review screen and proposal PDF.', createdAt: now() }
        ],
        tests: [
          { id: 't-si-01', frId: F1, title: 'New band premium matches actuarial table', gherkin: 'Given a proposal on the \u20b92 crore band\nWhen the premium is rated\nThen it matches the certified actuarial table for the band', createdAt: now() },
          { id: 't-si-02', frId: F2, title: 'Existing bands regression-clean', gherkin: 'Given the pre-change regression baseline\nWhen the full rating pack re-runs\nThen all existing band premiums are unchanged', createdAt: now() },
          { id: 't-si-03', frId: F3, title: 'Old consumers unaffected by the new band', gherkin: 'Given a consumer on contract v2.0 without the new band\nWhen it submits a proposal\nThen the request succeeds unchanged', createdAt: now() },
          { id: 't-si-04', frId: F4, title: 'Crore formatting is correct end-to-end', gherkin: 'Given a customer selects the \u20b92 crore band\nWhen quote, review and PDF render\nThen the amount is formatted as \u20b92 Cr consistently', createdAt: now() }
        ],
        releases: [{ id: 'rel-si', name: 'R-2026.07 \u2014 \u20b92 Cr band', date: '2026-07-30', storyIds: [S1, S2, S3], createdAt: now() }]
      },
      {
        id: 'proj-kyc', name: 'Nominee & KYC Enhancements', productId: 'all',
        about: 'Compliance-driven improvements to nominee capture and proposer identity checks — applies to every product.',
        createdAt: now(),
        tracker: {
          description: 'Threshold-based PAN verification and mandatory nominee capture, driven by the regulator circular. Applies across every product line.',
          status: 'on-track', goLive: day(35), owner: 'm-compliance', visibility: 'private', sharedWith: [],
          events: [
            { id: uid(), date: day(-20), type: 'kickoff', note: 'Regulator circular reviewed with Compliance', createdAt: now(), source: 'seed' },
            { id: uid(), date: day(-8), type: 'milestone', note: 'Draft BRD created for threshold-based PAN verification', createdAt: now(), source: 'seed' }
          ],
          versions: []
        },
        metrics: [], reviews: [],
        decisions: [],
        research: [{ id: 'r-kyc', title: 'KYC circular — PAN capture thresholds', source: 'note', createdAt: now(), content: 'Regulator guidance requires PAN capture above a premium threshold. Current journey already collects PAN as mandatory; verify threshold logic is documented before drafting requirements.' }],
        conversations: [],
        brds: [{
          id: 'b-kyc', title: 'Threshold-based PAN verification', owner: 'PM', status: 'Draft', decisionId: null, researchIds: ['r-kyc'], createdAt: now(),
          sections: { background: 'PAN is captured for all proposers today, but verification (against the issuer) only matters above the regulatory premium threshold.', requirements: ['Verify PAN with the issuer when annual premium exceeds the threshold'], stakeholders: 'Compliance', success: '' },
          versions: [{ v: 1, ts: now(), note: 'Initial draft', sections: { background: 'PAN is captured for all proposers today, but verification (against the issuer) only matters above the regulatory premium threshold.', requirements: ['Verify PAN with the issuer when annual premium exceeds the threshold'], stakeholders: 'Compliance', success: '' } }]
        }],
        pdns: [], epics: [], stories: [], frs: [], tests: [], releases: []
      },
      ...portfolioSeed()
    ]
  };
}
