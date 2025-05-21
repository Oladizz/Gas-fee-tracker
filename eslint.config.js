// eslint.config.js - Flat configuration (Simplified)

const globals = require('globals');
const js = require('@eslint/js');
const prettierConfig = require('eslint-config-prettier'); // Rules that disable ESLint styling for Prettier
const prettierPlugin = require('eslint-plugin-prettier'); // The Prettier plugin itself

module.exports = [
    // 1. Basic ESLint recommended configuration
    js.configs.recommended,

    // 2. Custom language options and global settings
    {
        languageOptions: {
            ecmaVersion: 12, // From original parserOptions
            sourceType: 'commonjs', // Inferred from original 'env: { commonjs: true }'
            globals: {
                ...globals.node, // From original 'env: { node: true }'
                ...globals.commonjs, // From original 'env: { commonjs: true }'
            },
        },
        // Apply to all JS files
        files: ['**/*.js'],
    },

    // 3. Prettier integration
    // This combines eslint-config-prettier (disables conflicting rules)
    // and eslint-plugin-prettier (adds prettier rule)
    {
        plugins: {
            prettier: prettierPlugin,
        },
        rules: {
            ...prettierConfig.rules, // Apply prettierConfig to disable conflicting ESLint rules
            'prettier/prettier': 'error', // Report Prettier violations as ESLint errors
            'no-console': 'off', // Allow console.log (from original .eslintrc.js)
        },
        // Apply to all JS files
        files: ['**/*.js'],
    },
];
