# Controls

This guide covers controls on Data charts and embedded report/dashboard components. For a bespoke inline calculator, parameter-driven planning tool or interactive explainer, use the installed Visualize workflow directly instead, including its controls and composition guidance.

Keep labeled native controls outside the chart container. Use one compact control row, a small results row and a roughly 240–300 px chart; wrap controls on narrow screens. Avoid oversized headings, nested cards and large padding for an inline chart. Reserve readout widths/heights for the longest result, including wrapped status text on narrow screens; use tabular numerals so updates do not move the chart.

Initialize defaults unconditionally; mount once and replace the complete config from one state model. Show input values immediately, then debounce chart and calculated readouts together by about 150–250 ms; flush on `change` and reset so the committed state is immediate. Clear pending work on reset. Disable controls until ready or retain the latest selection. Keep chart height, IDs, colors and useful comparison bounds stable; never clip valid results to keep a fixed domain. A short transition is optional where supported; respect reduced motion and avoid repeated entrance animations.

```js
let pending;
function commit() { clearTimeout(pending); renderFromState(); }
function preview() {
  showInputValues();
  clearTimeout(pending);
  pending = setTimeout(commit, 200);
}
// input: read controls into state, then preview(); change: commit();
// reset: restore all baseline state and controls, then commit().
```

Calculated curves need explicit assumptions, valid ranges and finite results. Use only the points needed to represent a piecewise-linear model, including its breakpoints. Keep full precision in calculations; round all displayed readouts, labels and tooltip values to useful precision (usually 0–2 decimals), with units. Use `Intl.NumberFormat(...).format(value)` and `valueFormat`; never round the underlying rows to hide display noise. Validate baseline and meaningful changed calculations, then exercise rapid input, committed changes and reset.
