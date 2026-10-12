# Investment Banking Integrations

Use this map to fit `ib-deck-qc` into the Investment Banking v2 stack.

## financial-source-of-truth

Use for:
- source hierarchy and controlling-source decisions
- stale-data checks and as-of-date standards
- citation format
- source conflict handling
- fact / assumption / management claim / seller claim / third-party estimate labeling

IB deck QC should identify source issues, then apply the source-of-truth standard to resolve them.

## model-audit-tieout

Use for:
- model formula errors
- workbook structure problems
- hardcodes, broken links, inconsistent formula families
- sensitivity/scenario logic
- source-to-model tie-outs
- formula-driven numbers that differ from pitch book, CIM, teaser, valuation deck, financing deck, or committee output

IB deck QC should not rebuild models. It should route model problems to model audit.

## excel-data-cleaner

Use for:
- badly formatted source tables
- inconsistent date/number formats
- duplicate records
- merged-cell tabular data
- CSV/XLSX cleanup before tie-out

## three-statement-model-builder

Use when an IB deliverable issue reveals missing or broken operating model logic, including financial-statement linkage, working capital, debt, capex, taxes, or cash flow.

## dcf-model-builder

Use when valuation deck issues involve DCF forecast drivers, WACC, terminal value, EV-to-equity bridge, sensitivity tables, or intrinsic value range.

## comps-valuation

Use when issues involve peer selection, calendarization, metric normalization, EV/equity bridge, multiple calculation, outlier treatment, or implied valuation range.

## cim-teardown

Use when the artifact is seller-provided or CIM-derived and seller claims need to be converted into evidence asks, claims ledgers, red flags, or a diligence workplan.

## financials-normalizer

Use when issues involve adjusted EBITDA, add-backs, non-recurring items, run-rate adjustments, NWC support, lender EBITDA, quality of revenue, or support schedules.

## lbo-model-build

Use when issues involve sources and uses, debt schedule, cash sweep, leverage, covenant headroom, liquidity trough, sponsor returns, IRR/MOIC, or financing feasibility.

## merger-model-builder

Use when issues involve accretion/dilution, pro forma ownership, purchase accounting, synergy phasing, financing mix, exchange ratio, premium paid, or pro forma leverage.

## buyer-investor-list

Use when issues involve buyer rationale, investor targeting, lender targeting, strategic fit, sponsor fit, prioritization, outreach sequencing, or missing buyer-support evidence.

## pitch-deck-builder and cim-builder

Use when the problem is not a QC issue but a missing or weak pitch/CIM page, equity story, slide architecture, source register, teaser language, or banker-ready page rewrite.

When `cim-builder` hands off a CIM, teaser, management presentation, lender presentation, or buyer-facing section, consume `cim_builder_to_ib_deck_qc` from `../../../references/handoff-contracts.md`.

When `pitch-deck-builder` hands off a pitch book, client discussion deck, page plan, storyboard, or slide blueprint, consume `pitch_deck_builder_to_ib_deck_qc` from `../../../references/handoff-contracts.md`.

Missing source logs, claim registers, key-number tie-outs, chart/visual registers, or open-item blockers are material circulation issues.

## style-guide-adapter

Use when the artifact has a target firm/client style profile, precedent style, restyle pass, or style QC output. Consume `style_guide_adapter_style_profile` and `style_guide_adapter_change_log` as `style_profile_package` and `style_change_log_package`.

If `visual_review_status` is `metadata_only`, `not_performed`, or `blocked`, final posture cannot be `client-ready` unless a separate rendered visual review has been completed and documented.

## capital-markets-issuance

Use when issues involve ECM/DCM issuance timing, market window, investor targeting, comparable deals, use of proceeds, execution risk, or financing alternatives.

## distressed-recovery-waterfall

Use when issues involve claims, lien priority, recovery value, fulcrum security, plan value, liquidation value, or restructuring alternative sensitivities.

When restructuring materials are being circulated, consume `distressed_recovery_waterfall_to_ib_deck_qc` from `../../../references/handoff-contracts.md`. Keep legal-entitlement economics, negotiated plan economics, collateral/liquidation waterfalls, and enterprise-value waterfalls separate.

## memo-builder

Use after QC fixes when the user wants final IC/committee synthesis, decision framing, open questions, risks, and recommendation language.

## private-credit-underwriting

Use when issues involve borrower credit quality, debt capacity, leverage, covenant headroom, collateral, liquidity, downside case, lender EBITDA, terms, or credit committee materials.
