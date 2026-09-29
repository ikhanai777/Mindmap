// Long-press radial menu: Add child, Link, Color, Note, Collapse, Delete (+ Select in the middle).
import { get } from '../store.js';
import * as A from '../actions.js';
import { getIndex } from '../model.js';
import { themeOf } from '../themes.js';
import { $, h, haptic } from './util.js';

export function initRadial(app) {
  const root = $('#radial');
  const pop = $('#popover');
  let armed = false;

  function close() {
    root.classList.remove('open');
    root.hidden = true;
    root.replaceChildren();
  }

  function colorPopover(ids, x, y, onDone) {
    const theme = themeOf(get().doc);
    const apply = (c) => {
      A.updateNodes(ids, { color: c }, { label: 'Color' });
      pop.hidden = true;
      haptic('light');
      onDone?.();
    };
    pop.replaceChildren(
      h('button.swatch.auto', { 'aria-label': 'Automatic color', onclick: () => apply(null) }),
      ...theme.palette.map((c) => h('button.swatch', { style: { background: c }, 'aria-label': 'Color ' + c, onclick: () => apply(c) })),
    );
    pop.hidden = false;
    const w = pop.offsetWidth, hh = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + 'px';
    pop.style.top = Math.max(8, Math.min(window.innerHeight - hh - 8, y - hh - 20)) + 'px';
    const outside = (e) => {
      if (!pop.contains(e.target)) { pop.hidden = true; document.removeEventListener('pointerdown', outside, true); }
    };
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  }

  function open(id, x, y) {
    const doc = get().doc;
    const n = doc.nodes[id];
    if (!n) return;
    const hasKids = getIndex(doc).kids(id).length > 0;
    const items = [
      { icon: '＋', label: 'Add child', run: () => app.startQuickAdd(id) },
      { icon: '🔗', label: 'Link', run: () => app.startLink(id) },
      { icon: '🎨', label: 'Color', run: () => colorPopover([id], x, y) },
      { icon: '📝', label: 'Note', run: () => { app.select(id); app.sheet.open(id, 'full'); } },
      { icon: n.collapsed ? '⊕' : '⊖', label: n.collapsed ? 'Expand' : 'Collapse', run: () => A.toggleCollapse(id), disabled: !hasKids },
      { icon: '🗑', label: 'Delete', run: () => app.deleteWithUndo([id]), danger: true, disabled: id === doc.rootId && !hasKids },
    ];
    const R = 84;
    // keep the ring on screen
    const cx = Math.max(R + 34, Math.min(window.innerWidth - R - 34, x));
    const cy = Math.max(R + 60, Math.min(window.innerHeight - R - 34, y));
    root.replaceChildren();
    items.forEach((it, i) => {
      const a = -Math.PI / 2 + (i / items.length) * Math.PI * 2;
      const btn = h('button.r-item' + (it.danger ? '.danger' : ''), {
        role: 'menuitem',
        disabled: it.disabled,
        style: { left: cx + Math.cos(a) * R + 'px', top: cy + Math.sin(a) * R + 'px', transitionDelay: i * 18 + 'ms', opacity: it.disabled ? 0.35 : null },
        onclick: (e) => { e.stopPropagation(); if (!armed) return; close(); it.run(); haptic('light'); },
      }, h('b', { 'aria-hidden': 'true' }, it.icon), it.label);
      root.append(btn);
    });
    root.append(h('button.r-item.r-center', {
      role: 'menuitem',
      style: { left: cx + 'px', top: cy + 'px' },
      onclick: (e) => { e.stopPropagation(); if (!armed) return; close(); app.startMulti(id); },
    }, 'Select'));
    root.hidden = false;
    // the finger that long-pressed is still down: its lift must not "click" the item under it
    armed = false;
    root.onpointerdown = (e) => { armed = true; if (e.target === root) close(); };
    requestAnimationFrame(() => root.classList.add('open'));
    haptic('medium');
  }

  return { open, close, colorPopover, get isOpen() { return !root.hidden; } };
}
