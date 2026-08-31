// theme module — handles CYAN / CRT / AMBER / MONO switching
const THEMES = ['default', 'crt', 'amber', 'mono'];
let currentTheme = localStorage.getItem('theme') || 'default';

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = 'default';
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme === 'default' ? '' : theme);
  document.documentElement.classList.add('theme-anim');
  setTimeout(() => document.documentElement.classList.remove('theme-anim'), 400);
  const buttons = document.querySelectorAll('#themeCtl button');
  buttons.forEach(btn => {
    const isOn = btn.getAttribute('data-t') === theme;
    btn.classList.toggle('on', isOn);
  });
  localStorage.setItem('theme', theme);
}

export function initTheme() {
  const stored = localStorage.getItem('theme') || 'default';
  applyTheme(stored);
  document.querySelectorAll('#themeCtl button').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.getAttribute('data-t'));
    });
  });
}

export { currentTheme, applyTheme };
