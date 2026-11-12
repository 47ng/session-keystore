// Tests read how the tab reached the page from the top frame, like the store.
// `undefined` stands for a browser without the Navigation API.
export function stubActivation(activation?: { from: object | null }) {
  const navigation = activation && { activation };
  Object.defineProperty(window.top!, "navigation", { configurable: true, value: navigation });
}

export function removeNavigationStubs() {
  delete (window.top as { navigation?: unknown }).navigation;
}

// Each page gets a new top window. Tests run in one, so forget the marks
// the store leaves on it.
export function startNewPage() {
  delete (window.top as unknown as Record<symbol, unknown>)[
    Symbol.for("session-keystore:forgot-on-arrival")
  ];
}
