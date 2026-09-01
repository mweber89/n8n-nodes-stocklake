# Stocklake logo

The Stocklake mark: a candlestick reflected in a waterline. Same glyph as the
live favicon at `stocklake.dev` (`mcpserver/external/web/favicon.svg`), just
plated onto a rounded tile so it works as a standalone icon.

Two tile variants, matching the site's real light/dark accent tokens
(`--accent: #3d5f82` light mode, `--accent: #6f9bc9` dark mode) — the tile
color is inverted from the mode it's meant for, so the mark stays legible
against either a light or dark host UI:

- **`stocklake-dark-tile.svg`** — dark tile (`#15171b`), light glyph
  (`#6f9bc9`). This is `nodes/Stocklake/stocklake.svg` in this repo (the
  `light`-mode icon n8n shows).
- **`stocklake-light-tile.svg`** — light tile (`#f3f4f6`), dark glyph
  (`#3d5f82`). This is `nodes/Stocklake/stocklake.dark.svg` in this repo (the
  `dark`-mode icon n8n shows).

PNG renders of each at 64/128/512px are included for anywhere an SVG isn't
accepted (marketplace listings, social previews, etc.) — regenerate with:

```bash
python3 -c "
import cairosvg
for name in ['stocklake-dark-tile', 'stocklake-light-tile']:
    for size in (512, 128, 64):
        cairosvg.svg2png(url=f'{name}.svg', write_to=f'{name}-{size}.png', output_width=size, output_height=size)
"
```

These are copies for reuse outside n8n's own icon-loading convention — the
files n8n actually loads at runtime are `nodes/Stocklake/stocklake.svg` and
`nodes/Stocklake/stocklake.dark.svg` (referenced via `icon: {light: ..., dark:
...}` in `Stocklake.node.ts`). Keep both copies in sync if the mark changes.
