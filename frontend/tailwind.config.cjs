/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,html}',
  ],
  theme: {
    extend: {
      borderRadius: {
        'neo': '0.75rem',    // 12px
        'neo-lg': '1rem',    // 16px
      },
      boxShadow: {
        'neo-lift': '0 4px 20px -4px rgba(0,0,0,0.05), 0 -2px 10px -2px rgba(255,255,255,0.8)',
        'neo-lift-hover': '0 6px 24px -4px rgba(0,0,0,0.08), 0 -2px 12px -2px rgba(255,255,255,0.9)',
        'neo-inset': 'inset 0 2px 4px rgba(0,0,0,0.04)',
        // Dark mode shadows
        'neo-lift-dark': '0 4px 20px -4px rgba(0,0,0,0.4), 0 -2px 10px -2px rgba(255,255,255,0.05)',
        'neo-lift-hover-dark': '0 6px 24px -4px rgba(0,0,0,0.5), 0 -2px 12px -2px rgba(255,255,255,0.08)',
        'neo-inset-dark': 'inset 0 2px 4px rgba(0,0,0,0.2)',
      },
      colors: {
        brand: {
          DEFAULT: 'var(--accent-700)',
          light: 'var(--accent-50)',
          dark: 'var(--accent-800)',
          50: 'var(--accent-50)',
          100: 'var(--accent-100)',
          200: 'var(--accent-200)',
          300: 'var(--accent-300)',
          400: 'var(--accent-400)',
          500: 'var(--accent-500)',
          600: 'var(--accent-600)',
          700: 'var(--accent-700)',
          800: 'var(--accent-800)',
          900: 'var(--accent-900)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          light: 'var(--warning-light)',
          dark: 'var(--warning-dark)',
        },
        info: {
          DEFAULT: 'var(--info)',
          light: 'var(--info-light)',
          dark: 'var(--info-dark)',
        },
        success: {
          DEFAULT: 'var(--success)',
          light: 'var(--success-light)',
          dark: 'var(--success-dark)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          light: 'var(--danger-light)',
          dark: 'var(--danger-dark)',
        },
      },
      zIndex: {
        '55': '55',
        '59': '59',
        '60': '60',
        '70': '70',
        '80': '80',
        '82': '82',
        '83': '83',
        '84': '84',
      },
      keyframes: {
        'cursor-blink': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
      animation: {
        'cursor-blink': 'cursor-blink 1s step-end infinite',
      },
      typography: {
        DEFAULT: {
          css: {
            '--tw-prose-body': 'rgb(63 63 70)',
            '--tw-prose-headings': 'rgb(39 39 42)',
            '--tw-prose-links': 'var(--accent-700)',
            '--tw-prose-bold': 'rgb(39 39 42)',
            '--tw-prose-code': 'var(--accent-700)',
            '--tw-prose-pre-bg': 'rgb(244 244 245)',
            '--tw-prose-pre-code': 'rgb(63 63 70)',
            '--tw-prose-quotes': 'rgb(113 113 122)',
            '--tw-prose-quote-borders': 'var(--accent-700)',
            fontSize: '0.9375rem',
            lineHeight: '1.7',
            'code::before': { content: '""' },
            'code::after': { content: '""' },
            code: {
              backgroundColor: 'rgb(244 244 245)',
              padding: '0.125rem 0.375rem',
              borderRadius: '0.25rem',
              fontWeight: '400',
            },
          },
        },
        invert: {
          css: {
            '--tw-prose-body': 'rgb(212 212 216)',
            '--tw-prose-headings': 'rgb(244 244 245)',
            '--tw-prose-links': 'var(--accent-400)',
            '--tw-prose-bold': 'rgb(244 244 245)',
            '--tw-prose-code': 'var(--accent-300)',
            '--tw-prose-pre-bg': 'rgb(39 39 42)',
            '--tw-prose-pre-code': 'rgb(212 212 216)',
            '--tw-prose-quotes': 'rgb(161 161 170)',
            '--tw-prose-quote-borders': 'var(--accent-400)',
            code: {
              backgroundColor: 'rgb(63 63 70)',
              color: 'var(--accent-300)',
              padding: '0.125rem 0.375rem',
              borderRadius: '0.25rem',
              fontWeight: '400',
            },
            strong: {
              color: 'rgb(244 244 245)',
            },
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
