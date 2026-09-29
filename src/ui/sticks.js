// Virtual thumbsticks for fly & walk. Left moves; right (landscape) looks.
import { $ } from './util.js';

function bindStick(el, onChange) {
  const knob = el.querySelector('.knob');
  let id = null;
  const update = (e) => {
    const r = el.getBoundingClientRect();
    const R = r.width / 2;
    let x = (e.clientX - r.left - R) / (R * 0.8);
    let y = (e.clientY - r.top - R) / (R * 0.8);
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    knob.style.transform = `translate(${x * R * 0.6}px, ${y * R * 0.6}px)`;
    // small dead zone, then a gentle response curve for fine control
    const dz = (v) => (Math.abs(v) < 0.08 ? 0 : Math.sign(v) * Math.pow(Math.abs(v), 1.4));
    onChange(dz(x), -dz(y));
  };
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    id = e.pointerId;
    el.setPointerCapture(id);
    el.classList.add('active');
    update(e);
  });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === id) update(e); });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    el.classList.remove('active');
    knob.style.transform = '';
    onChange(0, 0);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

export function initSticks(app) {
  bindStick($('#stick-left'), (x, y) => { app.rig.stick.x = x; app.rig.stick.y = y; if (x || y) app.rig.cancelTween(); });
  bindStick($('#stick-right'), (x, y) => { app.rig.lookStick.x = x; app.rig.lookStick.y = y; });
}
