---
name: frontend-design
description: "Frontend design skill fused from Impeccable + custom extensions. Covers design philosophy, anti-AI-slop patterns, typography, color (OKLCH), spatial design, motion, interaction, responsive, UX writing, state management, engineering, and 4 style variants. Includes 20 command skills for audit/critique/polish/animate/etc."
license: "Apache 2.0 (Impeccable) + MIT (custom extensions)"
user-invocable: true
disable-model-invocation: false
---

# Frontend Design (Impeccable Fusion Edition)

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. It fuses [Impeccable](https://github.com/pbakaus/impeccable) design philosophy with extended knowledge on state management, engineering, and design style systems.

---

## Context Gathering Protocol

Design skills produce generic output without project context. You MUST have confirmed design context before doing any design work.

**Required context** — every design skill needs at minimum:
- **Target audience**: Who uses this product and in what context?
- **Use cases**: What jobs are they trying to get done?
- **Brand personality/tone**: How should the interface feel?

**Gathering order:**
1. **Check current instructions (instant)**: If your loaded instructions already contain a **Design Context** section, proceed immediately.
2. **Check .impeccable.md (fast)**: If not in instructions, read `.impeccable.md` from the project root. If it exists and contains the required context, proceed.
3. **Gather it now (REQUIRED)**: If neither source has context, ask the user for the three items above before doing anything else. Do NOT skip this step and do NOT infer context from the codebase instead. Once gathered, offer to save it to `.impeccable.md` at the project root so future sessions skip straight to step 2. (The detailed intake playbook lives at `impeccable/teach-impeccable/SKILL.md`.)

---

## Design Direction

Commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work — the key is intentionality, not intensity.

---

## Frontend Aesthetics Guidelines

### Typography
> *Consult [typography reference](reference/typography.md) for scales, pairing, and loading strategies.*

Choose fonts that are beautiful, unique, and interesting. Pair a distinctive display font with a refined body font.

**DO**: Use a modular type scale with fluid sizing (clamp) for display text; fixed rem scales for app UIs
**DO**: Vary font weights and sizes to create clear visual hierarchy
**DON'T**: Use overused fonts — Inter, Roboto, Arial, Open Sans, system defaults
**DON'T**: Use monospace typography as lazy shorthand for "technical/developer" vibes
**DON'T**: Put large icons with rounded corners above every heading — they rarely add value

### Color & Theme
> *Consult [color reference](reference/color-and-contrast.md) for OKLCH, palettes, and dark mode.*

Commit to a cohesive palette. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.

**DO**: Use OKLCH (not HSL) for perceptually uniform, maintainable palettes
**DO**: Tint your neutrals toward your brand hue — even a subtle hint creates subconscious cohesion
**DON'T**: Use gray text on colored backgrounds — use a shade of the background color instead
**DON'T**: Use pure black (#000) or pure white (#fff) — always tint
**DON'T**: Use the AI color palette: cyan-on-dark, purple-to-blue gradients, neon accents on dark backgrounds
**DON'T**: Use gradient text for "impact" — it's decorative rather than meaningful
**DON'T**: Default to dark mode with glowing accents

### Layout & Space
> *Consult [spatial reference](reference/spatial-design.md) for grids, rhythm, and container queries.*

**DO**: Create visual rhythm through varied spacing — tight groupings, generous separations
**DO**: Use fluid spacing with clamp() that breathes on larger screens
**DO**: Use asymmetry and unexpected compositions; break the grid intentionally
**DON'T**: Wrap everything in cards — not everything needs a container
**DON'T**: Nest cards inside cards — flatten the hierarchy
**DON'T**: Use identical card grids — same-sized cards with icon + heading + text, repeated endlessly
**DON'T**: Center everything — left-aligned text with asymmetric layouts feels more designed
**DON'T**: Use the same spacing everywhere — without rhythm, layouts feel monotonous

### Visual Details
**DO**: Use intentional, purposeful decorative elements that reinforce brand
**DON'T**: Use glassmorphism everywhere — blur effects used decoratively rather than purposefully
**DON'T**: Use rounded elements with thick colored border on one side — a lazy accent
**DON'T**: Use sparklines as decoration — tiny charts that convey nothing meaningful
**DON'T**: Use rounded rectangles with generic drop shadows — safe, forgettable
**DON'T**: Use modals unless there's truly no better alternative

### Motion
> *Consult [motion reference](reference/motion-design.md) for timing, easing, and reduced motion.*

**DO**: Use motion to convey state changes — entrances, exits, feedback
**DO**: Use exponential easing (ease-out-quart/quint/expo) for natural deceleration
**DO**: For height animations, use grid-template-rows transitions
**DON'T**: Animate layout properties (width, height, padding, margin) — use transform and opacity only
**DON'T**: Use bounce or elastic easing — they feel dated and tacky

### Interaction
> *Consult [interaction reference](reference/interaction-design.md) for forms, focus, and loading patterns.*

**DO**: Use progressive disclosure — start simple, reveal sophistication through interaction
**DO**: Design empty states that teach the interface, not just say "nothing here"
**DO**: Make every interactive surface feel intentional and responsive
**DON'T**: Repeat the same information — redundant headers, intros that restate the heading
**DON'T**: Make every button primary — hierarchy matters

### Responsive
> *Consult [responsive reference](reference/responsive-design.md) for mobile-first, fluid design, and container queries.*

**DO**: Use container queries (@container) for component-level responsiveness
**DO**: Adapt the interface for different contexts — don't just shrink it
**DON'T**: Hide critical functionality on mobile — adapt, don't amputate

### UX Writing
> *Consult [ux-writing reference](reference/ux-writing.md) for labels, errors, and empty states.*

**DO**: Make every word earn its place
**DON'T**: Repeat information users can already see

---

## The AI Slop Test

**Critical quality check**: If you showed this interface to someone and said "AI made this," would they believe you immediately? If yes, that's the problem.

A distinctive interface should make someone ask "how was this made?" not "which AI made this?"

Review the DON'T guidelines above — they are the fingerprints of AI-generated work from 2024-2025.

---

## Reference Library (Impeccable)

Deep-dive reference documents for each design dimension:

| Reference | Covers |
|-----------|--------|
| [typography](reference/typography.md) | Type systems, font pairing, modular scales, OpenType, web font loading |
| [color-and-contrast](reference/color-and-contrast.md) | OKLCH, tinted neutrals, dark mode, accessibility, 60-30-10 |
| [spatial-design](reference/spatial-design.md) | 4pt spacing, grids, visual hierarchy, container queries, optical adjustments |
| [motion-design](reference/motion-design.md) | 100/300/500 rule, easing curves, stagger, reduced motion, perceived performance |
| [interaction-design](reference/interaction-design.md) | 8 states, focus rings, Popover API, CSS Anchor, modals, keyboard nav |
| [responsive-design](reference/responsive-design.md) | Content-driven breakpoints, pointer/hover queries, safe areas, srcset |
| [ux-writing](reference/ux-writing.md) | Button labels, error formulas, empty states, voice vs tone, i18n |

## Extended Knowledge (Original)

| Topic | Document | Covers |
|-------|----------|--------|
| UI Aesthetics | [ui-aesthetics.md](ui-aesthetics.md) | HSL color tokens, 8px grid CSS snippets, shadow scales, dark mode CSS |
| Component Patterns | [component-patterns.md](component-patterns.md) | CSS Grid/Flexbox layouts, responsive nav, glass card, Framer Motion |
| UX Principles | [ux-principles.md](ux-principles.md) | Nielsen 10 heuristics, WCAG, ARIA, keyboard, loading patterns |
| State Management | [state-management.md](state-management.md) | Redux/Zustand/Jotai/Recoil/Context — decision tree + code templates |
| Frontend Engineering | [engineering.md](engineering.md) | Web Vitals, code splitting, virtual scroll, Vitest/Playwright, Vite/Webpack |

## Design Style Systems

Specific style variant specs with CSS tokens and component patterns:

| Style | Document | Aesthetic |
|-------|----------|-----------|
| Claymorphism | [claymorphism/SKILL.md](claymorphism/SKILL.md) | Soft clay, large radii, dual inner shadows, offset outer shadows |
| Glassmorphism | [glassmorphism/SKILL.md](glassmorphism/SKILL.md) | Frosted glass, backdrop-filter, translucency, blur layers |
| Neubrutalism | [neubrutalism/SKILL.md](neubrutalism/SKILL.md) | Thick borders, offset solid shadows, high saturation, minimal radius |
| Liquid Glass | [liquid-glass/SKILL.md](liquid-glass/SKILL.md) | Apple-style translucent depth, spring animations, ambient response |

---

## Technique Playbooks (20 Impeccable modules)

These 20 techniques are **not** separate slash commands — they're this skill's toolbox. Each is a detailed step-by-step playbook at `impeccable/<name>/SKILL.md` (installed under `~/.claude/skills/ccg/impeccable/`). When a task calls for one, **read that file and apply it**; every playbook assumes the design principles above. Invoke `/ccg:frontend-design` once and pull in whichever techniques the work needs.

### Quality & Audit
| Technique | What it does |
|-----------|------------|
| `audit` | Technical quality checks (a11y, performance, responsive, theming, anti-patterns) — scored 0-20 |
| `critique` | UX design review with Nielsen heuristics scoring (0-40), persona testing, cognitive load |
| `teach-impeccable` | Intake playbook: gather design context, save to .impeccable.md |

### Fix & Align
| Technique | What it does |
|-----------|------------|
| `normalize` | Align with design system standards |
| `polish` | Final pass before shipping — 20-item checklist |
| `distill` | Strip to essence, remove unnecessary complexity |
| `clarify` | Improve unclear UX copy, error messages, labels |
| `optimize` | Performance improvements (CWV, bundle, rendering) |
| `harden` | Error handling, i18n, text overflow, edge cases |

### Style & Expression
| Technique | What it does |
|-----------|------------|
| `animate` | Add purposeful motion and micro-interactions |
| `colorize` | Introduce strategic color to monochromatic designs |
| `bolder` | Amplify boring designs with distinctive impact |
| `quieter` | Tone down overly bold designs to refined sophistication |
| `delight` | Add moments of joy, personality, and surprise |

### Structure & Components
| Technique | What it does |
|-----------|------------|
| `extract` | Pull into reusable components and design tokens |
| `adapt` | Adapt for different devices and contexts |
| `onboard` | Design onboarding flows and empty states |
| `typeset` | Fix font choices, hierarchy, sizing, readability |
| `arrange` | Fix layout, spacing, visual rhythm |
| `overdrive` | Technically extraordinary effects (shaders, springs, scroll-driven) |

### Combining techniques
Chain playbooks in sequence for a full pass — e.g. `audit → normalize → polish` (find issues, fix inconsistencies, final cleanup), or `critique → harden` (UX review, then add error handling). Read each module's SKILL.md in turn and carry its output into the next.

---

## Implementation Principles

Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices across generations.

---

## Use Cases

- Design system establishment
- Component library development
- UI/UX audit and review (`audit`, `critique` playbooks)
- Accessibility improvement
- Responsive layout design (`adapt` playbook)
- Interaction and animation design (`animate`, `delight` playbooks)
- Style variant selection (Claymorphism / Glassmorphism / Neubrutalism / Liquid Glass)
- Performance optimization (`optimize` playbook)
- Pre-launch polish (`polish` playbook)
- Copy improvement (`clarify` playbook)
- Production hardening (`harden` playbook)
- Typography refinement (`typeset` playbook)
- Layout improvement (`arrange` playbook)
