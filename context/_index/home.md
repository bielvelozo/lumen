---
tags:
  - moc
---
# Business Assistant — Project Knowledge Vault

This vault contains all project-specific knowledge for Business Assistant: constitution, specs, learnings, and rules.

## Where to go

- **[[../constitution|Constitution]]** — non-negotiable project principles. Read before any substantive work.
- **[[specs|Specs MOC]]** — all specs, past and present, indexed by status.
- **[[learnings|Learnings MOC]]** — architecture, patterns, gotchas.
- **[[conventions|Conventions MOC]]** — code style choices the team has made.
- **[[rules|Rules MOC]]** — project-specific safety and workflow rules.
- **[[../reports/2026-09-11-correcoes-p0-p1|Correções P0/P1 (2026-09-11)]]** — o que foi corrigido e provado na última rodada, e a fila que sobrou. Comece por aqui.
- **[[../reports/2026-09-10-handoff-testes-e-correcoes|QA handoff (2026-09-10)]]** — environment recipe, test accounts and reference figures, verification commands; still the reference for setting the environment up. Full findings in [[../reports/2026-09-05-teste-funcional-cliente|the QA report]].

## How to use this vault

- New feature or refactor → copy `../specs/_template/` and fill in.
- New learning discovered → copy `../templates/learning.md` and add to `../learnings/`.
- New convention agreed → copy `../templates/convention.md` and add to `../conventions/`.
- New rule needed → copy `../templates/rule.md` and add to `../rules/`.
- Always cross-link with `[[wikilinks]]` so backlinks aggregate concepts over time.
