import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#0B0B0C',
          panel: '#111214',
          text: '#E6E7E9',
          muted: '#9AA0A6',
          ring: '#272B33',
          blue: '#2B7FFF',
          orange: '#FF7A00',
        },
      },
      fontFamily: {
        mono: ['Menlo', 'Fira Code', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  prefix: 'bk-',
  darkMode: 'class',
} satisfies Config;
