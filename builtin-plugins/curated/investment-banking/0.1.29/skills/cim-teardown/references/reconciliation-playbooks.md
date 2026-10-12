# Reconciliation Playbooks (Tie-outs that catch lies)

## Table of contents
1. ARR <-> Revenue <-> Billings <-> Cash (SaaS)
2. Bookings <-> Billings <-> Deferred revenue
3. NRR/GRR tie-out to ARR bridge
4. GM tie-out to cloud spend + services mix
5. Pipeline coverage <-> forecast <-> actuals
6. Working capital and seasonality checks
7. Common reconciliation breaks and what they imply

---

## 1) ARR <-> Revenue <-> Billings <-> Cash (SaaS)
Goal: ensure the top-line story is internally consistent.

### Step 1: Define each metric
- ARR: point-in-time recurring run-rate (see `metric-definitions.md`)
- Revenue: recognized revenue in period
- Billings: invoiced amounts in period
- Cash: cash receipts in period

### Step 2: Build the monthly table (36 months)
Create a table with columns:
- month
- beginning ARR
- net new ARR (new + expansion - contraction - churn)
- ending ARR
- revenue (subs, usage, services)
- billings
- beginning deferred revenue
- ending deferred revenue
- cash receipts

### Step 3: Key tie-outs
- Billings tie-out: `Billings = Revenue + (Ending Deferred - Beginning Deferred)` (simplified)
- ARR exit vs subscription revenue run-rate: check if `ARR_exit ~ subs_revenue_last_month * 12` (only if rev is stable and definition matches)
- Cash vs billings: check collections timing and DSO

### Step 4: Investigate breaks
If ARR grows but revenue does not:
- possible longer billing terms, usage vs subscription shifts, churn hidden

If bookings/billings grow but deferred does not:
- possibly shorter contract terms, month-to-month, or recognition timing changes

---

## 2) Bookings <-> Billings <-> Deferred revenue
### Minimum dataset
- bookings by month (new/renewal/expansion)
- billings by month
- deferred revenue rollforward

### Checks
- bookings should lead to billings within a reasonable lag for most motions
- billings should accumulate into deferred revenue unless revenue recognized immediately

Red flags:
- bookings definitions shift between decks
- billings only shown annually

---

## 3) NRR/GRR tie-out to ARR bridge
### Minimum dataset
Customer-level ARR bridge by quarter (or month):
- customer_id
- starting_arr
- expansion
- contraction
- churn
- ending_arr

### Steps
1. Choose the cohort definition (start-of-period active customers is acceptable if churned stay included).
2. Compute GRR and NRR per quarter and for LTM.
3. Reconcile sum(ending_arr) to reported exit ARR.
4. Segment the results (SMB vs enterprise, vertical, geo).

Red flags:
- exclusions not disclosed
- migrations reclassed without mapping

---

## 4) GM tie-out to cloud spend + services mix
### Minimum dataset
- revenue split: subscription/usage/services
- COGS split: hosting/cloud, support, third-party, services delivery
- cloud cost export (CUR/billing)

### Checks
- compute GM by revenue line (subs GM, services GM)
- tie cloud costs to COGS hosting line (allow for allocation differences)
- check whether support and implementation are misclassified

Red flags:
- cloud credits subsidize GM
- services margin negative but hidden

---

## 5) Pipeline coverage <-> forecast <-> actuals
### Minimum dataset
- weekly pipeline snapshots
- opportunity field history (stage, close date, amount)
- forecast submissions by month (commit, best case)
- actual bookings/revenue

### Checks
- build weighted pipeline using historical stage conversion
- compare forecast vs actual (error distribution)
- analyze slippage (close date pushed)

Red flags:
- unweighted pipeline used
- no-decision excluded from win rates

---

## 6) Working capital and seasonality
### Minimum dataset
- AR aging by month
- DSO trend
- deferred revenue trend
- renewal calendar

Checks:
- rising DSO can signal enterprise friction
- deferred revenue declining can signal shorter terms or churn
- renewal calendar clustering creates seasonality/churn cliffs

---

## 7) What reconciliation breaks imply (cheat sheet)
- ARR up, revenue flat: definition mismatch, usage volatility, contract term shift
- bookings up, deferred flat: bookings definition games or term shortening
- GM high, cloud spend high: cost misclassification or credits
- NRR high, GRR unknown: expansion masking churn
- pipeline strong, forecast misses: pipeline quality issues
