module.exports = {
    extends: 'airbnb-base',
    rules: {
        'no-underscore-dangle': 'off',
        'no-param-reassign': 'off',
        'import/no-cycle': 'off',
        'no-restricted-syntax': 'off',
        'no-continue': 'off',
        'no-console': 'off',
        'import/prefer-default-export': 'off',
        'no-await-in-loop': 'off',
        'no-void': 'off',
        indent: ['error', 4],
        'max-len': ['warn', {
            code: 120,
        }],
    },
};
