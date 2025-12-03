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
  const saltBtn = document.getElementById('saltBtn')
  const toggleBondsEl = document.getElementById('toggleBonds')
  const avgBondDurationEl = document.getElementById('avgBondDuration')
  const activeBondsEl = document.getElementById('activeBonds')
  const metricsEl = document.querySelector('.metrics')

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

  // Salt state (simplified: on/off). In reality, dissolved salt lowers freezing point
  // and raises boiling point; we model that qualitatively.
  let saltOn = false

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

  // --- Temperature color mapping for slider + metrics accent ---
  function clamp01(x) { return Math.max(0, Math.min(1, x)) }
  function lerp(a, b, t) { return a + (b - a) * t }
  function hsl(h, s, l) { return `hsl(${h}, ${s}%, ${l}%)` }
  function tempToColor(tempC) {
    const minC = -273.15
    const stops = [
      { t: minC, h: 260, s: 85, l: 60, glow: 'rgba(166,75,244,0.85)' }, // 0 K -> purple glow
      { t: 0,    h: 200, s: 90, l: 62, glow: 'rgba(120,180,255,0.4)' },  // <0 °C light blue
      { t: 25,   h: 140, s: 75, l: 45, glow: 'rgba(80,230,120,0.35)' },  // ~25 °C green
      { t: 100,  h: 30,  s: 90, l: 50, glow: 'rgba(255,170,70,0.45)' },  // ~100 °C orange
      { t: 500,  h: 0,   s: 95, l: 55, glow: 'rgba(255,60,60,0.6)' }     // 500 °C red
    ]
    if (tempC <= stops[0].t) return { color: hsl(stops[0].h, stops[0].s, stops[0].l), glow: stops[0].glow }
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1]
      if (tempC <= b.t) {
        const tt = clamp01((tempC - a.t) / (b.t - a.t))
        const h = lerp(a.h, b.h, tt)
        const s = lerp(a.s, b.s, tt)
        const l = lerp(a.l, b.l, tt)
        const glow = tt < 0.05 ? a.glow : (tt > 0.95 ? b.glow : 'rgba(255,255,255,0.25)')
        return { color: hsl(h, s, l), glow }
      }
    }
    const last = stops[stops.length - 1]
    return { color: hsl(last.h, last.s, last.l), glow: last.glow }
  }

  function updateTempSliderAppearance(tempC) {
    if (!tempRange) return
    const min = parseFloat(tempRange.min || '-273.15')
    const max = parseFloat(tempRange.max || '500')
    const pct = clamp01((tempC - min) / (max - min)) * 100
    const { color, glow } = tempToColor(tempC)
    const bg = `linear-gradient(90deg, ${color} 0%, ${color} ${pct}%, rgba(255,255,255,0.12) ${pct}%, rgba(255,255,255,0.12) 100%)`
    tempRange.style.setProperty('--range-color', color)
    tempRange.style.setProperty('--range-glow', glow)
    tempRange.style.setProperty('--range-bg', bg)
    if (metricsEl) metricsEl.style.setProperty('--accent-color', color)
  }

  // Phase estimation (1 atm):
  // If salt is present, approximate freezing point depression and boiling point elevation.
  function getPhase(c) {
    const freezePoint = saltOn ? -5 : 0
    const boilPoint = saltOn ? 104 : 100
    if (c <= freezePoint) return saltOn ? 'Solid (Ice + salt)' : 'Solid (Ice)'
    if (c >= boilPoint) return saltOn ? 'Gas (Steam, salty solution)' : 'Gas (Steam)'
    return saltOn ? 'Liquid (Salt solution)' : 'Liquid (Water)'
  }

  // Molecule container
  const molecules = []
  // Salt ions (Na⁺ and Cl⁻), spawned when salt is added
  const ions = [] // { x, y, vx, vy, charge: '+" or '-', type: 'Na'|'Cl' }
  // Bond tracking: map of key "i-j" to {start: seconds}
  const bonds = new Map()
  // Rolling average of bond durations (seconds)
  let bondDurations = []
  const MAX_BOND_SAMPLES = 1000
  // Track sim time and a short history of active bonds for 3s average in liquid/gas
  let simTime = 0
  const activeBondHistory = [] // {t, count}

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
    ions.length = 0
  }

  function createIon(type) {
    // Place ions near a random water molecule so they sit between molecules,
    // not far away in empty space.
    const base = molecules.length
      ? molecules[Math.floor(Math.random() * molecules.length)]
      : { x: W * 0.5, y: H * 0.5 }
    const offsetR = 20 + Math.random() * 18
    const offsetA = Math.random() * Math.PI * 2
    const x = base.x + Math.cos(offsetA) * offsetR
    const y = base.y + Math.sin(offsetA) * offsetR
    const angle = rand(0, Math.PI * 2)
    const speed = rand(0.2, 0.6)
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      charge: type === 'Na' ? '+' : '-',
      type
    }
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

  function drawIon(ion) {
    const radius = ion.type === 'Na' ? 7 : 8
    ctx.beginPath()
    ctx.arc(ion.x, ion.y, radius, 0, Math.PI * 2)
    if (ion.type === 'Na') {
      ctx.fillStyle = '#ffdd88' // warm yellow for Na⁺
    } else {
      ctx.fillStyle = '#88b8ff' // cool blue for Cl⁻
    }
    ctx.fill()
    // charge symbol
    ctx.fillStyle = '#101520'
    ctx.font = '10px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(ion.charge, ion.x, ion.y)
  }

  function clear() {
    ctx.clearRect(0, 0, W, H)
    // Clear SVG overlay
    while (svg.firstChild) svg.removeChild(svg.firstChild)
  }

  function update(dt, tempC) {
    simTime += dt
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

    // Simple Brownian-like motion for ions (only when salt is present)
    if (saltOn && ions.length) {
      for (const ion of ions) {
        ion.x += ion.vx * BASE_SPEED * 0.6 * dt
        ion.y += ion.vy * BASE_SPEED * 0.6 * dt
        // gentle random jitter
        ion.vx += (Math.random() - 0.5) * 0.4 * dt
        ion.vy += (Math.random() - 0.5) * 0.4 * dt

        // weak attraction toward nearest water molecule so ions stay
        // interspersed within the liquid rather than drifting away.
        if (molecules.length) {
          let nearest = null
          let bestD2 = Infinity
          for (let i = 0; i < molecules.length; i++) {
            const m = molecules[i]
            const dx = m.x - ion.x
            const dy = m.y - ion.y
            const d2 = dx * dx + dy * dy
            if (d2 < bestD2) { bestD2 = d2; nearest = m }
          }
          if (nearest && bestD2 > 1) {
            const d = Math.sqrt(bestD2)
            const nx = (nearest.x - ion.x) / d
            const ny = (nearest.y - ion.y) / d
            const pull = 12 * dt // very gentle pull
            ion.vx += nx * pull
            ion.vy += ny * pull
          }
        }
        // keep within bounds
        const r = ion.type === 'Na' ? 7 : 8
        if (ion.x < r) { ion.x = r; ion.vx = Math.abs(ion.vx) }
        if (ion.x > W - r) { ion.x = W - r; ion.vx = -Math.abs(ion.vx) }
        if (ion.y < r) { ion.y = r; ion.vy = Math.abs(ion.vy) }
        if (ion.y > H - r) { ion.y = H - r; ion.vy = -Math.abs(ion.vy) }
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
          // With salt present, reduce attraction to show disrupted IMFs
          const saltFactor = saltOn ? 0.6 : 1
          const strength = IMF_ATTRACT_STRENGTH * saltFactor * coolFactor * (1 - d / IMF_CUTOFF)
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
      const avg = bondDurations.length ? (bondDurations.reduce((a,b)=>a+b,0) / bondDurations.length) : 0
      avgBondDurationEl.textContent = avg.toFixed(2)

      const phaseText = getPhase(tempC)
      const isLiquidOrGas = /Liquid|Gas/.test(phaseText)
      let activeDisplay = bonds.size
      if (isLiquidOrGas) {
        // keep only last ~3 seconds of samples
        activeBondHistory.push({ t: simTime, count: bonds.size })
        const cutoff = simTime - 3
        while (activeBondHistory.length && activeBondHistory[0].t < cutoff) activeBondHistory.shift()
        if (activeBondHistory.length) {
          const sum = activeBondHistory.reduce((acc, s) => acc + s.count, 0)
          activeDisplay = Math.round(sum / activeBondHistory.length)
        }
      } else {
        activeBondHistory.length = 0
      }
      activeBondsEl.textContent = String(activeDisplay)
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
          line.setAttribute('stroke-width', saltOn ? '1.4' : '2')
          line.setAttribute('stroke-dasharray', '6 6')
          line.setAttribute('opacity', saltOn ? '0.55' : '0.9')
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
    // Update slider + metrics color theme
    updateTempSliderAppearance(cNum)

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

  // Salt button: toggle dissolved salt state
  if (saltBtn) {
    saltBtn.addEventListener('click', () => {
      saltOn = !saltOn
      // Update button label to show state
      saltBtn.textContent = saltOn ? 'Remove salt 🧂' : 'Add salt 🧂'
      // Slight sparkle so the user sees a change
      sparkle(rand(20, W - 20), rand(20, H - 20))
      // Spawn or clear ions
      ions.length = 0
      if (saltOn) {
        const ionCount = Math.floor(NUM_MOLECULES * 0.35)
        for (let i = 0; i < ionCount; i++) {
          ions.push(createIon(i % 2 === 0 ? 'Na' : 'Cl'))
        }
      }
      // Recompute phase text for current temperature
      setTemperature(Number(tempRange.value))
      // Re-render latent heat chart to shift plateaus
      renderHeatChart()
      updateHeatUI()
    })
  }

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

  // --- Heat vs Temperature model and charting ---
  // We'll model 1 mole of water for simplicity. Units: kJ per mole (kJ/mol) for heat.
  // Specific heats (approx):
  // Ice (solid): Cs = 2.09 J/gK -> 36.7 kJ/kmolK -> for 1 mol (18 g): 2.09 * 18 / 1000 = 0.03762 kJ/K
  // Liquid: Cl = 4.18 J/gK -> 75.24 kJ/kmolK -> per mol: 4.18 * 18 / 1000 = 0.07524 kJ/K
  // Gas: Cg ~ 1.9 J/gK -> per mol: 1.9 * 18 / 1000 = 0.0342 kJ/K
  const MOLAR_MASS = 18.01528 // g/mol
  const Cs = 2.09 * MOLAR_MASS / 1000 // kJ / (mol K)
  const Cl = 4.18 * MOLAR_MASS / 1000
  const Cg = 1.9 * MOLAR_MASS / 1000
  const Lf = 6.01 * 18.01528 / 1000 // enthalpy of fusion ~6.01 kJ/mol? Actually 6.01 kJ/mol directly; keep per mol
  // Note: The values above are approximate and intended for pedagogical simulation
  // Use typical latent heats (kJ/mol): fusion ~6.01, vaporization ~40.65
  const LATENT_FUSION = 6.01 // kJ/mol
  const LATENT_VAP = 40.65 // kJ/mol

  // Base temperature breakpoints (deg C) without salt
  const T_melt_base = 0
  const T_boil_base = 100

  function getMeltingPoint() {
    // With salt, lower freezing point noticeably to illustrate freezing point depression
    // (cartooned value: -10 °C instead of 0 °C).
    return saltOn ? -10 : T_melt_base
  }

  function getBoilingPoint() {
    // With salt, raise boiling point slightly; keep the shift small so the plateau
    // remains near ~100 °C but clearly moves when salt is toggled.
    return saltOn ? 103 : T_boil_base
  }

  // Compute Q(T): heat added (kJ per mol) to take 1 mol from a reference base (e.g., -50 C) up to T
  // We'll choose reference T0 = -50 C where Q=0 for plotting convenience
  const T0 = -273.15
  function Q_of_T(T) {
    // integrate piecewise from T0 to T
    let Q = 0
    function heatAcross(a, b, C) { return C * (b - a) }
    // helper to accumulate from low to high
    const low = Math.min(T0, T)
    const high = Math.max(T0, T)
    const T_melt = getMeltingPoint()
    const T_boil = getBoilingPoint()

    // We'll step through intervals: [T0..T_melt] solid, [T_melt..T_boil] liquid (with plateau for fusion), [T_boil..T] gas
    if (T >= T0 && T <= T_melt) {
      // entirely in solid
      return Cs * (T - T0)
    }
    if (T > T_melt && T <= T_boil) {
      // heat solid from T0 to melt, add latent fusion, then liquid to T
      Q = Cs * (T_melt - T0) + LATENT_FUSION + Cl * (T - T_melt)
      return Q
    }
    if (T > T_boil) {
      Q = Cs * (T_melt - T0) + LATENT_FUSION + Cl * (T_boil - T_melt) + LATENT_VAP + Cg * (T - T_boil)
      return Q
    }
    // If T < T0 (rare), allow negative Q
    if (T < T0) {
      return Cs * (T - T0)
    }
    return Q
  }

  // Approximate inverse T(Q) by numeric search (bisection) over reasonable T range
  function T_of_Q(Qtarget) {
    // search between -200 and 600 C
    let lo = -200, hi = 600
    let flo = Q_of_T(lo), fhi = Q_of_T(hi)
    if (Qtarget <= flo) return lo
    if (Qtarget >= fhi) return hi
    for (let it = 0; it < 60; it++) {
      const mid = (lo + hi) / 2
      const fm = Q_of_T(mid)
      if (Math.abs(fm - Qtarget) < 1e-4) return mid
      if (fm < Qtarget) lo = mid; else hi = mid
    }
    return (lo + hi) / 2
  }

  // Chart drawing
  const heatChart = document.getElementById('heatChart')
  const heatQOut = document.getElementById('heatQ')
  const heatTOut = document.getElementById('heatT')
  const addHeatBtn = document.getElementById('addHeat')
  const removeHeatBtn = document.getElementById('removeHeat')
  const resetHeatBtn = document.getElementById('resetHeat')
  const toggleHeatPanelBtn = document.getElementById('toggleHeatPanel')
  const heatCtx = heatChart ? heatChart.getContext('2d') : null
  let currentQ = 0 // kJ per mol relative to T0

  function renderHeatChart() {
    if (!heatCtx) return
    // Always match canvas drawing buffer to current CSS size so the
    // chart fully fits the visible container and stays sharp.
    const ratio = window.devicePixelRatio || 1
    const rect = heatChart.getBoundingClientRect()
    const w = Math.max(10, Math.floor(rect.width * ratio))
    const h = Math.max(10, Math.floor(rect.height * ratio))
    if (heatChart.width !== w || heatChart.height !== h) {
      heatChart.width = w
      heatChart.height = h
      heatCtx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    heatCtx.clearRect(0, 0, w, h)
    // compute sample points
    const samples = 300
    const Tmin = T0
    // extend chart a bit above boiling so raised boiling point still fits comfortably
    const Tmax = 220
    const Qvals = new Array(samples)
    let Qmin = Infinity, Qmax = -Infinity
    for (let i = 0; i < samples; i++) {
      const t = Tmin + (Tmax - Tmin) * (i / (samples - 1))
      const q = Q_of_T(t)
      Qvals[i] = { t, q }
      if (q < Qmin) Qmin = q
      if (q > Qmax) Qmax = q
    }
    // padding
    const pad = 36
    // draw axes
    heatCtx.strokeStyle = 'rgba(255,255,255,0.12)'
    heatCtx.lineWidth = 1
    heatCtx.beginPath()
    heatCtx.moveTo(pad, h - pad)
    heatCtx.lineTo(w - pad, h - pad)
    heatCtx.moveTo(pad, h - pad)
    heatCtx.lineTo(pad, pad)
    heatCtx.stroke()

    // scale functions: map Q to x, T to y
    const xOfQ = q => pad + ((q - Qmin) / (Qmax - Qmin)) * (w - pad * 2)
    const yOfT = t => h - (pad + ((t - Tmin) / (Tmax - Tmin)) * (h - pad * 2))

    // plot Q(T)
    heatCtx.beginPath()
    heatCtx.strokeStyle = 'rgba(80,200,160,0.95)'
    heatCtx.lineWidth = 2
    for (let i = 0; i < Qvals.length; i++) {
      const { t, q } = Qvals[i]
      const x = xOfQ(q)
      const y = yOfT(t)
      if (i === 0) heatCtx.moveTo(x, y)
      else heatCtx.lineTo(x, y)
    }
    heatCtx.stroke()

    // draw gridlines and axis ticks (x: heat, y: temperature)
    heatCtx.font = '12px system-ui'
    heatCtx.fillStyle = 'rgba(255,255,255,0.12)'
    heatCtx.lineWidth = 0.8
    // y grid + ticks at 50°C steps including 0 (show negative and positive values)
    const step = 50
    const yMinTick = Math.floor(Tmin / step) * step
    const yMaxTick = Math.ceil(Tmax / step) * step
    for (let t = yMinTick; t <= yMaxTick; t += step) {
      const norm = (t - Tmin) / (Tmax - Tmin)
      const ty = pad + (1 - norm) * (h - pad * 2)
      heatCtx.strokeStyle = 'rgba(255,255,255,0.03)'
      heatCtx.beginPath()
      heatCtx.moveTo(pad, ty)
      heatCtx.lineTo(w - pad, ty)
      heatCtx.stroke()
      heatCtx.fillStyle = 'rgba(255,255,255,0.45)'
      heatCtx.fillText(t + '°C', 6, ty + 4)
    }

    // x axis ticks
    const xTicks = 6
    heatCtx.fillStyle = 'rgba(255,255,255,0.6)'
    for (let i = 0; i <= xTicks; i++) {
      const qv = Qmin + (i / xTicks) * (Qmax - Qmin)
      const x = xOfQ(qv)
      heatCtx.strokeStyle = 'rgba(255,255,255,0.06)'
      heatCtx.beginPath()
      heatCtx.moveTo(x, h - pad)
      heatCtx.lineTo(x, h - pad + 6)
      heatCtx.stroke()
      heatCtx.fillText(qv.toFixed(0), x - 10, h - 6)
    }

    // draw vertical markers and shaded area for melting and boiling plateaus
    const T_melt = getMeltingPoint()
    const T_boil = getBoilingPoint()
    const qmelt = Q_of_T(T_melt)
    const qboil = Q_of_T(T_boil)
    const plateauHalfWidth = Math.max(6, (w - pad * 2) * 0.008)
    heatCtx.fillStyle = 'rgba(120,180,255,0.06)'
    heatCtx.fillRect(xOfQ(qmelt) - plateauHalfWidth, pad, plateauHalfWidth * 2, h - pad * 2)
    heatCtx.fillStyle = 'rgba(255,220,140,0.04)'
    heatCtx.fillRect(xOfQ(qboil) - plateauHalfWidth, pad, plateauHalfWidth * 2, h - pad * 2)
    // labels
    heatCtx.fillStyle = 'rgba(255,255,255,0.7)'
    heatCtx.fillText('Melting', xOfQ(qmelt) + 8, pad + 14)
    heatCtx.fillText('Vaporisation', xOfQ(qboil) + 8, pad + 14)

    // draw currentQ marker (use the same accent as the temperature gauge)
    const cx = xOfQ(currentQ)
    const cy = yOfT(T_of_Q(currentQ))
    // prefer the glow color returned by tempToColor so the marker matches the slider/theme
    const _tempAccent = typeof tempRange !== 'undefined' ? tempToColor(Number(tempRange.value)) : null
    // derive a brighter but less opaque fill and a larger shadow (glow)
    let markerColor = 'rgba(255,215,120,0.75)'
    let markerShadowColor = markerColor
    if (_tempAccent && _tempAccent.glow) {
      const m = String(_tempAccent.glow).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/)
      if (m) {
        let r = parseInt(m[1], 10), g = parseInt(m[2], 10), b = parseInt(m[3], 10), a = parseFloat(m[4] || '1')
        // brighten color toward white
        const brighten = (v) => Math.min(255, Math.round(v + (255 - v) * 0.25))
        r = brighten(r); g = brighten(g); b = brighten(b)
        const reducedAlpha = Math.max(0.35, Math.min(0.85, a * 0.8)) // reduce opacity a bit
        markerColor = `rgba(${r}, ${g}, ${b}, ${reducedAlpha})`
        // shadow a touch dimmer than fill for glow
        markerShadowColor = `rgba(${r}, ${g}, ${b}, ${Math.max(0.25, reducedAlpha * 0.8)})`
      } else {
        markerColor = _tempAccent.glow
        markerShadowColor = _tempAccent.glow
      }
    }
    // draw with a larger blur to simulate a wider glow radius
    heatCtx.save()
    heatCtx.beginPath()
    heatCtx.fillStyle = markerColor
    heatCtx.shadowColor = markerShadowColor
    heatCtx.shadowBlur = 24 // slightly larger glow radius
    heatCtx.arc(cx, cy, 7, 0, Math.PI * 2) // slightly bigger marker
    heatCtx.fill()
    heatCtx.restore()
    heatCtx.strokeStyle = 'rgba(0,0,0,0.5)'
    heatCtx.lineWidth = 1
    heatCtx.stroke()

    // axis labels
    heatCtx.fillStyle = 'rgba(255,255,255,0.6)'
    heatCtx.fillText('Heat added (kJ/mol)', w / 2 - 40, h - 8)
    heatCtx.save()
    heatCtx.translate(12, h / 2 + 20)
    heatCtx.rotate(-Math.PI / 2)
    heatCtx.fillText('Temperature (°C)', 0, 0)
    heatCtx.restore()
  }

  function updateHeatUI() {
    if (heatQOut) heatQOut.textContent = currentQ.toFixed(2)
    if (heatTOut) heatTOut.textContent = T_of_Q(currentQ).toFixed(2)
    // sync slider temperature to the T_of_Q value
    const tnew = T_of_Q(currentQ)
    // Avoid clobbering user while dragging heavily: set only if difference > 0.01
    if (Math.abs(Number(tempRange.value) - tnew) > 0.02) setTemperature(tnew)
    // refresh trend indicator when heat UI changes
    updateTrendIndicator()
  }

  if (addHeatBtn) addHeatBtn.addEventListener('click', () => { currentQ += 1; renderHeatChart(); updateHeatUI() })
  if (removeHeatBtn) removeHeatBtn.addEventListener('click', () => { currentQ = Math.max(-200, currentQ - 1); renderHeatChart(); updateHeatUI() })
  if (resetHeatBtn) resetHeatBtn.addEventListener('click', () => { currentQ = 0; renderHeatChart(); updateHeatUI() })
  if (toggleHeatPanelBtn) toggleHeatPanelBtn.addEventListener('click', (e) => {
    const panel = document.querySelector('.heat-panel')
    if (!panel) return
    const isHidden = panel.classList.toggle('hidden')
    toggleHeatPanelBtn.textContent = isHidden ? 'Show latent graph' : 'Hide latent graph'
  })

  // initialize chart drawing; resize is handled inside renderHeatChart
  window.addEventListener('resize', renderHeatChart)
  renderHeatChart()

  // Trend indicator (glowing circle) that tracks the chart trendline and phase
  const trendEl = document.getElementById('trendIndicator')
  function updateTrendIndicator() {
    if (!trendEl) return
    // Map currentQ to an x position inside simContainer
    const rect = container.getBoundingClientRect()
    // Use the same sample bounds used by renderHeatChart (T0..Tmax)
    const Tmin = T0, Tmax = 220
    const Qmin = Q_of_T(Tmin), Qmax = Q_of_T(Tmax)
    const pct = (currentQ - Qmin) / (Qmax - Qmin)
    const clamped = Math.max(0, Math.min(1, pct))
    // Put the indicator horizontally across the sim area according to pct
    const x = rect.left + clamped * (rect.width - 32) + 8
    // Choose a vertical band near the top so it doesn't overlap the molecules much
    const y = rect.top + 20
    // Position (use transform for smooth motion)
    trendEl.style.transform = `translate(${clamped * (rect.width - 32)}px, 8px)`

    // Color by phase
    const tempNow = Number(tempRange.value)
    const T_boil = getBoilingPoint()
    trendEl.classList.remove('glow-solid', 'glow-liquid', 'glow-gas')
    if (tempNow <= SOLID_THRESHOLD) trendEl.classList.add('glow-solid')
    else if (tempNow >= T_boil) trendEl.classList.add('glow-gas')
    else trendEl.classList.add('glow-liquid')
  }



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
    if (saltOn) {
      for (const ion of ions) drawIon(ion)
    }
    // (KE mini chart removed)
    // keep trend indicator aligned during animation
    updateTrendIndicator()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
})()
