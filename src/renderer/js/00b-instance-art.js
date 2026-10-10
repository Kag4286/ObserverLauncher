// js/00b-instance-art.js — deterministic instance avatar art (v4.5.0). Classic script, loads
// right after 00-core.js (before anything that renders the rail). Renders a small abstract
// "identicon" from an integer seed + an accent palette key. Deliberately geometric (NOT Minecraft
// art / cartoon, per DESIGN.md 2.3 / 3.5). Used by the rail avatar, the compact dropdown, and the
// Settings preview tile.

// Map an accent palette key (as stored in settings) to the CSS variable that carries its colour.
// '' = brand default. Unknown keys fall back to brand too. lime -> --brand (the v4 brand IS green).
const INST_ACCENT_VARS = {
  '': 'var(--brand)',
  lime: 'var(--brand)',
  violet: 'var(--violet)',
  orange: 'var(--orange)',
  pink: 'var(--pink)',
  blue: 'var(--blue)',
};
function instAccentCss(key){ return INST_ACCENT_VARS[key] || INST_ACCENT_VARS['']; }
// The order the picker shows swatches in (also the persisted set; see settings.INSTANCE_ACCENTS).
const INST_ACCENT_KEYS = ['', 'lime', 'violet', 'orange', 'pink', 'blue'];

// Initials for the avatar: first letters of the first two words, uppercase, max 2 chars.
// 'Survival' -> 'SU'; 'My Big Server' -> 'MB'; empty -> '··'.
function instInitials(name){
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '\u00b7\u00b7';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// mulberry32 — a tiny deterministic PRNG so the same seed always paints the same art.
function instRng(seed){
  let s = (Number(seed) || 0) >>> 0;
  if (!s) s = 0x9E3779B9;
  return function(){
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build the SVG markup for one instance avatar: a 5x5 mirrored identicon tinted with the accent.
// Returns an SVG string (safe: only numbers + a whitelisted CSS var go into it).
function instanceArt(seed, accentKey){
  const rnd = instRng(seed);
  const accent = instAccentCss(accentKey);
  const cells = [];
  for (let y = 0; y < 5; y++){
    for (let x = 0; x < 3; x++){
      if (rnd() > 0.45) cells.push([x, y]);
    }
  }
  const all = cells.concat(cells.map(([x, y]) => [4 - x, y]));
  const rects = all.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1" rx=".16"/>`).join('');
  return `<svg viewBox="0 0 5 5" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="fill:${accent}" aria-hidden="true">${rects}</svg>`;
}

// The full inner markup of an instance avatar tile: art layer + initials + a small status dot.
// `st` is the status class suffix ('running' | 'stopped' | ...). accentKey '' -> brand.
function instAvatarHtml(name, seed, accentKey, st){
  const initials = esc(instInitials(name));
  const accent = instAccentCss(accentKey);
  return '<span class="inst-avatar" style="--inst-accent:' + accent + '">'
    + '<span class="inst-art">' + instanceArt(seed, accentKey) + '</span>'
    + '<span class="inst-initials">' + initials + '</span>'
    + '<span class="inst-dot st-' + esc(st || 'stopped') + '"></span>'
    + '</span>';
}
