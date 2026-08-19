// Zenith EDW — read-only query API over the company data warehouse.
// A separate application from the Feasly product: Feasly connects to it the
// way it would connect to a real Snowflake/Databricks estate.
const express = require('express');
const cors = require('cors');
const { TABLES, catalog } = require('./tables');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => res.json({ service: 'zenith-edw', status: 'up', tables: Object.keys(TABLES).length }));

// Table catalog — what an analyst (or Feasly) sees when it connects.
app.get('/tables', (_req, res) => res.json({ warehouse: 'ZENITH_EDW', tables: catalog() }));

// Rows with optional filtering, sorting and pagination.
app.get('/tables/:name', (req, res) => {
  const t = TABLES[req.params.name];
  if (!t) return res.status(404).json({ error: `unknown table "${req.params.name}"` });
  const limit = Math.min(500, parseInt(req.query.limit, 10) || 50);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  let rows = t.rows;
  // ?where=column:value (exact, case-insensitive)
  if (req.query.where) {
    const [col, val] = String(req.query.where).split(':');
    rows = rows.filter((r) => String(r[col] ?? '').toLowerCase() === String(val ?? '').toLowerCase());
  }
  if (req.query.sort) {
    const col = String(req.query.sort).replace(/^-/, '');
    const dir = String(req.query.sort).startsWith('-') ? -1 : 1;
    rows = [...rows].sort((a, b) => (a[col] > b[col] ? dir : a[col] < b[col] ? -dir : 0));
  }
  res.json({ table: req.params.name, total: rows.length, limit, offset, rows: rows.slice(offset, offset + limit) });
});

// Aggregate endpoint — group/sum/avg/count without shipping raw rows around.
app.post('/query', (req, res) => {
  const { table, groupBy, metric, op = 'count' } = req.body || {};
  const t = TABLES[table];
  if (!t) return res.status(400).json({ error: 'valid table required' });
  const buckets = new Map();
  for (const row of t.rows) {
    const key = groupBy ? String(row[groupBy] ?? '—') : 'all';
    const b = buckets.get(key) || { key, n: 0, sum: 0 };
    b.n += 1;
    if (metric && typeof row[metric] === 'number') b.sum += row[metric];
    buckets.set(key, b);
  }
  const results = [...buckets.values()]
    .map((b) => ({ key: b.key, count: b.n, sum: Math.round(b.sum), avg: b.n ? Math.round((b.sum / b.n) * 100) / 100 : 0 }))
    .sort((a, b) => (op === 'count' ? b.count - a.count : b.sum - a.sum));
  res.json({ table, groupBy: groupBy || null, metric: metric || null, op, results });
});

module.exports = app;
