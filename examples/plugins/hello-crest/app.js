// Hello Crest: a countdown kept in the plugin's storage and a line from GitHub's zen endpoint.
// Everything goes through window.crest (docs/plugins.md); the page itself cannot reach the network.
const $ = (id) => document.getElementById(id);
let endsAt = null;
let notified = false;

/** Crest's theme tokens as CSS variables (--label, --fill-2, --font, ...). */
function applyTheme(theme) {
  for (const [name, value] of Object.entries(theme)) {
    if (value) document.documentElement.style.setProperty(`--${name}`, value);
  }
}

async function loadZen() {
  $("zen").textContent = "…";
  try {
    const r = await crest.fetch("https://api.github.com/zen", { headers: { accept: "text/plain" } });
    $("zen").textContent = r.status === 200 ? r.body.trim() : `GitHub answered ${r.status}.`;
  } catch (e) {
    $("zen").textContent = `No line this time (${e.message}).`;
  }
}

// The page only runs while its tool is open: a countdown that ended meanwhile is announced on the next open.
function render() {
  const left = endsAt ? Math.max(0, endsAt - Date.now()) : 0;
  $("clock").textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}`;
  $("stop").hidden = !endsAt;
  if (endsAt && left === 0 && !notified) {
    notified = true;
    crest.storage.set("notified", true);
    crest.notify("Countdown finished", "Hello from a Crest plugin").catch(() => {});
  }
}

async function start(minutes) {
  endsAt = Date.now() + minutes * 60_000;
  notified = false;
  await crest.storage.set("endsAt", endsAt);
  await crest.storage.set("notified", false);
  render();
}

async function stop() {
  endsAt = null;
  await crest.storage.remove("endsAt");
  render();
}

(async () => {
  const hello = await crest.hello();
  applyTheme(hello.theme);
  crest.on("theme", applyTheme);
  endsAt = await crest.storage.get("endsAt");
  notified = (await crest.storage.get("notified")) === true;
  for (const b of document.querySelectorAll("[data-min]")) b.addEventListener("click", () => start(Number(b.dataset.min)));
  $("stop").addEventListener("click", stop);
  $("again").addEventListener("click", loadZen);
  render();
  setInterval(render, 1000);
  loadZen();
})();
