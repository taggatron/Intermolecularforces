/*
  Water molecules simulation with intermolecular attraction overlay
  - Canvas: draws molecules (O red + 2 H white) moving with temperature-dependent speed
  - SVG overlay: dotted green lines between molecules within a cutoff (IMF)
  - Temperature slider: -273°C to 500°C
  - Phase indicator: Ice (≤0°C), Liquid (0–100°C), Gas (≥100°C), 1 atm assumption
  - Phase-change buttons: Freeze, Melt, Boil, Condense (animate temperature)
*/

;(function () {
  const canvas = document.getElementById('simCanvas')
  const ctx = canvas.getContext('2d')
  const svg = document.getElementById('imfOverlay')
  const container = document.getElementById('simContainer')
  const tempRange = document.getElementById('tempRange')
  const tempCLabel = document.getElementById('tempCLabel')
  const tempKLabel = document.getElementById('tempKLabel')
  const phaseIndicator = document.getElementById('phaseIndicator')
  const phaseOverlay = document.getElementById('phaseLabel')
  const freezeBtn = document.getElementById('freezeBtn')
  const meltBtn = document.getElementById('meltBtn')
  const boilBtn = document.getElementById('boilBtn')
  const condenseBtn = document.getElementById('condenseBtn')
  const toggleBondsEl = document.getElementById('toggleBonds')
  const avgBondDurationEl = document.getElementById('avgBondDuration')
  const activeBondsEl = document.getElementById('activeBonds')

  // Logical sim space matches canvas intrinsic size; CSS scales it responsively
  let W = canvas.width
  let H = canvas.height

  // Molecule and physics settings
  const NUM_MOLECULES = 80
  const O_RADIUS = 10
  const H_RADIUS = 6
  const OH_BOND = 18 // distance from O to each H (visual only)
  const HOH_ANGLE = (104.5 * Math.PI) / 180 // ~104.5 degrees
  const WALL_RESTITUTION = 0.95
  const BASE_SPEED = 40 // px/s at ~0°C above absolute zero baseline
  const IMF_CUTOFF = 80 // px, draw dotted lines when centers within this distance
  const IMF_ATTRACT_STRENGTH = 0.06 // base acceleration scale (tuned)
  const REPULSION_DIST = O_RADIUS * 2
  const REPULSION_STRENGTH = 0.4

  // Gravity and floor behavior
  const G_ACCEL_BASE = 250 // base px/s^2 downward
  const G_TERM_BASE = 220 // base terminal speed
  const FLOOR_FRICTION_BASE = 4.0 // base per-second friction when on floor
  // Solid-state vibration tweak
  const VIB_AMP = 40 // px/s random vibration amplitude in solid/freezing
  const VIB_ANG = 1.0 // rad/s small angular jitter in solid/freezing

  // Lattice packing (activated in solid): hexagonal grid
  let lattice = [] // array of anchor points {x,y}
  const LATTICE_SPACING_LIQUID = 34
  const LATTICE_SPACING_SOLID = 56 // slightly larger spacing for ice-like lower density
  const LATTICE_SPRING = 0.8 // spring strength toward anchor when solid
  const LATTICE_DAMP = 0.85
  const SOLID_THRESHOLD = 0 // deg C

  // Freeze sequence state
  let freezeTimerMs = 0 // counts down when freezing from gas
  let freezeBoost = 0 // 0..1, drives extra gravity + damping during freeze
  let moveDamp = 1 // scales translational speed during special states
  let assignedAnchors = null // array of anchor points mapped 1:1 to molecules

  // Temperature model: use Kelvin for speed scaling: v ~ sqrt(Tk)
  function cToK(c) { return c + 273.15 }
  function speedMultiplier(c) {
    const Tk = Math.max(0, cToK(c)) // 0 at absolute zero
    // baseline sqrt scaling with a mild high-T boost factor to ensure agility near boiling
    const base = Math.sqrt(Tk / 273.15)
    const hotBoost = 1 + 0.35 * Math.min(1, Math.max(0, (c - 40) / 100)) // up to +35% boost by ~140°C
    return base * hotBoost
  }

  // Phase estimation (1 atm):
  function getPhase(c) {
    if (c <= 0) return 'Solid (Ice)'
    if (c >= 100) return 'Gas (Steam)'
    return 'Liquid (Water)'
  }

  // Molecule container
  const molecules = []
  // Bond tracking: map of key "i-j" to {start: seconds}
  const bonds = new Map()
  // Rolling average of bond durations (seconds)
  let bondDurations = []
  const MAX_BOND_SAMPLES = 1000

  function rand(min, max) { return Math.random() * (max - min) + min }

  function createMolecule() {
    const x = rand(30, W - 30)
    const y = rand(30, H - 30)
    const angle = rand(0, Math.PI * 2)
    const v = rand(0.4, 1.2)
    const vx = Math.cos(angle) * v
    const vy = Math.sin(angle) * v
    return { x, y, vx, vy, angle: rand(0, Math.PI * 2), spin: rand(-1, 1) * 0.5, gvy: 0 }
  }

  function initMolecules() {
    molecules.length = 0
    for (let i = 0; i < NUM_MOLECULES; i++) molecules.push(createMolecule())
  }

  // Drawing utilities
  function drawMolecule(m) {
    // Oxygen at (x,y), Hydrogens at fixed angle relative to m.angle
    const a = m.angle
    const a1 = a - HOH_ANGLE / 2
    const a2 = a + HOH_ANGLE / 2
    const h1x = m.x + Math.cos(a1) * OH_BOND
    const h1y = m.y + Math.sin(a1) * OH_BOND
    const h2x = m.x + Math.cos(a2) * OH_BOND
    const h2y = m.y + Math.sin(a2) * OH_BOND

    if (bondsVisible) {
      // Bonds (optional, subtle)
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(m.x, m.y)
      ctx.lineTo(h1x, h1y)
      ctx.moveTo(m.x, m.y)
      ctx.lineTo(h2x, h2y)
      ctx.stroke()
    }

    // Oxygen
    ctx.fillStyle = '#d84d4d'
    ctx.beginPath()
    ctx.arc(m.x, m.y, O_RADIUS, 0, Math.PI * 2)
    ctx.fill()

    // Hydrogens
    ctx.fillStyle = '#f2f2f2'
    ctx.beginPath(); ctx.arc(h1x, h1y, H_RADIUS, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(h2x, h2y, H_RADIUS, 0, Math.PI * 2); ctx.fill()
  }

  function clear() {
    ctx.clearRect(0, 0, W, H)
    // Clear SVG overlay
    while (svg.firstChild) svg.removeChild(svg.firstChild)
  }

  function update(dt, tempC) {
    const mult = speedMultiplier(tempC)
    // Movement damping: reduced during freeze and in solid
  const solidMotionDamp = tempC <= SOLID_THRESHOLD ? 0.15 : 1
    moveDamp = Math.min(solidMotionDamp, 1)
    const speedScale = BASE_SPEED * mult * Math.min(1, moveDamp + (1 - freezeBoost) * 0.65)
    let rotScale = 0.8 * mult * (1 - 0.6 * freezeBoost)
    if (tempC <= SOLID_THRESHOLD) rotScale *= 0.25

  // Temperature-dependent gravity/ground factors: lighten as temperature rises
    const hotFactor = Math.min(1, Math.max(0, (tempC - 0) / 90)) // full loosening at ~90°C
    let gAccel = G_ACCEL_BASE * (1 - 0.95 * hotFactor) // reduce up to 95%
    let gTerm = G_TERM_BASE * (1 - 0.9 * hotFactor) + 20 * hotFactor // very weak terminal pull
    let floorFriction = Math.max(0.05, FLOOR_FRICTION_BASE * (1 - 0.95 * hotFactor)) // reduce up to 95%
    // During active freeze, temporarily strengthen gravity to ensure descent from gas
    if (freezeBoost > 0) {
      gAccel += G_ACCEL_BASE * 0.9 * freezeBoost
      gTerm += 140 * freezeBoost
      // increase floor friction when landing to help settle into lattice
      floorFriction += 2.0 * freezeBoost
    }

  for (const m of molecules) {
      // Thermal motion (scaled by temperature)
      m.x += m.vx * speedScale * dt
      m.y += m.vy * speedScale * dt

      // Gravity component (independent of temperature scaling)
  m.gvy = Math.min(gTerm, m.gvy + gAccel * dt)
      m.y += m.gvy * dt

      // Rotational drift
      m.angle += m.spin * rotScale * dt

      // Wall collisions
      const margin = 18
      if (m.x < margin) { m.x = margin; m.vx = Math.abs(m.vx) * WALL_RESTITUTION }
      if (m.x > W - margin) { m.x = W - margin; m.vx = -Math.abs(m.vx) * WALL_RESTITUTION }
      if (m.y < margin) { m.y = margin; m.vy = Math.abs(m.vy) * WALL_RESTITUTION; m.gvy = 0 }
      if (m.y > H - margin) {
        m.y = H - margin
        m.vy = -Math.abs(m.vy) * WALL_RESTITUTION
        m.gvy = 0 // absorb gravitational fall at the floor
        // Floor friction: reduce horizontal motion while on the ground
        const fr = Math.max(0, 1 - floorFriction * dt)
        m.vx *= fr
      }
    }

    // Interactions: repulsion (short-range) + attraction (mid-range), both temp-scaled
    const Tk = Math.max(0, cToK(tempC))
    const coolFactor = 1 - Math.min(1, Tk / 600) // stronger attraction when cooler; fades as temp rises
    for (let i = 0; i < molecules.length; i++) {
      for (let j = i + 1; j < molecules.length; j++) {
        const a = molecules[i], b = molecules[j]
        let dx = b.x - a.x, dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 === 0) continue
        const d = Math.sqrt(d2)
        const nx = dx / d, ny = dy / d

        // Short-range repulsion to prevent overlap
        const repDist = (tempC <= SOLID_THRESHOLD) ? O_RADIUS * 3.2 : REPULSION_DIST
        if (d < repDist) {
          const overlap = repDist - d
          const push = REPULSION_STRENGTH * overlap
          a.x -= nx * push * 0.5; a.y -= ny * push * 0.5
          b.x += nx * push * 0.5; b.y += ny * push * 0.5
        }

        // Mid-range attraction within IMF cutoff, scaled by coolness
        const inBond = d < IMF_CUTOFF
        if (inBond) {
          const strength = IMF_ATTRACT_STRENGTH * coolFactor * (1 - d / IMF_CUTOFF)
          // convert to velocity-like change per frame using dt and base scale
          const dv = strength * dt * 60 // approximate to frame-rate for feel
          a.vx += nx * dv; a.vy += ny * dv
          b.vx -= nx * dv; b.vy -= ny * dv

          // Track bond start
          const key = `${i}-${j}`
          if (!bonds.has(key)) {
            bonds.set(key, { start: performance.now() / 1000 })
          }
        } else {
          // If a bond existed and just broke, record duration
          const key = `${i}-${j}`
          const info = bonds.get(key)
          if (info) {
            const now = performance.now() / 1000
            const dur = Math.max(0, now - info.start)
            bonds.delete(key)
            bondDurations.push(dur)
            if (bondDurations.length > MAX_BOND_SAMPLES) bondDurations.shift()
          }
        }
      }
    }

  // Solid lattice packing: pull molecules toward nearest anchor when solid
    if ((tempC <= SOLID_THRESHOLD || freezeBoost > 0) && lattice.length) {
      // ramp strength as it gets colder
      const ramp = Math.min(1, (SOLID_THRESHOLD - tempC) / 50 + freezeBoost)
      for (let idx = 0; idx < molecules.length; idx++) {
        const m = molecules[idx]
        // prefer assigned lattice anchor for more regular crystal
        const target = (assignedAnchors && assignedAnchors[idx]) || nearestAnchor(m)
        if (target) {
          const dx = target.x - m.x, dy = target.y - m.y
          m.vx += dx * (LATTICE_SPRING * ramp) * dt
          m.vy += dy * (LATTICE_SPRING * ramp) * dt
          m.vx *= (1 - (1 - LATTICE_DAMP) * ramp)
          m.vy *= (1 - (1 - LATTICE_DAMP) * ramp)
          // counter gravity a little to form lattice layers instead of a heap
          m.gvy *= (1 - 0.5 * ramp)

          // Orient molecule so one H aims toward neighbor along row to form O–H–O chains
          if (typeof target.theta === 'number') {
            const desired = target.theta
            const da = angleDelta(m.angle, desired)
            const ORIENT_SPRING = 4.0
            m.angle += da * ORIENT_SPRING * ramp * dt
            m.spin *= (1 - 0.8 * ramp * dt)
          }

          // Extra damping when close to anchor to reduce movement further
          const dist = Math.hypot(dx, dy)
          if (dist < 10) {
            m.vx *= 0.9; m.vy *= 0.9
          }
        }
      }
      // Add gentle lattice vibration
      for (const m of molecules) {
        m.vx += (Math.random() - 0.5) * VIB_AMP * dt
        m.vy += (Math.random() - 0.5) * VIB_AMP * dt
        m.angle += (Math.random() - 0.5) * VIB_ANG * dt
      }
    }
    // In solid/freezing: run a few quick relaxation passes to remove any remaining overlaps
    if ((tempC <= SOLID_THRESHOLD || freezeBoost > 0) && molecules.length) {
  const minDist = O_RADIUS * 3.2
      for (let it = 0; it < 3; it++) {
        for (let i = 0; i < molecules.length; i++) {
          for (let j = i + 1; j < molecules.length; j++) {
            const a = molecules[i], b = molecules[j]
            let dx = b.x - a.x, dy = b.y - a.y
            let d2 = dx * dx + dy * dy
            if (d2 === 0) { dx = (Math.random() - 0.5) * 1e-3; dy = (Math.random() - 0.5) * 1e-3; d2 = dx*dx + dy*dy }
            const d = Math.sqrt(d2)
            if (d < minDist) {
              const nx = dx / d, ny = dy / d
              const corr = (minDist - d) * 0.5
              a.x -= nx * corr; a.y -= ny * corr
              b.x += nx * corr; b.y += ny * corr
              // light velocity damping to help settle
              a.vx *= 0.95; a.vy *= 0.95
              b.vx *= 0.95; b.vy *= 0.95
            }
          }
        }
      }
    }
    // Decay freeze boost over time
    if (freezeTimerMs > 0) {
      freezeTimerMs = Math.max(0, freezeTimerMs - dt * 1000)
      freezeBoost = freezeTimerMs / 2500
    } else {
      freezeBoost = 0
    }
    // Update metrics UI
    if (avgBondDurationEl && activeBondsEl) {
      const active = bonds.size
      const avg = bondDurations.length ? (bondDurations.reduce((a,b)=>a+b,0) / bondDurations.length) : 0
      activeBondsEl.textContent = String(active)
      avgBondDurationEl.textContent = avg.toFixed(2)
    }
  }

  function drawIMFLines() {
    // Draw green dotted lines between molecules within cutoff distance
    for (let i = 0; i < molecules.length; i++) {
      for (let j = i + 1; j < molecules.length; j++) {
        const a = molecules[i], b = molecules[j]
        const dx = b.x - a.x, dy = b.y - a.y
        const d2 = dx * dx + dy * dy
        if (d2 <= IMF_CUTOFF * IMF_CUTOFF) {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
          line.setAttribute('x1', a.x.toFixed(1))
          line.setAttribute('y1', a.y.toFixed(1))
          line.setAttribute('x2', b.x.toFixed(1))
          line.setAttribute('y2', b.y.toFixed(1))
          line.setAttribute('stroke', '#1db954')
          line.setAttribute('stroke-width', '2')
          line.setAttribute('stroke-dasharray', '6 6')
          line.setAttribute('opacity', '0.9')
          svg.appendChild(line)
        }
      }
    }
  }

  // Resize handler: keep canvas internal resolution synced to CSS box
  function resize() {
    const rect = container.getBoundingClientRect()
    canvas.width = Math.floor(rect.width)
    canvas.height = Math.floor(rect.height)
    svg.setAttribute('width', String(canvas.width))
    svg.setAttribute('height', String(canvas.height))
    W = canvas.width; H = canvas.height
    buildLattice()
  }

  window.addEventListener('resize', resize)
  resize()
  initMolecules()

  // Temperature/phase UI
  function setTemperature(c) {
    const cNum = Math.max(-273.15, Math.min(500, Number(c)))
    tempRange.value = String(cNum)
    tempCLabel.textContent = cNum.toFixed(1)
    tempKLabel.textContent = cToK(cNum).toFixed(2)
    const phase = getPhase(cNum)
    phaseIndicator.textContent = phase.replace(/\s*\(.+\)/, '')
    phaseIndicator.dataset.phase = phase
    phaseOverlay.textContent = phase
    phaseOverlay.hidden = false

    // Rebuild lattice and (re)assign anchors when entering solid; clear when leaving
    if (cNum <= SOLID_THRESHOLD || freezeBoost > 0) {
      buildLattice()
      assignedAnchors = assignAnchorsGreedy(molecules, lattice)
    } else {
      assignedAnchors = null
    }
  }

  tempRange.addEventListener('input', () => setTemperature(Number(tempRange.value)))
  setTemperature(Number(tempRange.value))

  // Phase change buttons tween temperature
  function tweenTemperature(targetC, durationMs = 1200) {
    const startC = Number(tempRange.value)
    const start = performance.now()
    function step(t) {
      const p = Math.min(1, (t - start) / durationMs)
      const ease = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p // easeInOutQuad
      const c = startC + (targetC - startC) * ease
      setTemperature(c)
      if (p < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  function onFreezeClicked() {
    const currentC = Number(tempRange.value)
    // If starting from gas, kick off a freeze sequence: stronger gravity and damping
    if (currentC >= 100) {
      freezeTimerMs = 2500
      freezeBoost = 1
      // Initial descent impulse and damping
      for (const m of molecules) {
        m.gvy += 200 + Math.random() * 120
        m.vx *= 0.5
        m.vy *= 0.35
        m.spin *= 0.3
      }
      // Build or refresh lattice and assign anchors for a regular crystal
      buildLattice()
      assignedAnchors = assignAnchorsGreedy(molecules, lattice)
    }
    // Always tween temperature down to below freezing
    tweenTemperature(-10)
  }
  freezeBtn.addEventListener('click', onFreezeClicked)
  meltBtn.addEventListener('click', () => tweenTemperature(20))
  boilBtn.addEventListener('click', () => tweenTemperature(110))
  condenseBtn.addEventListener('click', () => tweenTemperature(80))

  // Optional little sparkle effect on big phase transitions
  function sparkle(x, y) {
    const s = document.createElement('div')
    s.className = 'sparkle'
    s.style.left = `${x}px`
    s.style.top = `${y}px`
    container.appendChild(s)
    setTimeout(() => container.removeChild(s), 600)
  }
  ;[freezeBtn, meltBtn, boilBtn, condenseBtn].forEach(btn =>
    btn.addEventListener('click', () => sparkle(rand(20, W - 20), rand(20, H - 20)))
  )

  // Bonds toggle
  let bondsVisible = true
  if (toggleBondsEl) {
    bondsVisible = toggleBondsEl.checked
    toggleBondsEl.addEventListener('change', () => {
      bondsVisible = toggleBondsEl.checked
    })
  }

  // Build hexagonal lattice anchors to match container size
  function buildLattice() {
    lattice = []
    // Use larger spacing for solid to create more open hexagonal structure
    const currentC = Number(tempRange.value)
    const s = (currentC <= SOLID_THRESHOLD || freezeBoost > 0) ? LATTICE_SPACING_SOLID : LATTICE_SPACING_LIQUID
    const rows = Math.floor(H / (s * Math.sqrt(3) / 2)) + 2
    const cols = Math.floor(W / s) + 2
    const dy = s * Math.sqrt(3) / 2
    for (let r = 0; r < rows; r++) {
      const y = 10 + r * dy
      const offset = (r % 2) * (s / 2)
      for (let c = 0; c < cols; c++) {
        const x = 10 + offset + c * s
        // Desired orientation: alternate rows so one H points horizontally toward neighbor
        const theta = (r % 2 === 0) ? (HOH_ANGLE / 2) : (Math.PI - HOH_ANGLE / 2)
        lattice.push({ x, y, row: r, col: c, theta })
      }
    }
  }

  // Smallest signed angle difference a->b in [-pi, pi]
  function angleDelta(a, b) {
    let d = (b - a + Math.PI) % (Math.PI * 2)
    if (d < 0) d += Math.PI * 2
    return d - Math.PI
  }

  // Helper: nearest anchor for fallback
  function nearestAnchor(m) {
    let best = null, bestD2 = Infinity
    for (const p of lattice) {
      const dx = p.x - m.x, dy = p.y - m.y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) { bestD2 = d2; best = p }
    }
    return best
  }

  // Assign unique anchors to molecules using a greedy nearest strategy
  function assignAnchorsGreedy(ms, anchors) {
    const assigned = new Array(ms.length)
    const taken = new Array(anchors.length).fill(false)
    for (let i = 0; i < ms.length; i++) {
      let bestIdx = -1, bestD2 = Infinity
      for (let j = 0; j < anchors.length; j++) {
        if (taken[j]) continue
        const dx = anchors[j].x - ms[i].x, dy = anchors[j].y - ms[i].y
        const d2 = dx * dx + dy * dy
        if (d2 < bestD2) { bestD2 = d2; bestIdx = j }
      }
      if (bestIdx >= 0) {
        assigned[i] = { x: anchors[bestIdx].x, y: anchors[bestIdx].y }
        taken[bestIdx] = true
      } else {
        assigned[i] = nearestAnchor(ms[i])
      }
    }
    return assigned
  }

  // Kinetic energy mini chart
  // (KE mini chart removed)

  // Main loop
  let last = performance.now()
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const tempC = Number(tempRange.value)
    clear()
    update(dt, tempC)
    drawIMFLines()
    for (const m of molecules) drawMolecule(m)
    // (KE mini chart removed)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
})()
