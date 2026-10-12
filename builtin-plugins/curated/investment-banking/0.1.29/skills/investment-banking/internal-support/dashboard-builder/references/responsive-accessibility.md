# Responsive and Accessibility Requirements

The dashboard must work from an MD's desktop monitor to a phone opened between meetings.

## Layout

- Use the shared light hero/top band with identity tile, decision callout, highlight tiles, and sticky numbered table of contents.
- Keep the dashboard as one page. Navigation deep-links to sections.
- Use responsive CSS grid and container-aware cards.
- Promote dense tables, matrices, waterfalls, and registers to full-width panels.
- Avoid fixed heights except for bounded chart canvases or intentional scroll areas.
- Keep text wrapping natural. Do not clip table labels, metric notes, or source captions.

## Tables

- Wide tables must sit in a horizontally scrollable wrapper.
- Dense tables may use sticky first column on desktop.
- Compact tables should support stacked rows on small screens.
- Numeric columns should align right when appropriate.
- Each table should have a visible title and source note if source posture matters.

## Charts

- Charts must resize when their container changes size.
- Use `ResizeObserver` for dynamic redraw when JavaScript charts are used.
- Include accessible labels and text summaries for chart modules.
- If chart data is empty, render a visible no-data state instead of a blank canvas.

## Navigation

- Horizontal nav should scroll on small screens.
- Deep links should compensate for sticky header height.
- Active section state should update on scroll when JavaScript is available.
- Hash links must still work from `file://`.
- Citation links and chips must be reachable by keyboard focus; hover previews are additive, not the only citation access path.
- Numeric citation links should preserve normal text color and use quiet underline/background affordance rather than default blue link styling.

## Print and PDF

- Provide a print stylesheet.
- Remove sticky behavior in print.
- Avoid splitting major cards awkwardly across pages.
- Show URLs or artifact names for source links when useful.

## Accessibility

- Use semantic landmarks: header, nav, main, section, table.
- Preserve visible focus states.
- Citation hover/focus previews must include source title, type/status, date/as-of, and pinpoint/excerpt/note when available.
- Do not rely on color alone for severity.
- Use readable contrast for chips, badges, and charts.
- Include `aria-label` on navigation and generated charts.
