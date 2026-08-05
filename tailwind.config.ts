import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Harvest-ish accents
        brand: { orange: '#fb5c31', green: '#3aa76d', teal: '#004348' },
      },
    },
  },
  plugins: [],
}

export default config
