module.exports = {
  root: true,
  extends: ['next', 'next/core-web-vitals'],
  ignorePatterns: [
    'sdk/**/*',
    'types/**/*',
    'e2e/**/*',
    '__tests__/**/*',
    'vitest.config.ts',
    'playwright.config.ts',
    'tailwind.config.js',
    'next.config.js',
  ],
  rules: {
    'react-hooks/exhaustive-deps': 'off',
    '@next/next/no-img-element': 'off',
  },
}
