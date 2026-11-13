import { afterEach, beforeEach, vi } from "vitest";

import { removeNavigationStubs, startNewPage, stubActivation } from "./navigation.ts";

// The test page is the first page of its tab. Stores only load keys after
// another page of the same origin, so make it look like a reload.
beforeEach(() => {
  stubActivation({ from: {} });
});

// Test files run in an iframe, and the store keeps its window.name half
// in the top frame, which every test file shares.
afterEach(() => {
  vi.restoreAllMocks();
  removeNavigationStubs();
  startNewPage();
  window.top!.name = "";
  window.sessionStorage.clear();
  window.localStorage.clear();
});
