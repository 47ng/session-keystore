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
    // They throw when blocked: a cross-origin top frame, or no storage access
    return typeof window.top!.name === "string" && !!window.sessionStorage && !!window.localStorage;
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

// --

// Firefox gives a page that comes back from the back/forward cache the
// sessionStorage it had when it left, without the changes later pages made.
// So revisions live in localStorage, under a random tab ID kept in
// sessionStorage. A store removes the ones that no page saved for 30 days.
// The tab ID key stays outside storagePrefix: if forgetEarlierPages removed it,
// it would remove the revisions of a new ID and leave the old ones.
const tabIdKey = "session-keystore-tab";
const revisionLifetime = 30 * 24 * 60 * 60 * 1000;

const marks = (target: object) => target as Record<symbol, unknown>;

const startNewTab = () => {
  window.sessionStorage.removeItem(tabIdKey);
  const id = b64.encode(randomBytes(16));
  window.sessionStorage.setItem(tabIdKey, id);
  return id;
};

const tabId = () => window.sessionStorage.getItem(tabIdKey) ?? startNewTab();

// A popup starts with a copy of its opener's sessionStorage, tab ID
// included. When the opener's sessionStorage holds the same ID, the popup
// takes a new one, so that later changes do not touch the opener's revisions.
// This runs for each store: once the IDs differ, it does nothing.
// If window.name already holds a share, a store of the popup saved keys
// under the shared ID (the opener could not be read before). The popup first
// removes all revisions under that ID, so that no cached page of the popup
// can match them. The opener then loses its keys too.
export const leaveOpenerTab = () => {
  try {
    if (window.top!.opener?.sessionStorage.getItem(tabIdKey) === tabId()) {
      if (window.top!.name.includes(storagePrefix)) {
        removeRevisionsOfThisTab();
      }
      startNewTab();
    }
  } catch {}
};

const revisionKey = (storeName: string) => `${storagePrefix}${tabId()}:revision:${storeName}`;

export const readRevision = (storeName: string) =>
  window.localStorage.getItem(revisionKey(storeName))?.split(" ")[0] ?? null;

export const saveRevision = (storeName: string, revision: string) =>
  window.localStorage.setItem(revisionKey(storeName), `${revision} ${Date.now()}`);

export const removeRevision = (storeName: string) =>
  window.localStorage.removeItem(revisionKey(storeName));

const removeRevisionsOfThisTab = () => {
  const prefix = revisionKey("");
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(prefix)) {
      window.localStorage.removeItem(key);
    }
  }
};

export const removeOldRevisions = () => {
  const oldest = Date.now() - revisionLifetime;
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(storagePrefix)) {
      const savedAt = Number(window.localStorage.getItem(key)?.split(" ")[1]);
      if (!(savedAt >= oldest)) {
        window.localStorage.removeItem(key);
      }
    }
  }
};

// --

// When the page comes back from the back/forward cache, Safari updates
// navigation.activation only after pageshow. It then gives the entry after
// this one as `from`: correct after Back, wrong after Forward.
// So on the first restore of a page, the store checks whether
// navigation.activation changed since the page loaded, and keeps that
// choice until the page unloads. If it did not change, the store instead
// checks whether this page is still the last page of the tab to hide.
// If so, no other page that uses the store hid since, so the store treats
// the tab as back from another site. It does the same when the tab has no note.
// The note lives in sessionStorage, which belongs to one tab and which
// Safari keeps up to date, outside storagePrefix so that forgetting keeps it.
// Each pageshow event decides once, so that the first store's choice
// cannot change what the next store sees.
const pageIdMark = Symbol.for("session-keystore:page-id");
const seenActivation = Symbol.for("session-keystore:seen-activation");
const activationIsLate = Symbol.for("session-keystore:activation-is-late");
const fromAnotherSite = Symbol.for("session-keystore:from-another-site");
const lastHiddenPageKey = "session-keystore-last-hidden-page";

const pageId = () => {
  const top = marks(window.top!);
  top[pageIdMark] ??= b64.encode(randomBytes(16));
  return top[pageIdMark] as string;
};

const readActivation = () => {
  const activation = window.top!.navigation?.activation;
  return activation && `${activation.navigationType} ${activation.from?.id ?? activation.from}`;
};

export const noteActivationOnArrival = () => {
  if (!(seenActivation in window)) {
    marks(window)[seenActivation] = readActivation();
  }
};

// Removes the old note first: if the new one cannot be saved, the tab has
// no note, and a missing note counts as another site.
export const noteHiddenPage = (id = pageId()) => {
  window.sessionStorage.removeItem(lastHiddenPageKey);
  window.sessionStorage.setItem(lastHiddenPageKey, id);
};

const decideFromAnotherSite = () => {
  const activation = readActivation();
  if (activation === undefined) {
    return false;
  }
  const page = marks(window);
  page[activationIsLate] ??= activation === page[seenActivation];
  if (!page[activationIsLate]) {
    return !followsSameOriginPage();
  }
  const lastPage = window.sessionStorage.getItem(lastHiddenPageKey);
  return lastPage === null || lastPage === pageId();
};

export const comesBackFromAnotherSite = (event: PageTransitionEvent) => {
  const decision = marks(event);
  decision[fromAnotherSite] ??= decideFromAnotherSite();
  return decision[fromAnotherSite] as boolean;
};

// The sessionStorage share names the revision it belongs to, so that
// a share from an old copy of sessionStorage does not load.
export const tagShare = (share: string, revision: string) => `${share}.${revision}`;

export const untagShare = (tagged: string) => {
  const end = tagged.lastIndexOf(".");
  return end < 0 ? null : { share: tagged.slice(0, end), revision: tagged.slice(end + 1) };
};

// Marks the top window, which every page gets anew and its frames share
const forgotOnArrival = Symbol.for("session-keystore:forgot-on-arrival");

// Like forgetEarlierPages, once per page: stores created later must not
// remove the shares and revisions that this page wrote.
export const forgetEarlierPagesOnArrival = () => {
  const top = marks(window.top!);
  if (!top[forgotOnArrival]) {
    top[forgotOnArrival] = true;
    forgetEarlierPages();
  }
};

// Removes the tab's revisions too, so that a cached page of the tab drops its keys when it comes back
export const forgetEarlierPages = () => {
  for (const key of Object.keys(window.sessionStorage)) {
    if (key.startsWith(storagePrefix)) {
      window.sessionStorage.removeItem(key);
    }
  }
  removeAllFromWindowName();
  removeRevisionsOfThisTab();
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

const removeFromWindowNameWhere = (matches: (name: string) => boolean) => {
  const saved = loadObjectFromWindowName();
  const names = Object.keys(saved).filter(matches);
  if (names.length === 0) {
    return;
  }
  names.forEach((name) => delete saved[name]);
  const json = JSON.stringify(saved);
  window.top!.name = json === "{}" ? "" : json;
};

export const removeFromWindowName = (name: string) =>
  removeFromWindowNameWhere((saved) => saved === name);

const removeAllFromWindowName = () =>
  removeFromWindowNameWhere((saved) => saved.startsWith(storagePrefix));
