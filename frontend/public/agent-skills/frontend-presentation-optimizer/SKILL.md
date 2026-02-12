---
name: Frontend Presentation Optimizer
description: Build visually strong openings and stable reply formats with safe HTML/CSS/JS snippets.
references:
  - references/opening-visual-composer.md
  - references/reply-format-enforcer.md
  - references/css-effects-presets.md
  - references/js-interaction-lite.md
  - references/render-safety-guard.md
---

## When to use

- User asks for stronger visual impact in opening lines or first reply.
- User wants structured response layout (status/action/dialogue/notes).
- User wants lightweight HTML/CSS/JavaScript presentation effects.
- Existing reply is readable but flat, repetitive, or lacks hierarchy.

## Must do

- Read all reference files and apply only the minimum needed pieces.
- Keep semantics clear: atmosphere first, readability second, effects third.
- Default to lightweight, progressively enhanced output.
- Provide plain-text fallback if target environment may strip HTML/CSS/JS.
- Keep macros/variables and character facts untouched.

## Must not do

- Do not invent world facts, persona constraints, or hard rules.
- Do not rely on external CDN, framework runtime, or remote assets.
- Do not ship heavy animations, long-running timers, or event spam.
- Do not break HTML structure (unclosed tags, invalid nesting).
- Do not output dangerous scripting patterns.

## Workflow

1. Pick one opening pattern from `opening-visual-composer`.
2. Apply one response skeleton from `reply-format-enforcer`.
3. Add at most 1-2 effect presets from `css-effects-presets`.
4. Add JavaScript only if user explicitly asks for interactivity.
5. Run `render-safety-guard` checklist before final output.

## Output requirements

- Return a complete result that can be used directly.
- If HTML mode is used, include matching style block and optional script block.
- If compatibility is uncertain, append a plain-text fallback variant.

## Examples

- Request: “把开场写得更有舞台感，带一点 UI 氛围。”
  - Use cinematic opening shell + gradient title + subtle fade-in.
- Request: “之后每轮都按固定格式回复。”
  - Use structured reply skeleton from format reference.
- Request: “要一点交互，但别重。”
  - Use one disclosure toggle from JS-lite reference.
