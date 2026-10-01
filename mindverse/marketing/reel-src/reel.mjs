// Capture real footage of Mindverse for a 1080x1920 Instagram reel.
// The page's animation clock (rAF, performance.now, setTimeout) is virtual
// and advanced one video frame at a time, so motion is smooth regardless of
// how slowly the software renderer runs.
// usage: node reel.mjs <outDir> <scene> [<scene> ...]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || '/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const FPS = Number(process.env.FPS || 24);
const URL_ = 'http://localhost:4174/';
const [outDir, ...sceneNames] = process.argv.slice(2);

// ---------------------------------------------------------------- page-side virtual clock

const clockInit = () => {
  let vt = 0;
  let raf = [];
  let timers = [];
  let tid = 1;
  const realRAF = window.requestAnimationFrame.bind(window);
  const keepAlive = () => realRAF(keepAlive);
  keepAlive(); // keep the compositor producing frames for screenshots
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => (raf.push(cb), raf.length);
  window.setTimeout = (fn, ms = 0, ...args) => {
    const id = tid++;
    timers.push({ id, at: vt + ms, fn: () => fn(...args) });
    return id;
  };
  window.clearTimeout = (id) => (timers = timers.filter((x) => x.id !== id));
  window.__step = (ms) => {
    vt += ms;
    const due = timers.filter((x) => x.at <= vt);
    timers = timers.filter((x) => x.at > vt);
    due.forEach((x) => x.fn());
    const run = raf;
    raf = [];
    run.forEach((cb) => cb(vt));
    window.__reel?.update(vt);
  };
};

// ---------------------------------------------------------------- overlay (captions, finger, title cards)

const overlayInit = () => {
  const css = `
  .statusbar, .toast, .inspector { display: none !important; }
  body.inspecting .quick { display: flex !important; }
  body.inspecting .quick[hidden] { display: none !important; }
  #modal-body > p { display: none; } .modal h2 { margin-bottom: 10px; }
  .modal { place-items: start center !important; padding-top: 150px !important; background: rgba(0,3,10,.35) !important; }
  .modal textarea { min-height: 120px !important; height: 120px; }
  #reel-cap { position: fixed; left: 0; right: 0; top: 64%; z-index: 50; text-align: center; pointer-events: none; padding: 0 22px; }
  #reel-cap .k { font: 800 11px/1 Orbitron, sans-serif; letter-spacing: .32em; color: #29e0d8; text-shadow: 0 0 10px rgba(41,224,216,.8); margin-bottom: 10px; }
  #reel-cap .t { font: 800 29px/1.12 Inter, sans-serif; color: #fff; letter-spacing: -.01em; text-wrap: balance;
     text-shadow: 0 0 18px rgba(62,168,255,.55), 0 2px 12px rgba(0,0,0,.9); }
  #reel-cap .s { margin-top: 10px; font: 500 15px/1.35 Inter, sans-serif; color: #b9d4f0; text-shadow: 0 1px 10px #000; }
  #reel-shade { position: fixed; inset: 0; z-index: 45; pointer-events: none;
     background: linear-gradient(180deg, transparent 52%, rgba(0,0,0,.75) 66%, rgba(0,0,0,.85) 100%); }
  #reel-black { position: fixed; inset: 0; z-index: 60; background: #000; pointer-events: none; display: grid; place-items: center; }
  #reel-hero { position: fixed; inset: 0; z-index: 61; display: grid; place-items: center; text-align: center; pointer-events: none; padding: 0 28px;
     font: 800 38px/1.1 Inter, sans-serif; color: #fff; text-shadow: 0 0 24px rgba(62,168,255,.6); }
  #reel-hero em { font-style: normal; background: linear-gradient(90deg,#7fd4ff,#29e0d8 45%,#c9a0ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
  #reel-finger { position: fixed; z-index: 70; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; pointer-events: none;
     background: radial-gradient(circle, rgba(255,255,255,.85) 0 30%, rgba(255,255,255,.25) 31% 60%, transparent 62%);
     box-shadow: 0 0 18px rgba(120,220,255,.9); }
  #reel-ripple { position: fixed; z-index: 69; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; pointer-events: none; border: 2px solid #9ff3ff; }
  #reel-outro { position: fixed; inset: 0; z-index: 62; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; text-align: center;
     background: radial-gradient(circle at 50% 45%, rgba(0,8,20,.55), rgba(0,0,0,.92) 70%); }
  #reel-outro img { width: 116px; height: 116px; filter: drop-shadow(0 0 24px rgba(41,224,216,.7)); }
  #reel-outro .name { font: 800 34px/1 Orbitron, sans-serif; letter-spacing: .2em; padding-left: .2em;
     background: linear-gradient(90deg,#7fd4ff,#29e0d8 45%,#c9a0ff); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 10px rgba(41,224,216,.5)); }
  #reel-outro .tag { font: 600 19px/1.3 Inter, sans-serif; color: #e6f3ff; }
  #reel-outro .cta { margin-top: 16px; font: 700 15px/1 Inter, sans-serif; color: #021018; padding: 14px 22px; border-radius: 999px;
     background: linear-gradient(135deg,#29e0d8,#3ea8ff); box-shadow: 0 0 28px rgba(41,224,216,.6); }
  #reel-outro .small { font: 500 13px/1.4 Inter, sans-serif; color: #8aa3c2; }
  `;
  document.head.append(Object.assign(document.createElement('style'), { textContent: css }));
  const el = (id, html = '') => {
    const d = document.createElement('div');
    d.id = id;
    d.innerHTML = html;
    d.style.opacity = 0;
    document.body.append(d);
    return d;
  };
  const shade = el('reel-shade');
  const cap = el('reel-cap', '<div class="k"></div><div class="t"></div><div class="s"></div>');
  const black = el('reel-black');
  const hero = el('reel-hero');
  const finger = el('reel-finger');
  const ripple = el('reel-ripple');
  const outro = el('reel-outro');
  const ease = (x) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
  const st = { cap: null, capAt: 0, capOut: null, ripAt: -1e9, outroAt: null, black: 0, hero: null, heroAt: 0, heroOut: null, vt: 0 };
  window.__reel = {
    caption(k, t, s) {
      cap.querySelector('.k').textContent = k || '';
      cap.querySelector('.t').textContent = t;
      cap.querySelector('.s').textContent = s || '';
      st.cap = true;
      st.capAt = st.vt;
      st.capOut = null;
    },
    captionOut() { st.capOut = st.vt; },
    black(v) { st.black = v; },
    hero(html) { hero.innerHTML = `<div>${html}</div>`; st.heroAt = st.vt; st.heroOut = null; st.hero = true; },
    heroOut() { st.heroOut = st.vt; },
    finger(x, y, show = true) { finger.style.left = x + 'px'; finger.style.top = y + 'px'; finger.style.opacity = show ? 1 : 0; ripple.style.left = x + 'px'; ripple.style.top = y + 'px'; },
    tap() { st.ripAt = st.vt; },
    outro(img) {
      outro.innerHTML = `<img src="${img}" alt=""><div class="name">MINDVERSE</div><div class="tag">Think in three dimensions.</div>
        <div class="cta">Get it on Android</div><div class="small">3D mind maps · works offline · your maps stay on your phone</div>`;
      st.outroAt = st.vt;
    },
    topbar(v) { document.querySelector('.topbar').style.opacity = v; },
    update(vt) {
      st.vt = vt;
      if (st.cap) {
        const p = ease((vt - st.capAt) / 450);
        const q = st.capOut != null ? 1 - ease((vt - st.capOut) / 300) : 1;
        cap.style.opacity = Math.min(p, q);
        cap.style.transform = `translateY(${(1 - p) * 18}px)`;
        shade.style.opacity = Math.min(p, q);
      }
      black.style.opacity = st.black;
      if (st.hero) {
        const p = ease((vt - st.heroAt) / 500);
        const q = st.heroOut != null ? 1 - ease((vt - st.heroOut) / 400) : 1;
        hero.style.opacity = Math.min(p, q);
        hero.style.transform = `scale(${0.94 + 0.06 * p})`;
      }
      const r = (vt - st.ripAt) / 450;
      ripple.style.opacity = r >= 0 && r < 1 ? 1 - r : 0;
      ripple.style.transform = `scale(${1 + r * 1.6})`;
      if (st.outroAt != null) {
        const p = ease((vt - st.outroAt) / 700);
        outro.style.opacity = p;
        outro.style.transform = `scale(${0.96 + 0.04 * p})`;
      }
    },
  };
};

// ---------------------------------------------------------------- driver

async function open(browser) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.addInitScript(clockInit);
  await page.goto(URL_);
  await page.waitForFunction(() => window.mindverse && document.fonts.status === 'loaded', null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.evaluate(overlayInit);
  // frame the map in the upper part of the screen, above the captions
  await page.evaluate(() => {
    const { world } = window.mindverse;
    const cam = world.camera;
    const H = 640;
    cam.setViewOffset(360, H, 0, H * 0.1, 360, H);
    cam.updateProjectionMatrix();
    for (let i = 0; i < 30; i++) window.__step(1000 / 24);
  });
  return { ctx, page };
}

function recorder(page, dir) {
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const shot = async () => {
    await page.evaluate((ms) => window.__step(ms), 1000 / FPS);
    await page.screenshot({ path: `${dir}/f${String(n++).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 93, timeout: 180000 });
  };
  return {
    get count() { return n; },
    async hold(sec) { for (let i = 0, k = Math.round(sec * FPS); i < k; i++) await shot(); },
    // run fn(t in 0..1) in the page before each frame
    async tween(sec, fn, arg) {
      const k = Math.round(sec * FPS);
      for (let i = 1; i <= k; i++) {
        await page.evaluate(([src, t, a]) => new Function('t', 'a', src)(t, a), [fn, i / k, arg]);
        await shot();
      }
    },
    shot,
  };
}

// helpers evaluated in the page
const setCam = `
  const { world, mind } = window.mindverse;
  mind.fly = null;
  const [az, el, dist, tx = 0, ty = 0, tz = 0] = a;
  world.controls.target.set(tx, ty, tz);
  world.camera.position.set(tx + dist * Math.sin(az) * Math.cos(el), ty + dist * Math.sin(el), tz + dist * Math.cos(az) * Math.cos(el));
  world.controls.update();`;

const nodePos = (page, title) =>
  page.evaluate((title) => {
    const { map, mind } = window.mindverse;
    const n = Object.values(map.nodes).find((x) => x.title === title);
    return { id: n.id, ...mind.screenPosition(n.id) };
  }, title);

const center = (page, sel) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);

async function moveFinger(page, rec, from, to, sec, { drag = false } = {}) {
  const k = Math.round(sec * FPS);
  for (let i = 1; i <= k; i++) {
    const t = i / k;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const x = from.x + (to.x - from.x) * e;
    const y = from.y + (to.y - from.y) * e;
    await page.evaluate(([x, y]) => window.__reel.finger(x, y), [x, y]);
    if (drag) await page.mouse.move(x, y);
    await rec.shot();
  }
}

async function tap(page, rec, p) {
  if (process.env.DEBUG) console.log('tap at', p.x.toFixed(0), p.y.toFixed(0), await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e.tagName + '#' + e.id + '.' + e.className; }, [p.x, p.y]));
  await page.evaluate(([x, y]) => (window.__reel.finger(x, y), window.__reel.tap()), [p.x, p.y]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await rec.shot();
  await page.mouse.up();
  await rec.shot();
}

const ICON = 'data:image/svg+xml;base64,' + Buffer.from(require('fs').readFileSync(new URL('../../android/icon.svg', import.meta.url))).toString('base64');

// ---------------------------------------------------------------- scenes

const scenes = {
  // 0:00 hook — black, a line of copy, then the map flies in
  async s1(page, rec) {
    await page.evaluate(() => { window.__reel.topbar(0); window.__reel.black(1); window.__reel.hero('Your ideas<br>aren’t <em>flat.</em>'); });
    await page.evaluate(new Function('a', setCam), [0.9, 0.5, 320]);
    await rec.hold(1.3);
    await page.evaluate(() => window.__reel.heroOut());
    await rec.tween(1.7, `
      const e = 1 - Math.pow(1 - t, 3);
      window.__reel.black(Math.max(0, 1 - t * 2.2));
      ${setCam.replace('const [az, el, dist, tx = 0, ty = 0, tz = 0] = a;', 'const az = 0.9 - 0.9 * e, el = 0.5 - 0.32 * e, dist = 320 - 225 * e, tx = 0, ty = 0, tz = 0;')}
      if (t > 0.35 && !window.__capShown) { window.__capShown = 1; window.__reel.caption('', 'So why is your mind map?', ''); }`);
  },
  // 0:03 orbit
  async s2(page, rec) {
    await page.evaluate(() => { window.__reel.topbar(1); window.__reel.caption('MINDVERSE', 'Mind maps in 3D', 'Orbit, zoom and fly through your ideas'); });
    await rec.tween(4, `
      const e = t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
      ${setCam.replace('const [az, el, dist, tx = 0, ty = 0, tz = 0] = a;', 'const az = -0.75 + 1.4 * e, el = 0.32 - 0.22 * e, dist = 96 - 20 * e, tx = 0, ty = 0, tz = 0;')}`);
  },
  // 0:07 add an idea
  async s3(page, rec) {
    await page.evaluate(new Function('a', setCam), [0.15, 0.12, 82]);
    await page.evaluate(() => window.__reel.caption('BUILD', 'Grow ideas in a tap', 'Select a bubble, tap +, type'));
    await rec.hold(0.4);
    const ai = await nodePos(page, 'Artificial Intelligence');
    await moveFinger(page, rec, { x: 300, y: 560 }, ai, 0.7);
    await tap(page, rec, ai);
    await page.evaluate((id) => window.mindverse.mind.flyTo(id, { distance: 40 }), ai.id);
    await rec.hold(1.2);
    const plus = await center(page, '#quick [data-q="child"]');
    await moveFinger(page, rec, ai, plus, 0.5);
    await tap(page, rec, await center(page, '#quick [data-q="child"]'));
    await page.evaluate(() => window.__reel.finger(0, 0, false));
    // pull back so the new bubble and its branch stay in frame
    await page.evaluate((id) => window.mindverse.mind.flyTo(id, { distance: 58 }), ai.id);
    await rec.hold(0.2);
    for (const ch of 'Quantum AI') {
      await page.keyboard.type(ch);
      await rec.shot();
      await rec.shot();
    }
    await rec.hold(0.3);
    await page.keyboard.press('Enter');
    await rec.hold(1.25);
  },
  // 0:12.5 drag to re-parent
  async s4(page, rec) {
    await page.evaluate(new Function('a', setCam), [0.0, 0.1, 80]);
    await page.evaluate(() => window.__reel.caption('ORGANISE', 'Drag to reorganise', 'Drop a bubble on another to move its branch'));
    await rec.hold(0.3);
    const from = await nodePos(page, 'Ethics');
    await moveFinger(page, rec, { x: 60, y: 560 }, from, 0.5);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.evaluate(() => window.__reel.tap());
    await rec.shot();
    const to = await nodePos(page, 'Genetics');
    await moveFinger(page, rec, from, to, 1.9, { drag: true });
    // settle onto the target so the drop ring shows
    const to2 = await nodePos(page, 'Genetics');
    await page.mouse.move(to2.x, to2.y);
    await page.evaluate(([x, y]) => window.__reel.finger(x, y), [to2.x, to2.y]);
    await rec.hold(0.4);
    await page.mouse.up();
    await page.evaluate(() => window.__reel.finger(0, 0, false));
    await page.evaluate(() => window.mindverse.select(null));
    await rec.hold(1.35);
  },
  // 0:17 search
  async s5(page, rec) {
    await page.evaluate(new Function('a', setCam), [-0.1, 0.12, 82]);
    await page.evaluate(() => window.__reel.caption('FIND', 'Find anything instantly', 'Matches light up, everything else fades back'));
    await rec.hold(0.3);
    const box = await center(page, '#search');
    await moveFinger(page, rec, { x: 200, y: 560 }, box, 0.5);
    await tap(page, rec, box);
    await page.evaluate(() => window.__reel.finger(0, 0, false));
    for (const ch of 'energy') {
      await page.keyboard.type(ch);
      await rec.shot();
      await rec.shot();
    }
    await rec.hold(0.7);
    const first = await center(page, '#search-results li[data-id]');
    await page.evaluate(([x, y]) => window.__reel.finger(x, y), [first.x, first.y]);
    await rec.hold(0.25);
    await tap(page, rec, first);
    await page.evaluate(() => window.__reel.finger(0, 0, false));
    await rec.hold(1.4);
  },
  // 0:21 import an outline
  async s6(page, rec) {
    await page.evaluate(new Function('a', setCam), [0.05, 0.12, 82]);
    await page.evaluate(() => window.__reel.caption('IMPORT', 'Paste a list. Get a 3D map.', 'Outlines, Markdown or JSON'));
    const btn = await center(page, '[data-act="import"]');
    await moveFinger(page, rec, { x: 180, y: 560 }, btn, 0.45);
    await tap(page, rec, btn);
    await page.evaluate(() => window.__reel.finger(0, 0, false));
    await rec.hold(0.3);
    const text = `Trip to Japan\n- Tokyo\n  - Shibuya\n  - Akihabara\n  - Sushi bars\n- Kyoto\n  - Temples\n  - Tea house\n- Osaka\n  - Street food\n  - Castle\n- Packing\n  - JR Pass\n  - Camera`;
    await page.fill('#import-text', text);
    await rec.hold(0.7);
    const go = await center(page, '#import-go');
    await moveFinger(page, rec, { x: 180, y: 300 }, go, 0.4);
    await tap(page, rec, go);
    await page.evaluate(() => window.__reel.finger(0, 0, false));
    await rec.hold(2.3);
  },
  // 0:25.5 outro
  async s7(page, rec, icon) {
    await page.evaluate(() => { window.__reel.topbar(0); });
    await page.evaluate(new Function('a', setCam), [0.4, 0.2, 88]);
    await rec.tween(0.6, `${setCam.replace('const [az, el, dist, tx = 0, ty = 0, tz = 0] = a;', 'const az = 0.4 - 0.12 * t, el = 0.2, dist = 88, tx = 0, ty = 0, tz = 0;')}`);
    await page.evaluate((img) => window.__reel.outro(img), icon);
    await rec.tween(3.4, `${setCam.replace('const [az, el, dist, tx = 0, ty = 0, tz = 0] = a;', 'const az = 0.28 - 0.7 * t, el = 0.2, dist = 88 + 25 * t, tx = 0, ty = 0, tz = 0;')}`);
  },
};

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const name of sceneNames) {
  const t0 = Date.now();
  const { ctx, page } = await open(browser);
  const rec = recorder(page, `${outDir}/${name}`);
  await scenes[name](page, rec, ICON);
  writeFileSync(`${outDir}/${name}/done`, String(rec.count));
  console.log(`${name}: ${rec.count} frames in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  await ctx.close();
}
await browser.close();
