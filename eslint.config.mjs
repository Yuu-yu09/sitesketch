import js from "@eslint/js";

/*
 * Lint rules chosen from this project's own bug history, not from a default
 * preset. Each rule below corresponds to something that actually shipped
 * broken here and was found by a test or by measurement, never by reading
 * the code - which is the argument for having a linter at all.
 *
 *   no-shadow          -> link(pageId, ...) shadowed the enclosing pageId,
 *                         making pageId === pageId always true so every nav
 *                         link rendered as aria-current
 *   no-unused-vars     -> leftovers from refactors; also catches a renamed
 *                         binding still being read (items.length below)
 *   no-undef           -> typos in identifiers, including ones that resolve
 *                         to something unintended
 *   no-constant-condition, no-self-compare
 *                      -> the shape of a comparison that can only be true
 *   eqeqeq             -> loose equality hides null/undefined confusion
 *   no-implicit-globals -> this codebase is plain scripts, so a bare
 *                         assignment leaking to window is a real risk
 */
export default [
  js.configs.recommended,
  {
    /* Third-party, minified. Linting it produced 691 of the 876 errors and
       told us nothing: nobody here is going to fix SortableJS.
       This has to be its own entry - `ignores` alongside `files` does not
       exclude anything. */
    ignores: ["static/js/vendor/**"],
  },
  {
    files: ["static/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        localStorage: "readonly",
        getComputedStyle: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        requestAnimationFrame: "readonly",
        CustomEvent: "readonly",
        Event: "readonly",
        console: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        AbortController: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Sortable: "readonly",
        api: "readonly",
        /* This is a plain-script codebase: these are published on window by
           other files and used across them. Declaring them is what makes
           no-undef worth having - left undeclared it reported 148 of them,
           every one a false alarm, which is how a useful rule gets ignored. */
        API: "readonly",
        SS: "readonly",
        DESIGN: "readonly",
        Editor: "readonly",
        EditorUI: "readonly",
        History: "readonly",
        Crop: "readonly",
        Consent: "readonly",
        Mascot: "readonly",
        IntersectionObserver: "readonly",
        parent: "readonly",
        top: "readonly",
      },
    },
    rules: {
      "no-shadow": "error",
      /* caughtErrors: "none" because `catch (e) { /* ignore *\/ }` is used
         deliberately throughout - a named binding with a comment saying why
         is clearer than optional catch binding, and reporting 19 of those
         every run is how a useful rule gets switched off. */
      "no-unused-vars": ["error", {
        args: "none",
        caughtErrors: "none",
        varsIgnorePattern: "^_",
      }],
      "no-undef": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-self-compare": "error",
      "no-implicit-globals": "error",
      "no-implied-eval": "error",
      "no-fallthrough": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-sparse-arrays": "error",
      "no-func-assign": "error",
      "no-cond-assign": "error",
      "no-control-regex": "error",
      "no-debugger": "error",
      "no-var": "off",
    },
  },
];