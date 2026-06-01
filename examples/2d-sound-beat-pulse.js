/*
 * Sound Beat Pulse — 1D/2D/3D, palette-based, with sim-sound fallback
 *
 * On each detected bass beat the whole piece blooms from the center and steps
 * forward through the palette; between beats it decays smoothly to a calm
 * brightness floor with a slow shimmer — a pulse, never a strobe.
 *
 * Works on a bare strip too: if no sensor board is attached it drives a
 * simulated 120-BPM groove so you can see (and tune) the reaction without
 * hardware. Verified against reference/language.md.
 *
 * Beat-detection backbone adapted from MyMathematicalMind's "Sound Reactive
 * Color Fade" (https://patterns.electromage.com/pattern/QhsaiD6Kbq2LnZ54p),
 * itself a stripped-down build of Jeff Vyduna's "Music Sequencer"
 * (https://patterns.electromage.com/pattern/7MuJmcy4FZbs9jGbB). Simulated-sound
 * fallback adapted from wizard / Ben Hencke's "sound - spectroblots"
 * (https://patterns.electromage.com/pattern/vXGvYT7tqJCsCKfiD).
 */

// --- Sensor board ---------------------------------------------------------
export var light = -1                      // stays -1 when no board is attached
function SB() { return light != -1 }
export var frequencyData = array(32)

// --- Look (calm, palette-based; honors the house style) -------------------
// A warm sunrise palette: deep magenta -> orange -> gold -> warm white.
var beatPalette = [
  0,    0.05, 0,    0.10,
  0.35, 0.55, 0.05, 0.25,
  0.70, 1.00, 0.35, 0.05,
  1,    1.00, 0.85, 0.55
]
floorBright = 0.12         // brightness floor — never fully black
decayPerSec = 0.22         // fraction of the pulse retained per SECOND
stepOnBeat  = 0.11         // how far the palette advances on each beat

// --- UI controls (2 knobs) ------------------------------------------------
export var beatSensitivity = 0.5
export var brightness = 0.6
export function sliderBeatSensitivity(v) { beatSensitivity = v }
export function showNumberBeatSensitivity() { return beatSensitivity }
export function sliderBrightness(v) { brightness = clamp(v, 0.05, 1) }
export function showNumberBrightness() { return brightness }

// --- Beat detection (bass EMA rising-edge + debounce) ---------------------
export var BPM = 120                       // only used for the retrigger lock
var bass, maxBass = .02, bassThreshold = .02
var bassSlowEMA = .001, bassFastEMA = .001, lastBassFastEMA = .5
var bassOn, bassVelAvg = .5
var bvSize = 5, bv = array(5), bvPtr = 0
var minBeatRetrigger = .2                  // in beats; blocks double-triggering
var debounceTimer = 0

export var pulse = 0                       // 0..1 energy, blooms on a beat
export var palettePos = 0                  // palette read offset, steps on a beat

export function gaugePulse() { return pulse }

function beatsToMs(beats) { return 1000 / BPM * 60 * beats }

function debounce(trigger, fn, duration, elapsed) {
  if (trigger && debounceTimer <= 0) { fn(); debounceTimer = duration }
  else debounceTimer = max(-3e4, debounceTimer - elapsed)
}

function processSound(delta) {
  // Kick fundamental lives in the lowest bins (~40-80Hz).
  bass = frequencyData[1] + frequencyData[2] + frequencyData[3]
  maxBass = max(maxBass, bass)
  // Auto gain: bleed the running max down so it re-scales to the room.
  if (maxBass > 10 * bassSlowEMA && maxBass > bassThreshold) maxBass *= .99

  bassSlowEMA = (bassSlowEMA * 999 + bass) / 1000
  bassFastEMA = (bassFastEMA * 9   + bass) / 10

  // Normalized first derivative of the fast average, averaged over bvSize frames.
  bv[bvPtr] = (bassFastEMA - lastBassFastEMA) / maxBass
  bassVelAvg += bv[bvPtr] / bvSize
  bvPtr = (bvPtr + 1) % bvSize
  bassVelAvg -= bv[bvPtr] / bvSize
  lastBassFastEMA = bassFastEMA

  // Lower sensitivity slider -> require a steeper rise to call it a beat.
  bassOn = bassVelAvg > (0.85 - 0.6 * beatSensitivity)
  debounce(bassOn, onBeat, beatsToMs(minBeatRetrigger), delta)
}

// What happens on every detected beat.
function onBeat() {
  pulse = 1
  palettePos = (palettePos + stepOnBeat) % 1
}

// --- Per-frame -------------------------------------------------------------
export function beforeRender(delta) {
  setPalette(beatPalette)
  // No board? Fake a groove into frequencyData at 40Hz. Either way, the SAME
  // analysis runs below — the detector doesn't care where the data came from.
  if (!SB()) doAt(40, delta, simulateSound)
  processSound(delta)

  // Delta-normalized decay: same feel at any frame rate.
  pulse = pulse * pow(decayPerSec, delta / 1000)
  shimmer = 0.06 * wave(time(0.12))          // slow breath so it's alive between beats
}

// --- Render (one body, three entry points) --------------------------------
function renderShared(index, x, y, z) {
  // Distance from center -> the bloom radiates outward; doubles as palette spread.
  d = hypot(x - 0.5, y - 0.5)
  paintValue = (palettePos + d * 0.5) % 1
  // Bloom is brightest at center on a beat (1-d) and decays with pulse.
  bloom = pulse * clamp(1 - d, 0, 1)
  v = brightness * (floorBright + shimmer + (1 - floorBright) * bloom)
  paint(paintValue, clamp(v, 0, 1))
}
export function render(index)            { renderShared(index, index / pixelCount, 0, 0) }
export function render2D(index, x, y)    { renderShared(index, x, y, 0) }
export function render3D(index, x, y, z) { renderShared(index, x, y, z) }

// --- Simulated sound (wizard / Ben Hencke) --------------------------------
// Fakes a 120-BPM four-on-the-floor groove into frequencyData when no board is
// present, so the beat detector and visuals have something to chew on.
var accumDelta = 0
function doAt(hertz, delta, fn) {
  accumDelta += delta
  if (accumDelta <= 1000 / hertz) return
  accumDelta -= 1000 / hertz
  fn()
}

simBPM = 120
var measurePeriod = 4 * 60 / simBPM / 65.536
function simulateSound() {
  tM = time(measurePeriod)                   // one musical measure
  tP = time(8 * measurePeriod)               // one 8-measure phrase
  for (i = 0; i < 32; i++) frequencyData[i] = 0

  beat = (-4 * tM + 5) % 1                    // 4 kicks per measure
  beat *= .02 * pow(beat, 4)                  // sharpen the attack
  for (i = 0; i < 10; i++) frequencyData[i] += beat * (10 - i) / 10

  claps = .006 * square(2 * tM - .5, .10)     // off-beat claps
  for (i = 9; i < 14 + random(5); i++)
    frequencyData[i] += claps * (.7 + .6 * random(i % 2))

  highHat = .01 * square(4 * tM - .5, .05)    // hats on 2 & 4
  for (i = 18; i < 20; i++) frequencyData[i] += highHat * (.8 + random(.4))

  lead = 4 + floor(16 * wander(tP))           // wandering synth fundamental
  for (i = 4; i < 20; i++)
    frequencyData[i] += .005 * (lead == i || lead == (i - 4) * r(.4))
}
function wander(t) {
  t *= 49.261
  return (wave(t / 2) * wave(t / 3) * wave(t / 5) + wave(t / 7)) / 2
}
function r(p) { return random(1) < p }
