# DCF Architecture

The deterministic workbook is a values export with transparent long-format rows, not a replacement for a bespoke banker formula model.

Recommended sections: Summary, Model, Sensitivities, Checks, Assumptions, Run Log. Formula mode adds a template workbook with control panel, operating schedules, WACC, terminal value, valuation, sensitivities, checks, and source notes.

Architecture rules:
- Separate sourced facts, assumptions, calculations, checks, and outputs.
- Keep one source of truth for scenario and valuation assumptions.
- Preserve raw files and existing workbook formulas unless the user requests in-place edits.
- Use consistent signs: cash inflows positive, cash uses negative, debt-like bridge items subtracted from EV.
- Make screen-grade caveats visible before valuation tables.

If a user requests custom workbook architecture beyond the shipped template, disclose that it requires bespoke workbook work rather than the bundled materializer.
