import { expect, test } from "vitest";

import SK from "./index.ts";

test("works without a window", () => {
  const store = new SK();
  store.set("foo", "bar");
  expect(store.get("foo")).toEqual("bar");
  store.delete("foo");
  expect(store.get("foo")).toBeNull();
});
