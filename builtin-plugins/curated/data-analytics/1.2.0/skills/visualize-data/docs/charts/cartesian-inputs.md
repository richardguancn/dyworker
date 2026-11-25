# Cartesian semantics

Use the [public types](public-api.md) already read with the chart entry instructions. These constraints concern the data and interpretation, not the object shape.

Grouped rows need nonblank series labels, unique coordinate/series pairs and every expected pair, using explicit nulls where missing observations are supported. Series names must not overwrite the category field or collapse into indistinguishable display labels. Measures share comparable units. Stacks require complete, nonnegative, additive parts of one whole.

Numeric/date trends use coordinate order; other categories retain supplied order unless sorted. Keep domains and series colors comparable across panels and filter states. Legend toggles are local; normalized shares are recomputed over visible parts.

Continuous X uses numeric distance or elapsed ISO dates; `xScale: "category"` instead uses supplied order and equal category spacing, including numeric-looking IDs. Category X cannot use domains or X references. Log axes require positive original values and bounds; explicit null Y gaps remain permitted. Do not combine log Y with `startAtZero`.
