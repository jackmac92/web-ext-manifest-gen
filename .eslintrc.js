module.exports = {
  env: {
    es6: true,
    node: true
  },
  overrides: [
    {
      files: ['src/**/__tests__/*.js'],
      env: {
        jest: true
      }
    }
  ],
  extends: 'eslint:recommended',
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly'
  },
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module'
  },
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
  }
}
