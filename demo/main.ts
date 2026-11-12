import SessionKeystore from "../src/index.ts";

declare global {
  interface Window {
    // Exposed for the end-to-end tests
    store: SessionKeystore;
    restoredFromCache: boolean;
  }
}

// For manual testing in real browsers: what the store sees when the page
// loads or comes back from the back/forward cache, before it runs.
// Listeners run in order, so this one runs before the store's.
const diagnostics = document.querySelector("#diagnostics")!;
function noteArrival(event: string) {
  const activation = window.navigation?.activation;
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  let windowName = "";
  try {
    windowName = Object.keys(JSON.parse(window.name)).join(", ");
  } catch {}
  const line = [
    `${new Date().toLocaleTimeString()} ${event}`,
    activation === undefined
      ? "no Navigation API"
      : `from ${activation?.from?.url ?? "null"} (${activation?.navigationType})`,
    `timing: ${entry?.type}`,
    `window.name: ${windowName || "-"}`,
    `revision: ${sessionStorage.getItem("session-keystore:default:revision") ?? "-"}`,
  ].join(" · ");
  diagnostics.textContent = `${line}\n${diagnostics.textContent}`;
}
noteArrival("load");
addEventListener("pageshow", (event) => {
  if (event.persisted) {
    noteArrival("restored from the back/forward cache");
  }
});

const store = new SessionKeystore();
window.store = store;
addEventListener("pageshow", (event) => {
  window.restoredFromCache = event.persisted;
});

const keyNames = ["foo", "bar"];
const output = document.querySelector("#keys")!;

function render() {
  output.textContent = keyNames
    .map((name) => `${name}: ${JSON.stringify(store.get(name))}`)
    .join("\n");
}

const button = (id: string, onClick: () => void) =>
  document.querySelector(`#${id}`)!.addEventListener("click", onClick);

button("set-foo", () => store.set("foo", crypto.randomUUID()));
button("set-bar", () => store.set("bar", crypto.randomUUID(), Date.now() + 3000));
button("clear", () => store.clear());
button("reload", () => location.reload());

for (const event of ["created", "updated", "deleted", "expired"] as const) {
  store.on(event, render);
}
render();
