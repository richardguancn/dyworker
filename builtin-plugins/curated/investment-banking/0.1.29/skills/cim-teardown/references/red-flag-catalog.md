# Red-Flag Catalog + Detection Logic

## Table of contents
1. How to use this catalog
2. Cross-check rules (narrative vs data)
3. Red flags (60) with: trigger -> why -> detection -> evidence -> question
4. Severity calibration (1-5)

---

## 1) How to use this catalog
Red flags should be **specific, testable, and linked** to claims and questions.

For each red flag:
- record it in `outputs/red_flag_register.csv`
- link to at least one `claim_id` and at least one `question_id`
- include the detection rule (what you observed) and the evidence needed to resolve

---

## 2) Cross-check rules (core)
Always cross-check:
- CIM narrative vs KPI exhibits (same metric, same period)
- KPI exhibits vs underlying exports (customer-level and transaction-level)
- ARR exit vs revenue run-rate vs deferred revenue trend
- GM claims vs cloud spend + services mix
- Forecast claims vs historical forecast accuracy
- Customer logo claims vs customer master list (full list) and ultimate parent mapping

---

## 3) Red flags (60 concrete)

### A) Retention / NRR / GRR / churn
1) **NRR referenced without a definition.**
- Why: NRR is easy to game.
- Detection: NRR value shown; no numerator/denominator/window anywhere.
- Evidence: metric glossary + customer-level ARR bridge.
- Question: "Provide your NRR/GRR definitions and customer-level ARR bridge for last 8 quarters."

2) **NRR math cannot be reproduced.**
- Detection: recomputation differs by >2 pts.
- Evidence: raw ARR movements + exclusion list + customer ID mapping.
- Question: "List every exclusion and provide customer-ID mapping for cohort and ARR movements."

3) **NRR includes expansions but expansion drivers are not visible.**
- Detection: bridge shows minimal expansion but NRR high.
- Evidence: product usage, seat counts, pricing changes.
- Question: "Break down expansion by seats, modules, usage, and price increases by segment."

4) **GRR omitted entirely (only NRR shown).**
- Why: hides churn/downsells.
- Evidence: contraction + churn by cohort.
- Question: "Provide GRR by quarter and segment with churn reasons."

5) **Retention shown only for active customers.**
- Detection: footnote says "active" or excludes churned.
- Evidence: full cohort including churned.
- Question: "Recompute retention including churned customers; provide churn log."

6) **Logo churn low but ARR churn high (or vice versa) with no explanation.**
- Evidence: churn log with both logos and ARR.
- Question: "Provide logo churn and ARR churn by segment and explain divergence."

7) **Churn reasons missing or mostly 'Other'.**
- Evidence: churn reason coding policy, win/loss notes.
- Question: "Provide churn reasons with competitor displacement where known."

8) **Cohorts defined by renewal date (not acquisition) to hide early churn.**
- Evidence: customer start dates and renewal calendar.
- Question: "Provide retention by acquisition cohort month and by renewal cohort."

9) **NRR measured on revenue instead of ARR.**
- Detection: NRR described as revenue retention.
- Evidence: invoice-level data, ARR bridge.
- Question: "Provide ARR-based and revenue-based retention; explain differences."

10) **NRR excludes downgrades or includes reactivations as expansion.**
- Evidence: ARR movement classification rules.
- Question: "Provide your ARR movement taxonomy and reclassify reactivations separately."

11) **Churn timing inconsistent (counts only after offboarding).**
- Evidence: termination dates vs last invoice dates.
- Question: "Provide churn by contract termination date and by last invoice date."

12) **Retention materially worse in SMB but not disclosed.**
- Detection: only blended retention shown.
- Evidence: retention by segment.
- Question: "Provide NRR/GRR by segment (SMB/mid/enterprise) for 8+ quarters."

13) **Retention uses 'gross dollar retention' but excludes usage minimum step-downs.**
- Evidence: subscription objects + usage billing.
- Question: "Provide retention including committed usage step-downs and minimum resets."

14) **Migration/cohort restatement without the raw mapping.**
- Evidence: mapping table old_customer_id -> new_customer_id.
- Question: "Provide the migration mapping and recompute retention including migrated customers."

15) **Customer count growth conflicts with revenue growth.**
- Evidence: customer master list + ARR by customer.
- Question: "Provide customer count by segment and ARPA/ACV trends to reconcile."

### B) Revenue / bookings / billings
16) **Revenue growth claim does not reconcile to financial exports.**
- Evidence: monthly revenue export + GL tie-out.
- Question: "Reconcile revenue growth to GL and provide monthly revenue by product line for 36 months."

17) **Exit run-rate used as headline instead of actual trailing results.**
- Evidence: monthly revenue + one-time item list.
- Question: "Provide last 24 months monthly revenue and identify non-recurring items."

18) **Bookings growth claimed but deferred revenue flat/down.**
- Evidence: deferred revenue rollforward + billings.
- Question: "Provide deferred revenue rollforward and billings; explain divergence vs bookings."

19) **Bookings definition unclear (TCV vs ACV, includes renewals?).**
- Evidence: bookings policy + contract extracts.
- Question: "Define bookings and provide bookings by type (new/renewal/expansion), ACV vs TCV."

20) **Billings not provided or only annualized.**
- Evidence: invoices by month.
- Question: "Provide monthly billings (invoiced amounts) and reconcile to deferred revenue."

21) **Services revenue blended into subscription to inflate growth or margin.**
- Evidence: revenue and COGS split by type; services margin.
- Question: "Split subscription vs services revenue and margin; quantify services attach rate."

22) **Large quarter-end spikes in revenue or billings (cutoff risk).**
- Evidence: invoice dates, rev rec schedules.
- Question: "Provide revenue cutoff testing by invoice date and service delivery date."

23) **Revenue recognition policy changed recently without clear impact.**
- Evidence: accounting memo, auditor communication.
- Question: "Describe rev rec policy change, quantify impact by quarter."

24) **Customer prepaid terms changed (shorter terms) but runway assumptions unchanged.**
- Evidence: contract term distribution; deferred revenue trend.
- Question: "Provide contract term distribution and impact on cash collection timing."

25) **Backlog or RPO referenced but cannot be reconciled.**
- Evidence: RPO schedule; contract data.
- Question: "Provide RPO by quarter and reconcile to contract terms and revenue forecast."

### C) Gross margin / COGS / cost structure
26) **GM inconsistent with cloud spend trend.**
- Evidence: cloud cost export + COGS detail.
- Question: "Provide cloud spend by service and allocate to customers/products; reconcile to COGS."

27) **Support/CSM costs excluded from COGS without disclosure.**
- Evidence: headcount by function; cost accounting policy.
- Question: "Explain COGS policy and quantify GM impact if support included."

28) **Implementation/delivery labor treated as opex even when required to deliver product.**
- Evidence: services org chart; utilization.
- Question: "Provide services delivery cost and margin; clarify if implementation is required."

29) **Gross margin reported as 'contribution margin' or vice versa.**
- Evidence: metric definitions.
- Question: "Provide definitions and recompute GM per GAAP COGS policy."

30) **GM improving while product mix shifts to lower-margin services.**
- Evidence: revenue mix and margin by line.
- Question: "Provide GM by product line and explain mix-driven margin impact."

31) **Gross margin excludes third-party fees or data costs.**
- Evidence: vendor invoices; COGS detail.
- Question: "Provide third-party fees and how they are classified; recompute GM."

32) **Cloud credits materially subsidize COGS.**
- Evidence: cloud credits detail.
- Question: "Quantify cloud credits and pro forma GM without credits."

### D) Pipeline / forecast / GTM performance
33) **Pipeline coverage based on unweighted pipeline.**
- Evidence: stage conversion rates.
- Question: "Provide stage conversions and compute weighted pipeline coverage for next quarter."

34) **Win rate excludes no-decision deals.**
- Evidence: opp outcomes including no-decision.
- Question: "Provide no-decision rate and include in win rate by segment."

35) **Sales cycle reported as average only.**
- Evidence: distribution.
- Question: "Provide median/p75/p90 sales cycle for won and lost deals; show slippage rate."

36) **Forecast accuracy not shown.**
- Evidence: forecast vs actual history.
- Question: "Provide last 8 quarters forecast vs actual by month, including commit/best case."

37) **Pipeline snapshots missing (cannot measure coverage properly).**
- Evidence: weekly snapshots.
- Question: "Provide weekly pipeline snapshots for last 6 quarters (export or report)."

38) **Stage definitions changed mid-period.**
- Evidence: CRM stage history/config changes.
- Question: "Provide stage mapping over time and normalize conversion analysis."

39) **Pipeline double counting (renewal + expansion + new).**
- Evidence: unique opportunity IDs; account mapping.
- Question: "Provide unique opp IDs and de-duplicate pipeline by account and close date."

40) **Discounting increasing but not disclosed.**
- Evidence: discount report by segment.
- Question: "Provide discounting trend and net price realization by segment."

41) **Quota attainment low but growth plan assumes acceleration.**
- Evidence: rep quota/attainment history.
- Question: "Provide rep-level quota and attainment; explain hiring/ramp assumptions in plan."

42) **High reliance on a single channel/partner.**
- Evidence: bookings by channel.
- Question: "Provide channel mix and margin economics; assess channel concentration risk."

### E) TAM / market / competition
43) **TAM inflated via category definition creep.**
- Evidence: TAM methodology.
- Question: "Recalculate TAM restricted to ICP and geos; show sensitivity table."

44) **Market growth sourced from outdated or unclear third-party.**
- Evidence: full excerpt and publication date.
- Question: "Provide source excerpt and mapping to your category."

45) **Market share claim inconsistent with revenue scale.**
- Evidence: peer revenue comps.
- Question: "Provide peer set, share calculation, and definitional boundaries."

46) **Competitive 'only provider' claim is easily falsifiable.**
- Evidence: competitive verification + references.
- Question: "Provide proof and customer references where this feature drove purchase vs competitors."

47) **No systematic win/loss data (only anecdotes).**
- Evidence: CRM loss reasons; win/loss interviews.
- Question: "Provide win/loss by competitor and reason codes for last 12-18 months."

### F) Pricing / packaging
48) **Headline pricing shown, net realized pricing not disclosed.**
- Evidence: invoice pricing and discounts.
- Question: "Provide net price realization (gross price, discounts, credits) by segment."

49) **Price increase claims without renewal cohort proof.**
- Evidence: renewals pre/post change.
- Question: "Show churn and NRR impact pre/post price increase by cohort."

50) **Usage-based revenue presented as stable without volatility analysis.**
- Evidence: usage by customer and billing.
- Question: "Provide usage distribution, seasonality, and downsides under contraction scenarios."

### G) Concentration / customer list integrity
51) **Top customers list is partial or grouped (selection bias).**
- Evidence: full ARR by customer.
- Question: "Provide full ARR by customer with ultimate parent mapping and top 20 contracts."

52) **Ultimate parent mapping missing (affiliates hide concentration).**
- Evidence: parent-child mapping.
- Question: "Provide ultimate parent mapping and recompute concentration."

53) **Single vertical concentration hidden.**
- Evidence: ARR by vertical.
- Question: "Provide ARR by vertical and exposure to sector shocks."

54) **Vendor concentration (one cloud/provider/third-party is existential).**
- Evidence: vendor spend by vendor.
- Question: "Provide vendor spend concentration and contract terms; identify mitigation plans."

### H) Unit economics / efficiency
55) **CAC definition excludes major cost buckets.**
- Evidence: S&M GL detail + headcount.
- Question: "Provide CAC build with cost buckets and allocation rules; recompute CAC by segment."

56) **CAC payback uses revenue (not gross profit).**
- Evidence: gross margin by cohort.
- Question: "Recompute payback using gross profit and cohort churn assumptions."

57) **LTV assumes unrealistically low churn or ignores gross margin.**
- Evidence: churn by segment and margin.
- Question: "Provide churn distribution and GM by segment; recompute LTV with sensitivity."

58) **Magic Number formula inconsistent or miscomputed.**
- Evidence: formula + inputs.
- Question: "Provide your Magic Number definition and inputs; we will recompute with standard formula."

### I) Accounting adjustments / QoE indicators
59) **Adjusted EBITDA addbacks recur every quarter.**
- Evidence: addback schedule by month.
- Question: "Provide addback detail and justify recurring items; provide run-rate EBITDA excluding recurring addbacks."

60) **Working capital signals deteriorating (DSO rising, deferred revenue declining) vs growth narrative.**
- Evidence: AR aging, deferred rollforward.
- Question: "Provide AR aging, collections notes, deferred revenue rollforward, and explain cash conversion trend."

---

## 4) Severity calibration (1-5)
- 5: likely deal-breaker or major value impairment; immediate escalation
- 4: highly material; could change structure/price or diligence timeline
- 3: material but potentially fixable; needs verification
- 2: minor; track and resolve if easy
- 1: informational; document only
