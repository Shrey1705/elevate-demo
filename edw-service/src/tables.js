// Zenith EDW — the company's enterprise data warehouse.
//
// This is NOT part of the Feasly product. It stands in for the datalake every
// insurer already runs (Snowflake/Databricks/BigQuery): the place where policy,
// claim, customer and delivery data actually lives. Feasly connects to it as a
// read-only source, which is the point of the demo — the workspace answers
// questions using the company's real data, without copying it anywhere.
//
// Rows are generated deterministically from a fixed seed so every environment
// and every demo run shows identical numbers.

let seed = 20260718;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (min, max) => Math.floor(min + rnd() * (max - min + 1));
const dayISO = (offset) => new Date(Date.now() + offset * 86400e3).toISOString().slice(0, 10);

const CITIES = ['Mumbai', 'Pune', 'Bengaluru', 'Hyderabad', 'Chennai', 'Delhi', 'Ahmedabad', 'Jaipur', 'Kochi', 'Indore'];
const PLANS = ['ESSENTIAL', 'SECURE', 'PRIME', 'APEX'];
const CHANNELS = ['D2C Web', 'Mobile App', 'Agent', 'Bancassurance', 'Aggregator'];
const CLAIM_TYPES = ['Hospitalisation', 'Day-care', 'Maternity', 'Critical illness', 'Pre/post hospitalisation'];
const TICKET_TOPICS = ['Premium payment failed', 'Policy document not received', 'Cashless approval delay', 'Nominee update', 'Renewal reminder opt-out', 'Add-on not reflected', 'EMI option unavailable', 'Network hospital query'];
const FIRST = ['Aarav', 'Diya', 'Vihaan', 'Ananya', 'Kabir', 'Meera', 'Rohan', 'Ishita', 'Arjun', 'Sana', 'Nikhil', 'Priya'];
const LAST = ['Sharma', 'Iyer', 'Patel', 'Reddy', 'Nair', 'Khan', 'Gupta', 'Desai', 'Rao', 'Mehta'];

function build() {
  seed = 20260718; // reset so generation is repeatable

  const customers = Array.from({ length: 240 }, (_, i) => ({
    customer_id: `CUS${String(10001 + i)}`,
    name: `${pick(FIRST)} ${pick(LAST)}`,
    city: pick(CITIES),
    age: int(22, 68),
    segment: rnd() > 0.82 ? 'HNI' : rnd() > 0.45 ? 'Mass affluent' : 'Mass',
    acquired_on: dayISO(-int(30, 900)),
    channel: pick(CHANNELS)
  }));

  const policies = customers.flatMap((c, i) => {
    const n = rnd() > 0.75 ? 2 : 1;
    return Array.from({ length: n }, (_, j) => {
      const plan = c.segment === 'HNI' ? pick(['PRIME', 'APEX']) : pick(PLANS);
      const si = plan === 'APEX' ? pick([10000000, 20000000, 99999999]) : plan === 'PRIME' ? pick([5000000, 10000000]) : pick([500000, 1000000, 2500000]);
      const issued = dayISO(-int(10, 730));
      return {
        policy_id: `POL${String(500001 + i * 2 + j)}`,
        customer_id: c.customer_id,
        plan_code: plan,
        sum_insured: si,
        annual_premium: Math.round((si / 1000) * (plan === 'APEX' ? 1.9 : plan === 'PRIME' ? 1.5 : 1.1) + int(2000, 9000)),
        issued_on: issued,
        status: rnd() > 0.93 ? 'LAPSED' : rnd() > 0.86 ? 'RENEWAL_DUE' : 'ACTIVE',
        payment_mode: rnd() > 0.88 ? 'MONTHLY_EMI' : 'ANNUAL',
        channel: c.channel,
        members_covered: int(1, 5)
      };
    });
  });

  const claims = Array.from({ length: 180 }, (_, i) => {
    const p = policies[int(0, policies.length - 1)];
    const amount = int(8000, 480000);
    const filed = dayISO(-int(1, 400));
    const auto = amount < 25000 && rnd() > 0.25;
    return {
      claim_id: `CLM${String(90001 + i)}`,
      policy_id: p.policy_id,
      customer_id: p.customer_id,
      claim_type: pick(CLAIM_TYPES),
      claimed_amount: amount,
      approved_amount: rnd() > 0.12 ? amount : Math.round(amount * 0.6),
      filed_on: filed,
      settled_on: rnd() > 0.15 ? dayISO(-int(0, 380)) : null,
      settlement_hours: auto ? int(1, 3) : int(24, 220),
      cashless: rnd() > 0.4,
      auto_adjudicated: auto,
      status: rnd() > 0.14 ? 'SETTLED' : rnd() > 0.5 ? 'IN_REVIEW' : 'QUERY_RAISED'
    };
  });

  const support_tickets = Array.from({ length: 150 }, (_, i) => ({
    ticket_id: `TKT${String(70001 + i)}`,
    customer_id: customers[int(0, customers.length - 1)].customer_id,
    topic: pick(TICKET_TOPICS),
    channel: pick(['Email', 'WhatsApp', 'Call centre', 'In-app']),
    opened_on: dayISO(-int(0, 180)),
    resolved_hours: int(1, 96),
    csat: int(2, 5),
    status: rnd() > 0.2 ? 'RESOLVED' : 'OPEN'
  }));

  const hospital_network = Array.from({ length: 90 }, (_, i) => ({
    hospital_id: `HOS${String(3001 + i)}`,
    name: `${pick(['City', 'Apex', 'Sunrise', 'Lifeline', 'Metro', 'Grace'])} ${pick(['Hospital', 'Multispeciality', 'Medical Centre'])}`,
    city: pick(CITIES),
    tier: rnd() > 0.55 ? 'Tier-2' : 'Tier-1',
    cashless_enabled: rnd() > 0.18,
    empanelled_on: dayISO(-int(5, 700)),
    beds: int(40, 620)
  }));

  // The company's own delivery ledger — what Feasly's Portfolio module reads
  // when an org already tracks releases in the warehouse.
  const project_registry = [
    ['PRJ-1041', 'Instant Claim Settlement', 'Claims & Servicing', dayISO(-97), 'LIVE', 'anita.rao'],
    ['PRJ-1046', 'WhatsApp Renewal Reminders', 'Retail Health', dayISO(-59), 'LIVE', 'anita.rao'],
    ['PRJ-1052', 'Corporate Group Onboarding Portal', 'Group Health', dayISO(-40), 'LIVE', 'sana.k'],
    ['PRJ-1058', 'Cashless Hospital Network Expansion', 'Claims & Servicing', dayISO(-18), 'LIVE', 'vikram.n'],
    ['PRJ-1061', 'High-Value Cover Expansion', 'Retail Health', dayISO(12), 'IN_FLIGHT', 'shrey'],
    ['PRJ-1066', 'EMI & Payment Flexibility', 'Retail Health', dayISO(27), 'AT_RISK', 'shrey'],
    ['PRJ-1071', 'Policy Document Digitisation', 'Digital Platform', dayISO(43), 'DELAYED', 'sana.k'],
    ['PRJ-1074', 'Telemedicine Add-on', 'Retail Health', dayISO(49), 'IN_FLIGHT', 'anita.rao'],
    ['PRJ-1079', 'Fraud Detection Model v2', 'Digital Platform', dayISO(72), 'ON_HOLD', 'vikram.n']
  ].map(([project_code, name, product_line, go_live_date, status, owner]) => ({
    project_code, name, product_line, go_live_date, status, owner,
    budget_inr: int(1800000, 12000000), headcount: int(3, 14)
  }));

  // Daily business metrics — what a north-star metric can be wired to.
  const metrics_daily = [];
  for (let d = 120; d >= 0; d -= 5) {
    metrics_daily.push({
      metric_date: dayISO(-d),
      quotes_started: int(900, 1800),
      policies_issued: int(180, 420),
      conversion_pct: Number((int(210, 330) / 10).toFixed(1)),
      claims_auto_settled_pct: Number((Math.min(68, 20 + (120 - d) * 0.38) + rnd() * 3).toFixed(1)),
      avg_settlement_hours: Number(Math.max(1.2, 26 - (120 - d) * 0.2 + rnd() * 2).toFixed(1)),
      renewal_on_time_pct: Number((Math.min(80, 61 + (120 - d) * 0.16) + rnd() * 2).toFixed(1))
    });
  }

  const agents = Array.from({ length: 40 }, (_, i) => ({
    agent_code: `AGT${String(2001 + i)}`,
    name: `${pick(FIRST)} ${pick(LAST)}`,
    city: pick(CITIES),
    policies_sold: int(12, 260),
    gwp_inr: int(400000, 9000000),
    active: rnd() > 0.15
  }));

  return { customers, policies, claims, support_tickets, hospital_network, project_registry, metrics_daily, agents };
}

const DATA = build();

const TABLES = {
  customers: { rows: DATA.customers, desc: 'Policyholder master — demographics, segment, acquisition channel.' },
  policies: { rows: DATA.policies, desc: 'Issued policies with plan, sum insured, premium and payment mode.' },
  claims: { rows: DATA.claims, desc: 'Claim events with settlement time, cashless flag and auto-adjudication.' },
  support_tickets: { rows: DATA.support_tickets, desc: 'Service desk tickets by topic, channel and CSAT.' },
  hospital_network: { rows: DATA.hospital_network, desc: 'Empanelled hospitals, tier and cashless capability.' },
  project_registry: { rows: DATA.project_registry, desc: 'Delivery ledger — projects, go-live dates, budgets and owners.' },
  metrics_daily: { rows: DATA.metrics_daily, desc: 'Daily business metrics: funnel, claims and renewals.' },
  agents: { rows: DATA.agents, desc: 'Distribution agents with production and GWP.' }
};

const catalog = () => Object.entries(TABLES).map(([name, t]) => ({
  name, description: t.desc, row_count: t.rows.length,
  columns: Object.keys(t.rows[0] || {})
}));

module.exports = { TABLES, catalog };
