import js from '@eslint/js';

export default [
    js.configs.recommended,
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
            },
        },
        rules: {
            'no-shadow': 'error',
            'no-invalid-this': 'error',
            'no-throw-literal': 'error',
            'no-template-curly-in-string': 'error',
            'no-restricted-globals': ['error', 'window'],
            'no-await-in-loop': 'error',
            'no-return-await': 'error',
            'require-atomic-updates': 'error',
            'consistent-return': 'error',
            'no-unsafe-optional-chaining': 'error',
            'eqeqeq': ['error', 'smart'],
            'no-promise-executor-return': 'error',
            'no-constant-binary-expression': 'error',
        },
    },
];
