import sdk from "../../src-tauri/src/plugins/sdk.js?raw";
import html from "../../examples/plugins/hello-crest/index.html?raw";
import css from "../../examples/plugins/hello-crest/style.css?raw";
import app from "../../examples/plugins/hello-crest/app.js?raw";

/** The sample plugin as one document: the SDK first, then its page with the style and script inlined (as Crest serves it, minus the folder). */
export function pluginPage(): string {
  return html
    .replace('<link rel="stylesheet" href="style.css" />', () => `<style>${css}</style>`)
    .replace('<script src="app.js"></script>', () => `<script>${app}</script>`)
    .replace(/<!doctype html>/i, () => `<!doctype html><script>${sdk}</script>`);
}

export function getPluginPage(_id?: string): string {
  return pluginPage();
}
