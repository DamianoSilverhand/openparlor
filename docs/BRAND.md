# OpenParlor brand

**The idea.** A parlor is the room where people gather to play. The mark is a lit, open doorway standing on a step, with a
`p` inside and a dot in its bowl: you, in the room. The wordmark is drawn from simple rounded strokes, with "open" in ink
and "parlor" in teal.

## Files (`brand/`)

| File | Use |
|---|---|
| `logo.svg` | Mark and wordmark side by side. Follows light and dark mode. READMEs, websites, slides. |
| `mark.svg` | The doorway alone, on a transparent background. Avatars, small spots. |
| `icon.svg` | The mark on a mustard tile. App and social icons. The PNG app icons in `public/icons/` are drawn from it. |

Everything is generated: change `scripts/make-brand.js`, then run `node scripts/make-brand.js` and
`node scripts/make-icons.js`, and commit the results. No fonts or image tools are needed.

## Colours

| Name | Hex | Use |
|---|---|---|
| Ink | `#1d1a17` | outlines, shadow, "open" |
| Teal | `#238080` | the doorway, "parlor" (`#5bbcbc` on dark backgrounds) |
| Mustard | `#f2b632` | the icon tile, the dot |
| Paper | `#fffbf2` | the p, text on dark |

## Using it

- Keep clear space around the logo equal to the width of the p's bowl, and do not stretch, recolour or rotate it.
- Do not go below 24 px tall for the lockup or 16 px for the mark.
- The code is MIT licensed, but the name and logo identify this project. If you publish a modified version or a hosted
  service, please use your own name and logo for it (set yours with `brand.name` in the config).
