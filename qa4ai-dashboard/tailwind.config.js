/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: '#f6f8fa',
          overlay: '#ffffff',
          subtle:  '#eaeef2',
          inset:   '#f0f0f0',
        },
        fg: {
          DEFAULT: '#24292f',
          muted:   '#57606a',
          subtle:  '#6e7781',
        },
        border: {
          DEFAULT: '#d0d7de',
          muted:   '#eaeef2',
        },
        accent: {
          DEFAULT:  '#0969da',
          muted:    '#218bff',
          emphasis: '#0550ae',
        },
        success: { DEFAULT: '#1a7f37', muted: '#dafbe1', emphasis: '#0f5323' },
        danger:  { DEFAULT: '#cf222e', muted: '#ffebe9', emphasis: '#a40e26' },
        warning: { DEFAULT: '#9a6700', muted: '#fff8c5', emphasis: '#7d4e00' },
        severe:  { DEFAULT: '#bc4c00', muted: '#ffe4cc' },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
    },
  },
  plugins: [],
}
