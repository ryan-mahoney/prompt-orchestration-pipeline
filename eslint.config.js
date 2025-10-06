import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  // Base JavaScript configuration
  js.configs.recommended,

  // React configuration
  {
    files: ["**/*.{js,jsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "react/prop-types": "off",
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^(React|_)",
        },
      ],
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        // Browser globals for React components
        console: "readonly",
        document: "readonly",
        alert: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        navigator: "readonly",
        DataTransfer: "readonly",
        AbortController: "readonly",
        TextDecoder: "readonly",
        EventSource: "readonly",
        performance: "readonly",
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  },

  // Node.js/CommonJS files configuration
  {
    files: ["src/**/*.js", "tests/**/*.js"],
    languageOptions: {
      globals: {
        // Node.js globals
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
        global: "readonly",
        // Browser globals
        fetch: "readonly",
        FormData: "readonly",
        navigator: "readonly",
        DataTransfer: "readonly",
        AbortController: "readonly",
        TextDecoder: "readonly",
        EventSource: "readonly",
        performance: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^(React|_)",
        },
      ],
      "no-console": "off",
      "no-undef": "off",
      "no-empty": "warn",
      "react/prop-types": "off",
    },
  },

  // Ignore patterns
  {
    ignores: [
      "**/dist/**",
      "node_modules/**",
      "coverage/**",
      "demo/**",
      ".clinerules/**",
      "*.config.js",
      "test-functional-api.js",
    ],
  },
];
