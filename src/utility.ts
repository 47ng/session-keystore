import { b64, utf8 } from "@47ng/codec";
import { hash } from "@stablelib/sha256";

const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

const SALT_LENGTH = 32;

const hashOf = (windowNameHalf: string) => b64.encode(hash(utf8.encode(windowNameHalf)));

const xor = (data: Uint8Array, pad: Uint8Array) =>
  new Uint8Array(data).map((byte, i) => byte ^ pad[i]);

export const split = (secret: string): [string, string] => {
  const data = utf8.encode(secret);
  const pad = randomBytes(data.length + SALT_LENGTH);
  const windowNameHalf = b64.encode(pad);
  const ciphertext = b64.encode(xor(data, pad));
  return [windowNameHalf, `${ciphertext}.${hashOf(windowNameHalf)}`];
};

export const join = (windowNameHalf: string, sessionStorageHalf: string) => {
  const [ciphertext, expectedHash] = sessionStorageHalf.split(".");
  if (expectedHash !== hashOf(windowNameHalf)) {
    return null;
  }
  return utf8.decode(xor(b64.decode(ciphertext), b64.decode(windowNameHalf)));
};

// --

export const canPersist = () => {
  try {
    // Both throw when blocked: a cross-origin top frame, or no storage access
    return typeof window.top!.name === "string" && !!window.sessionStorage;
  } catch {
    return false;
  }
};

export const storagePrefix = "session-keystore:";

// Whether the page before this one in the tab, or the same page on a
// reload, had the same origin. Read in the top frame, as it owns window.name.
// Chromium keeps window.name across sites, so this is the only way to tell
// there. Without the Navigation API, assume it did.
export const followsSameOriginPage = () => window.top!.navigation?.activation?.from !== null;

// Marks the top window, which every page gets anew and its frames share
const forgotOnArrival = Symbol.for("session-keystore:forgot-on-arrival");

// Like forgetEarlierPages, once per page: stores created later must not
// remove the shares that `persist()` wrote on this page.
export const forgetEarlierPagesOnArrival = () => {
  const top = window.top as unknown as Record<symbol, boolean>;
  if (!top[forgotOnArrival]) {
    top[forgotOnArrival] = true;
    forgetEarlierPages();
  }
};

// Removes the shares that earlier pages left for the next one, for every
// store: a sessionStorage share is only on disk between pages.
export const forgetEarlierPages = () => {
  for (const key of Object.keys(window.sessionStorage)) {
    if (key.startsWith(storagePrefix)) {
      window.sessionStorage.removeItem(key);
      removeFromWindowName(key);
    }
  }
};

const loadObjectFromWindowName = (): Record<string, unknown> => {
  try {
    const saved = JSON.parse(window.top!.name);
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      return saved;
    }
  } catch {}
  return {};
};

export const saveToWindowName = (name: string, data: string) => {
  const obj = loadObjectFromWindowName();
  obj[name] = data;
  window.top!.name = JSON.stringify(obj);
};

export const readFromWindowName = (name: string) => {
  const half = loadObjectFromWindowName()[name];
  return typeof half === "string" ? half : null;
};

export const removeFromWindowName = (name: string) => {
  const saved = loadObjectFromWindowName();
  if (!(name in saved)) {
    return;
  }
  delete saved[name];
  const json = JSON.stringify(saved);
  window.top!.name = json === "{}" ? "" : json;
};
