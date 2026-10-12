# DCF Plan Schema

`plan.json` is the public input contract for the deterministic DCF pipeline. Use `assets/plan_template.json` for a runnable starter, but replace placeholders before treating outputs as decision-grade.

Required top-level keys: `meta`, `source_basis`, `timeline`, `historicals`, `forecast`, `wacc`, `terminal_value`, `ev_to_equity_bridge`, `scenarios`, `sensitivities`.

`meta` requires company, industry, currency, units, valuation date/as-of date, accounting basis, valuation purpose, and model type (`fcff` or `fcfe`).

`source_basis` must cover historicals, forecast, WACC, terminal value, share count, and net debt. Each source needs `id`, topic, native evidence `label`, source name/type, as-of date, confidence, and notes. Native labels are `reported`, `company_guidance`, `consensus`, `management_case`, `user_provided`, `connected_app`, `web_research`, `analyst_estimate`, `placeholder`, and `derived`. Preserve native labels in plans, workbook rows, and run logs; add shared taxonomy labels only for downstream handoff.

`timeline` requires `start_year`, `horizon_years` from 1 to 15, and `periodicity`. The bundled engine is annual-first; quarterly inputs should be annualized unless all vectors match the period count.

`historicals` should include latest-year revenue, EBITDA, EBIT, cash taxes, D&A, capex, change in NWC, net working capital, unlevered FCF, and source id. FCFE plans also need net income and levered FCF when available.

`forecast` requires cash flow basis, mid-year convention, source id, and scenario assumptions. FCFF scenarios need revenue growth, EBIT margin, tax rate, D&A/revenue, capex/revenue, NWC/revenue, terminal growth when used, and WACC adjustment. FCFE scenarios also need net income margin or enough IS detail plus net borrowing.

`wacc` requires risk-free rate, beta, ERP, size premium, pre-tax cost of debt, tax rate, target debt/equity weights, and source id. Optional fields include company-specific premium, country risk, preferred weight, and preferred cost. Weights should roughly sum to 100%; WACC must exceed perpetual growth.

`terminal_value` uses `perpetual_growth` or `exit_multiple`; include both growth and exit multiple when possible for cross-checks.

`ev_to_equity_bridge` uses positive add-back convention for cash, non-operating assets, and associates; subtract debt, leases, minorities, pensions, preferred, options, and other debt-like items. Per-share output requires diluted shares plus net-debt and share-count source ids.

`scenarios` must include base, downside, and upside. `sensitivities` should include negative, zero, and positive arrays for WACC, terminal growth, exit multiple, revenue growth, and EBIT margin.

Screen-grade work may use placeholders, stale data, or rough estimates. Decision-grade work needs current sources, supported bridge items, no hard failures, and no material value-driving placeholders.
