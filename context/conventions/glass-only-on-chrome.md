---
tags:
  - convention
  - design
applies-to:
  - frontend UI (design system, components, layouts)
created: 2026-06-15
---
# Glass only on the chrome; data on solid surfaces

The frosted-glass (glassmorphism) effect is used only on the product's chrome — the topbar, the sidebar, the chat input field, and menus/popovers. Data — numbers, tables, chart values, and any answer text the user reads — always sits on a solid, high-contrast surface. Never place a number or reading text on glass.

## Why

This is a data product: legibility beats visual effect every time. Glass over real content lowers contrast and makes figures harder to trust and read — the opposite of the product's "precision" value. Confining glass to the frame keeps the Liquid-Glass-inspired identity while protecting the one thing that must be unambiguous: the data. The rule is load-bearing enough that the [[../constitution|Constitution]] names it too.

## How to Apply

- **Glass allowed:** topbar, sidebar, chat input field, menus, dropdowns, and similar framing/overlay chrome.
- **Glass forbidden:** message bubbles with answers, metric cards, tables, chart surfaces, and any panel whose job is to present numbers or reading text — these use solid surfaces.
- Use the design system's glass treatment only on chrome components, and build data surfaces from its solid/opaque surface styles. See `design-system/design-system.css`, `design-system/README.md`, and the `design-system/preview-assistente-vidro.html` reference.
- Keep data text on solid surfaces in Inter (body/data); Space Grotesk is for titles and brand. The accent blue is `#185fa5`.
