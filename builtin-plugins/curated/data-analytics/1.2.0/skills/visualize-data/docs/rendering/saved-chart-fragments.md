# Saved Data chart fragments

These examples document the pinned renderer used by existing Data artifacts and release compatibility checks. Preserve that pin when revising a saved chart.

## Author a chart fragment

```yaml
chart_base_url: "https://persistent.oaistatic.com/plugins/visualize/charts/data-analytics-plugin/1.2.2-alpha.1/charts"
```

Without an executor, author this literal standard-component fragment. Keep the published import, change the chart fields and reviewed rows, and prepend the installed `assets/visualize-data/assets/chart-host.css` inside a style element when the host does not supply it. Keep space reserved as the chart loads. Give the root a unique ID and select it by ID; the host can move scripts outside the root. The runtime supplies the interactive chart, legend, tooltips and error state.

```html
<section id="monthly-usage" data-data-chart data-viz-composition>
  <div data-viz-container style="min-height:380px"></div>
</section>
<script type="module">
  const { mountChart } = await import("https://persistent.oaistatic.com/plugins/visualize/charts/data-analytics-plugin/1.2.2-alpha.1/charts/element.js");
  const root = document.getElementById("monthly-usage");
  const container = root.querySelector("[data-viz-container]");
  const config = {
    id: "monthly-usage", title: "Monthly usage (GB)", height: 280,
    spec: { type: "line", x: "month", y: "usage", yLabel: "GB" },
    rows: [{ month: "Jan", usage: 12 }, { month: "Feb", usage: 18 }]
  };
  const chart = mountChart(container, config);
</script>
```

## Send the fragment in Chat

Previously saved chat embeds can carry this same HTML as a GenUI AppBlock or DIL fragment.

```text
genui{"app_block":{"content":"<section id=\"monthly-usage\" data-data-chart data-viz-composition>\n  <div data-viz-container style=\"min-height:380px\"></div>\n</section>\n<script type=\"module\">\n  const { mountChart } = await import(\"https://persistent.oaistatic.com/plugins/visualize/charts/data-analytics-plugin/1.2.2-alpha.1/charts/element.js\");\n  const root = document.getElementById(\"monthly-usage\");\n  const container = root.querySelector(\"[data-viz-container]\");\n  const config = {\n    id: \"monthly-usage\", title: \"Monthly usage (GB)\", height: 280,\n    spec: { type: \"line\", x: \"month\", y: \"usage\", yLabel: \"GB\" },\n    rows: [{ month: \"Jan\", usage: 12 }, { month: \"Feb\", usage: 18 }]\n  };\n  const chart = mountChart(container, config);\n</script>"}}
```
