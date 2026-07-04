/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['selector', '.dark-theme'],
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand indigo ramp — matches the Material $primary-palette in
        // src/styles.scss. Keep the two in sync if the brand color changes.
        primary: {
          50: '#E8EAF6',
          100: '#C5CAE9',
          200: '#9FA8DA',
          300: '#7986CB',
          400: '#5C6BC0',
          500: '#3F51B5',
          600: '#3949AB',
          700: '#303F9F',
          800: '#283593',
          900: '#1A237E',
        },
        // Semantic aliases resolved from the CSS custom-property tokens in
        // src/styles.scss, so these utilities follow the active theme without
        // dark: pairs. (No alpha modifiers — the vars carry opaque colors.)
        income: 'var(--color-income)',
        'income-text': 'var(--color-income-text)',
        'income-soft': 'var(--color-income-light)',
        expense: 'var(--color-expense)',
        'expense-text': 'var(--color-expense-text)',
        'expense-soft': 'var(--color-expense-light)',
        success: 'var(--color-success)',
        'success-soft': 'var(--color-success-light)',
        error: 'var(--color-error)',
        'error-soft': 'var(--color-error-light)',
        warning: 'var(--color-warning)',
        'warning-soft': 'var(--color-warning-light)',
        info: 'var(--color-info)',
        'info-soft': 'var(--color-info-light)',
      },
      fontFamily: {
        sans: ['"PT Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
