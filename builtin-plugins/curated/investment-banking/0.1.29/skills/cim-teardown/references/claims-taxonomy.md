# Claims Taxonomy + Extraction Rules

## Table of contents
1. What counts as a claim
2. Taxonomy (categories and subcategories)
3. Claim typing (fact/estimate/projection/etc.)
4. Splitting compound claims
5. Capturing qualifiers and scope (the "lie layers")
6. Metric detection and canonicalization
7. Claim normalization schema (fields)
8. Worked examples (10 common claim types)
9. Common extraction pitfalls and fixes

---

## 1) What counts as a claim
Extract a claim when it would change underwriting, valuation, or risk if false.

Always extract:
- any numeric statement (value, rate, growth, ratio)
- any benchmark statement ("best-in-class", "top quartile", "#1")
- any causal statement ("NRR is driven by X")
- any forecast or plan assumption ("will reach 30% EBITDA")
- any customer proof point (ROI, payback, churn reduction)
- any competitive assertion ("only provider", "category leader")

Usually ignore (unless material):
- generic marketing language with no falsifiable content
- basic history with no impact

---

## 2) Taxonomy (categories and subcategories)
Use the top-level categories consistently across outputs (see `output-schemas.md`).

### Market
- TAM/SAM/SOM definition and sizing
- Market growth / CAGR
- Segmentation (vertical, geo, size)
- Buyer persona and budget
- Tailwinds/headwinds (regulatory/tech)
- Competitive intensity

### Product
- Modules/features shipped
- Roadmap and timelines
- Performance claims (uptime/latency)
- Differentiators (data, IP)
- Integrations/ecosystem
- Implementation complexity/time-to-value

### GTM
- ICP definition
- Sales motion (PLG, sales-led, channel)
- ACV/ASP and pricing realization
- Win rates
- Sales cycle and slippage
- Funnel metrics (lead->SQL->opp->win)
- Partner/channel economics

### Customers
- Logo list (select vs full)
- Customer counts, growth
- Concentration (top 10/20)
- Retention (NRR/GRR)
- Churn (logo, ARR, revenue)
- Cohorts (by start month, segment)
- Expansion drivers
- Satisfaction (NPS, reviews)

### Financial performance
- Revenue growth (GAAP/non-GAAP)
- Revenue mix (subscription/services/usage)
- Bookings, billings
- Gross margin and components
- Op margin / EBITDA / adj EBITDA
- Cash flow, burn, runway
- Working capital and seasonality

### Unit economics
- CAC and payback
- LTV and assumptions
- Contribution margin
- Cohort profitability
- Sales efficiency (Magic Number, S&M%)

### Moat/competition
- Competitive positioning
- Switching costs
- Network effects
- Data advantage
- Pricing power
- Product velocity

### Ops
- Support/delivery model
- Vendor dependencies
- Process maturity
- Scalability bottlenecks

### Legal/regulatory
- Compliance (SOC2, GDPR, HIPAA, etc.)
- Litigation
- Contractual risk (SLAs, indemnities)
- Regulatory exposure

### Team
- Key execs
- Hiring plan
- Incentives and retention
- Key-person risk

### Tech/security
- Architecture and cloud footprint
- Security posture and incidents
- SDLC maturity
- Data governance

### Pipeline/forecast
- Pipeline coverage definition
- Forecast methodology and accuracy
- Renewal pipeline
- Backlog

### Pricing
- Pricing model (seat, usage, tier)
- Discounting
- Price increases
- Packaging

### International
- Geo mix
- FX exposure
- Localization
- Data residency

### Concentration risk
- Customer concentration
- Vendor concentration
- Channel concentration

### Working capital
- DSO, AR aging
- Deferred revenue
- Collections risk

### Capex
- Capex requirements
- Capitalized software

### Seasonality
- Budget cycles
- Renewal seasonality
- Seasonal revenue patterns

---

## 3) Claim typing (how to classify)
- **Fact:** presented as true today/historical
- **Estimate:** management estimate, may be derived
- **Projection:** forward-looking target/forecast
- **Opinion:** subjective framing ("best", "leading")
- **Benchmark:** vs peers ("top quartile")
- **Third-party:** analyst report, study, external citation

If unsure, choose the *most skeptical* type (Estimate or Opinion) and lower confidence.

---

## 4) Splitting compound claims
Many CIM sentences contain 2-5 claims. Split into atomic units.

Example:
"We grew revenue 60% CAGR while maintaining 80% GM and 120% NRR."
- Claim A: Revenue CAGR = 60% over period X
- Claim B: GM = 80% over period X
- Claim C: NRR = 120% over period X

---

## 5) Capturing qualifiers and scope (the "lie layers")
Always store qualifiers as structured fields, not just text.

Qualifiers to capture:
- Magnitude: approx, ~, up to, at least, less than
- Accounting: pro forma, adjusted, non-GAAP, run-rate
- Timing: LTM, TTM, Q4 exit, as-of date
- Population: top 20 customers, enterprise segment, excluding churned

Scope fields to capture:
- segment (SMB/mid/enterprise)
- geo
- product line
- cohort definition (start month, included customers)

---

## 6) Metric detection and canonicalization
For every metric, capture:
- metric name (canonical)
- definition (formula)
- period and frequency
- numerator/denominator
- exclusions/inclusions

Use definitions in `metric-definitions.md`. If definition missing, set claim status `NEEDS_DEFINITION`.

---

## 7) Claim normalization schema (fields)
Minimum fields (match Claims Ledger columns):
- claim_id
- claim_text
- category/subcategory
- claim_type
- metrics
- period/as-of
- scope
- qualifiers
- cim_citation
- confidence (1-5)
- materiality (H/M/L)
- implied_assumptions
- required_evidence
- verification_method

---

## 8) Worked examples (common claim types)

### Example 1: Revenue growth
Claim: "FY2025 revenue grew 55% YoY to $48M"
- Metrics: Revenue, YoY growth
- Evidence: monthly revenue export + GL tie-out
- Verification: recompute YoY; reconcile to cash/deferred rev

### Example 2: Gross margin
Claim: "82% gross margin (LTM)"
- Evidence: COGS detail + cloud invoices + services mix
- Verification: recompute GM; split subs vs services

### Example 3: NRR
Claim: "120% NRR in FY2025"
- Evidence: customer-level ARR bridge; definition doc
- Verification: recompute NRR/GRR by cohort; segment by customer size

### Example 4: Pipeline coverage
Claim: "3.0x pipeline coverage for next quarter"
- Evidence: CRM opp history + stage conversions + forecast model
- Verification: rebuild weighted coverage; compare to forecast accuracy

### Example 5: TAM
Claim: "TAM is $10B"
- Evidence: methodology + bottom-up model + third-party citation
- Verification: rebuild TAM constrained to ICP; sensitivity analysis

### Example 6: Win rate
Claim: "35% enterprise win rate"
- Evidence: CRM closed won/lost + no decision outcomes
- Verification: recompute win rate including no-decisions and slippage

### Example 7: Sales cycle
Claim: "45-day sales cycle"
- Evidence: stage timestamps; include losses
- Verification: median and p90; slippage rates

### Example 8: Concentration
Claim: "Top 10 customers <15% of ARR"
- Evidence: ARR by customer by ultimate parent; top contracts
- Verification: recompute concentration, including affiliates

### Example 9: Pricing power
Claim: "We raised prices 8% with minimal churn"
- Evidence: renewal cohorts before/after; discounting trend
- Verification: churn/NRR impact analysis; net price realization

### Example 10: Competitive differentiation
Claim: "Only provider with real-time compliance automation"
- Evidence: feature matrix; win/loss; customer references
- Verification: verify against top competitors; pressure-test with references

---

## 9) Common extraction pitfalls
- Treating chart headlines as facts without reading footnotes
- Failing to store time period
- Mixing pro forma with organic
- Accepting NRR without definition
- Ignoring "select customers" selection bias

Fix: lower confidence, create evidence asks, and add red-flag entries.
