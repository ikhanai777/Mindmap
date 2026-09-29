// Visual themes. Node colors left as `null` resolve against the theme palette,
// so switching theme recolors a map without touching its data.
export const THEMES = {
  void: {
    name: 'Void',
    bg: ['#161a23', '#05060a'],
    fog: '#07080d',
    fogDensity: 0.011,
    accent: '#7CF7FF',
    palette: ['#7CF7FF', '#A78BFA', '#F472B6', '#FBBF24', '#34D399', '#60A5FA', '#FB923C', '#E879F9'],
    text: '#E8F6FF',
    textOutline: '#05060a',
    stars: 0.9,
    bloom: 0.35,
    flat: 0,
    linkAlpha: 0.8,
    grid: '#2a3140',
    nebula: 0.16,
  },
  aurora: {
    name: 'Aurora',
    bg: ['#0c2129', '#130a26'],
    fog: '#0e1024',
    fogDensity: 0.011,
    accent: '#5EEAD4',
    palette: ['#5EEAD4', '#A78BFA', '#818CF8', '#2DD4BF', '#C084FC', '#67E8F9', '#F0ABFC', '#99F6E4'],
    text: '#EEF9FF',
    textOutline: '#0b0c1c',
    stars: 0.7,
    bloom: 0.4,
    flat: 0,
    linkAlpha: 0.8,
    grid: '#2c2f4a',
    nebula: 0.2,
  },
  paper: {
    name: 'Paper',
    bg: ['#faf8f2', '#ece8dd'],
    fog: '#f1eee6',
    fogDensity: 0.006,
    accent: '#0f766e',
    palette: ['#0f766e', '#7c3aed', '#db2777', '#b45309', '#15803d', '#1d4ed8', '#c2410c', '#9333ea'],
    text: '#1d2127',
    textOutline: '#faf8f2',
    stars: 0,
    bloom: 0,
    flat: 1,
    linkAlpha: 0.7,
    grid: '#cfc9bb',
    nebula: 0.14,
  },
  contrast: {
    name: 'High Contrast',
    bg: ['#000000', '#000000'],
    fog: '#000000',
    fogDensity: 0.003,
    accent: '#FFFF00',
    palette: ['#FFFF00', '#00FFFF', '#FF66FF', '#FFFFFF', '#66FF33', '#FF9933', '#66B2FF', '#FF5050'],
    text: '#FFFFFF',
    textOutline: '#000000',
    stars: 0,
    bloom: 0,
    flat: 0.65,
    linkAlpha: 1,
    grid: '#555555',
    nebula: 0.22,
  },
};

export const themeOf = (doc) => THEMES[doc?.theme] || THEMES.void;

/** Resolve display colors for every node: explicit color, else branch palette color. */
export function resolveColors(doc, index, theme) {
  const out = new Map();
  for (const id of index.order) {
    const n = doc.nodes[id];
    if (n.color) { out.set(id, n.color); continue; }
    if (id === doc.rootId) { out.set(id, theme.accent); continue; }
    const parentColor = n.parentId ? out.get(n.parentId) : null;
    if (n.parentId === doc.rootId || !n.parentId) {
      const b = index.branch.get(id);
      out.set(id, theme.palette[((b < 0 ? 0 : b) + 1) % theme.palette.length]);
    } else out.set(id, parentColor || theme.accent);
  }
  return out;
}
