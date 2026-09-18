# TapMakerWork workspace override

This page overrides the marketing-oriented master pattern for the IDE workspace.

- Product pattern: dense Developer Tool / IDE plus low-code app-builder workspace.
- Default mode: dark.
- Layout: fixed top command bar, resizable left navigator, live center canvas/editor, right inspector, resizable bottom terminal.
- Palette: background `#0d1017`, panel `#151922`, raised `#1c2230`, border `#2c3444`, foreground `#e8edf5`, muted `#8d98aa`, focus `#4b9cff`, success `#3ccf91`, warning `#e3b341`, danger `#f47067`.
- Typography: system UI for controls; JetBrains Mono-compatible stack for code, metrics and logs. Do not download fonts at runtime.
- Motion: 120-180ms state transitions only; canvas edits must feel immediate. Respect reduced motion.
- Density: 28px tabs, 30-34px fields, 8px grid, compact table rows.
- Every drag operation needs numeric inputs and keyboard alternatives.
- Resizers must be keyboard operable and expose their current size.
