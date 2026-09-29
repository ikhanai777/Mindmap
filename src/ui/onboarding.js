// 3-step interactive tour on the sample map. Skippable, never repeated.
import { $, h } from './util.js';
import { getMeta, setMeta } from '../db.js';

const STEPS = [
  {
    title: 'Your ideas, as a constellation',
    text: 'Drag to turn the globe, pinch to zoom. Tap a glowing node to select it; long-press for more actions.',
    target: null,
  },
  {
    title: 'Capture beats layout',
    text: 'Tap + to add an idea to the selected node. Press Return for a sibling, Tab or swipe right to indent. Hold + to dictate.',
    target: '#btn-add',
  },
  {
    title: 'Orbit, fly or walk',
    text: 'Switch camera modes here. Outline mode (☰) is the fastest brain-dump and works with a screen reader.',
    target: '#dock .segmented',
  },
];

export function initOnboarding() {
  const root = $('#coach');
  let step = 0;

  function render() {
    const s = STEPS[step];
    const spot = h('div.spot');
    const card = h('div.card', { role: 'dialog', 'aria-label': 'Intro' },
      h('h3', s.title),
      h('p', s.text),
      h('div.actions',
        h('button', { onclick: finish }, 'Skip'),
        h('div.dots', STEPS.map((_, i) => h('i' + (i === step ? '.on' : '')))),
        h('button.primary', { onclick: next }, step === STEPS.length - 1 ? 'Start mapping' : 'Next')));
    root.replaceChildren(spot, card);
    const el = s.target && $(s.target);
    if (el) {
      const r = el.getBoundingClientRect();
      const pad = 8;
      Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
      card.style.bottom = window.innerHeight - r.top + 24 + 'px';
    } else {
      Object.assign(spot.style, { left: '50%', top: '45%', width: '0px', height: '0px' });
      card.style.bottom = 'calc(120px + env(safe-area-inset-bottom))';
    }
    card.querySelector('.primary').focus();
  }

  function next() {
    if (step < STEPS.length - 1) { step++; render(); } else finish();
  }

  function finish() {
    root.hidden = true;
    root.replaceChildren();
    setMeta('onboarded', true);
  }

  async function start(force = false) {
    if (!force && (await getMeta('onboarded', false))) return;
    step = 0;
    root.hidden = false;
    render();
  }

  return { start, get active() { return !root.hidden; } };
}
