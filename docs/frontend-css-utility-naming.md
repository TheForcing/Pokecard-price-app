# Frontend CSS Utility Naming

This document defines naming rules for reusable utility classes in `apps/web/app/globals.css`.

## Naming rules

- Keep utility class names **short and role-based** (`text-xs`, `top-gap-sm`, `align-self-end`).
- Use the `text-*` prefix for typography utilities (font size/weight only).
- Use the `*-gap-*` pattern for spacing utilities (`top-gap-sm`, `panel-top-gap`).
- Use `inline-*` for compact inline layout helpers (`inline-control`, `inline-meta-actions`).
- Use `card-*`, `panel-*`, `price-*` prefixes for domain-specific reusable UI blocks.
- Prefer composing multiple single-purpose utilities over adding one-off classes.

## Utility vs component class

- **Utility class**: single concern, reusable across sections.
  - Examples: `text-xs`, `top-gap-sm`, `align-self-end`, `empty-state-text`
- **Component/domain class**: tied to a specific UI block.
  - Examples: `card-main-row`, `compare-grid`, `price-fetched-at`, `panel-subtitle`

## Maintenance checklist

- When replacing inline styles, prefer an existing utility class first.
- If no class matches, add a reusable name (avoid per-screen names like `watchlist-title`).
- Remove selectors from `globals.css` when they have no `className` usage in `apps/web/app/**/*.tsx`.
- Keep naming ASCII and kebab-case.
