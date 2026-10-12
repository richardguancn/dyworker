# Data Request Library (Exact Export Wording)

## Table of contents
1. Principles (ask for exports, not screenshots)
2. Finance / accounting (GL, trial balance, revenue)
3. Billing/subscription systems (invoices, subscriptions, payments)
4. CRM / pipeline (opps, stage history, renewals)
5. Customer success/support (tickets, SLAs)
6. Product usage analytics (events, adoption)
7. Cloud cost exports (AWS/GCP/Azure)
8. Data room index and file naming standards

---

## 1) Principles
- Specify: system, report name, filters, fields, time window, granularity, format.
- Always request the raw keys (customer_id, contract_id, invoice_id, opp_id) so you can join data.
- Prefer exports with timestamps and historical change logs (opp field history, subscription changes).

---

## 2) Finance / accounting

### 2.1 General Ledger detail (NetSuite / Intacct / QuickBooks)
**Request:**
"GL detail export (CSV) for 36 months ending <YYYY-MM>, one row per transaction line. Include: txn_id, txn_date, posting_period, account_number, account_name, department/class, customer_id, vendor_id, memo/description, amount (base currency), currency, subsidiary/entity, created_timestamp, last_modified_timestamp. Provide chart of accounts and mapping to revenue/COGS/Opex buckets."

**Why:** revenue/GM/QoE tie-out; addbacks verification.

### 2.2 Trial balance by month
"Monthly trial balance (CSV) for last 36 months: account_number, account_name, period, beginning_balance, debits, credits, ending_balance."

### 2.3 Revenue by product/customer (management report)
"Monthly revenue by product line and customer segment for last 36 months, with reconciliation to GL revenue accounts. Provide the reconciliation table and mapping logic."

### 2.4 Deferred revenue rollforward
"Monthly deferred revenue rollforward for last 36 months: beginning deferred, billings, revenue recognized, other adjustments, ending deferred. Provide supporting GL accounts."

### 2.5 Adjusted EBITDA and addbacks schedule
"Monthly adjusted EBITDA bridge for last 12-24 months: GAAP operating income to adjusted EBITDA, with each addback line item, description, amount, and GL account references."

---

## 3) Billing / subscription systems

### 3.1 Invoices export (Stripe / Chargebee / Zuora)
"Invoice line-item export (CSV) for last 36 months: invoice_id, invoice_date, customer_id, subscription_id, product/plan_id, line_description, quantity, unit_price, discount_amount, tax, total_amount, currency, service_period_start, service_period_end, payment_status, paid_date."

### 3.2 Subscriptions export
"Subscription objects export (CSV): customer_id, subscription_id, start_date, end_date, status, billing_frequency, contracted_seats/units, price_per_unit, committed_usage_minimum, renewal_date, auto_renew_flag, last_modified_timestamp."

### 3.3 Payments/collections
"Payments export (CSV): payment_id, invoice_id, customer_id, payment_date, amount, method, status, failed_reason (if any)."

---

## 4) CRM / pipeline

### 4.1 Salesforce opportunity export (current snapshot)
"Salesforce Opportunity export (CSV) for opps created since <YYYY-01-01> and all open opps. Include: opp_id, opp_name, account_id, created_date, close_date_current, close_date_original, amount, stage_name, forecast_category, probability, lead_source, owner_id, segment, product, type (new/expansion/renewal), is_closed, is_won, is_lost, loss_reason, competitor, next_step."

### 4.2 Salesforce Opportunity Field History / Stage history
"Salesforce OpportunityFieldHistory (CSV) for same opp set, include: opp_id, field_name, old_value, new_value, change_date. At minimum: StageName, CloseDate, Amount, ForecastCategory."

### 4.3 Pipeline snapshot history
"Weekly pipeline snapshot report for last 6 quarters (or a snapshot table). Required fields: snapshot_date, opp_id, stage_name, close_date_current, amount, probability, forecast_category."

### 4.4 Renewals pipeline
"Renewals pipeline report (CSV): account_id, contract_id, renewal_date, renewal_amount, renewal_stage, churn_risk_score, CSM_owner, upsell_opportunity_flag."

### 4.5 Win/loss report
"Closed-won and closed-lost opportunities for last 24 months with: competitor, loss_reason, no-decision flag (if available), deal_cycle_days, discount_pct, product, segment."

---

## 5) Customer success / support

### 5.1 Zendesk ticket export
"Zendesk ticket export for last 24 months: ticket_id, created_date, solved_date, status, priority, requester_org/customer_id, category, first_response_time, resolution_time, CSAT score (if available)."

### 5.2 SLA performance
"Monthly SLA compliance report (uptime, response/resolution) for last 24 months; include exceptions and major incidents."

---

## 6) Product usage analytics

### 6.1 Event-level export (Segment/Amplitude)
"Event export (aggregated acceptable if event-level too large): user_id, account_id, event_name, event_timestamp, feature/module, platform, geography. Provide weekly active users by account and feature adoption rates."

---

## 7) Cloud cost exports

### 7.1 AWS Cost and Usage Report (CUR)
"AWS CUR export (CSV/Parquet acceptable) for last 24 months: usage_start_date, service, region, linked_account, line_item_type, unblended_cost, usage_amount, credits. Provide tag keys used to allocate costs to products/customers if applicable."

### 7.2 GCP Billing export
"GCP billing export for last 24 months: usage_start_time, service_description, project_id, sku, cost, credits, labels/tags."

---

## 8) Data room index
"Data room index (CSV) with folder path, filename, doc type, owner, date modified, notes. Include a stable file naming convention and version tags."

Naming standard (recommended):
- `FIN_GL_DETAIL_YYYYMM_v1.csv`
- `REV_CUSTOMER_ARR_BRIDGE_QTRLY_v2.xlsx`
- `CRM_OPP_HISTORY_2023-01_to_2025-12.csv`

