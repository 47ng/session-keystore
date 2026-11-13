import { expect, test, vi } from "vitest";

import { stubActivation } from "../test/navigation.ts";
import SK from "./index.ts";

function blockAndStartStore(storage: "sessionStorage" | "localStorage") {
  vi.spyOn(window, storage, "get").mockImplementation(() => {
    throw new DOMException("Access denied", "SecurityError");
  });
  const errors = vi.fn();
  window.addEventListener("error", errors);
  const store = new SK();
  store.set("foo", "bar");
  return { store, errors };
}

function comeBackFromCache(activation: Parameters<typeof stubActivation>[0]) {
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  stubActivation(activation);
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
}

test.each(["sessionStorage", "localStorage"] as const)(
  "keeps keys in memory when %s is blocked",
  (storage) => {
    const { store, errors } = blockAndStartStore(storage);
    comeBackFromCache({ from: { id: "other-page" }, navigationType: "traverse" });
    expect(store.get("foo")).toEqual("bar");
    expect(errors).not.toHaveBeenCalled();
  },
);

test.each(["sessionStorage", "localStorage"] as const)(
  "forgets keys after another site when %s is blocked",
  (storage) => {
    const { store, errors } = blockAndStartStore(storage);
    comeBackFromCache({ from: null, navigationType: "traverse" });
    expect(store.get("foo")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  },
);

test.each(["sessionStorage", "localStorage"] as const)(
  "forgets keys when %s is blocked and navigation.activation has not changed",
  (storage) => {
    const { store, errors } = blockAndStartStore(storage);
    comeBackFromCache({ from: {} });
    expect(store.get("foo")).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  },
);
