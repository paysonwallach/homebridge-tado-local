import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default tseslint.config(
  {
    ignores: ["dist/**"],
  },
  {
    rules: {
      "dot-notation": "error",
      eqeqeq: ["error", "smart"],
      curly: ["error", "all"],
      "prefer-arrow-callback": "warn",
      "no-use-before-define": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-use-before-define": [
        "error",
        { classes: false, enums: false },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { caughtErrors: "none" }],
    },
    files: ["**/*.ts", "**/*.tsx"],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
);
