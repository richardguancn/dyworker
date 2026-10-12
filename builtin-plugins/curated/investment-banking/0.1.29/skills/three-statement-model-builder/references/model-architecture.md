# Model Architecture

The deterministic workbook is a values export with long-format transparency. Formula mode is a prebuilt banker template materializer.

Default deterministic sheets: Summary, Model, Sensitivities, Checks, Assumptions, Sources, Run_Log.

Formula template sheets: Cover, Executive Summary, Control Panel, Historical Financials, Revenue Build, Expense Build, Income Statement, Working Capital, PP&E D&A, Debt Interest, Tax, Balance Sheet, Cash Flow Statement, Scenarios, Checks, Source Notes.

Architecture rules:
- Separate sources, assumptions, calculations, checks, and outputs.
- Preserve raw files and existing formulas unless the user requests in-place edits.
- Keep scenario controls centralized.
- Use consistent signs: operating cash inflows positive, cash uses negative, debt balances positive.
- Make balance checks and cash tie-outs visible.

Add specialized schedules only when required by the business model or user request; otherwise avoid bloating the workbook.
