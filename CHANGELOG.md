# Changelog

All notable changes to the **pixelblaze-pattern-coder** skill are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] - 2026-06-01

Initial public release.

### Fixed
- Palette-blending `Palette #` control displayed an uninitialized value (e.g.
  `8.175035e-41`) on first load. PixelBlaze seeds a control's shown value from the
  exported global whose name matches the control, and the module had none. Added an
  exported backing var `palette` (matching `inputNumberPalette`) in the palette-blending
  module and the affected examples (`2d-palette-crossfade`, `2d-ember-flicker`).

### Changed
- Default palette-blending timing is now **45s hold / 5s transition** (was 30s / 5s).
- Strengthened `reference/ui-controls.md`: input controls need a matching, exported
  backing var or the widget displays uninitialized memory.
