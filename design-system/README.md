# Lumen — identidade visual (v2, "Luz sobre o dado")

**Papel, tinta e âmbar.** O produto responde perguntas com números exatos vindos do banco do cliente, e a identidade existe para servir essa leitura: fundo calmo, texto de alto contraste, uma única cor de destaque que funciona como "luz".

O código de verdade mora no app. Esta pasta guarda o guia, os arquivos da marca e uma referência visual:

| Arquivo | O que é |
|---|---|
| `README.md` | Este guia. |
| `logo/` | Marca em SVG: símbolo, logo horizontal, ícone do app e favicon. |
| `design-system.css` | Cópia de referência dos tokens e classes, usada pelo `preview.html`. |
| `preview.html` | Todos os elementos numa página só. Abra direto no navegador (tem troca de tema). |

**Fonte da verdade:** `apps/web/src/design-system/` (`design-system.css`, `ui.tsx`, `icons.tsx`). Ao mudar um token no app, copie o CSS para cá de novo. O canvas com a identidade e as telas está em https://claude.ai/artifact/KMoYbzEBrQyUFnX4iuKJYz.

## Marca

O **L** de Lumen é o canto de todo gráfico: o eixo onde os números moram. O **semicírculo âmbar** nascendo dentro dele é a luz que o assistente acende sobre os dados, ou seja, a resposta exata. O nome escrito é `lumen`, em minúsculas, na Instrument Serif. A frase da marca é *"Pergunte ao seu negócio."*

| Arquivo | Uso |
|---|---|
| `logo/lumen-mark.svg` | Símbolo sobre fundo claro (eixo tinta, sol âmbar). |
| `logo/lumen-mark-inverse.svg` | Símbolo sobre fundo escuro (eixo papel). |
| `logo/lumen-logo.svg` / `lumen-logo-inverse.svg` | Logo horizontal, símbolo + nome escrito. |
| `logo/lumen-icon.svg` | Ícone do app: quadrado tinta de cantos arredondados. |
| `logo/lumen-favicon.svg` | Favicon: o traço fica mais grosso para ler em 16 a 32 px. |

- O nome escrito nos SVGs horizontais é texto na Instrument Serif, carregada do Google Fonts. Isso só funciona com o SVG aberto direto: dentro de `<img>` ou num editor, o navegador não baixa a fonte e ela cai na Georgia. Na web, prefira o símbolo + texto em HTML (como o `<Logo />` faz). Para impressão ou exportação, converta o texto em curvas num editor vetorial.
- Em cima do âmbar, use a versão monocromática em tinta, com eixo e sol na mesma cor.
- Não gire, não distorça, não troque as cores do símbolo e não coloque sombra nele.
- No código, use os componentes `<LogoMark />` (com `tile` vira o ícone) e `<Logo />`, de `ui.tsx`.

## Cores

Todas são variáveis CSS e mudam sozinhas no tema escuro (`data-theme="dark"` no `<html>`).

| Nome | Claro | Escuro | Variável | Uso |
|---|---|---|---|---|
| Tinta | `#15171C` | `#EDEAE3` | `--c-text` | Texto; é também a cor da moldura (sidebar). |
| Papel | `#F5F3EE` | `#101217` | `--c-bg` | Fundo do app. |
| Superfície | `#FFFFFF` | `#181B22` | `--c-surface` | Cartões e dados. |
| Âmbar | `#F2A43A` | `#F5B04D` | `--c-accent` | Ação principal, o sol, item ativo, foco. |
| Âmbar escuro | `#8F5500` | `#F5B04D` | `--c-accent-ink` | Links e texto de destaque. |
| Positivo | `#2B7A52` | `#5CC08D` | `--c-pos` | Alta, sucesso, conectado. |
| Negativo | `#B3412A` | `#F0876E` | `--c-neg` | Queda, falha. |

- Texto sobre âmbar é sempre **tinta** (`--c-on-accent`), nunca branco: branco sobre âmbar não passa em contraste.
- Âmbar puro não serve como cor de texto sobre papel. Para links e texto, use `--c-accent-ink`.
- Os cinzas de texto (`--c-text-2`, `--c-text-3`) passam em AA sobre papel e sobre branco. Não clareie.
- Na moldura escura, os tokens são `--c-chrome*`. Os estados suaves (`--c-*-soft`) servem de fundo para badges e alertas.

## Tipografia

| Família | Papel | Regras |
|---|---|---|
| **Instrument Serif** | Marca, títulos de página, números-chave | Só a partir de 28 px, peso 400 (tem itálico). Classes `.page-title`, `.ds-display`, `.metric__value`. |
| **Geist** | Interface, respostas, tabelas | 400, 500 e 600. Números de dado com `.ds-num` (algarismos tabulares). |
| **Geist Mono** | SQL, auditoria, rótulos, metadados | Sempre pequeno (11 a 13 px). Classes `.ds-mono` e `.eyebrow`. |

No app, as fontes vêm por `<link>` no `apps/web/index.html`.

## Regra do vidro

O vidro fosco continua restrito à **moldura**, e os dados ficam em **superfície sólida** (regra 6 do `AGENTS.md`, com a convenção em `context/conventions/glass-only-on-chrome.md`).

- `.glass.glass--ink` → a sidebar escura.
- `.glass` (papel fosco) → a lista de conversas, o campo do chat e os menus.
- Número, tabela ou resposta nunca vão sobre vidro. Use `.card`, `.metric` e `.bubble`.

Não há mais fundo com manchas coloridas: o fundo é o papel liso.

## Componentes (`apps/web/src/design-system/ui.tsx`)

| Componente | Classe | Nota |
|---|---|---|
| `ThemeProvider`, `useTheme`, `ThemeToggle` | — | Tema persistido no `localStorage`. |
| `LogoMark`, `Logo` | — | A marca, em SVG inline. |
| `PageHeader` | `.page-head` | Título serifado + descrição opcional. |
| `GlassPanel` | `.glass` | Só na moldura. `className="glass--ink"` para a sidebar. |
| `Button` | `.btn--primary` / `.btn--ghost` | Primário: âmbar com texto tinta. Altura mínima de 44 px. |
| `Card` | `.card` | Superfície sólida para dados e formulários. |
| `MetricCard` | `.metric` | Número serifado e variação num selo verde ou vermelho. |
| `Badge` | `.badge--pos` / `--neg` / `--wait` | Estados de conexão e de consulta. |
| `ChatBubble` | `.bubble--me` / `--them` | Balão do usuário em tinta; resposta em superfície sólida. |
| `Avatar`, `NavItem`, `TextField` | — | Mantidos por compatibilidade. |

Classes sem componente: `.chip` (sugestão de pergunta), `.input` e `.field-label`, `.table`, `.segmented`, `.steps` (etapas), `.code` (bloco de SQL), `.md` (markdown das respostas), `.msg` (linha de mensagem com o símbolo), `.eyebrow`.

Os ícones ficam em `apps/web/src/design-system/icons.tsx`: SVG de traço 1,75 que herda a cor do texto, sem biblioteca externa. Ícone sozinho num botão precisa de `aria-label`.

## Acessibilidade

- Foco visível com anel âmbar (`:focus-visible`).
- `prefers-reduced-motion` é respeitado.
- Alvos de toque de 44 px.
- Estados nunca dependem só da cor: badge sempre tem texto, e variação sempre tem sinal (`+12%`, `-3%`).
