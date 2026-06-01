# Motion-reactive patterns (accelerometer / 6-axis IMU)

> **Load this file only when the user explicitly asks for a motion- / tilt- /
> gravity- / orientation- / shake- / accelerometer- / gyro- / 6-axis-reactive
> pattern.** It is intentionally kept out of the default context. The companion
> examples `examples/3d-motion-gravity-liquid.js` and
> `examples/2d-motion-tilt-ball.js` are likewise gated — read them only in that
> same case.

**Default to one pattern that supports both sensors and auto-detects which is
present** (see "One pattern, both sensors" below). Only write a single-sensor
pattern if the user explicitly asks to target just one board.

Everything here is built strictly on functions verified in `reference/language.md`.
The techniques are distilled from a handful of reference patterns; **keep the
attributions when you reuse a technique** (and in any changelog entry):

- **Roger Cheng (Regorlas / Roger-random)** — author of the definitive
  accelerometer port. "GlowFlow (3D coord transform API port)" and the simpler
  test patterns "Accelerometer Tilt 3D" and "RGB-XYZ Accelerometer Blocks 3D"
  (https://github.com/Roger-random/glowflow). Source of the gravity-vector →
  spherical-coordinate (azimuth/polar) tilt model and the jitter-damping idiom.
  Axis-direction investigation: https://newscrewdriver.com/2019/07/08/pixelblaze-accelerometer-axis/.
- **kwitter** — forum write-up of the **Pico's built-in 6-axis sensor**
  (https://forum.electromage.com/t/how-to-use-the-pico-s-six-axis-sensor/4692).
  Source of the `sixAxis` variable, the IIR low-pass smoothing filter, and the
  resting-offset + per-axis sensitivity calibration workflow.
- **wizard (Ben Hencke)** — PixelBlaze core/firmware + sensor-board author. Forum
  guidance on what the accelerometer can and can't sense (gravity/tilt easy;
  spin-in-place produces almost nothing unless the sensor is far from the axis).
- **sorceror** — the angle-between-two-vectors formula
  (https://forum.electromage.com/t/example-patterns-using-3-axis-accelerometer/2378).

## Two different sensors — know which one you're targeting

This is the single most important thing to get right, because the variable name,
array length, and available data all differ:

| Hardware | Variable | Shape | Gives you |
|---|---|---|---|
| **Sensor Expansion Board** (LIS3DH) | `accelerometer` | `[x, y, z]` (3), 16G | Linear acceleration only → gravity direction (tilt/lean) + shake magnitude. **No gyroscope.** |
| **PixelBlaze V3 Pico** (built-in IMU) | `sixAxis` | `[x, y, z, gx, gy, gz]` (6) | `[0,1,2]` = orientation/accel (gravity), **`[3,4,5]` = angular velocity (gyro)** → real turn/spin sensing. |

`accelerometer` is documented in the official language reference; **`sixAxis` is
community-documented (kwitter), not yet in the official docs** — treat its exact
behavior as verified-by-forum, not verified-by-vendor, and tell the user to
confirm the live values in the **Var Watcher** before trusting signs/scales.

**Default to supporting both in one pattern and auto-detecting** (see "One
pattern, both sensors" below). A pattern that reads only `accelerometer` sits dead
on a bare Pico, and one that reads only `sixAxis` sits dead on an expansion-board
rig — because the other variable is never populated. Declaring and reading both is
cheap and makes the pattern portable, so do that unless the user explicitly wants
to target a single board.

## Scope discipline (read before writing)

Motion reactivity tempts over-engineering — full 3D rotation matrices, Kalman-ish
filters, gesture classifiers. Default to the **smallest model that satisfies the
ask:**

- "Light up the low side / show which way is down / a bubble level" → normalized
  gravity vector, used directly. ~15 lines. No trig.
- "Tilt changes the color / position / which half glows" → gravity vector → one or
  two **tilt angles** (`atan2`). ~30 lines.
- "Sloshing liquid / fluid that flows to the bottom of a 3D volume" → Roger's
  azimuth+polar rotation of the map. This is the heavy one — port it, don't
  reinvent it.
- "React to motion / shake / dance energy" → **magnitude** of the vector
  (`sqrt(x²+y²+z²)`); at rest it's ~1g, movement pushes it above 1.
- "Detect turning / spinning" → **only possible on the Pico** via `sixAxis[3..5]`
  (angular velocity). The expansion board cannot sense rotation in place.

## Sensor inputs (verified)

Declared with `export var`, with a safe default so indexing never hits undefined:

```js
export var accelerometer = array(3)   // expansion board: [x, y, z] in g, ~±16
export var sixAxis = array(6)          // Pico: [x,y,z, gx,gy,gz]; gyro = angular velocity
export var light = -1                  // doubles as a board-present probe (see below)
```

At rest the accelerometer reports the **1g pull of gravity**, not zero: the
down-pointing axis reads ≈ ±1 and the other two ≈ 0. Movement adds to that. With
no board attached the array stays all-zeros (magnitude 0), which is how you tell
"no board / freefall" apart from "at rest" (magnitude ≈ 1).

## One pattern, both sensors — the default approach

The two sensors are independent globals, and the one your hardware lacks stays at
its zero default. So **declare both, then pick whichever is reporting** via a
magnitude test — at rest *either* live sensor reads ~1g of gravity (magnitude
well above 0). Prefer `sixAxis` when it's live, because it's a superset: you also
get the gyro. When neither reports, drive the look from `time()` so a bare strip
still animates and stays tunable (same philosophy as the sound simulator).

This single read is the spine of both companion examples. Call it once at the top
of `beforeRender`, then run *one* downstream pipeline (smoothing, gravity
normalization, tilt) regardless of source.

**Latch the source — don't re-decide every frame.** This is the one place the
motion read deliberately differs from the sound playbook (which re-tests
`light == -1` fresh each frame). An accelerometer's magnitude legitimately dips
toward 0 in freefall or between hard shakes, so a per-frame test would flip to the
`time()` simulator for a frame and **visibly glitch**. Instead, latch onto the
first sensor that reports and hold it, releasing only after it reads ~0 for a run
of frames (a real hot-swap, not noise):

```js
export var accelerometer = array(3)   // expansion board: [x,y,z], accel only
export var sixAxis = array(6)          // Pico built-in: [x,y,z, gx,gy,gz]

// Axis signs are PER SENSOR — different chips, mounted differently. Set from the
// Var Watcher on the board you use; a wrong sign moves things the wrong way.
var boardSignX = 1, boardSignY = 1, boardSignZ = 1   // expansion board
var picoSignX  = 1, picoSignY  = 1, picoSignZ  = 1   // Pico (kwitter negated X & Z on his hat)

var mAx = 0, mAy = 0, mAz = 0   // live gravity/accel axes from whichever sensor
var mSpin = 0                    // gyro magnitude (0 on the expansion board)
export var motionSource = 0      // 0 none/sim, 1 Pico sixAxis, 2 expansion board

var lockedSource = 0, lostFrames = 0
var LOST_LIMIT = 30              // frames the held sensor must read ~0 before release

function readMotion() {
  var sm = sqrt(sixAxis[0]*sixAxis[0] + sixAxis[1]*sixAxis[1] + sixAxis[2]*sixAxis[2])
  var am = sqrt(accelerometer[0]*accelerometer[0] + accelerometer[1]*accelerometer[1] + accelerometer[2]*accelerometer[2])
  var presentNow = (sm > 0.1) ? 1 : ((am > 0.1) ? 2 : 0)

  if (lockedSource == 0) {
    lockedSource = presentNow; lostFrames = 0
  } else {
    var lockedMag = (lockedSource == 1) ? sm : am
    if (lockedMag > 0.1) lostFrames = 0
    else { lostFrames = lostFrames + 1; if (lostFrames >= LOST_LIMIT) { lockedSource = presentNow; lostFrames = 0 } }
  }
  motionSource = lockedSource

  if (lockedSource == 1) {        // Pico (superset: adds the gyro)
    mAx = sixAxis[0]*picoSignX; mAy = sixAxis[1]*picoSignY; mAz = sixAxis[2]*picoSignZ
    mSpin = sqrt(sixAxis[3]*sixAxis[3] + sixAxis[4]*sixAxis[4] + sixAxis[5]*sixAxis[5])
  } else if (lockedSource == 2) { // expansion board (no gyro)
    mAx = accelerometer[0]*boardSignX; mAy = accelerometer[1]*boardSignY; mAz = accelerometer[2]*boardSignZ
    mSpin = 0
  } else {
    mSpin = 0                      // caller fakes mAx/mAy/mAz from time()
  }
}
```

Everything downstream reads `mAx/mAy/mAz` and `mSpin`, never the raw sensor arrays
— so the pattern is identical on either board. **Gate any gyro-only effect on
`motionSource == 1`, or design it to degrade to nothing when `mSpin` is 0** (the
examples do the latter: spin agitation simply vanishes on the expansion board).
Export `motionSource` so the Var Watcher shows which sensor won.

> **TEST BEFORE FIRST USE — none of this is hardware-validated.** Put these checks
> in the pattern's header comment and run them on the real device:
> 1. **Coexistence:** confirm `accelerometer` and `sixAxis` can both be declared in
>    one pattern and that the right one populates (watch `motionSource`).
> 2. **Units/scale:** the code assumes `sixAxis[0..2]` reports gravity in the same
>    ~1g scale as the LIS3DH `accelerometer`. **This is not vendor-confirmed**
>    (`sixAxis` is community-documented). The detection threshold (`0.1`), the shake
>    term `abs(mag-1)`, and the gyro scale **all depend on it** — read live values
>    on a Pico and adjust the threshold/scale if they differ. Tilt *direction*
>    survives a scale mismatch (it's normalized); shake/spin *magnitude* does not.
> 3. **Axis signs:** per-sensor (`boardSign*` / `picoSign*`), mounting-specific.
>    Set each from the Var Watcher.

## Building block 1 — snapshot once, then smooth (Roger Cheng, kwitter)

Two non-negotiables every motion pattern needs in `beforeRender`:

**Snapshot once per frame.** Call `readMotion()` (above) at the top of
`beforeRender` to latch the live sensor into `mAx/mAy/mAz` + `mSpin`, then do all
math on those — so a mid-frame sensor update can't change a value between
calculations (Roger's `a = accelerometer` idiom, generalized to either board).
**Never read `accelerometer[i]` / `sixAxis[i]` repeatedly across a frame.**

**Low-pass filter the raw reading** — the accelerometer is jittery and every move
adds noise on top of gravity. Two equivalent idioms; pick one:

```js
// kwitter's IIR low-pass: filtered moves a fraction of the way to raw each frame.
// filterStrength ~0.05 (very smooth, laggy) .. 0.2 (snappy). Cheap and intuitive.
filteredX = filteredX + filterStrength * (rawX - filteredX)
```

```js
// Roger's damped average (same effect, expressed as a blend weight):
// damping 0 = instant, 0.95 = very smooth. halfvect persists between frames.
halfvect[i] = (1 - damping) * unit + damping * prevvect[i]
```

**Delta-normalize the filter if frame rate varies a lot.** A fixed
`filterStrength` smooths more per-second on a fast controller. For frame-rate
independence scale it: `k = 1 - pow(1 - filterStrength, delta/16.6)` (≈ tuned at
60 fps), then `filtered += k * (raw - filtered)`. For most wearables the plain
form is fine — note it and move on.

## Building block 2 — gravity direction → tilt (the common case)

At rest the (smoothed) vector points along gravity. Normalize it to a unit vector,
and you have "which way is down" independent of how hard the device is moving:

```js
len = sqrt(fx*fx + fy*fy + fz*fz)
len = max(len, 0.0001)                 // never divide by zero
nx = fx/len; ny = fy/len; nz = fz/len  // unit gravity vector, each in -1..1
```

For most patterns you don't need full rotation math — map the unit components
straight onto your look:

- **Bubble level / "low side glows":** the axis with the largest normalized
  component is "down." Brighten pixels on that side: `paint(pos, clamp(ny,0,1))`.
- **Tilt → hue or position shift:** feed a normalized axis into a palette read or
  an offset: `paintPos = (basePos + nx * 0.5) % 1`.
- **Two tilt angles** (pitch/roll) when you want smooth rotation of the look:

```js
roll  = atan2(nx, nz)                  // -PI..PI, rotation about the strip's long axis
pitch = atan2(ny, nz)
// convert an angle to a 0..1 phase for time()-style use: phase = roll/PI2 + 0.5
```

**Exaggerate for wearables.** wizard and Roger both note that clothing has a small
range of motion vs. a handheld object — multiply the tilt term and clamp it so
small leans produce big visual change: `clamp(pitch * gain, -PI, PI)`.

### Full 3D "sloshing liquid" (Roger's GlowFlow model — heavy, port don't reinvent)

When the user wants liquid that flows to the bottom of a **3D-mapped** volume,
Roger rotates every mapped pixel by the gravity vector's azimuth (about Z) and
polar (about Y) angles, then colors by the transformed Z (height relative to the
"surface"). The math: `azimuthAngle(x,y)` = `atan2`-style longitude on the XY
plane; `polarAngle(x,y,z)` = tilt from +Z. Precompute both rotation matrices
**once per frame in `beforeRender`** (never per pixel), apply them in `render3D`,
color by transformed height. See `examples/3d-motion-gravity-liquid.js` for the
full, verified implementation with the matrices flattened into reused arrays.

## Building block 3 — motion / shake magnitude

The vector's **length** is ~1 (one g) at rest and rises with movement. Subtract
the resting 1g to get "how hard is it moving right now," then smooth and use it as
an energy term (brighten, speed up, spawn ripples):

```js
mag = sqrt(ax*ax + ay*ay + az*az)
shake = abs(mag - 1)                   // 0 at rest, grows with motion
energy = energy + 0.15 * (shake - energy)   // smooth it (IIR), then decay-and-use
```

Keep the reaction a **pulse with a brightness floor**, not a strobe (house style):
add energy on motion and let it decay (delta-normalized), don't flash on/off.

**What the accelerometer cannot do:** detect spinning in place. Rotation about an
axis through the sensor produces almost no linear acceleration (wizard). Mounting
the sensor at arm's length helps (centripetal force shows up), but for real
turn/spin sensing you need the **Pico's gyro** (next block).

## Building block 4 — the Pico's gyro: real rotation (sixAxis[3..5])

`sixAxis[3]`, `[4]`, `[5]` are **angular velocity** about x/y/z — nonzero only
while the device is actively rotating, and they return to ~0 the instant it stops
(unlike the accelerometer, which always reads gravity). This is exactly the
"react to turning/spinning while dancing" capability the accelerometer can't give
you. Treat each like a signed rate, smooth it, and use magnitude or sign:

```js
spin = sqrt(sixAxis[3]*sixAxis[3] + sixAxis[4]*sixAxis[4] + sixAxis[5]*sixAxis[5])
spin = spinFiltered + 0.2 * (spin - spinFiltered)   // smooth (jittery raw)
// use spin as an energy term; use sign of an axis for direction (CW vs CCW)
```

Confirm the resting values and signs in the Var Watcher first — `sixAxis` is
community-documented and orientation depends on how the Pico is mounted.

## Building block 5 — calibration (kwitter): the step people skip

Sensors are never mounted in a clean orientation, and "at rest" is rarely all-
zero. kwitter's workflow, worth giving the user verbatim for any real install:

1. **Find resting offsets.** Temporarily `export var filteredX/Y/Z`, place the
   device in its intended resting orientation, read the steady values from the Var
   Watcher, and store them as `restingX/Y/Z`. Subtract them so "at rest" reads 0.
2. **Fix axis signs.** If an axis moves opposite to what you expect, negate it at
   the source (`a[0] = -a[0]`). Roger found the expansion board's X is mounted
   reversed relative to the LIS3DH datasheet; mounting determines this, so verify
   per project.
3. **Set per-axis sensitivity.** Expose sliders; multiply each axis. Start at
   neutral, raise if the axis barely reacts, lower if it instantly pegs to the
   edge. `clamp` the result to the range your visuals expect.

```js
tiltX = clamp((filteredX - restingX) * sensitivityX, -1, 1)
```

## Motion-specific gotchas (also see `reference/gotchas.md`)

- **Wrong variable = dead pattern.** `accelerometer` (expansion board) and
  `sixAxis` (Pico) are different variables; the one your hardware lacks is never
  populated. **Default to `readMotion()` — read both and auto-detect** — so the
  pattern is portable; only hard-code one sensor if the user asks.
- **At rest ≠ zero.** The accelerometer reads 1g of gravity at rest. "No motion"
  is magnitude ≈ 1, not 0; magnitude ≈ 0 means **no board** (or freefall).
- **Always smooth.** Raw readings jitter; an IIR low-pass (`f += k*(raw-f)`) or a
  damped average is mandatory or the LEDs buzz.
- **Snapshot once, compute in `beforeRender`.** Read the array into locals once per
  frame; do all vector/trig math in `beforeRender`, never per pixel in `render*`.
  Precompute any rotation matrices once per frame — never inside `render*`.
- **No per-frame allocation.** Allocate filter state, `unit`/`half` vectors, and
  matrix arrays once in global scope (e.g. `var half = array(3)`), reuse them.
- **Guard the divide.** Normalizing by vector length needs `len = max(len, 1e-4)`.
- **Watch fixed-point range (±32768).** `pow(x,2)` on a ~16G reading is fine, but
  don't sum many large squares unscaled. Prefer `x*x` over `pow(x,2)` for speed.
- **The accelerometer can't sense spin-in-place** — only tilt and linear motion.
  Use the Pico's `sixAxis[3..5]` gyro for true rotation, or mount the sensor off-
  axis so centripetal force registers.
- **Don't strobe.** Motion reactions pulse-and-decay with a brightness floor, per
  the house style (`reference/artistry.md`) — not flash fully on/off.
- **Calibrate per install.** Resting offset, axis signs, and sensitivity are
  mounting-specific; expose them and confirm live in the Var Watcher.
- **Latch the source; don't re-decide per frame.** Re-selecting the sensor each
  frame glitches to the simulator on any transient sub-threshold reading. Hold the
  first sensor seen and release only after a run of ~0 frames (see `readMotion`).
- **1D strips express only one gravity axis.** A `render(index)` fallback maps to a
  single axis (the examples use Y/X), so tilt in the other axes won't show on a bare
  strip. State this rather than letting it look broken.
- **Fill / "liquid" patterns are a power risk.** A half-to-full lit volume is many
  pixels on at once; keep the brightest band a saturated color (not white), cap the
  per-pixel value (e.g. `v = min(v, 0.8)`), and size brightness per
  `reference/power-safety.md`. The gravity-liquid example does all three.
- **Dot-product fill ≠ full rotation.** The simplified `dot(pos, gravity)` height
  model assumes a roughly centered, normalized (0..1) map; on irregular or
  off-center 3D maps it can look skewed — use Roger's matrix model there.
