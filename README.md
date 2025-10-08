# Intermolecular Forces — Water (H₂O) Simulation

An interactive, classroom-friendly simulation of water molecules with:

- Canvas molecules (O = red, H = white) and green dotted SVG lines for intermolecular attractions.
- Temperature slider (−273.15 °C to 500 °C) that controls molecular speeds and phase (solid/liquid/gas at ~1 atm).
- Phase-change buttons (Freeze ❄️ / Melt 💧 / Boil ♨️ / Condense ☁️) with animated transitions.
- Gravity that weakens as temperature rises; molecules settle at low T and roam freely at high T.
- Solid “ice-like” lattice: molecules arrange into O–H–O rows in a hex-like pattern at ≤ 0 °C.
- Optional bond lines toggle (Show bonds) to hide O–H bonds inside each molecule.
- Metrics bar: Average intermolecular bond duration and active bond count.

## Run locally

You can open `index.html` directly, but using a local server avoids any CORS issues and mirrors production setups.

Mac (zsh):

1) If you have Python installed:

```zsh
cd "/Users/danieltagg/Desktop/Desktop - Daniel’s MacBook Pro/Intermolecularforces"
python3 -m http.server 5173
```

Then open <http://localhost:5173> in your browser.

1) Or use Node (if installed):

```zsh
npx serve -l 5173 "/Users/danieltagg/Desktop/Desktop - Daniel’s MacBook Pro/Intermolecularforces"
```

## Controls & features

- Temperature slider: changes average kinetic speed with a √T(K) rule plus a small high‑temperature boost. Phase label updates at 0 °C and 100 °C (1 atm assumption).
- Freeze from gas: if you press Freeze while in the gas phase, molecules get a brief gravity “settling” boost, slow down, and are assigned to a lattice for a more regular crystal pattern.
- Solid lattice: in the solid regime (≤ 0 °C), molecules are softly pulled to a hexagonal lattice with alternating row orientation (O–H–O row alignment), reduced motion/rotation, larger spacing (more open ice-like structure), and mild thermal vibration.
- Gravity & floor friction: both fade as temperature rises so motion is freer near boiling; at low T, molecules settle.
- Intermolecular attractions: green dotted lines appear when molecule centers are within a cutoff (~80 px) and vanish beyond it.
- Overlap prevention: short-range repulsion plus a small relaxation step in freezing/solid removes overlaps to preserve a tidy crystal.
- Show bonds: toggle to show/hide the O–H bonds inside each molecule.
- Metrics bar: shows average intermolecular “bond” duration (based on distance cutoff) and the current number of active bonds.

## Teaching activities

Use the slider and buttons to model phase behavior and intermolecular forces:

1. Phase changes and kinetic theory
   - Ask learners to predict how speed should change as temperature changes (√T behavior). Compare liquid vs gas motion and discuss mean free path qualitatively.
   - Use Freeze/Melt/Boil/Condense to discuss energy transfer and how phase labels relate to 0 °C and 100 °C at ~1 atm.

2. Intermolecular forces visualization
   - Identify the green dotted attraction lines and relate them to intermolecular attractions (hydrogen bonding conceptually, though here it’s simplified by distance).
   - Vary temperature and observe the frequency/duration of attractions. Discuss why bonds persist longer at lower temperatures.

3. Crystal structure (ice)
   - Freeze from gas and watch the settling + lattice formation. Highlight O–H–O row alignment and how the lattice spacing is slightly larger (ice less dense than liquid water).
   - Compare “solid” vs “liquid” packing. Why does increasing temperature disrupt order?

4. Bond duration metric
   - Observe the “Avg bond duration” and “Active bonds” while changing the slider. Relate average duration to potential energy wells and thermal agitation: higher T → shorter average duration, fewer bonds.
   - Extension: Record durations at a few temperatures and plot them in a spreadsheet; infer a qualitative relationship (no need for a full model).

5. Inquiry and extensions
   - What happens if the cutoff is increased/decreased? How does that change the bond duration metric? (Instructor can adjust `IMF_CUTOFF` in code.)
   - Turn off Show bonds and focus on molecular centers and attraction lines. Does the pattern recognition change?
   - Discuss limitations: This is a visual, qualitative model (2D, simplified forces, not a physical MD engine).

## Customize

You can tune behavior in `main.js`:

- `IMF_CUTOFF` (default ~80 px): range at which attraction lines appear and bonds are considered active.
- Gravity/floor constants: `G_ACCEL_BASE`, `G_TERM_BASE`, and temperature scaling in the update loop.
- Lattice spacing: `LATTICE_SPACING_SOLID` (solid) and `LATTICE_SPACING_LIQUID` (liquid visualization baseline).
- Solid motion/vibration: `VIB_AMP`, `VIB_ANG`, and solid damping constants.

## Known limitations

- 2D visualization only; real water structure and hydrogen bonding are 3D and more complex (directional with angular dependence).
- Forces are simplified for clarity and performance; this is not a molecular dynamics simulation.
