# Accessibility Audit Report

## Methodology
- Ran a manual Axe DevTools-style review of the rendered UI and component code in the Next.js app.
- Focused on form semantics, interactive controls, and color tokens that Lighthouse commonly flags.
- Validated color contrast ratios with spot calculations for suspect combinations.

## Summary of Findings
- ❌ **Missing accessible labels:** 5 instances
- ❌ **Missing ARIA states/roles:** 2 instances
- ❌ **Contrast violations:** 1 instance affecting disabled primary buttons

## Detailed Findings

### Missing label associations
- **Credential creation inputs rely on placeholders.** None of the text fields in the "Create Credential" flow are paired with `<label>` elements (the `Kind` caption is not associated with the `<select>`), so screen readers announce blank names.【F:web/pages/credentials.tsx†L107-L166】
- **Credential edit dialog repeats the issue.** The inline edit controls also rely on placeholder text, leaving editing fields for usernames, API keys, and OAuth secrets without programmatic labels.【F:web/pages/credentials.tsx†L222-L266】
- **Feed management forms lack labels.** Both the creation form and the inline edit row add multiple `<input>` elements (text and checkbox) without labels or `aria-label` attributes, so the fields have no accessible name when navigating via assistive tech.【F:web/pages/feeds.tsx†L97-L158】
- **Site configuration forms miss labels.** The create/edit forms for site configs present six unlabeled text inputs, forcing screen reader users to guess what each selector field controls.【F:web/pages/site-configs.tsx†L56-L188】
- **Jobs status filter caption is not connected to its `<select>`.** The label text is rendered separately from the control, leaving the status dropdown without a name in the accessibility tree.【F:web/pages/jobs.tsx†L58-L67】

### Missing ARIA roles or states
- **Details disclosure buttons do not expose state.** The Jobs table expands a row with a "Details" button but never sets `aria-expanded` or ties the control to the revealed panel, so screen readers cannot determine whether the row is open.【F:web/pages/jobs.tsx†L134-L170】
- **Sortable bookmark headers lack `aria-sort`.** Column headers are implemented as plain buttons that update visual chevrons, but the table never updates `aria-sort`, so assistive tech users have no cue about the active sort direction.【F:web/pages/bookmarks.tsx†L327-L343】

### Contrast issues
- **Disabled primary buttons fade below 3:1.** Applying `disabled:opacity-50` to the `.btn` class lightens the blue background to roughly #92B1F5 while the label stays white, yielding ~2.1:1 contrast—below the 3:1 minimum for UI components.【F:web/styles/globals.css†L10-L14】【6f5f5e†L1-L19】

## Recommendations
1. Add explicit `<label htmlFor>` pairs (or `aria-label`/`aria-labelledby`) for every text input, select, and checkbox noted above.
2. Instrument disclosure buttons and sortable headers with ARIA attributes (`aria-expanded`, `aria-controls`, `aria-sort`) that mirror their state changes.
3. Replace the blanket `opacity-50` rule for disabled buttons with a color token that preserves at least 3:1 contrast against the label text.
