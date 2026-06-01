# Sound-reactive patterns (sensor expansion board)

> **Load this file only when the user explicitly asks for a sound- / audio- /
> music-reactive pattern (or beat / spectrum / FFT / tempo reactivity).** It is
> intentionally kept out of the default context. The companion examples
> `examples/2d-sound-spectrum.js` and `examples/2d-sound-beat-pulse.js` are
> likewise gated — read them only in that same case.

Everything here is built strictly on functions verified in `reference/language.md`.
The techniques are distilled from four reference patterns; **keep the attributions
when you reuse a technique** (and in any changelog entry):

- **wizard (Ben Hencke)** — author of the PixelBlaze core firmware and language,
  so his patterns are the *definitive* idiom. "sound — spectroblots 1D/2D/3D"
  (https://patterns.electromage.com/pattern/vXGvYT7tqJCsCKfiD) and
  "sound — spectrokalidamandala"
  (https://patterns.electromage.com/pattern/FRobn9vAtgoAqNCBo).
- **Jeff Vyduna** — one of the most senior PixelBlaze developers. "Music Sequencer
  — for V3 ONLY" (https://patterns.electromage.com/pattern/7MuJmcy4FZbs9jGbB ;
  forum write-up: https://forum.electromage.com/t/music-sequencer-choreography/1549).
  Definitive for beat detection, tempo inference, and choreography — but **very
  long (~1,400 lines) and known to crash PixelBlaze if pasted whole.** Mine it for
  sections, never reproduce it in full (see "Scope discipline" below).
- **MyMathematicalMind** — "Sound Reactive Color Fade", 2023
  (https://patterns.electromage.com/pattern/QhsaiD6Kbq2LnZ54p). A clean,
  deliberately *stripped-down* build of Jeff's sequencer that keeps only bass-beat
  detection. The best starting skeleton for a new beat-reactive pattern.

## Scope discipline (read before writing)

A sound-reactive pattern is the one place it's tempting to write 500+ lines. Don't.
Jeff Vyduna's Music Sequencer is the cautionary tale: each section is individually
correct and worth learning from, but the whole thing is long enough to crash the
device and slow to compile. **Default to the smallest engine that satisfies the
ask:**

- "React to the beat" → the bass-beat detector (one EMA pair + a velocity buffer +
  debounce). ~40 lines. Start from MyMathematicalMind's skeleton.
- "Spectrum analyzer / VU / frequency bars" → `frequencyData` + per-bin auto-gain.
  Start from wizard's spectroblots.
- "Stay in sync with the song's tempo / choreograph sections" → add tempo inference
  and a small queue. Only build this when the user explicitly wants tempo sync or
  scripted sections, and even then port only the pieces you need.

Never paste a multi-hundred-line sequencer unless the user explicitly asks for that
scope and accepts the crash risk.

## Sensor inputs (verified, from `language.md`)

Declared with `export var`. They read as safe defaults when no board is attached,
so always provide a graceful fallback:

- `frequencyData` — 32-element FFT magnitudes, ~12.5 Hz–10 kHz. **Values are tiny**
  (often well under 1.0); you almost always scale them up with a gain term.
- `energyAverage` — overall volume (one number). Best input for a simple
  loudness/VU reaction.
- `maxFrequency`, `maxFrequencyMagnitude` — the single strongest tone (~39 Hz
  resolution). Good for pitch-following.
- `light` — ambient light. Doubles as a **sensor-board-attached probe**: it sits at
  the impossible value `-1` when no board is present (wizard's and
  MyMathematicalMind's convention).
- `accelerometer` `[x,y,z]`, `analogInputs` `[A0..A4]`.

### Detecting the board and dispatching dimensions

wizard's and MyMathematicalMind's shared idiom — declare `light = -1`, test it, and
route every map dimension through one renderer so the pattern works on a strip, a
matrix, or a 3D map:

```js
export var light = -1
function SB() { return light != -1 }   // true once a sensor board is attached
export var frequencyData = array(32)

// One renderer, three entry points — PixelBlaze picks the one matching the map.
export function render(index)            { renderShared(index, index / pixelCount, 0, 0) }
export function render2D(index, x, y)    { renderShared(index, x, y, 0) }
export function render3D(index, x, y, z) { renderShared(index, x, y, z) }
```

In `beforeRender`, only run the analysis when a board is present, and otherwise
drive a simulator (below):

```js
export function beforeRender(delta) {
  if (SB()) processSound(delta)
  else      simulateSound(delta)   // so it still animates on a bare strip
  // ... per-frame visual math ...
}
```

## Building block 1 — frequency spectrum with auto-gain (wizard)

The raw `frequencyData` values are tiny and depend on room volume, so a fixed
multiplier looks great in one room and dead in the next. wizard solves this two
ways; pick by complexity budget.

**Simple decaying-peak AGC** (used in `examples/2d-sound-spectrum.js`): track the
loudest recent bin and normalize against it. Delta-normalize the decay so the
response is frame-rate independent.

```js
var peak = 0.0001          // running peak (never 0 — avoids divide-by-zero)
decayPerSec = 0.4          // peak falls toward this fraction/sec when quiet

export function beforeRender(delta) {
  frameMax = 0
  for (i = 0; i < 32; i++) if (frequencyData[i] > frameMax) frameMax = frequencyData[i]
  // Loud transients raise peak instantly; quiet passages let it fall and re-gain.
  peak = max(peak * pow(decayPerSec, delta / 1000), frameMax)
  peak = max(peak, 0.0001)
  gain = sensitivity / peak
}
```

**PI-controller AGC** (wizard's spectroblots / spectrokalidamandala): a tiny
proportional-integral controller nudges sensitivity until the *average* displayed
brightness hits a target fill, which holds the look steady across wildly different
tracks. Port this only when the simple peak tracker isn't smooth enough:

```js
// wizard's PI controller, stored as a 5-element array [kp, ki, state, min, max].
function makePIController(kp, ki, start, lo, hi) {
  var pic = array(5)
  pic[0] = kp; pic[1] = ki; pic[2] = start; pic[3] = lo; pic[4] = hi
  return pic
}
function calcPIController(pic, err) {
  pic[2] = clamp(pic[2] + err, pic[3], pic[4])       // integral term (clamped)
  return max(pic[0] * err + pic[1] * pic[2], .3)     // P + I, floored above 0
}
// each frame: sensitivity = calcPIController(pic, targetFill - measuredFill)
```

## Building block 2 — "compared to its own average" (wizard)

The reason wizard's patterns feel musical rather than like a flat VU meter: each
bin is compared to *its own* recent average (an exponential moving average), so a
snare popping above its baseline lights up even while steady bass holds. The EMA
weight is delta-derived, so the averaging window is a true wall-clock duration:

```js
averageWindowMs = 1500
export function beforeRender(delta) {
  dw = delta / averageWindowMs                 // this frame's weight in the EMA
  for (i = 0; i < 32; i++) {
    averages[i] = max(.0001, averages[i] * (1 - dw) + frequencyData[i] * dw * sensitivity)
  }
}
// in render: emphasis = current - average  →  only the *change* drives brightness
```

To smear 32 bins smoothly across many pixels, wizard interpolates between adjacent
bins (note: `var` locals, because array-method callbacks can't see caller locals —
see `gotchas.md`):

```js
function arrayLerp(arr, i) {
  var lo, hi, f
  lo = floor(i); hi = ceil(i); f = i - lo
  return arr[lo] * (1 - f) + arr[hi] * f
}
```

## Building block 3 — bass-beat detection (MyMathematicalMind, from Jeff Vyduna)

The compact, dependable beat detector. It sums the low bins, keeps a fast and a slow
EMA, watches the *rising edge* of the fast average, and debounces so one kick fires
once. This is the core of MyMathematicalMind's stripped skeleton — the cleanest
runnable starting point.

```js
var bass, maxBass = .02, bassThreshold = .02
var bassSlowEMA = .001, bassFastEMA = .001, lastBassFastEMA = .5
var bassOn, bassVelocitiesAvg = .5
var bvSize = 5, bv = array(5), bvPtr = 0     // circular buffer of normalized slopes
var minBeatRetrigger = .2                    // in beats; blocks double-triggering
var debounceTimer = 0

function processInstruments(delta) {
  bass = frequencyData[1] + frequencyData[2] + frequencyData[3]  // kick ~40-80Hz
  maxBass = max(maxBass, bass)
  if (maxBass > 10 * bassSlowEMA && maxBass > bassThreshold) maxBass *= .99 // AGC
  bassSlowEMA = (bassSlowEMA * 999 + bass) / 1000
  bassFastEMA = (bassFastEMA * 9   + bass) / 10
}

function inferBeat(delta) {
  bv[bvPtr] = (bassFastEMA - lastBassFastEMA) / maxBass   // normalized 1st derivative
  bassVelocitiesAvg += bv[bvPtr] / bvSize
  bvPtr = (bvPtr + 1) % bvSize
  bassVelocitiesAvg -= bv[bvPtr] / bvSize
  bassOn = bassVelocitiesAvg > .51                        // true while bass is rising
  debounce(bassOn, beatDetected, beatsToMs(minBeatRetrigger), delta)
  lastBassFastEMA = bassFastEMA
}

function debounce(trigger, fn, duration, elapsed) {
  if (trigger && debounceTimer <= 0) { fn(); debounceTimer = duration }
  else debounceTimer = max(-3e4, debounceTimer - elapsed)
}

function beatsToMs(beats) { return 1000 / BPM * 60 * beats }   // BPM is a global
```

Then write the visual reaction inside `beatDetected()` — advance a palette, inject
brightness, spawn a ripple, etc. **Keep it a pulse, not a strobe:** add energy on
the beat and let it decay (delta-normalized), honoring the house-style brightness
floor (`reference/artistry.md`).

## Building block 4 — tempo inference / BPM (Jeff Vyduna) — advanced

Only when the user wants true tempo sync. Jeff stores the last N intervals between
detected beats in a ring buffer and accepts a BPM estimate only when the intervals
are consistent (low standard deviation), which rejects spurious beats:

```js
function estimateBPM() {
  meanBeatInterval = beatIntervals.sum() / beatIntervalSamples
  var errSum = beatIntervals.reduce((a, v) => {
    var d = (v - meanBeatInterval) / 100   // scale down before squaring (fixed-point range)
    return a + d * d
  }, 0)
  var stdDev = sqrt(errSum / beatIntervalSamples) / (meanBeatInterval / 100)
  if (stdDev < .1) {
    BPMEst = round(6000 / (meanBeatInterval / 10))  // 60000ms/min, split to avoid overflow
    BPMEstReliable = 1
  } else BPMEstReliable = 0
}
```

Jeff's full sequencer also exposes ramp timers (`beat`, `halfnote`, `wholenote`,
`note_8`, `note_16` count down 1→0; `currentPatternPct`, `phrasePct` ramp up like
`time()`) and a tiny command queue (`enqueue(beforeRenderFn, beats)`, plus
`playUntilBeat`, `playUntilLoud`, and `exec` for one-shot commands) to choreograph
sections. **Describe or port these selectively; do not paste the whole engine.**

## Building block 5 — simulated sound (wizard), so it runs with no board

wizard's patterns degrade gracefully by faking a 120-BPM four-on-the-floor groove
when `light == -1`. This is invaluable: the user can see the pattern move before
buying the sensor board, and you can reason about it without hardware. Run it at a
fixed rate with the `doAt` helper so the simulation looks the same regardless of
frame rate:

```js
var accumDelta = 0
function doAt(hertz, delta, fn) {     // call fn ~hertz times/sec
  accumDelta += delta
  if (accumDelta <= 1000 / hertz) return
  accumDelta -= 1000 / hertz
  fn()
}
// usage: if (!SB()) doAt(40, delta, simulateSound)
```

`simulateSound` writes plausible energy into `frequencyData` (most energy in the low
bins on the beat, claps on the off-beats, hats on 2 & 4). See the full, verified
implementation in `examples/2d-sound-beat-pulse.js`.

## Sound-specific gotchas (also see `reference/gotchas.md`)

- **Scale `frequencyData` up.** Raw magnitudes are tiny; without a gain term the
  strip looks dead. Use auto-gain, not a guessed constant.
- **Delta-normalize every decay/EMA.** A bare `x *= k` per frame, or `peak * 0.99`,
  fades faster on a fast controller. Use `pow(ratePerSec, delta/1000)` or a
  `delta/windowMs` weight (shown above) so behavior is frame-rate independent.
- **Detect the board, don't assume it.** Gate analysis on `SB()` / `light != -1`
  and provide a simulator so a bare strip still animates.
- **Array-method callbacks can't close over caller locals** (`reduce`, `mutate`,
  etc. see only globals + their own params). Declare loop temporaries as `var`
  inside the callback, as Jeff does in `estimateBPM`.
- **Beats need a debounce.** A single kick spans several frames; without a retrigger
  lock you get a burst of false beats. Lock for a fraction of a beat
  (`minBeatRetrigger`).
- **Watch fixed-point range (±32768).** Summing squared errors or large counters can
  overflow — Jeff scales intervals down by /100 before squaring and splits the
  60000 ms/min constant. Keep intermediate magnitudes small.
- **Don't strobe.** Beat reactions should pulse-and-decay with a brightness floor,
  per the house style — not flash fully on/off.
- **Sync caveat (multi-board).** Beat detection drifts between boards on ambiguous
  music; MyMathematicalMind re-based timing on `time()` instead of `delta` to help.
  True choreography sync is hard — set expectations.
