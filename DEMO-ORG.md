# Org demo — run of show (12 minutes)

**URL:** https://zenith-health-demo.vercel.app/ai → "Explore the Zenith showcase demo"
**If anything looks stale:** sidebar footer → *Reset demo data*.

Their stated problem: *"we can't track projects."* Lead with that, not with the AI.

---

## 1 · The problem, on one screen (90s)

Open **Portfolio**.

> "This is every project across every product. Four delivered, six in flight, two need attention. Grouped by the month they went live — and the ones ahead show a countdown."

Point at **EMI & Payment Flexibility — At risk, in 27 days**.

> "Today that answer lives in someone's spreadsheet, three Jira boards and a status call. Here it's one screen, and it's derived, not typed."

## 2 · What a project actually is (2 min)

Click **High-Value Cover Expansion** → the **Tracker**.

- Description, status, go-live, owner, **Private / Published** — "not every tracker should be visible to everyone; this one is published, the KYC one is private."
- Scroll the **event timeline**.

Then the moment: click **Generate from documents**.

> "It just wrote the project history from the decisions, the spec versions, the delivery chain and the releases that already exist in the workspace. It cannot invent a history that didn't happen — every row traces to a document."

Point at the **AI** tags on the generated rows, then **Save version**.

> "That's a snapshot. When someone asks in November what this looked like at sign-off, you have it."

## 3 · Ask it like ChatGPT (2 min)

Sidebar → **New chat**. Ask, in order:

1. `what went live in the last quarter?`
2. `what's going live next?`
3. `what is at risk?`
4. `why did we build the sum insured band?`

> "Same box, plain questions. The last one is the important one — it answers with the alternatives we rejected, the evidence, and the confidence we had at the time. That's the institutional memory that normally walks out of the door."

## 4 · Roles, without logging out (90s)

Top of sidebar → **Working as** dropdown. Switch **Workspace Admin → Stakeholder**.

> "Same person, different hat. A stakeholder sees the portfolio and their approvals — no board, no data warehouse, no settings."

Switch to **Engineer** — Sprint Board returns, Reviews disappears. Then back to **Admin** → **Settings → Module Access**.

> "This is the grid you'd sign off. Twelve modules, every role, every tick changes the product live."

## 5 · Review & approval (2 min)

Sidebar → **Reviews** → open the BRD review.

> "One document, three reviewers, each with their own role and verdict. Vikram has approved; compliance and engineering are pending."

Click **Approve** as compliance → state moves, history records it.

> "The overall state is derived from the reviewers — nobody can flip a status field. The history is append-only. That's an audit trail, not a checkbox."

## 6 · Performance (1 min)

Any project → **Performance** (try *Instant Claim Settlement*).

> "The north star we committed to, the baseline we started from, and every reading since. Auto-settlement went 22% → 63% against a 60% target."

## 7 · Connected Data — the EDW (2 min)

Sidebar → **Connected Data**.

> "This is a *separate application* — Zenith's data warehouse, standing in for your Snowflake/Databricks. Eight tables, a thousand rows: policies, claims, tickets, hospital network, and the delivery ledger."

Click **project_registry**, then group **policies** by `plan_code`.

> "Feasly reads it live, read-only. Nothing is copied. And any query can be saved as evidence on a decision — so a business case points at company data instead of a screenshot."

## 8 · Close (30s)

> "Three things I'd want your reaction to: does the portfolio view answer the tracking problem; is the module/role split right for how we're organised; and is 'why did we build this' worth having in twelve months."

---

## Ready answers

- **"Is our data safe?"** — the AI can run entirely on your own machines (Settings → Model Hub); documents never leave. The EDW connection is read-only.
- **"Can it import from Jira/Excel?"** — not yet; today it's manual entry plus generation from documents. An importer is a small build once we know the source.
- **"Can several people use it at once?"** — each person has an account and their own workspace today; a shared team workspace is the next build and is what a pilot would fund.
- **"How long did this take?"** — say it honestly. It's a working system, not a mockup: four applications, real data, real state.

## If something breaks

Reset demo data (sidebar footer) fixes 90% of it. The EDW is independent — if a table is slow, skip to the next section; nothing else depends on it.
