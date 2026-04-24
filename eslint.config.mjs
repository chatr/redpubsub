import js from '@eslint/js';
import {defineConfig} from 'eslint/config';
import globals from 'globals';


export default defineConfig([
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser,
                ...globals.meteor
            }
        }
    }
]);
