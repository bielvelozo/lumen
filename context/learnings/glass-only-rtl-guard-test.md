---
tags:
  - learning
  - concept
related:
  - "[[../specs/06-web-shell-and-auth-ui/spec]]"
created: 2026-06-18
---
# Enforcing glass-only-on-chrome with an RTL guard test

Constitution invariant 6 says the frosted-glass treatment (`.glass`) appears ONLY on the
chrome (sidebar, topbar, menus, chat field); data and reading-length text always sit on
solid surfaces (`.card`, `.metric`, `.bubble`). This is enforced mechanically by a React
Testing Library guard test (required for specs 06/10/14) that renders the shell + a page
and asserts:

```ts
// the chrome IS glass
expect(container.querySelectorAll('.glass').length).toBeGreaterThanOrEqual(2);
// no data/reading surface is a descendant of any glass panel
expect(container.querySelectorAll('.glass .card, .glass .metric, .glass .bubble')).toHaveLength(0);
// a concrete number is not inside glass
expect(screen.getByText('R$ 128.000').closest('.glass')).toBeNull();
```

The `closest('.glass')` check on a real data node is the strongest assertion — it proves a
specific number isn't refracted, independent of how the tree is nested. The structural
`'.glass .card'` descendant selector catches the common mistake (wrapping a `Card`/
`MetricCard` inside a `GlassPanel`).

## Context

Built in spec 06 (`apps/web/src/routes/glass-only.test.tsx`). The design system keeps
`GlassPanel` (chrome) separate from `Card`/`MetricCard`/`ChatBubble` (solid) with 1:1
class names, so the selectors are stable. The shell confines `GlassPanel` to the sidebar
`<aside>` and topbar `<header>`; the routed page content is solid.

## How to Apply

- For any new glass surface, keep `GlassPanel` strictly on chrome; put data/reading text in
  `Card`/`MetricCard`/`ChatBubble`.
- Specs 10 (connect-DB UI) and 14 (chat UI) MUST ship the same guard test — render the
  view and assert no `.card`/`.metric`/`.bubble`/data node is under `.glass`; for chat, the
  input field may be glass but message bubbles must not be.
