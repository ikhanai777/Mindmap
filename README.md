# Constellate — 3D Mind Map

A mobile-first 3D mind map where ideas are glowing nodes in space you can orbit, fly through and walk around — while building a map stays as fast as typing a bulleted list.

Installable, offline-first PWA built on Three.js. Maps live on the device (IndexedDB); there is no backend.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (also on your LAN: open it on a phone)
npm test           # unit tests (model, history, import/export, layouts)
npm run build      # static build in dist/
npm run preview    # serve the build (service worker active)
node scripts/smoke.mjs http://localhost:4173/ smoke-out   # end-to-end smoke test on a phone viewport
```

## Deploy (Render)

`render.yaml` defines a static site: `npm ci && npm run build`, publish `dist/`, SPA rewrite, no-cache for `sw.js`, immutable hashed assets. Connect the GitHub repo in Render → *New → Blueprint*.

## What's in the MVP

| Area | Implemented |
|---|---|
| **Data model** | Map / Node / Link / Cluster / Waypoint as in the spec, versioned JSON schema with migration (`src/model.js`). `pos: null` = layout places it; `[x,y,z]` = pinned. |
| **Scene** | Instanced glass-orb nodes (fresnel rim + inner glow), 4 shapes (sphere idea, cube task, octahedron decision, ring question), size by descendant count, brightness by recency, root pulse, 250 ms spring pop, ±2% breathing drift. Bezier filament links with parent→child gradient tapering by depth; dashed cross-links with flowing particles; SDF billboard labels (troika) that fade with distance; emoji icons; nebula clusters; parallax starfield; depth fog; floor grid in walk mode; adaptive bloom. |
| **Themes** | Void, Aurora, Paper (flat-shaded, light), High Contrast. |
| **Navigation** | Orbit (1-finger rotate, pinch zoom, 2-finger pan, inertia), Fly (virtual stick + drag look, pinch altitude), Walk (eye height 1.6, tap node → smooth walk to 2 units away, proximity note reveal within 5 units, soft collision, optional gyroscope look). Recenter, minimap radar (tap to fly), breadcrumb, focus mode, last view remembered per map, tour mode over saved waypoints (swipe to skip). |
| **Capture** | Quick add (+ → child; Return → sibling; Tab / swipe → indent; swipe ← outdent), outline mode that builds the 3D tree live, paste import of bulleted/markdown lists, hold + to dictate (Web Speech API). |
| **Edit** | Long-press radial menu (Add child, Link, Color, Note, Collapse, Delete, Select), link mode with optional label, drag to move/pin or drop onto a node to reparent (glow ring), pinch a node to resize, markdown notes with checklists in a bottom sheet (peek 30% → 90%), multi-select with bulk color/tag/move/cluster/delete. |
| **Layouts** | Radial sphere, cone tree, force galaxy (d3-force-3d in a Web Worker, clusters pull together), flat 2D. Changes animate over 800 ms; pinned nodes stay put. |
| **Find** | Fuzzy search on titles/notes/tags with matches lit in 3D; filters by tag, color, date edited. |
| **Safety & sharing** | Unlimited undo/redo (command pattern; two-finger tap or shake to undo), autosave on every change, daily snapshots (30 kept). Export JSON, Markdown, OPML, PNG, and a self-contained HTML viewer with orbit + walkaround + tour. Import JSON, Markdown, OPML. |
| **Mobile UX** | Full-bleed canvas, chrome in the bottom third that fades after 3 s, 44 px touch targets with expanded invisible hit areas, landscape layout (dock on the right, sticks in both corners), haptics, 3-step onboarding on a sample map, empty state “Tap to name your idea”. |
| **Accessibility** | Outline mode is the screen-reader view (ARIA tree), rem-based dynamic type + label size setting, High Contrast theme, reduce-motion honored (drift and particles off), shapes/icons carry meaning beyond color. |
| **Performance** | InstancedMesh per shape, batched fat-line links (one draw call per bucket), LOD (points beyond 60 units, labels beyond 25), label budget, DPR capped at 2, adaptive quality (bloom → particles → labels when fps < 40 for 2 s), screen-space picking with ≥ 44 px hit radius. |

### Gestures

| Gesture | Empty space | Node |
|---|---|---|
| Tap | Deselect, hide chrome | Select + sheet peek |
| Double-tap | Recenter | Focus camera on node |
| Long-press | Add floating node here | Radial menu |
| Drag | Rotate (orbit) / look (fly, walk) | Move or reparent |
| Pinch | Zoom | Resize node |
| Two-finger tap | Undo | Undo |

Keyboard: `N`/`Tab` add child · `Enter` add sibling · `Del` delete · `⌘Z`/`⇧⌘Z` undo/redo · `/` search · `O` outline · `1-3` modes · `F` focus · `H` recenter · `L` link · `C` collapse · `WASD`/`QE` move.

## Project layout

```
src/
  model.js          schema, tree index, migration, sample map
  store.js          zustand store + command-pattern history
  actions.js        every document mutation (one undo step each)
  io.js             JSON / Markdown / OPML / pasted-list import & export
  exportHtml.js     self-contained walkaround viewer export
  db.js             IndexedDB persistence + daily snapshots
  themes.js         Void, Aurora, Paper, High Contrast
  layout/           radial, cone, flat solvers + force worker
  scene/            Three.js scene, node shader, fat-line batches
  camera.js         orbit / fly / walk rig, transitions, gyro
  gestures.js       touch/mouse gesture map, keyboard, paste, shake
  ui/               sheet, radial menu, outline, search, menu, minimap, sticks, tour, onboarding
public/             manifest, service worker, icons
```

## Not in the MVP (per spec roadmap)

Real-time collaboration (Yjs + WebSocket sync), AI generation, VR headsets, Capacitor app-store wrappers.
