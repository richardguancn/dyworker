# Metric Definitions + Diligence Pitfalls (Investor-grade)

## Table of contents
1. Principles (definitions before numbers)
2. Revenue, ARR/MRR, ACV/TCV, bookings, billings
3. Retention: NRR/GRR, churn, cohorts
4. Gross margin and COGS (SaaS vs services)
5. Unit economics: CAC, payback, LTV, contribution margin
6. Efficiency: Magic Number, S&M %, Rule of 40, burn multiple
7. Working capital and cash conversion
8. Pipeline and forecasting metrics
9. Non-GAAP metrics: adjusted EBITDA and addbacks
10. Common definition games (red flags)

---

## 1) Principles
- **Never compute or accept a metric without a written definition.**
- Store: numerator, denominator, time window, population, exclusions.
- If multiple definitions exist, create separate metric records (do not blend).

---

## 2) Revenue, ARR/MRR, ACV/TCV, bookings, billings

### Revenue
**Definition (GAAP-style):** Recognized revenue in the period under the applicable accounting standard.
- Must confirm: subscription vs services vs usage, revenue recognition policy, treatment of implementation.

Diligence pitfalls:
- Pro forma revenue mixing acquired revenue with organic.
- Pull-forward via one-time services.
- Usage revenue volatility masked by "subscription" framing.

### ARR (Annual Recurring Revenue)
ARR is a **point-in-time** measure of recurring contract value.

Acceptable formula variants (must specify which):
1) **Contracted recurring ARR:**
   - `ARR = sum(current recurring contract value annualized at current price)`
2) **MRR x 12:**
   - `ARR = MRR * 12` (only if MRR definition is clear)

Must define:
- Treatment of usage-based revenue (minimums? run-rate? trailing average?)
- Ramp deals (which ramp step counts?)
- Discounts and price uplifts
- Annual vs monthly billing
- FX (if multi-currency)

Red flags:
- ARR includes one-time fees or services.
- ARR defined as LTM recurring revenue (not point-in-time).

### MRR (Monthly Recurring Revenue)
`MRR = recurring revenue run-rate for the month` (point-in-time).
- Must define how partial-month starts are handled.

### ACV / ASP / TCV
- **ACV (Annual Contract Value):** annualized value of a contract (can include recurring + committed usage, must specify).
- **TCV (Total Contract Value):** total value across the full contract term (including services if defined).
- **ASP (Average Selling Price):** often means average ACV or average deal size; must specify.

Common trap: quoting ACV for enterprise but counting SMB in customer counts.

### Bookings
Bookings represent contracted value signed in period.
Common definitions:
- **Total bookings:** total contract value signed.
- **Annualized bookings:** annual recurring component of signed contracts.

Must specify:
- whether expansions/renewals are included
- whether churned renewals are removed
- how multi-year contracts are treated

### Billings
Billings represent invoiced amounts in period.
- Typically: `Billings = Revenue + Change in Deferred Revenue`
  (simplified; confirm for your accounting context)

### Deferred revenue
Deferred revenue is a balance-sheet liability representing billed but unrecognized revenue.
- Must reconcile: beginning deferred + billings - revenue = ending deferred

---

## 3) Retention: NRR/GRR, churn, cohorts

### Cohort basics
Define:
- cohort start date (month of first invoice? contract start? go-live?)
- measurement window (12 months? trailing?)
- inclusion rules (active-only is NOT acceptable for true retention)

### Expansion / contraction / churn components
For a fixed customer set (cohort):
- **Starting ARR:** ARR at period start for those customers
- **Expansion:** upsells, price increases, seat growth
- **Contraction:** downsells, seat reductions
- **Churn:** lost ARR from customers that leave or drop to zero

### GRR (Gross Revenue Retention)
Excludes expansion.
- `GRR = (Starting ARR - Contraction - Churn) / Starting ARR`

### NRR (Net Revenue Retention)
Includes expansion.
- `NRR = (Starting ARR - Contraction - Churn + Expansion) / Starting ARR`

Must define:
- timing: when does churn count (termination date vs last invoice vs notice)?
- treatment of reactivations (new logo vs reactivated)
- treatment of downgrades after renewal

### Logo churn
`Logo churn = (# customers churned in period) / (# customers at start of period)`

Trap: low logo churn can hide high ARR churn if small customers churn.

### ARR churn (gross and net)
- **Gross ARR churn rate:** `(Contraction + Churn) / Starting ARR`
- **Net ARR churn rate:** `(Contraction + Churn - Expansion) / Starting ARR`

### Retention sanity checks
- NRR should be reconcilable to customer-level ARR movements.
- If NRR is high but expansion mechanisms are unclear, treat as high risk.

---

## 4) Gross margin and COGS

### Gross margin
`Gross Margin % = (Revenue - COGS) / Revenue`

COGS should include all direct costs to deliver the product/service.
Common SaaS COGS components:
- hosting/cloud
- customer support
- third-party data / platform fees
- implementation/delivery labor (if promised as part of service)

Common tricks:
- excluding support/CSM from COGS
- capitalizing costs that should be expensed
- blending services into subscription without disclosing services margin

---

## 5) Unit economics: CAC, payback, LTV, contribution margin

### CAC (Customer Acquisition Cost)
CAC must specify the cost bucket and denominator.
Two common forms:
1) **CAC per new customer:**
   - `CAC = (Sales + Marketing costs attributable to new customer acquisition) / (# new customers acquired)`
2) **CAC per $ of new ARR:**
   - `CAC = S&M acquisition costs / New ARR booked`

Must define:
- whether S&M includes CSM or only sales+marketing
- allocation method (headcount, activity-based, etc.)
- whether expansions are excluded

### CAC payback
`CAC payback (months) = CAC / (Gross Profit from new customers per month)`

Key nuance:
- payback should use **gross profit**, not revenue
- if churn is meaningful, payback distribution matters (median/p90)

### LTV
Only valid when churn and gross margin assumptions are explicit.
A common simple form:
- `LTV = (ARPA * Gross Margin %) / Churn Rate`

But:
- churn must match the customer segment
- use steady-state churn (not early cohort)
- for expansion businesses, LTV needs cohort modeling

### Contribution margin
Contribution margin is the margin after variable costs.
Must define included variable costs:
- hosting, support, payment processing, delivery labor, possibly sales commissions

---

## 6) Efficiency metrics

### Magic Number (SaaS)
One common definition:
- `Magic Number = (Current quarter subscription revenue - Prior quarter subscription revenue) * 4 / Prior quarter S&M expense`

Variants exist. Always specify formula.

### Rule of 40
- `Rule of 40 = Revenue growth % + EBITDA margin %`
Must specify whether EBITDA is adjusted and whether revenue growth is YoY.

### Burn multiple
- `Burn multiple = Net cash burn / Net new ARR`
Must define burn (cash flow from ops? free cash flow?) and ARR definition.

---

## 7) Working capital and cash conversion
Key measures:
- **DSO:** days sales outstanding (AR / revenue)
- **Deferred revenue trend:** indicator of prepayment and bookings
- **Cash conversion:** EBITDA -> operating cash flow adjustments

Trap: high growth can mask collections issues; DSO rising is a warning.

---

## 8) Pipeline and forecasting metrics

### Pipeline coverage
Define:
- numerator: pipeline amount (weighted or unweighted)
- denominator: quota/target/bookings goal
- time window: next quarter, next 90 days, etc.

Best practice:
- compute **weighted pipeline** using historical conversion rates by stage

### Win rate
- `Win rate = Closed-won / (Closed-won + Closed-lost + No-decision)`
If no-decision is excluded, win rate is overstated.

### Sales cycle
Compute for both won and lost deals.
Report distribution (median, p75, p90), not only average.

---

## 9) Non-GAAP metrics: adjusted EBITDA
Adjusted EBITDA must list addbacks.
Hard rule:
- recurring "one-time" addbacks are not one-time.

Request:
- addback schedule by month/quarter
- GL accounts for addbacks

---

## 10) Common definition games (quick catalog)
- NRR excludes downgrades or excludes small customers
- GRR omitted entirely
- ARR defined as LTM recurring revenue
- GM excludes support or implementation
- CAC uses only marketing spend, excludes sales comp
- Pipeline coverage uses unweighted pipeline

If any of the above occurs: lower confidence and create red-flag entries.
