# Investment Banking Invocation Policy

## Entry Gate

Activate this plugin only when at least one of these conditions is satisfied:

1. **Explicit invocation.** The user tags or names Investment Banking, uses `@investment-banking`, supplies its plugin link, or explicitly invokes one of its skills.
2. **Banker workflow context.** The prompt asks for banker-owned transaction, capital markets, valuation, diligence, buyer/investor targeting, pitch, process, restructuring, coverage, sponsor, issuer, lender, or deal-advisory work.

When the request lacks transaction or banker-workflow context, do not activate this plugin. A deliverable format, finance topic, company name, valuation mention, or available spreadsheet does not on its own pass the gate.

## High-Intent Signals

The untagged prompt should contain a banking workflow signal, such as:

- a sell-side auction, VDR, Datasite, data room, CIM/teaser teardown, buyer universe, outreach wave, NDA tracker, bid log, management presentation, lender presentation, or banker pitch-book request for a client transaction;
- an M&A process, merger/accretion-dilution model, fairness committee support, board transaction package, deal committee package, or process tracker;
- issuer ECM, DCM, or LevFin advice, capital-markets execution materials, restructuring/recovery pitch, or recovery waterfall in an advisory context.

## Non-Triggers

Do not invoke Investment Banking automatically for public-equity investment decisions, personal financial advice, legal advice, FP&A, or generic writing tasks with no transaction or banker-workflow context. Generic memo, report, deck, model, dashboard, valuation, company profile, spreadsheet cleanup, meeting brief, or source-synthesis requests need a banker-owned transaction, capital markets, valuation, diligence, pitch, process, restructuring, coverage, sponsor, issuer, lender, or deal-advisory context to pass the gate.

## After Activation

Once this gate is met, use `plugin-routing-playbook.md` to choose the owning workflow and `deliverable-intake-policy.md` before a new substantive hero deliverable begins. Specialist and rendering skills inherit this activation decision and do not independently broaden the plugin's scope.
