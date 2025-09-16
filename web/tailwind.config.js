/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: '#f8fafc',
          foreground: '#0f172a',
        },
        surface: {
          DEFAULT: '#ffffff',
          foreground: '#111827',
        },
        muted: {
          DEFAULT: '#e2e8f0',
          foreground: '#334155',
        },
        primary: {
          DEFAULT: '#1d4ed8',
          foreground: '#ffffff',
        },
        secondary: {
          DEFAULT: '#0f172a',
          foreground: '#f8fafc',
        },
        accent: {
          DEFAULT: '#0f766e',
          foreground: '#ecfdf5',
        },
        success: {
          DEFAULT: '#047857',
          foreground: '#ecfdf5',
        },
        info: {
          DEFAULT: '#0369a1',
          foreground: '#f0f9ff',
        },
        warning: {
          DEFAULT: '#b45309',
          foreground: '#fefce8',
        },
        danger: {
          DEFAULT: '#b91c1c',
          foreground: '#fef2f2',
        },
      },
    },
  },
  plugins: [],
}
