/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        skylogic: {
          400: '#38bdf8',
          500: '#0ea5e9',
          900: '#0c1f3f',
        },
      },
    },
  },
  plugins: [],
}
