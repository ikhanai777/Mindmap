// Tour mode: play saved waypoints in order with auto-walk; swipe to skip.
// Doubles as a presentation mode.
import * as THREE from 'three';
import { get, set } from '../store.js';
import { $ } from './util.js';

const HOLD_MS = 4200;

export function initTour(app) {
  const bar = $('#tour-bar');
  const label = $('#tour-label');
  let i = 0;
  let timer = null;
  let playing = false;

  const list = () => Object.values(get().doc.waypoints).sort((a, b) => a.order - b.order);

  function show(index, auto) {
    const wps = list();
    if (!wps.length) return stop();
    i = ((index % wps.length) + wps.length) % wps.length;
    const w = wps[i];
    label.textContent = `${i + 1}/${wps.length} · ${w.name}`;
    clearTimeout(timer);
    const pos = new THREE.Vector3(...w.position), target = new THREE.Vector3(...w.target);
    const dist = app.scene.camera.position.distanceTo(pos);
    app.rig.flyTo(pos, target, Math.min(2600, Math.max(900, dist * 120)), () => {
      if (playing && auto) timer = setTimeout(() => show(i + 1, true), HOLD_MS);
    });
  }

  function start(from = 0) {
    if (!list().length) return app.toast('Save a view first: Menu → Tour → Save current view');
    playing = true;
    set({ touring: true });
    document.body.classList.add('touring');
    bar.hidden = false;
    app.sheet.close();
    // tours read best from inside the constellation
    if (app.rig.mode === 'orbit') app.setMode('fly', false);
    show(from, true);
  }

  function goto(index) {
    start(index);
  }

  function stop() {
    playing = false;
    clearTimeout(timer);
    bar.hidden = true;
    document.body.classList.remove('touring');
    set({ touring: false });
  }

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tour]');
    if (!b) return;
    if (b.dataset.tour === 'next') show(i + 1, true);
    if (b.dataset.tour === 'prev') show(i - 1, true);
    if (b.dataset.tour === 'stop') stop();
  });

  return {
    start, stop, goto,
    next: () => show(i + 1, true),
    prev: () => show(i - 1, true),
    get playing() { return playing; },
  };
}
