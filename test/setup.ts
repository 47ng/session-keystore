import { afterEach, vi } from "vitest";

// Test files run in an iframe, and the store keeps its window.name half
// in the top frame, which every test file shares.
afterEach(() => {
  vi.restoreAllMocks();
  window.top!.name = "";
  window.sessionStorage.clear();
});
