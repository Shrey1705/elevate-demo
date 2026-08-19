// Supporting files on any document — the Word/Excel/PowerPoint reality of how
// specs actually travel in an organisation.
//
// Text-ish files under 200KB keep their contents, so the AI can read them and
// cite them. Office binaries are registered with name, type and size and the
// UI says so plainly — better an honest reference than a fake preview.
import React, { useRef, useState } from 'react';
import { I } from './icons';
import { useWS, mutate, can, shortDate, attachmentFrom, addAttachment, removeAttachment, prettySize, TEXTY } from './workspace';

const ICON = (name) => {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return { glyph: 'file', tint: '#2b579a', label: 'Word' };
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return { glyph: 'checks', tint: '#217346', label: 'Excel' };
  if (['ppt', 'pptx', 'odp'].includes(ext)) return { glyph: 'layers', tint: '#d24726', label: 'PowerPoint' };
  if (ext === 'pdf') return { glyph: 'clipboard', tint: '#c0392b', label: 'PDF' };
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return { glyph: 'scatter', tint: '#7048e8', label: 'Image' };
  return { glyph: 'archive', tint: '#8e8e93', label: ext ? ext.toUpperCase() : 'File' };
};

export default function Attachments({ pid, type, doc }) {
  const ws = useWS();
  const editable = can(ws, 'edit');
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const list = doc.attachments || [];

  const upload = async (files) => {
    setErr(''); setBusy(true);
    for (const file of Array.from(files || [])) {
      if (file.size > 8 * 1024 * 1024) { setErr(`${file.name} is over 8 MB — link it instead of attaching.`); continue; }
      let content = '';
      if (TEXTY.test(file.name) && file.size < 200 * 1024) {
        try { content = await file.text(); } catch { /* keep metadata only */ }
      }
      const att = attachmentFrom(file, content);
      mutate((w) => addAttachment(w, pid, type, doc.id, att));
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="att">
      <div className="att-head">
        <p className="sigsub" style={{ margin: 0 }}>Supporting files {list.length ? `(${list.length})` : ''}</p>
        {editable && (
          <label className="att-add">
            <I n="upload" s={12} /> {busy ? 'Attaching…' : 'Attach files'}
            <input ref={inputRef} type="file" multiple style={{ display: 'none' }}
              accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.csv,.txt,.md,.json,.png,.jpg,.jpeg"
              onChange={(e) => upload(e.target.files)} />
          </label>
        )}
      </div>
      {err && <p className="error">{err}</p>}

      {list.length ? (
        <div className="att-list">
          {list.map((a) => {
            const ic = ICON(a.name);
            return (
              <div className="att-row" key={a.id}>
                <span className="att-icon" style={{ background: `${ic.tint}18`, color: ic.tint }}><I n={ic.glyph} s={14} /></span>
                <span className="att-main">
                  <b>{a.name}</b>
                  <em>{ic.label} · {prettySize(a.size)} · {shortDate(a.createdAt)}{a.hasContent ? ' · readable by the AI' : ' · linked'}</em>
                </span>
                {a.hasContent && (
                  <button className="fs-linkbtn" onClick={() => {
                    const w = window.open('', '_blank');
                    if (w) { w.document.write(`<pre style="font:13px ui-monospace,monospace;padding:24px;white-space:pre-wrap">${a.content.replace(/[&<]/g, (c) => (c === '&' ? '&amp;' : '&lt;'))}</pre>`); w.document.close(); }
                  }}>Preview</button>
                )}
                {editable && <button className="fs-linkbtn" onClick={() => mutate((w) => removeAttachment(w, pid, type, doc.id, a.id))}>Remove</button>}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="railempty" style={{ marginTop: 6 }}>
          No files attached. Word, Excel, PowerPoint and PDF are all accepted — text files are also read by the AI.
        </p>
      )}
    </div>
  );
}
