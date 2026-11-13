import { b64, utf8 } from "@47ng/codec";
import { hash } from "@stablelib/sha256";
import { afterEach, describe, expect, test, vi } from "vitest";

import { startNewPage, stubActivation } from "../test/navigation.ts";
import SK from "./index.ts";
import {
  split,
  join,
  saveToWindowName,
  noteHiddenPage,
  saveRevision,
  tagShare,
  forgetEarlierPages,
} from "./utility.ts";

let storeCount = 0;
const uniqueName = () => `store-${++storeCount}`;
const storageKey = (name: string) => `session-keystore:${name}`;

function reloadPage(name: string, { lateWindowNameWrites = true } = {}) {
  const nameBeforeUnload = window.top!.name;
  window.dispatchEvent(new Event("beforeunload"));
  window.dispatchEvent(new PageTransitionEvent("pagehide"));
  window.dispatchEvent(new Event("unload"));
  if (lateWindowNameWrites) {
    // Chromium: the next page does not see window.top!.name writes made while
    // the page unloads (beforeunload, pagehide or unload)
    window.top!.name = nameBeforeUnload;
  }
  startNewPage();
  return new SK({ name });
}

// Leave for another same-origin page that uses the store, then come back
// from the back/forward cache. Chromium gives the page its own window.top!.name back.
function visitAnotherPage(name: string, onOtherPage: (store: SK) => void) {
  const nameOnThisPage = window.top!.name;
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  onOtherPage(new SK({ name }));
  window.top!.name = nameOnThisPage;
  stubActivation(traversal());
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
}

// Firefox gives the page back the window.name and the sessionStorage
// it had when it left, without the other page's changes.
function visitAnotherPageAndGetOldStorageBack(name: string, onOtherPage: (store: SK) => void) {
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  const nameOnThisPage = window.top!.name;
  const storageOnThisPage = Object.entries(window.sessionStorage);
  onOtherPage(new SK({ name }));
  window.sessionStorage.clear();
  for (const [key, value] of storageOnThisPage) {
    window.sessionStorage.setItem(key, value);
  }
  window.top!.name = nameOnThisPage;
  stubActivation(traversal());
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
}

// Chromium and Firefox update navigation.activation before pageshow,
// so by default each restore gets a new entry and does not look like Safari
let traversalCount = 0;
const traversal = (from: { id: string } | null = { id: `entry-${++traversalCount}` }) =>
  ({ from, navigationType: "traverse" }) as const;

function restoreFromBackForwardCache(
  activation: Parameters<typeof stubActivation>[0] = traversal(),
  { otherPageHid = false } = {},
) {
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  if (otherPageHid) {
    noteHiddenPage("another-page");
  }
  stubActivation(activation);
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
}

const quotaExceeded = () => new DOMException("Full", "QuotaExceededError");

function failWrites(storage: Storage, { key = "", times = Infinity } = {}) {
  const { setItem, removeItem } = Storage.prototype;
  let failures = 0;
  const fails = (target: Storage, name: string) =>
    target === storage && name.includes(key) && failures++ < times;
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, name) {
    if (fails(this, name)) {
      throw quotaExceeded();
    }
    removeItem.call(this, name);
  });
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    name,
    value,
  ) {
    if (fails(this, name)) {
      throw quotaExceeded();
    }
    setItem.call(this, name, value);
  });
}

// The shares and revision that a page using this store leaves for the next page
function saveShares(name: string, json: string) {
  const [windowNameHalf, sessionStorageHalf] = split(json);
  saveRevision(name, "saved-revision");
  saveToWindowName(storageKey(name), windowNameHalf);
  window.sessionStorage.setItem(storageKey(name), tagShare(sessionStorageHalf, "saved-revision"));
}

function xorIntoWindowNameHalf(name: string, from: string, to: string) {
  const halves = JSON.parse(window.top!.name);
  const half = b64.decode(halves[storageKey(name)]);
  const [fromBytes, toBytes] = [utf8.encode(from), utf8.encode(to)];
  fromBytes.forEach((byte, i) => {
    half[i] ^= byte ^ toBytes[i];
  });
  halves[storageKey(name)] = b64.encode(half);
  window.top!.name = JSON.stringify(halves);
}

function readPersistedJson(name: string) {
  const windowNameHalf = JSON.parse(window.top!.name)[storageKey(name)];
  const sessionStorageHalf = window.sessionStorage.getItem(storageKey(name));
  return join(windowNameHalf, sessionStorageHalf!);
}

test("Store with default name", () => {
  const store = new SK();
  expect(store.name).toEqual("default");
});

test("Store with a name", () => {
  const store = new SK({ name: "foo" });
  expect(store.name).toEqual("foo");
});

describe("Event handlers", () => {
  test("created/updated", () => {
    const store = new SK();
    const created = vi.fn();
    const updated = vi.fn();
    store.on("created", created);
    store.on("updated", updated);
    store.set("foo", "bar");
    expect(created).toHaveBeenCalledTimes(1);
    expect(created.mock.calls[0][0]).toEqual({ name: "foo" });
    expect(updated).not.toHaveBeenCalled();
    created.mockReset();
    updated.mockReset();
    store.set("foo", "egg");
    expect(created).not.toHaveBeenCalled();
    expect(updated).toHaveBeenCalledTimes(1);
    expect(updated.mock.calls[0][0]).toEqual({ name: "foo" });
    created.mockReset();
    updated.mockReset();
    store.set("foo", "egg"); // Same value
    expect(created).not.toHaveBeenCalled();
    expect(updated).not.toHaveBeenCalled();
  });

  test("read", () => {
    const store = new SK();
    const read = vi.fn();
    store.on("read", read);
    store.set("foo", "bar");
    expect(read).not.toHaveBeenCalled();
    store.get("foo");
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0]).toEqual({ name: "foo" });
  });

  test("deleted", () => {
    const store = new SK();
    const deleted = vi.fn();
    store.on("deleted", deleted);
    store.set("foo", "bar");
    store.get("foo");
    expect(deleted).not.toHaveBeenCalled();
    store.delete("foo");
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(deleted.mock.calls[0][0]).toEqual({ name: "foo" });
  });

  test("expired", () => {
    const store = new SK();
    const expired = vi.fn();
    const deleted = vi.fn();
    store.on("expired", expired);
    store.on("deleted", deleted);
    const expirationDate = Date.now() + 1000;
    store.set("foo", "bar", expirationDate);
    store.get("foo", expirationDate - 100);
    expect(expired).not.toHaveBeenCalled();
    store.get("foo", expirationDate + 100);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(expired.mock.calls[0][0]).toEqual({ name: "foo" });
    expect(deleted).not.toHaveBeenCalled();
  });

  test("Unsubscribe via returned off callback", () => {
    const store = new SK();
    const read = vi.fn();
    const off = store.on("read", read);
    store.set("foo", "bar");
    store.get("foo");
    off();
    store.get("foo");
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("Unsubscribe via off method", () => {
    const store = new SK();
    const read = vi.fn();
    store.on("read", read);
    store.set("foo", "bar");
    store.get("foo");
    store.off("read", read);
    store.get("foo");
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("By default, this is not bound to the store", () => {
    const store = new SK();
    const nobind = vi.fn().mockReturnThis();
    const bind = vi.fn().mockReturnThis();
    store.on("created", nobind);
    store.on("created", bind.bind(store));
    store.set("foo", "bar");
    expect(bind.mock.results[0].value).toEqual(store);
    expect(nobind.mock.results[0].value).toBeUndefined();
  });
});

test("Clear", () => {
  const store = new SK();
  const deleted = vi.fn();
  store.on("deleted", deleted);
  store.set("foo", "bar");
  store.set("egg", "spam");
  expect(store.get("foo")).toEqual("bar");
  expect(store.get("egg")).toEqual("spam");
  store.clear();
  expect(deleted).toHaveBeenCalledTimes(2);
  expect(deleted.mock.calls[0][0]).toEqual({ name: "foo" });
  expect(deleted.mock.calls[1][0]).toEqual({ name: "egg" });
  expect(store.get("foo")).toBeNull();
  expect(store.get("egg")).toBeNull();
});

test("Key expiration", () => {
  vi.useFakeTimers();
  const store = new SK();
  const expired = vi.fn();
  const deleted = vi.fn();
  store.on("expired", expired);
  store.on("deleted", deleted);
  store.set("foo", "bar", Date.now() + 100);
  store.set("egg", "qux", Date.now() + 200);
  vi.advanceTimersByTime(150);
  expect(expired).toHaveBeenCalledTimes(1);
  expect(expired.mock.calls[0][0]).toEqual({ name: "foo" });
  expect(store.get("foo")).toBeNull();
  expect(store.get("egg")).toEqual("qux");
  expect(deleted).not.toHaveBeenCalled();
  vi.useRealTimers();
});

test("Set a key that already expired", () => {
  const store = new SK();
  const created = vi.fn();
  const expired = vi.fn();
  store.on("created", created);
  store.on("expired", expired);
  store.set("foo", "bar", 0);
  expect(created).not.toHaveBeenCalled();
  expect(expired).toHaveBeenCalledTimes(1);
});

test("Persistence", () => {
  const storeA = new SK();
  storeA.set("foo", "bar");
  storeA.persist();
  const storeB = new SK();
  expect(storeB.get("foo")).toEqual("bar");
});

describe("Persistence across page loads", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.top!.name = "";
  });

  test("restores keys after a reload", () => {
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    expect(reloadPage(name).get("foo")).toEqual("bar");
  });

  test("restores keys after several reloads without changes", () => {
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    reloadPage(name);
    reloadPage(name);
    expect(reloadPage(name).get("foo")).toEqual("bar");
  });

  test("restores the latest value of an updated key", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    store.set("foo", "egg");
    expect(reloadPage(name).get("foo")).toEqual("egg");
  });

  test("restores a new expiration date on an unchanged value", () => {
    const name = uniqueName();
    const expiresAt = Date.now() + 1000;
    const store = new SK({ name });
    store.set("foo", "bar");
    store.set("foo", "bar", expiresAt);
    const reloaded = reloadPage(name);
    expect(reloaded.get("foo")).toEqual("bar");
    expect(reloaded.get("foo", expiresAt)).toBeNull();
  });

  test("forgets deleted keys", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    store.set("egg", "spam");
    store.delete("foo");
    const reloaded = reloadPage(name);
    expect(reloaded.get("foo")).toBeNull();
    expect(reloaded.get("egg")).toEqual("spam");
  });

  test("does not persist expired keys", () => {
    vi.useFakeTimers();
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "secret", Date.now() + 100);
    store.set("egg", "spam");
    vi.advanceTimersByTime(150);
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    expect(readPersistedJson(name)).not.toContain("secret");
  });

  test("forgets keys cleared while the page unloads", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    window.addEventListener("pagehide", () => store.clear(), { once: true });
    expect(reloadPage(name).get("foo")).toBeNull();
  });

  test("forgets keys deleted before its own pagehide listener runs", () => {
    const name = uniqueName();
    let store: SK | undefined;
    window.addEventListener("pagehide", () => store!.delete("foo"), {
      once: true,
    });
    store = new SK({ name });
    store.set("foo", "bar");
    expect(reloadPage(name).get("foo")).toBeNull();
  });

  test.each([true, false])(
    "forgets keys deleted in beforeunload (late window.top!.name writes: %s)",
    (lateWindowNameWrites) => {
      const name = uniqueName();
      const store = new SK({ name });
      store.set("foo", "bar");
      store.set("egg", "spam");
      window.addEventListener("beforeunload", () => store.delete("foo"), {
        once: true,
      });
      const next = reloadPage(name, { lateWindowNameWrites });
      expect(next.get("foo")).toBeNull();
      // Chromium loses the whole store, other browsers keep the other keys
      expect(next.get("egg")).toEqual(lateWindowNameWrites ? null : "spam");
    },
  );

  test("forgets all keys when a key is deleted in unload, even without late window.top!.name writes", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    store.set("egg", "spam");
    window.addEventListener("unload", () => store.delete("foo"), { once: true });
    const next = reloadPage(name, { lateWindowNameWrites: false });
    expect(next.get("foo")).toBeNull();
    expect(next.get("egg")).toBeNull();
  });

  test("restores keys when persist() runs while the page unloads", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    window.addEventListener("pagehide", () => store.persist(), { once: true });
    expect(reloadPage(name).get("foo")).toEqual("bar");
  });

  test("leaves window.top!.name alone while the store is empty", () => {
    window.top!.name = "popup";
    new SK({ name: uniqueName() }).delete("missing");
    expect(window.top!.name).toEqual("popup");
  });

  test("removes its window.top!.name half once the store is empty", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    store.delete("foo");
    expect(window.top!.name).not.toContain(storageKey(name));
  });

  test.each(["123", "null", "true", '"popup"', "[]"])(
    "works when window.top!.name holds the JSON value %s",
    (value) => {
      window.top!.name = value;
      const name = uniqueName();
      const store = new SK({ name });
      store.set("foo", "bar");
      expect(store.get("foo")).toEqual("bar");
      expect(reloadPage(name).get("foo")).toEqual("bar");
    },
  );

  test("leaves the store unchanged when a key cannot be saved", () => {
    const name = uniqueName();
    const store = new SK<any>({ name });
    store.set("foo", "bar");
    const circular: any = {};
    circular.self = circular;
    expect(() => store.set(circular, "value")).toThrow();
    expect(store.get(circular)).toBeNull();
    expect(reloadPage(name).get("foo")).toEqual("bar");
  });

  test("keeps the old value when a new value cannot be saved", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    const circular: any = {};
    circular.self = circular;
    expect(() => store.set("foo", circular)).toThrow();
    expect(store.get("foo")).toEqual("bar");
    expect(reloadPage(name).get("foo")).toEqual("bar");
  });

  test("still deletes keys after rejecting a key that cannot be saved", () => {
    const name = uniqueName();
    const store = new SK<any>({ name });
    store.set("foo", "bar");
    const circular: any = {};
    circular.self = circular;
    expect(() => store.set(circular, "value")).toThrow();
    const deleted = vi.fn();
    store.on("deleted", deleted);
    store.delete("foo");
    expect(deleted).toHaveBeenCalledWith({ name: "foo" });
    expect(reloadPage(name).get("foo")).toBeNull();
  });

  test("keeps restored keys when another store with the same name starts", () => {
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    reloadPage(name);
    new SK({ name });
    expect(reloadPage(name).get("foo")).toEqual("bar");
  });

  test("keeps keys when another store with the same name starts", () => {
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    new SK({ name });
    expect(reloadPage(name).get("foo")).toEqual("bar");
  });

  test("keeps keys when an empty store with the same name comes back from the back/forward cache", () => {
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    new SK({ name });
    restoreFromBackForwardCache();
    expect(reloadPage(name).get("foo")).toEqual("bar");
  });

  test("keeps stores with different names apart", () => {
    const nameA = uniqueName();
    const nameB = uniqueName();
    new SK({ name: nameA }).set("foo", "a");
    new SK({ name: nameB }).set("foo", "b");
    reloadPage(nameA);
    expect(reloadPage(nameA).get("foo")).toEqual("a");
    expect(reloadPage(nameB).get("foo")).toEqual("b");
  });

  test("restores the last change among stores sharing a name", () => {
    const name = uniqueName();
    const first = new SK({ name });
    const second = new SK({ name });
    second.set("foo", "second");
    first.set("foo", "first");
    expect(reloadPage(name).get("foo")).toEqual("first");
  });

  test("keeps the sessionStorage half out of storage while the page is live", () => {
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    expect(window.sessionStorage.getItem(storageKey(name))).toBeNull();
    reloadPage(name);
    expect(window.sessionStorage.getItem(storageKey(name))).toBeNull();
  });

  test("forgets keys saved by version 1.0.3", () => {
    const name = uniqueName();
    const halvesFromVersion103 = {
      windowName: "ndqT0N7slCiLowiqPnhjg2QxZSQX3t0ZLiWPRlRM1A==",
      sessionStorage: "xoGxtrGDtgTwgX6IBElPoRJQCVFy_Oc7TET9ZCkRiQ==",
    };
    saveToWindowName(storageKey(name), halvesFromVersion103.windowName);
    window.sessionStorage.setItem(storageKey(name), halvesFromVersion103.sessionStorage);
    expect(new SK({ name }).get("foo")).toBeNull();
    expect(window.top!.name).toEqual("");
    expect(window.sessionStorage.getItem(storageKey(name))).toBeNull();
  });

  test("forgets keys after another site changes the window.top!.name half", () => {
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    xorIntoWindowNameHalf(
      name,
      '[["foo",{"v":1,"value":"bar"}]]',
      '[["foo",{"v":1,"value":"baz"}]]',
    );
    expect(new SK({ name }).get("foo")).toBeNull();
  });

  test("gives a disk reader no way to confirm a guess of the keys", () => {
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    const sessionStorageHalf = window.sessionStorage.getItem(storageKey(name))!;
    const [ciphertext] = sessionStorageHalf.split(".");
    const correctGuess = utf8.encode('[["foo",{"v":1,"value":"bar"}]]');
    const guessedWindowNameHalf = b64.encode(
      b64.decode(ciphertext).map((byte, i) => byte ^ correctGuess[i]),
    );
    const guessedHash = b64.encode(hash(utf8.encode(guessedWindowNameHalf)));
    expect(sessionStorageHalf).not.toContain(guessedHash);
  });

  test("keeps keys after a back/forward cache restore when another page only read them", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    visitAnotherPage(name, (other) => other.get("foo"));
    expect(store.get("foo")).toEqual("bar");
    expect(reloadPage(name).get("foo")).toEqual("bar");
  });

  test("forgets keys after a back/forward cache restore when another page changed them", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    store.set("egg", "spam");
    const deleted = vi.fn();
    store.on("deleted", deleted);
    visitAnotherPage(name, (other) => other.delete("foo"));
    expect(store.get("foo")).toBeNull();
    expect(store.get("egg")).toBeNull();
    expect(deleted).toHaveBeenCalledWith({ name: "foo" });
    expect(reloadPage(name).get("foo")).toBeNull();
  });

  test("forgets a key deleted on another page when the page gets its old sessionStorage back", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    visitAnotherPageAndGetOldStorageBack(name, (other) => other.delete("foo"));
    expect(store.get("foo")).toBeNull();
    expect(reloadPage(name).get("foo")).toBeNull();
  });

  test("does not bring back a value changed on another page when the page gets its old sessionStorage back", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "old");
    visitAnotherPageAndGetOldStorageBack(name, (other) => other.set("foo", "new"));
    expect(store.get("foo")).toBeNull();
    expect(reloadPage(name).get("foo")).toBeNull();
  });

  test("removes the old shares when the page gets its old sessionStorage back", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    visitAnotherPageAndGetOldStorageBack(name, (other) => other.delete("foo"));
    expect(window.sessionStorage.getItem(storageKey(name))).toBeNull();
    expect(window.top!.name).not.toContain(storageKey(name));
  });

  test("keeps the current shares when another page changed the store", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "old");
    visitAnotherPage(name, (other) => {
      other.set("foo", "new");
      other.persist();
    });
    expect(store.get("foo")).toBeNull();
    expect(window.sessionStorage.getItem(storageKey(name))).not.toBeNull();
  });

  test("does not bring back a key that a listener kept from being dropped", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    store.set("egg", "spam");
    store.on("deleted", () => {
      throw new Error("listener");
    });
    visitAnotherPage(name, (other) => other.delete("foo"));
    expect(store.get("foo")).toBeNull();
    expect(store.get("egg")).toBeNull();
    expect(reloadPage(name).get("foo")).toBeNull();
  });

  test("does not bring back a deleted key when the new revision cannot be saved", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    store.set("egg", "spam");
    visitAnotherPage(name, (other) => {
      const { setItem } = Storage.prototype;
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
        this: Storage,
        key,
        value,
      ) {
        if (this === window.localStorage) {
          throw quotaExceeded();
        }
        setItem.call(this, key, value);
      });
      expect(() => other.delete("foo")).not.toThrow();
      vi.restoreAllMocks();
    });
    expect(store.get("foo")).toBeNull();
    expect(reloadPage(name).get("foo")).toBeNull();
  });

  test("forgets keys when the share names an older revision", () => {
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    saveRevision(name, "newer-revision");
    expect(reloadPage(name, { lateWindowNameWrites: false }).get("foo")).toBeNull();
  });

  test("forgets every share when the restore check throws", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    const { getItem } = Storage.prototype;
    vi.spyOn(Storage.prototype, "getItem").mockImplementationOnce(function (this: Storage) {
      throw new DOMException("Access denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
      return getItem.call(this, key);
    });
    stubActivation(traversal());
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    vi.restoreAllMocks();
    expect(store.get("foo")).toBeNull();
    expect(Object.keys(window.sessionStorage).join()).not.toContain("session-keystore:");
    expect(window.top!.name).not.toContain("session-keystore:");
  });

  test("forgets keys after another page clears sessionStorage", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.sessionStorage.clear();
    new SK({ name }).set("foo", "new");
    stubActivation(traversal());
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(store.get("foo")).toBeNull();
  });

  test("does not write the old share when the old revision cannot be removed", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    store.set("egg", "spam");
    failWrites(window.localStorage, { times: 1 });
    expect(() => store.delete("foo")).toThrow();
    vi.restoreAllMocks();
    expect(reloadPage(name).get("foo")).toBeNull();
  });

  test("keeps keys when another page only read them and the page gets its old sessionStorage back", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    visitAnotherPageAndGetOldStorageBack(name, (other) => other.get("foo"));
    expect(store.get("foo")).toEqual("bar");
    expect(reloadPage(name).get("foo")).toEqual("bar");
  });

  test("removes the sessionStorage half when the page comes back from the back/forward cache", () => {
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    restoreFromBackForwardCache();
    expect(window.sessionStorage.getItem(storageKey(name))).toBeNull();
    expect(reloadPage(name).get("foo")).toEqual("bar");
  });

  test("keeps keys after a reload without the Navigation API", () => {
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    stubActivation(undefined);
    expect(reloadPage(name).get("foo")).toEqual("bar");
  });
});

describe("After a page of another site", () => {
  test("forgets keys", () => {
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    stubActivation({ from: null });
    expect(reloadPage(name).get("foo")).toBeNull();
    stubActivation({ from: {} });
    expect(reloadPage(name).get("foo")).toBeNull();
  });

  test("forgets the keys of stores the page does not use", () => {
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    stubActivation({ from: null });
    reloadPage(uniqueName());
    expect(Object.keys(window.sessionStorage)).not.toContain(storageKey(name));
    expect(window.localStorage.length).toBe(0);
    expect(window.top!.name).toEqual("");
    stubActivation({ from: {} });
    expect(reloadPage(name).get("foo")).toBeNull();
  });

  test("keeps keys persisted before another store starts", () => {
    const name = uniqueName();
    stubActivation({ from: null });
    reloadPage(uniqueName());
    const store = new SK({ name });
    store.set("foo", "bar");
    store.persist();
    new SK({ name: uniqueName() });
    stubActivation({ from: {} });
    expect(reloadPage(name).get("foo")).toEqual("bar");
  });

  test("forgets keys after a back/forward cache restore", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    const deleted = vi.fn();
    store.on("deleted", deleted);
    restoreFromBackForwardCache(traversal(null));
    expect(store.get("foo")).toBeNull();
    expect(deleted).toHaveBeenCalledWith({ name: "foo" });
    expect(window.sessionStorage.getItem(storageKey(name))).toBeNull();
    stubActivation({ from: {} });
    expect(reloadPage(name).get("foo")).toBeNull();
  });

  test("forgets keys of stores the page does not use, after a back/forward cache restore", () => {
    const name = uniqueName();
    new SK({ name: uniqueName() });
    saveShares(name, '[["foo",{"v":1,"value":"bar"}]]');
    restoreFromBackForwardCache(traversal(null));
    expect(window.sessionStorage.getItem(storageKey(name))).toBeNull();
    expect(window.top!.name).not.toContain(storageKey(name));
    stubActivation({ from: {} });
    expect(reloadPage(name).get("foo")).toBeNull();
  });

  test("forgets every key even when a deleted listener throws", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    store.set("egg", "spam");
    store.on("deleted", () => {
      throw new Error("listener");
    });
    restoreFromBackForwardCache(traversal(null));
    expect(store.get("foo")).toBeNull();
    expect(store.get("egg")).toBeNull();
    stubActivation({ from: {} });
    expect(reloadPage(name).get("egg")).toBeNull();
  });

  test("emits deleted even when storage fails while it forgets", () => {
    const store = new SK({ name: uniqueName() });
    store.set("foo", "bar");
    const deleted = vi.fn();
    store.on("deleted", deleted);
    failWrites(window.localStorage, { times: 1 });
    restoreFromBackForwardCache(traversal(null));
    expect(deleted).toHaveBeenCalledWith({ name: "foo" });
  });

  test("keeps what other tabs saved in localStorage", () => {
    window.localStorage.setItem("session-keystore:other-tab:revision:x", `r1 ${Date.now()}`);
    new SK({ name: uniqueName() }).set("foo", "bar");
    restoreFromBackForwardCache(traversal(null));
    expect(window.localStorage.getItem("session-keystore:other-tab:revision:x")).not.toBeNull();
  });

  test("leaves the keys of its opener alone in a popup", () => {
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    const openerStorage = Object.entries(window.sessionStorage);
    const openerName = window.top!.name;
    // The popup and the opener share this sessionStorage here; the opener's
    // copy comes back below
    Object.defineProperty(window.top!, "opener", { configurable: true, value: window.top });
    window.top!.name = "";
    stubActivation({ from: { id: "popup-page-without-store" } });
    startNewPage();
    new SK({ name }).set("egg", "spam");
    delete (window.top as { opener?: unknown }).opener;
    window.sessionStorage.clear();
    for (const [key, value] of openerStorage) {
      window.sessionStorage.setItem(key, value);
    }
    window.top!.name = openerName;
    stubActivation({ from: {} });
    expect(reloadPage(name, { lateWindowNameWrites: false }).get("foo")).toEqual("bar");
  });

  test("does not let a cached popup page keep keys once the popup takes a new tab ID", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    const storageOnThisPage = Object.entries(window.sessionStorage);
    const nameOnThisPage = window.top!.name;
    // The opener can be read now, and still has the same tab ID
    Object.defineProperty(window.top!, "opener", { configurable: true, value: window.top });
    new SK({ name: uniqueName() });
    delete (window.top as { opener?: unknown }).opener;
    // Firefox gives the cached page its old sessionStorage, with the old tab ID
    window.sessionStorage.clear();
    for (const [key, value] of storageOnThisPage) {
      window.sessionStorage.setItem(key, value);
    }
    window.top!.name = nameOnThisPage;
    stubActivation(traversal());
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(store.get("foo")).toBeNull();
  });

  test("keeps keys set after a back/forward cache restore", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "old");
    restoreFromBackForwardCache(traversal(null));
    store.set("foo", "new");
    stubActivation({ from: {} });
    expect(reloadPage(name).get("foo")).toEqual("new");
  });
});

// Safari, or a page that first loaded with Back
describe("When navigation.activation has not changed by pageshow", () => {
  const firstPageOfTheTab = { from: null, navigationType: "push" } as const;

  test("keeps keys after Back from another page of the same origin", () => {
    stubActivation(firstPageOfTheTab);
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    restoreFromBackForwardCache(firstPageOfTheTab, { otherPageHid: true });
    expect(store.get("foo")).toEqual("bar");
    stubActivation({ from: { id: "this-page" }, navigationType: "reload" });
    expect(reloadPage(name).get("foo")).toEqual("bar");
  });

  test("forgets keys after Back from another site", () => {
    const loadedAfterStart = { from: { id: "start" }, navigationType: "push" } as const;
    stubActivation(loadedAfterStart);
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    const deleted = vi.fn();
    store.on("deleted", deleted);
    restoreFromBackForwardCache(loadedAfterStart);
    expect(store.get("foo")).toBeNull();
    expect(deleted).toHaveBeenCalledWith({ name: "foo" });
    expect(reloadPage(name).get("foo")).toBeNull();
  });

  test("forgets the keys of every store after Back from another site", () => {
    stubActivation(firstPageOfTheTab);
    const first = new SK({ name: uniqueName() });
    const second = new SK({ name: uniqueName() });
    first.set("foo", "a");
    second.set("foo", "b");
    restoreFromBackForwardCache(firstPageOfTheTab);
    expect(first.get("foo")).toBeNull();
    expect(second.get("foo")).toBeNull();
  });

  test("forgets keys when no page noted that it hid", () => {
    stubActivation(firstPageOfTheTab);
    const store = new SK({ name: uniqueName() });
    store.set("foo", "bar");
    failWrites(window.sessionStorage, { key: "last-hidden-page" });
    restoreFromBackForwardCache(firstPageOfTheTab);
    expect(store.get("foo")).toBeNull();
  });

  test("forgets keys of an earlier page after a later page forgot the tab", () => {
    stubActivation(firstPageOfTheTab);
    const store = new SK({ name: uniqueName() });
    store.set("foo", "bar");
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    forgetEarlierPages();
    noteHiddenPage("later-page");
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(store.get("foo")).toBeNull();
  });

  test("keeps deciding without navigation.activation once Safari updates it", () => {
    stubActivation(firstPageOfTheTab);
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    restoreFromBackForwardCache(firstPageOfTheTab, { otherPageHid: true });
    const updatedBySafari = traversal();
    stubActivation(updatedBySafari);
    restoreFromBackForwardCache(updatedBySafari);
    expect(store.get("foo")).toBeNull();
  });
});

describe("When navigation.activation has changed by pageshow", () => {
  test("forgets keys after another site, even when another page hid since", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    restoreFromBackForwardCache(traversal(null), { otherPageHid: true });
    expect(store.get("foo")).toBeNull();
  });

  test("keeps keys after a page of the same origin that does not use the store", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    restoreFromBackForwardCache(traversal());
    expect(store.get("foo")).toEqual("bar");
  });

  test("keeps keys without the Navigation API", () => {
    stubActivation(undefined);
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(store.get("foo")).toEqual("bar");
  });

  test("keeps keys after Back, Forward and Back again next to a page that does not use the store", () => {
    const name = uniqueName();
    const store = new SK({ name });
    store.set("foo", "bar");
    // Both restores give the same navigation.activation: the store must not
    // take the second one for Safari's late update
    const backFromB = traversal({ id: "b" });
    restoreFromBackForwardCache(backFromB);
    restoreFromBackForwardCache(backFromB);
    expect(store.get("foo")).toEqual("bar");
  });
});

describe("Revisions in localStorage", () => {
  const day = 24 * 60 * 60 * 1000;

  afterEach(() => {
    vi.useRealTimers();
  });

  test("removes the revisions that tabs saved over 30 days ago", () => {
    window.localStorage.setItem("session-keystore:old-tab:store", `r1 ${Date.now() - 31 * day}`);
    window.localStorage.setItem("session-keystore:recent-tab:store", `r2 ${Date.now() - day}`);
    window.localStorage.setItem("app-setting", "kept");
    new SK({ name: uniqueName() });
    expect(window.localStorage.getItem("session-keystore:old-tab:store")).toBeNull();
    expect(window.localStorage.getItem("session-keystore:recent-tab:store")).not.toBeNull();
    expect(window.localStorage.getItem("app-setting")).toEqual("kept");
  });

  test("keeps the keys of a tab that loads a page at least every 30 days", () => {
    vi.useFakeTimers();
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    vi.advanceTimersByTime(20 * day);
    reloadPage(name);
    vi.advanceTimersByTime(20 * day);
    new SK({ name: uniqueName() });
    expect(reloadPage(name).get("foo")).toEqual("bar");
  });

  test("forgets keys whose revision is over 30 days old", () => {
    vi.useFakeTimers();
    const name = uniqueName();
    new SK({ name }).set("foo", "bar");
    vi.advanceTimersByTime(31 * day);
    expect(reloadPage(name).get("foo")).toBeNull();
  });

  test("writes nothing to localStorage for a tab without keys", () => {
    new SK({ name: uniqueName() });
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    expect(window.localStorage.length).toBe(0);
    restoreFromBackForwardCache();
    expect(window.localStorage.length).toBe(0);
  });

  test("removes its revision once the store is empty", () => {
    const store = new SK({ name: uniqueName() });
    store.set("foo", "bar");
    store.delete("foo");
    expect(window.localStorage.length).toBe(0);
  });
});

test("drops every key when a saved entry has an unknown format", () => {
  const json = JSON.stringify([
    ["foo", { v: 1, value: "bar" }],
    ["egg", { v: 2, value: "spam" }],
  ]);
  saveShares("default", json);
  const store = new SK();
  expect(store.get("foo")).toBeNull();
  expect(store.get("egg")).toBeNull();
});

test("keeps an empty value across a reload", () => {
  const name = uniqueName();
  new SK({ name }).set("foo", "");
  expect(reloadPage(name).get("foo")).toEqual("");
});

test("Expiration date", () => {
  const future = new Date(Date.now() + 1000);
  const store = new SK();
  store.set("foo", "bar", future);
  expect(store.get("foo")).toEqual("bar");
  expect(store.get("foo", future.valueOf())).toBeNull();
});
