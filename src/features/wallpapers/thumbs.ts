// The collection's thumbnails, bundled with the app, by id. Their own file: the tests' node knows no import.meta.glob.
// The Store package leaves out the six pictures of unknown source: its build loads their thumbnails as "" (vite.config.ts), so
// they are not here, and the gallery shows only the pictures that have a thumbnail.

const files = import.meta.glob<string>("../../assets/wallpapers/*.jpg", { eager: true, import: "default" });

export const THUMBS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(files)
    .filter(([, url]) => url)
    .map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -".jpg".length), url]),
);
