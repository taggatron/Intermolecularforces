# Intermolecular Forces — Water Simulation

An interactive canvas + SVG simulation of water molecules showing green dotted lines for intermolecular attractions. Temperature slider controls speed and shows phase (solid/liquid/gas) at 1 atm, with quick phase-change buttons.

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

## Notes

- Intermolecular lines appear when molecule centers are within a cutoff (~80 px) and disappear beyond that.
- Speed scales roughly with sqrt(T in Kelvin). Phase boundaries use 0 °C and 100 °C at 1 atm.
- Buttons tween the temperature and add a small sparkle visual.
