
export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: { extend: { colors: {
    brand: 'rgb(var(--brand) / <alpha-value>)', brand2: 'rgb(var(--brand-2) / <alpha-value>)', accent: 'rgb(var(--accent) / <alpha-value>)',
    surface: 'rgb(var(--surface) / <alpha-value>)', panel: 'rgb(var(--panel) / <alpha-value>)', ink: 'rgb(var(--ink) / <alpha-value>)',
    muted: 'rgb(var(--muted) / <alpha-value>)', line: 'rgb(var(--line) / <alpha-value>)',
  } } },
};
