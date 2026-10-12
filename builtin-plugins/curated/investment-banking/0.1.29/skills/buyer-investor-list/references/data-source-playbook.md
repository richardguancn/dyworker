# Data Source Playbook

Use this playbook to decide what evidence is needed and how to label confidence.

## Table of Contents

- [Source hierarchy](#source-hierarchy)
- [Facts vs assumptions vs inference](#facts-vs-assumptions-vs-inference)
- [Entity resolution rules](#entity-resolution-rules)
- [Data to collect by party type](#data-to-collect-by-party-type)
- [Source confidence](#source-confidence)
- [Stale-data checks](#stale-data-checks)
- [Evidence writing style](#evidence-writing-style)

## Source hierarchy

1. User-provided materials and explicit constraints.
2. Callable connected routes or user-provided exports: deal files, crm-like records, email/calendar context, prior process trackers, notes, and relationship data.
3. Licensed market-data routes or user-provided exports: company data, private-market data, sponsor/fund data, lender data, transactions, filings, transcripts, consensus, and contacts.
4. Public sources: company websites, investor presentations, filings, press releases, portfolio pages, news, conference materials, and public contact pages.
5. Inference from business logic, clearly labeled.

## Facts vs assumptions vs inference

Label row-level support:

- Fact: directly supported by provided or sourced evidence.
- Assumption: needed to proceed but not confirmed.
- Inference: reasoned conclusion from evidence, not directly stated.
- Needs validation: material to ranking and not yet verified.

Do not present inferred acquisition appetite, dry powder, contact ownership, or prior deal history as fact.

## Entity resolution rules

Normalize these before output:

- Parent vs subsidiary.
- Corporate parent vs relevant business unit.
- Sponsor firm vs specific fund.
- Sponsor firm vs portfolio platform.
- Lender affiliate vs asset manager parent.
- Family office vs operating company.
- Public company current name vs former name.
- Portfolio company ownership changes.
- Duplicate rows with different spellings or abbreviations.

Recommended fields:

- canonical_party_name
- party_type
- parent_or_owner
- relevant_unit_fund_platform
- contactable_entity
- ticker_or_identifier_if_relevant
- country_or_region
- last_verified_date
- source_confidence

## Data to collect by party type

### Strategic buyer

- Business unit and product/customer/geography overlap.
- Recent acquisitions and divestitures.
- Stated strategy from filings, transcripts, investor decks, or press releases.
- Balance sheet/capital allocation posture.
- Corporate development contact and relationship owner.
- Antitrust/confidentiality risk.

### Sponsor

- Current fund and vintage if available.
- Fund size, investment period, and likely remaining capacity if available.
- Typical equity check and enterprise value range.
- Sector/geography/stage/control/minority mandate.
- Relevant portfolio platforms and add-on history.
- Founder partnership or carve-out experience where relevant.
- Deal partner/contact and sponsor coverage owner.

### Sponsor-backed platform

- Sponsor owner.
- Platform size and strategy.
- Add-on fit.
- Contact path: sponsor deal team vs platform ceo/cfo/corp dev.
- Synergy and integration logic.
- Portfolio conflict risk.

### Lender / capital provider

- Facility type: revolver, term loan, unitranche, second lien, mezzanine, preferred equity, structured equity, dip, exit financing.
- Hold size and club appetite.
- Sponsored vs non-sponsored appetite.
- Sector restrictions and cyclicality tolerance.
- Leverage, pricing, covenant, and documentation posture if available.
- Existing relationship or exposure.

### Investor targeting

- Investor type and mandate.
- Security/structure eligibility.
- Sector and market-cap or company-stage fit.
- Position/check size.
- Recent activity and style.
- Existing ownership or prior meetings.
- Compliance/MNPI constraints where relevant.

## Source confidence

High:

- User-provided process data, current crm/contact data, direct public company/fund material, or multiple corroborating recent sources.

Medium:

- Structured database result or credible public source with partial gaps.

Low:

- Inferred from broad sector tag, stale source, portfolio adjacency only, or weak public evidence.

## Stale-data checks

Refresh or flag as stale when:

- Acquisition/portfolio information is more than 12-18 months old.
- Sponsor fund/fundraising information may have changed.
- Lender appetite or credit-market conditions may have changed.
- Corporate strategy changed due to leadership, activist pressure, restructuring, or divestiture.
- Prior process notes may conflict with current ownership or personnel.

## Evidence writing style

Bad: "active acquirer in software."

Good: "owns an adjacent workflow platform, announced a vertical expansion strategy, and completed two add-ons in the same customer segment; likely interested if retention and integration risk are defensible."

Bad: "large private equity fund with capital."

Good: "fund size and middle-market software mandate fit the expected equity check; existing portfolio company creates add-on angle, but valuation may be capped by sponsor underwriting."
