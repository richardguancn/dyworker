# Examples

## Example 1: Finance export with messy headers

User: "Clean this budget export and make it finance-review ready."

Expected behavior:

- Infer finance/FP&A domain.
- Preserve entity, department, account, scenario, fiscal period, currency, and amount fields.
- Remove report title rows and obvious subtotals from `clean_data`, preserving them in `raw_source` and logging the action.
- Standardize period labels but do not infer a fiscal calendar if not provided.
- Format amounts with thousands separators; preserve currency column if multiple currencies exist.
- Create checks for duplicate entity + department + account + period + scenario rows, missing amounts, missing departments, and totals embedded in detail data.

## Example 2: Sales pipeline CSV

User: "Make this Salesforce export usable for a pipeline analysis. De-dupe and clean stages."

Expected behavior:

- Infer sales/revops domain.
- Use opportunity ID as the primary duplicate key if available; do not de-dupe by account name alone.
- Standardize obvious stage casing/spacing but avoid collapsing materially different stages without a supplied mapping.
- Preserve ARR/ACV/amount distinction.
- Flag opportunities with missing owner, stage, close date, or amount.
- Flag close dates before created dates.
- Output a clean table plus data dictionary and issue log.

## Example 3: Vendor spend list

User: "Clean this vendor list for a renewal review."

Expected behavior:

- Infer procurement/vendor domain.
- Preserve vendor name, contract ID, owner, department, renewal date, amount, currency, recurring vs one-time, and approval status.
- Standardize vendor names only when differences are obvious punctuation/casing variants; otherwise flag possible duplicates.
- Preserve contract/PO/invoice identifiers as text.
- Flag renewal dates in the past for active vendors, missing owners, missing currency, and mixed recurring/one-time spend.

## Example 4: Product event log

User: "Clean this events data; I need it analysis-ready, not summarized."

Expected behavior:

- Infer product analytics domain.
- Preserve event-level grain.
- Do not de-duplicate unless exact duplicate events are identifiable.
- Preserve timestamps and timezone assumptions.
- Keep user/account/session/event IDs as text.
- Normalize event names only if mappings are obvious or supplied.
- Flag missing user/event/timestamp, future timestamps, and mixed timestamp formats.

## Example 5: User gives explicit instructions

User: "Clean the attached CSV. Keep only rows where Status = Active, convert dates to yyyy-mm-dd, do not remove duplicates, and output snake_case headers."

Expected behavior:

- Follow the explicit filter, date, duplicate, and header instructions.
- Preserve raw source.
- Log that inactive rows were filtered per user instruction.
- Do not apply exact duplicate removal even if duplicates exist; flag duplicates in quality checks if useful.
- Use snake_case headers in `clean_data`.

## Example 6: Ambiguous high-impact duplicate merge

User: "Clean and de-dupe this customer list."

Dataset has no customer ID, only names and emails with conflicting addresses.

Expected behavior:

- Remove exact duplicate rows if safe.
- Flag likely duplicates by normalized email/name.
- Do not merge conflicting customer records silently.
- Ask for a merge rule only if the user expects a single resolved customer list immediately. Otherwise deliver flagged potential duplicates.
