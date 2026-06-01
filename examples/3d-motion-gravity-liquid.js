/*
 * Motion Gravity Liquid — 3D (any 3D map; 2D + 1D fallbacks included)
 *
 * Fills like a container of glowing liquid that always settles to the bottom:
 * pixels below the gravity "surface" glow through a cool water palette (deep blue
 * -> teal -> bright cyan foam at the surface), pixels above it fade to a dark
 * floor. Tilt the object and the liquid flows to the new low side; shake it (or,
 * on a Pico, spin it) and the surface sloshes.
 *
 * AUTO-DETECTS the motion sensor — one pattern, any hardware. Prefers the
 * PixelBlaze V3 Pico's built-in 6-axis IMU (`sixAxis`, which also gives a gyro
 * for spin agitation), falls back to the Sensor Expansion Board's accelerometer
 * (`accelerometer`, tilt/shake only), and self-sloshes on a slow timer when
 * neither is attached. Verified against reference/language.md.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TEST BEFORE FIRST USE — this pattern has NOT been validated on hardware:
 *   1. Confirm `accelerometer` and `sixAxis` can both be declared in one pattern
 *      and that the right one populates. Watch the exported `motionSource`:
 *      1 = Pico sixAxis, 2 = expansion board, 0 = none/simulated.
 *   2. UNITS (important): this code assumes `sixAxis[0..2]` reports gravity in the
 *      same ~1g scale as the LIS3DH `accelerometer`. That is NOT vendor-confirmed
 *      (sixAxis is community-documented). The detection threshold (0.1), the shake
 *      term `abs(mag-1)`, and the gyro scale ALL depend on it. Read real values in
 *      the Var Watcher on a Pico and adjust the threshold / scale if they differ.
 *   3. AXIS SIGNS are per-sensor — the LIS3DH and the Pico IMU are different chips,
 *      mounted differently, so their axes generally differ. Set boardSign* and
 *      picoSign* from the Var Watcher; a wrong sign flows the liquid the wrong way.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Gravity-vector tilt model adapted from Roger Cheng's "GlowFlow" /
 * "Accelerometer Tilt 3D" (https://github.com/Roger-random/glowflow); simplified
 * to a dot-product fill level (no per-pixel matrix math — note this can look off
 * on irregular / non-centered 3D maps, since it assumes a roughly centered 0..1
 * volume). Dual-sensor auto-detect and the Pico `sixAxis` mapping follow kwitter's
 * write-up (https://forum.electromage.com/t/how-to-use-the-pico-s-six-axis-sensor/4692).
 */

// --- Sensors: declare BOTH; the absent one stays at its zero default --------
export var accelerometer = array(3)   // expansion board: [x,y,z], accel only, no gyro
export var sixAxis = array(6)          // Pico built-in: [x,y,z, gx,gy,gz]

// --- Axis signs are PER SENSOR (see header note #3) ------------------------
// Defaults are 1; set each from the Var Watcher on the board you actually use.
var boardSignX = 1, boardSignY = 1, boardSignZ = 1    // expansion board (accelerometer)
var picoSignX  = 1, picoSignY  = 1, picoSignZ  = 1    // Pico (sixAxis); kwitter negated X & Z on his hat

// --- Look (cool water palette: deep blue -> teal -> bright CYAN foam) -------
// Foam is cyan, NOT white: keeping the red channel low means a filled, lit volume
// never approaches all-white, which is the worst case for current draw. See the
// powerCeiling cap below and reference/power-safety.md.
var waterPalette = [
  0.0,  0.00, 0.02, 0.20,
  0.45, 0.00, 0.32, 0.72,
  0.80, 0.08, 0.62, 0.92,
  1.0,  0.30, 0.85, 1.00
]
floorBright = 0.06        // dark "air" above the liquid never goes fully black
surfaceBand = 0.18        // thickness of the bright foam band at the surface
powerCeiling = 0.78       // hard cap on per-pixel value (power: a filled volume of
                          // bright pixels draws a lot of current — see power-safety.md)

// --- UI controls ----------------------------------------------------------
export var brightness = 0.6
export var tiltGain = 0.5    // exaggerate small leans (wearables have little range)
export var fillLevel = 0.5   // how full the container is (0 empty .. 1 full)
export function sliderBrightness(v) { brightness = clamp(v, 0.05, 1) }
export function showNumberBrightness() { return brightness }
export function sliderTiltGain(v) { tiltGain = v }
export function showNumberTiltGain() { return tiltGain }
export function sliderFillLevel(v) { fillLevel = v }
export function showNumberFillLevel() { return fillLevel }

// --- Unified motion read with STICKY source selection ----------------------
var mAx = 0, mAy = -1, mAz = 0     // live gravity/accel axes from whichever sensor
var mSpin = 0                      // gyro magnitude (0 on the expansion board)
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
    mAx = sixAxis[0] * picoSignX; mAy = sixAxis[1] * picoSignY; mAz = sixAxis[2] * picoSignZ
    mSpin = sqrt(sixAxis[3]*sixAxis[3] + sixAxis[4]*sixAxis[4] + sixAxis[5]*sixAxis[5])
  } else if (lockedSource == 2) {    // expansion board (no gyro)
    mAx = accelerometer[0] * boardSignX; mAy = accelerometer[1] * boardSignY; mAz = accelerometer[2] * boardSignZ
    mSpin = 0
  } else {
    mSpin = 0                         // beforeRender synthesizes mAx/mAy/mAz from time()
  }
}

// --- Smoothed gravity state (allocated once, reused) ----------------------
var fx = 0, fy = -1, fz = 0          // filtered reading (start pointing "down")
var gx = 0, gy = -1, gz = 0          // normalized unit gravity vector
filterStrength = 0.12                // IIR low-pass: 0.05 smooth/laggy .. 0.2 snappy
export var slosh = 0                 // motion energy, blooms the surface band
export function gaugeSlosh() { return slosh }

// --- Per-frame ------------------------------------------------------------
export function beforeRender(delta) {
  setPalette(waterPalette)
  readMotion()

  if (motionSource == 0) {
    // No sensor: fake a slowly tumbling gravity so it self-sloshes (and stays tunable).
    mAx = sin(time(0.18) * PI2) * 0.6
    mAy = -cos(time(0.13) * PI2)
    mAz = sin(time(0.21) * PI2) * 0.6
  }

  // IIR low-pass each axis (raw motion data is jittery).
  fx = fx + filterStrength * (mAx - fx)
  fy = fy + filterStrength * (mAy - fy)
  fz = fz + filterStrength * (mAz - fz)

  // Normalize to a unit gravity vector ("which way is down"), guarding the divide.
  len = max(sqrt(fx*fx + fy*fy + fz*fz), 0.0001)
  gx = fx/len; gy = fy/len; gz = fz/len

  // Slosh = shake magnitude (any sensor) + spin agitation (Pico only; 0 otherwise).
  // NOTE: abs(mag-1) assumes a ~1g resting magnitude — see header note #2 for the
  // Pico-units caveat.
  mag = sqrt(mAx*mAx + mAy*mAy + mAz*mAz)
  shake = abs(mag - 1) + mSpin * 0.5
  slosh = slosh + 0.2 * (shake - slosh)
  slosh = slosh * pow(0.25, delta / 1000)     // delta-normalized decay
}

// --- Render: fill level along the gravity vector --------------------------
// height = how far a pixel sits along gravity (-1 deep .. +1 high). The surface
// rises and falls with fillLevel, wobbling a little when sloshed.
function renderShared(x, y, z) {
  var cx = x*2 - 1
  var cy = y*2 - 1
  var cz = z*2 - 1
  var height = clamp((cx*gx + cy*gy + cz*gz) * (1 + tiltGain*2), -1.2, 1.2)
  var surface = (fillLevel*2 - 1) + slosh * 0.4 * wave(time(0.2))
  var depth = surface - height        // >0 below surface (in liquid), <0 above
  var v
  if (depth > 0) {
    var pos = clamp(1 - depth / surfaceBand, 0, 1)   // 1 at surface -> 0 deeper
    v = floorBright + (1 - floorBright) * clamp(0.5 + depth, 0.5, 1)
    v = min(v, powerCeiling)                          // power cap
    paint(pos, v * brightness)
  } else {
    v = floorBright * clamp(1 + depth * 4, 0, 1)
    paint(0, v * brightness)
  }
}
export function render3D(index, x, y, z) { renderShared(x, y, z) }
export function render2D(index, x, y)    { renderShared(x, y, 0.5) }
// 1D fallback: a strip can only express gravity along ONE axis, so we map it to
// the gravity Y component — tilt purely in X or Z won't show on a 1D strip.
export function render(index)            { renderShared(0.5, index / pixelCount, 0.5) }
