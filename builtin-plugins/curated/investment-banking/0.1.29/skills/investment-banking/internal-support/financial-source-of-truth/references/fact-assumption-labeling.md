# Fact, Assumption, Claim, and Inference Labeling

Use this guide to keep the analysis honest about what is known, what is asserted, what is assumed, and what is inferred.

For cross-skill handoffs, use `../../../../../../../references/evidence-label-taxonomy.md` as the canonical mapping layer. Preserve skill-local labels when they are part of a schema or validator, and add the canonical category alongside them rather than forcing a rename.

## Label definitions

| Label | Definition | Example | Required treatment |
|---|---|---|---|
| verified fact | Directly supported by an authoritative, current source | FY2025 revenue from audited filing | Cite source and use normally |
| reported fact | Reported by a source but not independently verified | Market share from third-party report | Attribute to source and state limits |
| seller claim | Asserted by seller, banker, company, sponsor, or management pack | CIM says churn improved due to AI product | Put in claims ledger and ask for support |
| management statement | Spoken or written by management | CEO says demand improved in March | Quote or paraphrase with attribution; do not treat as proof |
| assumption | Chosen input not proven by evidence | Exit multiple of 12.0x | Label and sensitize |
| inference | Analyst conclusion drawn from evidence | Margin decline likely reflects mix pressure | Cite underlying facts and state confidence |
| estimate | Calculated approximation | LTM EBITDA estimated from quarterly data | Show method and caveat |
| pro forma adjustment | Adjustment to reported results | Add back public-company restructuring cost | Cite support and state whether accepted, rejected, or pending |
| unknown | Required item not sourced | Customer concentration unavailable | Convert to diligence ask |

## Labeling standard by work product

### CIM teardown

- Treat every seller assertion as a seller claim unless supported by source evidence.
- Separate evidence-backed red flags from hypothesis red flags.
- Convert unsupported high-impact claims into first-wave diligence asks.

### QoE

- Label each EBITDA adjustment as one of: supported, partly supported, management-only, rejected, pending support.
- Tie each adjustment to document evidence, period, recurrence analysis, and cash/non-cash treatment.
- Do not call normalized EBITDA verified unless the adjustment support is adequate.

### DCF and three-statement model

- Label historical values as sourced facts when tied to filings or financial statements.
- Label forecast drivers as assumptions unless explicitly guided by company guidance or contracted backlog.
- Label WACC, terminal growth, exit multiple, discount rate, and scenario cases as assumptions or estimates.

### Comps

- Label market prices and share counts with timestamp/date.
- Label peer selection rationale separately from objective facts.
- Label adjusted EBITDA or non-GAAP comparability issues as estimates if definitions differ.

### Earnings

- Label reported results, consensus, guidance, transcript statements, and analyst interpretation separately.
- Do not treat a management explanation as verified causality without supporting data.

### LBO and private credit

- Label sponsor model forecasts, lender adjustments, diligence adjustments, and user assumptions separately.
- Label covenant definitions and debt terms as verified only when tied to executed or draft legal documents.
- Label liquidity and revolver availability with as-of date.

### Investment memo

- Use the labels to separate what supports the recommendation from what still needs diligence.
- In the executive summary, avoid conclusions that require unsourced assumptions unless clearly framed as conditional.

## Language standards

Use stronger language only when evidence supports it.

| Evidence strength | Suitable language | Avoid |
|---|---|---|
| Verified fact | "reported", "filed", "contracted", "audited", "per source" | "appears" if no uncertainty exists |
| Reported fact | "according to", "reported by", "as stated in" | "verified" |
| Seller claim | "seller claims", "management states", "CIM asserts" | "the company has" unless supported |
| Assumption | "we assume", "case assumes", "if" | "will", "should", "is expected" without source |
| Inference | "suggests", "indicates", "is consistent with" | "proves", "confirms" |
| Unknown | "not yet supported", "requires diligence" | filler or false precision |

## Assumption escalation rule

Escalate an assumption into a visible caveat when any of these are true:

- It changes valuation by more than a modest amount.
- It changes buy/pass or approve/decline recommendation.
- It changes covenant compliance or liquidity runway.
- It is unsupported by current evidence.
- It contradicts management, market, or historical evidence.
- It is a heroic assumption relative to peer or historical benchmarks.

## Claims ledger template

```markdown
| Seller / management claim | Label | Evidence support | Test | Diligence ask | Risk if false |
|---|---|---|---|---|---|
| [claim] | [seller claim / management statement] | [source ID or none] | [how to test] | [ask] | [impact] |
```
