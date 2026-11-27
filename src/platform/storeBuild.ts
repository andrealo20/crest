/**
 * The Microsoft Store package's frontend (scripts/store-package.ps1 builds it with CREST_STORE, vite.config.ts passes it on).
 * Known at build time, so what the Store leaves out never shows. Undefined env in the Node tests: not the Store.
 */
// Written out in full, not with ?.: Vite's define replaces this exact expression.
export const storeBuild: boolean = import.meta.env !== undefined && !!import.meta.env.CREST_STORE;

/**
 * Tools the Store package leaves out. Files downloads and runs a program not in the package, which the Store's policy 10.2.2
 * on dynamically included code does not allow.
 */
export const NOT_IN_STORE: readonly string[] = ["files"];
