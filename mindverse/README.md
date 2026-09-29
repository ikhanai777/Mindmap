# Mindverse — 3D neon mind map

An interactive 3D mind map where ideas are glowing glass bubbles linked by luminous, pulsing fibres, floating above a circuit‑board floor with a neon city on the horizon.

This is a standalone app. It lives entirely in `mindverse/` and has its own `package.json`, so it is independent of the Constellate app at the repo root.

## Run

```bash
cd mindverse
npm install
npm run dev              # http://localhost:5173
npm test                 # unit tests (model, layout, history)
npm run build            # static site in dist/
npm run build:artifact   # single self-contained file: dist-artifact/mindverse.html
```

To deploy it as a static site (Render, Netlify, Vercel, GitHub Pages), set the root/base directory to `mindverse`, use `npm ci && npm run build` as the build command, and publish `dist/`.

## Features

| Area | What you get |
|---|---|
| **Look** | Fresnel glass bubbles with drifting inner veins and rim sparkles, colour‑coded per branch; each link is a bundle of twisting fibres with light pulses flowing from parent to child; bloom; black space with steady stars. The scenery button adds a nebula sky, drifting dust, a circuit floor with outward pulses and a neon skyline (off by default). Labels are drawn after bloom, so text stays sharp. |
| **Navigate** | Orbit, pan and zoom, with inertia. Fly‑to focus on any node, fit‑all, and auto‑rotate. Hovering or selecting a node lights the path back to the centre. |
| **Build** | Tab adds a child and Enter adds a sibling. You name the new idea inline: Tab or Shift+Enter keeps going, Esc cancels. Double‑click a bubble to rename it. A quick‑action bar floats next to the selected bubble. |
| **Edit** | Inspector panel with title, notes, glow colour (or inherit from the branch), collapse/expand (a badge shows the hidden count), arrange branch, focus and delete. |
| **Arrange** | A 3D radial layout that stays mostly screen‑facing. Drag a bubble to move its whole branch. Drop it onto another bubble to re‑parent it. New children are placed without overlapping existing bubbles. Auto‑arrange (L) re‑lays out everything. |
| **Find** | Search with `/` matches titles and notes. Matches and their paths stay lit while the rest dims. Enter flies to the result and expands collapsed branches if needed. |
| **Keep** | Autosave to localStorage, multiple maps (new, sample, duplicate, delete) and unlimited undo/redo. |
| **Share** | Export a PNG snapshot, JSON, or a Markdown outline, or copy the outline. Import JSON, an indented or bulleted outline, or Markdown with headings. |

## Keyboard

`Tab` child · `Enter` sibling · `F2` rename · `Space` collapse · `Del` delete · arrows walk the tree · `F` focus/fit · `L` arrange · `R` auto‑rotate · `/` search · `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · `?` help

## Code map

```
src/model.js            tree operations, colours, search, outline import/export
src/layout.js           3D radial layout + overlap relaxation
src/store.js            localStorage persistence, undo/redo history
src/scene/world.js      renderer, camera, bloom, sky/stars/floor/skyline/dust
src/scene/nodes.js      glass bubble shader, sparkles, canvas labels
src/scene/edges.js      GPU bezier fibre bundles with flowing light
src/scene/mindscene.js  model→view sync, picking, fly‑to, subtree dragging
src/main.js             UI wiring: pointer, keyboard, inspector, search, modals
```
