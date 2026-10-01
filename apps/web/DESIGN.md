# NexaOS Web — Design System

**Mode:** Operate. People come here to configure agents, watch runs and audit what happened.
Scanability, density and trust outrank expression; brand lives in precise details.

## World
A calm instrument panel. Graphite surfaces, hairline borders, one cool "signal" accent
reserved for primary actions, focus and live activity. Glass (backdrop blur) only on
overlays (command palette, dialogs, sticky header). No gradients on content, no neon.

## Tokens (`src/app/globals.css`)
- Surfaces: `bg` → `surface` → `surface-2` (raised) with `border` hairlines.
- Text: `fg`, `muted`, `faint`.
- `accent` (signal cyan) + `accent-fg`; statuses `success`, `warning`, `danger`, `info`.
  Status is **never colour alone**: every status pill carries an icon and a word.
- Radius: 10px panels, 8px controls, 6px pills. Spacing on a 4px grid.
- Type: Geist Sans for UI; Geist Mono for ids, tokens, costs, durations, JSON.
  Numerals are tabular everywhere metrics appear.

## Motion
120–180 ms ease-out for state changes; live timeline entries fade in. All motion is
disabled under `prefers-reduced-motion`.

## Signature details
- Active nav item: 2px signal rail on the left edge.
- Execution timeline: a vertical rail whose nodes carry the event icon; running steps pulse.
- Every id/trace id is monospace with a one-click copy.
