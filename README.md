# pixelblaze-pattern-coder

A Claude skill for writing, debugging, and explaining LED patterns for the
[ElectroMage PixelBlaze V3](https://electromage.com/) controller. It produces code in the
PixelBlaze **expression language** (a restricted ES6 subset), not standard JavaScript — so
the patterns compile and run on-device the first time instead of silently failing on idioms
the hardware doesn't support.

## What's inside

- **`SKILL.md`** — the skill instructions and workflow.
- **`reference/`** — verified language reference, common gotchas, UI-control signatures,
  curated palettes, a palette-crossfade module, power-safety math, and pixel-mapping guides.
- **`examples/`** — complete, verified patterns (1D/2D/3D, palette crossfade, ember flicker,
  sound spectrum, and more) to use as templates.
- **`pixelblaze-pattern-coder.skill`** — packaged bundle for one-click install.

## Install

**Easiest:** download [`pixelblaze-pattern-coder.skill`](pixelblaze-pattern-coder.skill) and
add it in a Claude environment that supports skills.

**From source:** clone this repo and copy the folder into your skills directory (keep the
folder name `pixelblaze-pattern-coder`).

## Highlights

- Palette-crossfade module with a **45s hold / 5s blend** default and the standard
  Auto Cycle / Random Palette / Palette # controls.
- Power-safety guidance so patterns don't brown out larger LED runs.
- Every built-in used is checked against the language reference — no invented functions.

## License

Copyright (C) 2026 Zachary Reiss-Davis. Licensed under GPL-3.0-or-later — see [LICENSE](LICENSE).
See [CHANGELOG.md](CHANGELOG.md) for version history.
