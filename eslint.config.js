// Lint rules: the ESLint recommended set, applied to the right kind of file (Node CommonJS on the server, ES modules and
// browser globals in the browser code, a worker for sw.js). Run with `npm run lint`.
const js = require('@eslint/js');
const globals = require('globals');

const common = { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }], 'no-empty': ['error', { allowEmptyCatch: true }] };

module.exports = [
  { ignores: ['node_modules/**', 'data/**', 'output/**', 'plugins/**', 'public/icons/**'] },
  js.configs.recommended,
  { files: ['**/*.js'], rules: common },
  // Server, scripts, tests and each game's server.js: Node, CommonJS.
  {
    files: ['server/**/*.js', 'scripts/**/*.js', 'test/**/*.js', 'test-support/**/*.js', 'games/*/server.js', 'examples/*/server.js', 'eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  // Browser pages, game screens and mini-games: ES modules in the browser.
  {
    files: ['public/**/*.js', 'games/*/public/**/*.js', 'minigames/**/*.js', 'examples/*/public/**/*.js', 'examples/*/client.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.browser } },
  },
  { files: ['public/sw.js'], languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } } },
];
