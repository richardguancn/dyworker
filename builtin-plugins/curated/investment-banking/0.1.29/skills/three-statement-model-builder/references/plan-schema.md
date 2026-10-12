# Three-Statement Plan Schema

`plan.json` is the public input contract for the deterministic operating-model pipeline. Use `assets/plan_template.json` as a runnable starter, but replace placeholders before decision use.

Required top-level keys: `meta`, `source_basis`, `timeline`, `historicals`, `revenue`, `costs`, `working_capital`, `ppe`, `debt`, `tax`, `equity`, `scenarios`, `sensitivities`. Optional: `other_balance_sheet`.

`meta` requires company name, industry, currency, units, as-of date, and accounting basis (`us_gaap`, `ifrs`, `management`, `cash_basis`, or `unspecified`).

`source_basis` must be non-empty and cover historicals plus at least one material forecast driver. Each source needs `id`, `label`, `source_type`, `as_of_date`, native `evidence_label`, `covers`, `confidence`, and notes. Native labels are `source_reported`, `company_provided`, `connector_sourced`, `public_filing`, `web_verified`, `management_guidance`, `analyst_estimate`, `benchmark`, `assumption`, and `placeholder`; model rows may also use `model_calculated`. Preserve native labels and map to shared taxonomy only for handoff.

`timeline` requires `start_year`, `horizon_periods`, and `periodicity` (`annual` or `quarterly`).

`historicals` requires income statement, balance sheet, cash flow, debt schedule, PP&E, and working capital. Latest historical balance sheet must balance or the model is not decision-ready.

Revenue methods: segmented build, total growth, or volume/price. Costs require COGS and opex methods. Working capital uses days assumptions. PP&E requires capex and depreciation method. Debt requires beginning balance, draws, repayments, interest rate, revolver/minimum cash where relevant. Tax and equity assumptions must be explicit.

`scenarios` should include base, downside, and upside with coherent overrides. `sensitivities` should include at least revenue growth, margin, working capital, capex, and interest/liquidity cases when relevant.

Screen-grade work can use assumptions/placeholders and supports triage only. Decision-grade work needs source-backed historicals, balanced statements, no hard failures, and current support for forecast drivers.
