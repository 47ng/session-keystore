// Tests read how the tab reached the page from the top frame, like the store.
// `undefined` stands for a browser without the Navigation API.
export function stubActivation(activation?: {
  from: { id?: string } | null;
  navigationType?: NavigationType;
}) {
  const navigation = activation && { activation };
  Object.defineProperty(window.top!, "navigation", { configurable: true, value: navigation });
}

export function removeNavigationStubs() {
  delete (window.top as { navigation?: unknown }).navigation;
}

// Each page gets new windows. Tests run in one page, so forget the marks
// that the store leaves on the top window and on this frame.
export function startNewPage() {
  for (const mark of ["forgot-on-arrival", "page-id"]) {
    delete (window.top as unknown as Record<symbol, unknown>)[
      Symbol.for(`session-keystore:${mark}`)
    ];
  }
  for (const mark of ["seen-activation", "activation-is-late"]) {
    delete (window as unknown as Record<symbol, unknown>)[Symbol.for(`session-keystore:${mark}`)];
  }
}
