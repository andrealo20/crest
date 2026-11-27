/**
 * The Microsoft Store package's frontend (scripts/store-package.ps1 builds it with CREST_STORE, vite.config.ts passes it on).
 * Known at build time, so what the Store leaves out never shows. Undefined env in the Node tests: not the Store.
 */
// Written out in full, not with ?.: Vite's define replaces this exact expression.
export const storeBuild: boolean = import.meta.env !== undefined && !!import.meta.env.CREST_STORE;

