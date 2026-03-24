const globals = require('globals');

const sharedRules = {
  'no-undef': 'error',
  'no-redeclare': 'error',
  'no-unreachable': 'error',
};

module.exports = [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.claude/**',
      '.history/**',
      'main-sohu-fix.js',
      'main-sohu-fix-v2.js',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.es2021,
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-redeclare': 'error',
      'no-unreachable': 'error',
    },
  },
  {
    files: [
      'main.js',
      'preload.js',
      'content-preload.js',
      'script-manager.js',
      'domain-config.js',
      'build-scripts/**/*.js',
      'ai-agent/**/*.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.es2021,
        ...globals.node,
      },
    },
    rules: sharedRules,
  },
  {
    files: ['renderer.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.es2021,
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: sharedRules,
  },
  {
    files: ['injected-scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.es2021,
        ...globals.browser,
      },
    },
    rules: {
      'no-redeclare': 'error',
      'no-unreachable': 'error',
    },
  },
];
