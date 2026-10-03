/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['selector', '.dark-theme'],
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      colors: {
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
        // The text and border ramps, the surfaces and the brand, by role, for
        // the same reason — and high contrast reaches these too, which a
        // gray-* or indigo-* utility never does. An /alpha modifier on any
        // of them generates nothing, with no warning: Tailwind cannot split a
        // var() into channels. A translucent tint is a color-mix() in the
        // component stylesheet instead.
        fg: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          disabled: 'var(--text-disabled)',
          inverse: 'var(--text-inverse)',
        },
        surface: {
          background: 'var(--surface-background)',
          card: 'var(--surface-card)',
          elevated: 'var(--surface-elevated)',
          hover: 'var(--surface-hover)',
          'hover-active': 'var(--surface-hover-active)',
          active: 'var(--surface-active)',
          subtle: 'var(--surface-subtle)',
          muted: 'var(--surface-muted)',
          strong: 'var(--surface-strong)',
          sunken: 'var(--surface-sunken)',
        },
        line: {
          DEFAULT: 'var(--border-primary)',
          subtle: 'var(--border-secondary)',
          strong: 'var(--border-strong)',
        },
        brand: {
          DEFAULT: 'var(--color-primary)',
          soft: 'var(--color-primary-light)',
          text: 'var(--color-primary-text)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          light: 'var(--color-accent-light)',
        },
        'error-text': 'var(--color-error-text)',
        'warning-text': 'var(--color-warning-text)',
        'success-text': 'var(--color-success-text)',
        ai: 'var(--color-ai)',
      },
      fontFamily: {
        sans: ['"PT Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
