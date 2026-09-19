/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // IronNest palette — deep petrol sidebar/buttons, warm cream canvas, golden accent.
        // `emerald` is intentionally remapped so every existing emerald-* utility
        // renders in the petrol-teal brand ramp without touching component code.
        emerald: {
          50: '#EDF3F1',
          100: '#DCE9E3',
          200: '#B7D4C7',
          300: '#86B3A2',
          500: '#1B7A64',
          600: '#116149',
          700: '#0E5446',
          800: '#0C3F36',
          900: '#0A2F2A',
        },
        pine: {
          50: '#EDF3F1',
          100: '#DCE9E3',
          200: '#B7D4C7',
          600: '#116149',
          700: '#0E4A3E',
          800: '#0C3B34',
          900: '#0A2E29',
          950: '#07211E',
        },
        ink: {
          DEFAULT: '#10333D',
          soft: '#3D5A63',
          faint: '#7A9096',
        },
        cream: {
          DEFAULT: '#F3F1E8',
          deep: '#ECE9DB',
        },
        gold: {
          50: '#FBF4E0',
          100: '#F6E8C3',
          200: '#EFD9A0',
          300: '#E8C86E',
          400: '#E3B84E',
          500: '#D9A62E',
          600: '#B9861F',
          DEFAULT: '#F2C14E',
        },
        pastel: {
          mint: '#BFE3C6',
          butter: '#F7ECCB',
          lilac: '#D8D2E6',
          sage: '#BCD6D2',
          rose: '#F3D3CF',
          sky: '#C6DDEC',
        },
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
        slate: {
          850: '#151f32',
          950: '#0b1120',
        }
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
}
