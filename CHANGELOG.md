# Changelog

All notable changes to the **pixelblaze-pattern-coder** skill are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/). Entries record not
just *what* changed but *what we learned* — for fixes, the root cause and the
guardrail added so it can't recur.

## [1.2.0] - 2026-06-01

Added a gated motion-reactive reference and two motion examples. Like the sound
material, they stay **out of context unless the user explicitly asks for a motion-
/ tilt- / gravity- / orientation- / shake- / gyro- / 6-axis-reactive pattern**, so
non-motion work doesn't pay the token cost.

### Added
- `reference/accelerometer.md` — motion-reactive playbook. Leads with the
  distinction that matters most: the **Sensor Expansion Board** exposes
  `accelerometer` `[x,y,z]` (LIS3DH, linear acceleration only — no gyro), while the
  **PixelBlaze V3 Pico** has a built-in 6-axis IMU exposed as `sixAxis`
  `[x,y,z,gx,gy,gz]` whose indices 3–5 are angular velocity (real rotation). Covers
  snapshot-once + IIR/damped smoothing, the normalized gravity vector → tilt
  angles (and Roger's azimuth/polar sloshing model), motion/shake magnitude, the
  Pico gyro for true spin sensing, and kwitter's resting-offset + sensitivity
  calibration workflow. **Leads with the default approach — "One pattern, both
  sensors":** a `readMotion()` helper declares both variables, auto-detects which
  is live by magnitude (preferring `sixAxis`, since it adds the gyro), and falls
  back to a `time()` simulator when neither is present, so one portable pattern
  runs on any hardware. Opens with a scope-discipline ladder.
- `examples/3d-motion-gravity-liquid.js` — a cool water palette fills like liquid
  that settles to the gravity low side, with a foam-bright surface band,
  shake-driven slosh (plus gyro-spin agitation on a Pico), and a brightness floor.
  Uses a dot-product "height along gravity" instead of per-pixel matrix math.
  Auto-detects the sensor (`readMotion()`); one renderer body serves 3D/2D/1D;
  self-sloshes on a timer when no sensor is attached.
- `examples/2d-motion-tilt-ball.js` — a soft glowing ball rolls downhill with tilt
  and, on a Pico, blooms/shifts color with spin (`sixAxis[3..5]` gyro, which
  degrades to nothing on the expansion board). Auto-detects the sensor and
  demonstrates kwitter's calibration (resting offsets, sign flips, sensitivity).
  Drifts on a timer when no sensor reports.

### Changed
- `SKILL.md` — added a gated "Motion-reactive?" question that routes to
  `reference/accelerometer.md` (and prompts asking which board the user has), and a
  gated entry for the reference + its two examples in the Reference files list.
- `reference/language.md` — sensor section now documents `sixAxis` (Pico built-in
  6-axis IMU) alongside `accelerometer`, flags `accelerometer` as accel-only
  (reads ~1g at rest, no gyro), and marks `sixAxis` as community-documented
  (confirm live in the Var Watcher).

### Sources & attribution (motion-reactive material)
Techniques are distilled from community work; attributions are preserved in
`accelerometer.md`, the example headers, and here:
- **Roger Cheng (Regorlas / Roger-random)** — "GlowFlow (3D coord transform API
  port)", "Accelerometer Tilt 3D", and "RGB-XYZ Accelerometer Blocks 3D"
  (https://github.com/Roger-random/glowflow): the gravity-vector → spherical
  (azimuth/polar) tilt model and the jitter-damping idiom. Axis-direction
  investigation: https://newscrewdriver.com/2019/07/08/pixelblaze-accelerometer-axis/.
- **kwitter** — Pico 6-axis write-up
  (https://forum.electromage.com/t/how-to-use-the-pico-s-six-axis-sensor/4692): the
  `sixAxis` variable, the IIR low-pass filter, and the resting-offset + per-axis
  sensitivity calibration workflow.
- **wizard (Ben Hencke)** — sensor-board author; guidance on what the accelerometer
  can/can't sense (tilt easy; spin-in-place near-invisible unless off-axis).
- **sorceror** — angle-between-two-vectors formula
  (https://forum.electromage.com/t/example-patterns-using-3-axis-accelerometer/2378).

### Lessons baked in
- **Two sensors, two variables — so auto-detect both by default.** `accelerometer`
  (expansion board) and `sixAxis` (Pico) are different variables; the one your
  hardware lacks is never populated, so a pattern on the wrong variable sits dead.
  The reference and both examples now lead with a `readMotion()` helper that
  declares both, picks the live one by magnitude (preferring `sixAxis`), and
  simulates from `time()` when neither reports — one portable pattern per layout.
- **Latch the source; don't re-decide per frame.** Re-selecting the sensor every
  frame flips to the `time()` simulator on any transient sub-threshold reading
  (freefall, hard shake) and glitches. `readMotion()` now latches onto the first
  sensor seen and releases only after a run of ~0 frames — the one spot motion
  intentionally diverges from the sound playbook's per-frame `light == -1` test
  (explained in the code comments).
- **`sixAxis` units are unverified — test before first use.** Detection threshold,
  the `abs(mag-1)` shake term, and gyro scaling all assume `sixAxis` matches the
  LIS3DH's ~1g scale, which isn't vendor-confirmed. Both examples carry a
  "TEST BEFORE FIRST USE" header (coexistence, units/scale, axis signs) and the
  reference has the matching callout; tilt direction survives a scale mismatch,
  magnitude does not.
- **Axis signs are per-sensor.** Two different chips, mounted differently, can't
  share one sign convention; `boardSign*` / `picoSign*` are now separate and
  applied inside `readMotion()`.
- **Fill patterns are a power case.** The gravity-liquid foam is a saturated cyan
  (not white) and per-pixel value is capped (`powerCeiling`), with default
  brightness lowered — so a filled, lit volume can't approach all-white. Documented
  as a motion-specific gotcha pointing at `power-safety.md`.
- **At rest ≠ zero.** The accelerometer reads 1g of gravity at rest; "no motion" is
  magnitude ≈ 1, and magnitude ≈ 0 means no board (or freefall) — which doubles as
  the detection test.
- **Always smooth, and snapshot once.** Raw motion data jitters; an IIR low-pass or
  damped average is mandatory, and the array must be read into locals once per frame
  with all vector/trig math in `beforeRender` (matrices precomputed there, never in
  `render*`).
- **Only the gyro senses spin.** The expansion-board accelerometer can't detect
  rotation in place — a recurring community misconception. True turn/spin needs the
  Pico's `sixAxis[3..5]`.
- **Carry the project-wide rules in:** delta-normalized decay, brightness floor /
  no strobe, no per-frame allocation, palette-based color.

## [1.1.0] - 2026-06-01

Added a gated sound-reactive reference and a beat-reactive example. Both are
kept **out of context unless the user explicitly asks for a sound- / audio- /
beat- / spectrum- / tempo-reactive pattern**, so non-sound work doesn't pay the
token cost.

### Added
- `reference/sound.md` — sound-reactive playbook: sensor inputs and board
  detection (`light == -1`), single-renderer dimension dispatch, frequency-
  spectrum auto-gain (simple decaying-peak and wizard's PI controller), per-bin
  "compared to its own average" EMA reactivity, bass-beat detection
  (fast/slow EMA rising edge + debounce), tempo / BPM inference, a simulated-
  sound fallback, and sound-specific gotchas. Opens with a "scope discipline"
  rule: default to the smallest engine that satisfies the ask.
- `examples/2d-sound-beat-pulse.js` — a complete, verified beat-reactive pattern.
  Blooms from center and steps through a warm palette on each detected bass beat,
  then decays to a brightness floor with a slow shimmer (a pulse, not a strobe).
  Runs on a bare strip via a 120-BPM simulated groove when no sensor board is
  attached; one renderer body serves 1D/2D/3D. Two UI knobs (Beat Sensitivity,
  Brightness) plus a Pulse gauge.

### Changed
- `SKILL.md` — `reference/sound.md` and both sound examples
  (`2d-sound-spectrum.js`, `2d-sound-beat-pulse.js`) are now explicitly **gated**:
  read only on an explicit sound-reactive request. The default `examples/`
  description no longer lists the sound spectrum, and the "Sound-reactive?"
  question now routes to `sound.md`.

### Sources & attribution (sound-reactive material)
Techniques are distilled from four community patterns; attributions are preserved
in `sound.md`, the example header, and here:
- **wizard (Ben Hencke)** — PixelBlaze core/firmware author, the definitive idiom.
  "sound — spectroblots 1D/2D/3D"
  (https://patterns.electromage.com/pattern/vXGvYT7tqJCsCKfiD) and
  "sound — spectrokalidamandala"
  (https://patterns.electromage.com/pattern/FRobn9vAtgoAqNCBo): PI-controller
  auto-gain, per-bin running averages, `arrayLerp` bin smoothing, `doAt`
  fixed-rate updates, and the simulated-sound fallback.
- **Jeff Vyduna** — "Music Sequencer — for V3 ONLY"
  (https://patterns.electromage.com/pattern/7MuJmcy4FZbs9jGbB ;
  https://forum.electromage.com/t/music-sequencer-choreography/1549): beat
  detection, std-dev-gated BPM estimation, and the ramp-timer / command-queue
  choreography model. Noted as ~1,400 lines and crash-prone if pasted whole —
  referenced for sections only, never reproduced in full.
- **MyMathematicalMind** — "Sound Reactive Color Fade", 2023
  (https://patterns.electromage.com/pattern/QhsaiD6Kbq2LnZ54p): the compact,
  stripped-down beat-detection skeleton the new example is built on.

### Lessons baked in
- **Scope is a feature.** The Music Sequencer proves that "more sound code" isn't
  better — it can crash the device and is slow to compile. The reference leads
  with scope discipline and the example stays ~150 lines.
- **Detect the board; simulate when absent.** Gate analysis on `light != -1` and
  drive a simulator otherwise, so patterns animate (and stay tunable) with no
  hardware.
- **Auto-gain, not magic constants.** Raw `frequencyData` is tiny and room-
  dependent; normalize against a decaying peak or a PI controller.
- **Delta-normalize every decay/EMA** (carrying the project-wide frame-rate rule
  into audio): `pow(ratePerSec, delta/1000)` or a `delta/windowMs` weight.
- **Array-method callbacks can't close over caller locals** — declare temporaries
  as `var` inside the callback.

## [1.0.0] - 2026-06-01

Initial public release. The skill writes, debugs, and explains PixelBlaze V3
patterns and pixel maps, built strictly on the verified official language
reference so it never emits functions PixelBlaze doesn't have.

### Added
- `SKILL.md` — trigger description, hard constraints, authoring + surgical-edit
  workflow, and a self-verification checklist.
- Reference library: `language.md` (verified built-ins — the source of truth),
  `ui-controls.md`, `mapping.md` (layout → pixel map, incl. a rectangle-perimeter
  generator for edge-lit tables/mirrors), `gotchas.md`, `artistry.md` (with the
  house style), `palettes.md` (curated cpt-city palettes), `power-safety.md`,
  `integrations.md` (Firestorm / WebSocket / pixelblaze-client), and
  `palette-blending.md` (the gradient-palette crossfade module).
- Eight verified examples: 1D breathing rainbow, 1D palette comet, 2D Perlin
  plasma, 2D ring aurora, 2D palette crossfade, 2D ember flicker, 3D noise cube,
  and a sound spectrum with auto-gain.
- Canonical palette-blending controls baked into the module and examples: an
  `Auto Cycle` toggle, a `Random Palette` toggle (default on), and a `Palette #`
  input, with `autoCycle`/`randomStart` exported for debugging — plus a one-shot
  startup guard so a random start wins over the restored control value.

### Changed
- Default palette-blending timing is now **45s hold / 5s transition** (was 30s / 5s).
- Strengthened `reference/ui-controls.md`: input controls need a matching, exported
  backing var or the widget displays uninitialized memory.

### Fixed
- Palette-blending `Palette #` control displayed an uninitialized value (e.g.
  `8.175035e-41`) on first load. PixelBlaze seeds a control's shown value from the
  exported global whose name matches the control, and the module had none. Added an
  exported backing var `palette` (matching `inputNumberPalette`) in the palette-blending
  module and the affected examples (`2d-palette-crossfade`, `2d-ember-flicker`).

### Development iterations (the path to 1.0.0)
Built and refined over one working session, each step driven by the previous result
(several surfaced only on real hardware — a 326-px WS2815 infinite-mirror table):
1. Reframed a legacy ChatGPT prompt as a skill grounded in **verified docs**, not
   model memory.
2. Built the initial skill from the official `simap/pixelblaze` reference: `SKILL.md`,
   core references (language, ui-controls, mapping, gotchas, artistry), and four
   examples.
3. Added curated palettes (`palettes.md`); corrected a name/description/URL shuffle in
   the source dump by matching data → variable name.
4. Interviewed for and filled the **house style** (calm/organic default, ~0.5 slider
   defaults, hard avoid-rules incl. no full-rainbow, all four layout types).
5. Risk audit → added `power-safety.md` and `integrations.md`, restored the
   surgical-edit discipline, rewrote the sound example with **auto-gain**, and added
   ring (2D) and cube (3D) examples.
6. Added the gradient-palette **crossfade module** (`palette-blending.md`) + example;
   made it the signature ambient effect.
7. Added an ember-flicker example and a **rectangle-perimeter map generator** (built
   while making the infinite-mirror-table patterns).
8. Hardware test surfaced a **Perlin strobe** (`time()*256`) → fixed to slow bounded
   drift across plasma/cube/ember; added a gotcha and tightened the motion constraint.
9. Audited for the same bug class → fixed **frame-rate-dependent decay** (comet tail,
   sound AGC) via delta-normalization; documented it.
10. Crossfade looked "muddy" → learned palettes must be **visually distinct**; added
    manual palette control; fixed a **palette-scroll seam** with `triangle()` and added
    the **closed-loop integer-frequency** rule.
11. Made the blending controls standard (`Auto Cycle` toggle + `Palette #` input) and
    exported `autoCycle`.
12. Added a `Random Palette` toggle + **one-shot startup** as canonical (random start
    that survives the control restore) and wrote a **surgical migration guide** for
    older patterns.
13. Fixed input-control widgets showing **uninitialized garbage** by requiring exported,
    name-matched backing vars.
14. Seeded this changelog and made "capture the lesson" part of the skill-change process.

### Lessons baked in (development history)
Hard-won during development and encoded as rules/guardrails so they can't recur:
- **Build on verified docs, not memory.** The entire reference is transcribed from
  the official `simap/pixelblaze` language reference; "if it's not in `language.md`,
  it doesn't exist."
- **Perlin animation speed = how fast its coordinate moves.** `time(...) * 256`
  swept ~hundreds of noise cells/second and strobed. Fix/guardrail: drift the
  coordinate slowly via bounded accumulation, `z = (z + delta/1000 * rate) % 256`.
- **Per-frame decay is frame-rate dependent.** A bare `x = x * k` per frame fades
  faster on a fast controller. Guardrail: delta-normalize (`pow(retainPerSec, delta/1000)`).
- **Scrolling a non-cyclic palette seams** where it wraps (end color ≠ start color).
  Guardrail: sweep with `triangle()` (out-and-back) or mirror the palette.
- **Closed loops (rings/perimeters) need integer spatial frequencies** and a single
  coefficient-1 phase on every term, or the wiring joint and the scroll-wrap jump.
- **Crossfades need visually distinct palettes** — near-identical palettes look like
  muddy "mixing," not a fade.
- **Controls restore after init**, so a bare random init is overwritten by the saved
  control; a one-shot first-frame guard is required for random-start to take effect.
- **Honor the house style:** palette-based color (no full-rainbow), layered slow +
  fast motion, a brightness floor (never full blackout), no strobing, 2–4 controls.
- **Be power-aware** on larger runs (current-draw math + injection guidance), and
  make surgical, minimally-invasive edits to existing patterns.
