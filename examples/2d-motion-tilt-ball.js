/*
 * Motion Tilt Ball — 2D (matrix/panel; 1D fallback included)
 *
 * A soft glowing ball rolls downhill: tilt the device and the blob settles to the
 * low corner. On a Pico, spin/turn it and the gyro adds energy — the blob blooms
 * brighter and its color advances faster through a palette. (On the expansion
 * board, with no gyro, the color still drifts slowly so it's never static.)
 *
 * AUTO-DETECTS the motion sensor — one pattern, any hardware. Prefers the
 * PixelBlaze V3 Pico's built-in 6-axis IMU (`sixAxis`, which adds the gyro), falls
 * back to the Sensor Expansion Board's accelerometer (`accelerometer`, tilt only),
 * and drifts on a timer when neither is present. Verified against reference/language.md.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TEST BEFORE FIRST USE — this pattern has NOT been validated on hardware:
 *   1. Confirm `accelerometer` and `sixAxis` can both be declared in one pattern
 *      and that the right one populates. Watch the exported `motionSource`:
 *      1 = Pico sixAxis, 2 = expansion board, 0 = none/simulated.
 *   2. UNITS (important): this code assumes `sixAxis[0..2]` reports tilt in the same
 *      ~1g scale as the LIS3DH `accelerometer`. That is NOT vendor-confirmed (sixAxis
 *      is community-documented). The detection threshold (0.1) and the gyro scale
 *      depend on it — read real values in the Var Watcher on a Pico and adjust.
 *   3. AXIS SIGNS are per-sensor — different chips, mounted differently. Set
 *      boardSign* and picoSign* from the Var Watcher (picoSignX defaults to -1 per
 *      kwitter's hat; yours may differ). Calibrate restingX/Y at rest as well.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Dual-sensor auto-detect, the Pico `sixAxis` mapping, IIR smoothing, and the
 * calibration workflow follow kwitter's write-up
 * (https://forum.electromage.com/t/how-to-use-the-pico-s-six-axis-sensor/4692).
 */

// --- Sensors: declare BOTH; the absent one stays at its zero default --------
export var accelerometer = array(3)   // expansion board: [x,y,z], accel only, no gyro
export var sixAxis = array(6)          // Pico built-in: [x,y,z, gx,gy,gz]

// --- Axis signs are PER SENSOR (see header note #3) ------------------------
var boardSignX = 1,  boardSignY = 1     // expansion board (accelerometer)
var picoSignX  = -1, picoSignY  = 1     // Pico (sixAxis); kwitter negated X on his hat

// --- Calibration (read filtered values at rest from the Var Watcher) -------
var restingX = 0.0
var restingY = 0.0

// --- Look (warm blob palette: magenta -> orange -> gold -> warm white) ------
var ballPalette = [
  0.0,  0.10, 0.00, 0.20,
  0.40, 0.85, 0.10, 0.05,
  0.75, 1.00, 0.55, 0.05,
  1.0,  1.00, 0.92, 0.65
]
floorBright = 0.05        // matrix never goes fully black
ballSize = 0.35           // blob radius in map units
idleDrift = 0.03          // base color drift/sec so the look isn't static without a gyro

// --- UI controls ----------------------------------------------------------
export var brightness = 0.7
export var sensitivity = 0.5   // 0..1 slider -> 0..4x internally (kwitter's mapping)
export function sliderBrightness(v) { brightness = clamp(v, 0.05, 1) }
export function showNumberBrightness() { return brightness }
export function sliderSensitivity(v) { sensitivity = v }
export function showNumberSensitivity() { return sensitivity }

// --- Unified motion read with STICKY source selection ----------------------
var mAx = 0, mAy = 0, mSpin = 0    // live tilt axes + gyro magnitude (0 on board)
export var motionSource = 0        // 0 none/sim, 1 Pico sixAxis, 2 expansion board
export function showNumberMotionSource() { return motionSource }

var lockedSource = 0               // the source we've latched onto
var lostFrames = 0                 // consecutive frames the locked sensor read ~0
var LOST_LIMIT = 30                // frames of silence before we release the lock

// We latch onto the first sensor that reports and HOLD it, instead of re-deciding
// every frame. WHY this differs from the sound examples (which re-test light==-1
// fresh each frame): an accelerometer's magnitude legitimately dips toward 0 in
// freefall or between hard shakes, so a per-frame test would flip to the time()
// simulator for a frame and visibly glitch. We only release the lock after the held
// sensor reads ~0 for LOST_LIMIT straight frames (a real hot-swap, not noise).
function readMotion() {
  var sm = sqrt(sixAxis[0]*sixAxis[0] + sixAxis[1]*sixAxis[1] + sixAxis[2]*sixAxis[2])
  var am = sqrt(accelerometer[0]*accelerometer[0] + accelerometer[1]*accelerometer[1] + accelerometer[2]*accelerometer[2])
  var presentNow = (sm > 0.1) ? 1 : ((am > 0.1) ? 2 : 0)

  if (lockedSource == 0) {
    lockedSource = presentNow
    lostFrames = 0
  } else {
    var lockedMag = (lockedSource == 1) ? sm : am
    if (lockedMag > 0.1) {
      lostFrames = 0
    } else {
      lostFrames = lostFrames + 1
      if (lostFrames >= LOST_LIMIT) { lockedSource = presentNow; lostFrames = 0 }
    }
  }
  motionSource = lockedSource

  if (lockedSource == 1) {           // Pico (superset: adds the gyro)
    mAx = sixAxis[0] * picoSignX; mAy = sixAxis[1] * picoSignY
    mSpin = sqrt(sixAxis[3]*sixAxis[3] + sixAxis[4]*sixAxis[4] + sixAxis[5]*sixAxis[5])
  } else if (lockedSource == 2) {    // expansion board (no gyro)
    mAx = accelerometer[0] * boardSignX; mAy = accelerometer[1] * boardSignY
    mSpin = 0
  } else {
    mAx = sin(time(0.17) * PI2) * 0.7      // drift so the ball wanders (and stays tunable)
    mAy = cos(time(0.23) * PI2) * 0.7
    mSpin = 0
  }
}

// --- Smoothed state (allocated once) --------------------------------------
var filteredX = 0, filteredY = 0
var spinFiltered = 0
filterStrength = 0.12          // IIR low-pass strength for tilt
var ballX = 0.5, ballY = 0.5   // blob center, eased toward the tilt target
export var palettePos = 0      // color offset: idle drift + spin
export var spin = 0
export function gaugeSpin() { return spin }

// --- Per-frame ------------------------------------------------------------
export function beforeRender(delta) {
  setPalette(ballPalette)
  readMotion()                   // signs already applied per-sensor inside readMotion

  // IIR low-pass (raw is jittery).
  filteredX = filteredX + filterStrength * (mAx - filteredX)
  filteredY = filteredY + filterStrength * (mAy - filteredY)
  spinFiltered = spinFiltered + 0.2 * (mSpin - spinFiltered)
  spin = spinFiltered

  // Calibrated tilt -> target blob position. Slider 0..1 maps to 0..4x.
  sens = sensitivity * 4
  tiltX = clamp((filteredX - restingX) * sens, -1, 1)
  tiltY = clamp((filteredY - restingY) * sens, -1, 1)
  targetX = 0.5 + tiltX * 0.5
  targetY = 0.5 + tiltY * 0.5

  // Ease the ball toward the downhill target (heavier = more liquid feel).
  ballX = ballX + 0.15 * (targetX - ballX)
  ballY = ballY + 0.15 * (targetY - ballY)

  // Color advances at a slow idle rate PLUS spin (delta-normalized). The idle term
  // means the expansion board (no gyro) still gets color motion instead of a static blob.
  palettePos = (palettePos + (idleDrift + spin * 0.5) * delta / 1000) % 1
}

// --- Render: a soft blob at (ballX, ballY) --------------------------------
function renderShared(x, y) {
  var d = sqrt((x - ballX)*(x - ballX) + (y - ballY)*(y - ballY))
  var blob = clamp(1 - d / ballSize, 0, 1)
  blob = blob * blob                        // soften the falloff
  var v = floorBright + (1 - floorBright) * blob * (0.7 + clamp(spin, 0, 0.6))
  paint((palettePos + blob * 0.25) % 1, clamp(v, 0, 1) * brightness)
}
export function render2D(index, x, y) { renderShared(x, y) }
// 1D fallback: a strip expresses only one tilt axis (X here).
export function render(index)         { renderShared(index / pixelCount, 0.5) }
