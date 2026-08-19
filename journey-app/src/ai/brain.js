// One router for every chat surface: when a local model is active, questions
// go through the RAG pipeline (retrieve → grounded, low-temperature local
// generation with citations); otherwise the deterministic demo backend
// answers. Same contract either way: { reply, engine, sources }.
import { ai } from '../lib/api';
import { askLocal } from './rag';
import { usingLocal } from './workspace';
import { askPortfolio } from './portfolioBrain';

export async function askFeasly({ token, ws, project, messages, onProgress }) {
  // Portfolio questions ("what went live in June?", "why did we build EMI?")
  // have exact answers in the workspace's own records — answer from those
  // and cite the projects, rather than paraphrasing through a model.
  const last = messages[messages.length - 1]?.content || '';
  const pf = askPortfolio(ws, last);
  if (pf) return { reply: pf.reply, engine: 'portfolio', sources: pf.sources };

  // Local RAG needs a project corpus to ground on; without one (e.g. the
  // workspace-level home chat before any project exists) fall through to
  // the deterministic backend.
  if (usingLocal(ws) && project) {
    const question = messages[messages.length - 1].content;
    return askLocal({ question, project, token, local: ws.local, onProgress });
  }
  const r = await ai.chat(token, messages.map(({ role, content }) => ({ role, content })));
  return { reply: r.reply, engine: r.engine, sources: null };
}
