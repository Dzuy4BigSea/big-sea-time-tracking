import type { Config } from 'tailwindcss'

/**
 * Track2 — Big Sea brand skin.
 * Hexes from the 2024 Big Sea Brand Guidelines; where a guideline hex fails WCAG AA at UI text
 * sizes, a darkened "derived" partner is used (documented inline).
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          // ---- PRIMARY ACCENT (was brand.orange's role) ----
          teal: '#004348', // active nav, tabs, timer, PM tags, links, focus, invoice header
          'teal-d': '#00343a', // hover / pressed
          'teal-l': '#0a6d74', // icons / hover on dark
          'teal-50': '#e8f2f2', // replaces every orange-50 fill

          // ---- PRIMARY ACTION / SUCCESS (was brand.green) ----
          green: '#047a44', // button fill, positive figures (derived from neon, AA-safe)
          'green-d': '#036538',
          'green-50': '#e6f7ee',
          'green-neon': '#08f477', // dots / charts / sparklines ONLY

          // ---- SUPPORTING BRIGHTS (accents, dots, data-viz — never body text) ----
          aqua: '#08f4ca', // running-timer pulse, live indicators
          blue: '#5180eb', // chart series, open/T&M dots
          pink: '#fb5eea', // chart series, fixed-fee dots
          coral: '#ff554c', // overdue dots, over-budget bars
          lime: '#bbfd50', // warning dots, rope motif, chart series

          // ---- SUPPORTING DEEPS (text-safe) ----
          navy: '#1a2e6c', // open / Time & Materials text
          purple: '#341162', // fixed-fee text
          maroon: '#501124',
          ink: '#0d2022', // primary body text / dark surfaces (sidebar, headers)
          stone: '#605f56', // labels, meta, muted text

          // ---- DERIVED STATUS TEXT (AA-safe partners for the brights) ----
          'coral-d': '#c9342c',
          'coral-50': '#ffecea',
          'lime-d': '#55700a',
          'lime-50': '#f4ffe2',
          'navy-50': '#eef1fb',
          'purple-50': '#f3eafa',
        },
      },
      fontFamily: {
        sans: ['"Poppins"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        serif: ['"Fraunces"', 'ui-serif', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}

export default config
