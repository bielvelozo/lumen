# Lumen — design system (v1)

Tokens e componentes em React para o assistente de IA, na direção que você aprovou: **vidro fosco só na moldura, dado em superfície sólida de alto contraste**, acento azul, tema claro e escuro.

São três arquivos:

- `design-system.css` — tokens (cores claro/escuro, tipografia, raios, espaçamento, o material de vidro), base e classes dos componentes.
- `ui.jsx` — os componentes React e o hook `useTheme`.
- `README.md` — este guia.

## Instalação no projeto React (Vite)

1. Copie `design-system.css` e `ui.jsx` para `src/` (ex.: `src/design-system/`).
2. Importe a CSS **uma vez** no entrypoint:

```js
// src/main.jsx
import "./design-system/design-system.css";
```

3. As fontes (Space Grotesk + Inter) já vêm via `@import` no topo da CSS. Para carregar mais rápido, mova para um `<link>` no `index.html` e remova o `@import`.
4. Renderize o fundo refrativo uma vez, no topo da árvore: `<AppBackground />`. Sem ele o vidro não tem o que refratar.

```jsx
import { AppBackground, ThemeToggle, MetricCard } from "./design-system/ui";

export default function App() {
  return (
    <>
      <AppBackground />
      {/* seu app */}
    </>
  );
}
```

Quer ver tudo junto rápido? Renderize `<Showcase />` numa rota.

## Regra de ouro do vidro

O efeito de vidro é a assinatura do produto, mas ele machuca legibilidade. Por isso:

- **Use `<GlassPanel>` (ou a classe `.glass`) só na moldura:** sidebar, barra de cima, campo do chat, menus e sobreposições.
- **Nunca** coloque número, tabela ou texto de leitura longa sobre vidro. Isso vai em `<Card>`, `<MetricCard>` e `<ChatBubble>`, que são superfícies sólidas.
- O vidro precisa de algo atrás pra refratar: mantenha o `<AppBackground />` na página.

## Tokens (resumo)

Tudo é variável CSS, então muda sozinho no claro/escuro. Use as variáveis em vez de cravar cor.

| Grupo | Variáveis |
|---|---|
| Acento | `--c-accent`, `--c-accent-2`, `--c-accent-soft` |
| Superfície | `--c-surface`, `--c-surface-2`, `--c-bg`, `--c-bg-2` |
| Texto | `--c-text`, `--c-text-2`, `--c-text-3` |
| Semântica | `--c-pos`, `--c-neg` |
| Borda | `--c-border`, `--c-border-strong` |
| Vidro | `--glass-bg`, `--glass-border`, `--glass-hi`, `--glass-blur` |
| Tipografia | `--font-display`, `--font-body`, `--text-xs … --text-2xl`, `--w-regular/medium/bold` |
| Espaço | `--space-1 … --space-8` |
| Raio | `--radius-sm/md/lg/xl/pill` |
| Movimento | `--dur`, `--ease` |

Tipografia: `Space Grotesk` para títulos e marca (com restrição), `Inter` para corpo e dado. Números usam `font-variant-numeric: tabular-nums` (classe `.ds-num`) para alinhar.

## Componentes

```jsx
import {
  useTheme, ThemeToggle, AppBackground, GlassPanel,
  Button, Card, MetricCard, TextField, ChatBubble, Avatar, NavItem
} from "./design-system/ui";
```

- `useTheme()` → `{ theme, toggle, setTheme }`. Aplica `data-theme` no `<html>` e persiste no `localStorage`.
- `<ThemeToggle />` → botão de sol/lua pronto.
- `<AppBackground />` → o fundo refrativo (renderize uma vez).
- `<GlassPanel as="aside" className="...">` → aplica o vidro. `as` troca a tag.
- `<Button variant="primary | ghost" icon={<svg/>}>Texto</Button>` → sem texto, vira botão de ícone.
- `<Card>` → superfície sólida pra conteúdo.
- `<MetricCard label="Vendas em maio" value="R$ 128.000" delta="+12% vs abril" trend="up | down" />`
- `<TextField icon={<svg/>} boxed placeholder="..." />`
- `<ChatBubble from="me | them">...</ChatBubble>`
- `<Avatar initials="GV" />`
- `<NavItem active icon={<svg/>}>Chat</NavItem>`

Exemplo de moldura com vidro:

```jsx
<GlassPanel as="header" style={{ borderRadius: 16, padding: "0 16px", display: "flex", alignItems: "center", gap: 14 }}>
  <TextField icon={<SearchIcon />} placeholder="Buscar" style={{ flex: 1 }} />
  <ThemeToggle />
  <Avatar initials="GV" />
</GlassPanel>
```

## Ícones

Os componentes aceitam ícones como prop (`icon={<svg/>}`), então você escolhe a fonte. Recomendo `lucide-react` no projeto:

```bash
npm i lucide-react
```

```jsx
import { Search, Send } from "lucide-react";
<TextField icon={<Search size={18} />} placeholder="Buscar" />
<Button icon={<Send size={18} />} aria-label="Enviar" />
```

## Tema claro/escuro

O tema é controlado pelo atributo `data-theme` no `<html>`. O `useTheme` cuida disso e do `localStorage`. Para forçar um tema sem o hook: `document.documentElement.setAttribute("data-theme", "dark")`.

## Acessibilidade já embutida

Foco visível (`:focus-visible`), `prefers-reduced-motion` respeitado, e contraste pensado pros dois temas. Ao criar telas novas, mantenha texto de dado fora do vidro pra não perder contraste.
