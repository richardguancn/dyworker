# Shared Investment Banking Dashboard Runtime

This directory contains the shared dashboard runtime used by `skills/dashboard-builder`.

- `dashboard.css`: MD-grade responsive layout, sticky horizontal nav, module cards, wide table handling, mobile table fallback, and print styles.
- `dashboard.js`: deep-link handling, active navigation state, hash support from `file://`, and resize hooks for responsive charts.

Do not fork this runtime into individual analytical skills. If multiple skills need a new dashboard behavior, add it here and expose it through the dashboard contract/module library.
