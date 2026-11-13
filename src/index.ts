import mitt from "mitt";
import type { Emitter } from "mitt";

import {
  split,
  join,
  canPersist,
  storagePrefix,
  followsSameOriginPage,
  noteActivationOnArrival,
  noteHiddenPage,
  leaveOpenerTab,
  comesBackFromAnotherSite,
  readRevision,
  saveRevision,
  removeRevision,
  removeOldRevisions,
  tagShare,
  untagShare,
  forgetEarlierPages,
  forgetEarlierPagesOnArrival,
  saveToWindowName,
  readFromWindowName,
  removeFromWindowName,
} from "./utility.ts";

interface ExpirableKey {
  v: 1;
  readonly value: string;
  readonly expiresAt?: number; // timestamp
}

// The payload passed the hash check, so this store wrote it. Only its
// format is checked: anything unexpected drops every key.
const isPayload = <Keys>(data: unknown): data is [Keys, ExpirableKey][] =>
  Array.isArray(data) && data.every(([, item]) => item?.v === 1 && typeof item.value === "string");

// --

export interface KeyEvent<Keys> {
  name: Keys;
}

export type EventMap<Keys> = {
  created: KeyEvent<Keys>;
  read: KeyEvent<Keys>;
  updated: KeyEvent<Keys>;
  deleted: KeyEvent<Keys>;
  expired: KeyEvent<Keys>;
};

export type EventTypes<Keys> = keyof EventMap<Keys>;
export type EventPayload<Keys, T extends EventTypes<Keys>> = EventMap<Keys>[T];
export type Callback<Keys, T extends EventTypes<Keys>> = (value: EventPayload<Keys, T>) => void;

export interface ConstructorOptions {
  name?: string;
}

// --

export default class SessionKeystore<Keys = string> {
  // Members
  readonly name: string;
  readonly #storageKey: string;
  #emitter: Emitter<EventMap<Keys>>;
  #store: Map<Keys, ExpirableKey>;
  #timeouts: Map<Keys, ReturnType<typeof setTimeout>>;
  #halves: { windowName: string; sessionStorage: string } | null = null;
  #revision: string | null = null;
  readonly #canPersist: boolean = false;

  // --

  constructor(opts: ConstructorOptions = {}) {
    this.name = opts.name || "default";
    this.#storageKey = `${storagePrefix}${this.name}`;
    this.#emitter = mitt();
    this.#store = new Map();
    this.#timeouts = new Map();
    /* istanbul ignore else */
    if (typeof window !== "undefined") {
      // They throw when the top frame is cross-origin or storage is blocked.
      // Old revisions go first, so that a share whose revision no page saved
      // for 30 days does not load.
      try {
        noteActivationOnArrival();
        leaveOpenerTab();
        removeOldRevisions();
        this._load();
      } catch {}
      this.#canPersist = canPersist();
      if (this.#canPersist) {
        try {
          if (this.#store.size > 0) {
            // Saves the same revision again, to restart its 30 days
            saveRevision(this.name, this.#revision!);
          } else {
            this.#revision = readRevision(this.name);
          }
        } catch {}
      }
      if (this.#store.size > 0) {
        this._writeWindowNameHalf();
      }
      window.addEventListener("pagehide", () => {
        if (this.#canPersist) {
          try {
            noteHiddenPage();
          } catch {}
        }
        this._writeSessionStorageHalf();
      });
      window.addEventListener("pageshow", (event) => {
        if (event.persisted) {
          // If anything throws, a listener included, it forgets every key:
          // a deleted key must never come back
          try {
            this._comeBackFromCache(comesBackFromAnotherSite(event));
          } catch {
            this._forgetAll();
          }
        }
      });
    }
  }

  // Event Emitter --

  // Returns an unsubscribe callback
  on<T extends EventTypes<Keys>>(event: T, callback: Callback<Keys, T>) {
    this.#emitter.on(event, callback);
    return () => this.#emitter.off(event, callback);
  }

  off<T extends EventTypes<Keys>>(event: T, callback: Callback<Keys, T>) {
    this.#emitter.off(event, callback);
  }

  // API --

  set(key: Keys, value: string, expiresAt?: Date | number) {
    let d: number | undefined;
    if (expiresAt !== undefined) {
      d = typeof expiresAt === "number" ? expiresAt : expiresAt.valueOf();
    }
    const newItem: ExpirableKey = {
      v: 1,
      value,
      expiresAt: d,
    };
    // Throw before changing the store, so that it never holds an entry
    // that later writes cannot serialize.
    JSON.stringify([key, newItem]);
    const oldItem = this.#store.get(key);
    this.#store.set(key, newItem);
    if (this._setTimeout(key) === "expired") {
      return; // Don't call created or updated
    }
    this._saveChange();
    if (!oldItem) {
      this.#emitter.emit("created", { name: key });
    } else if (oldItem.value !== newItem.value) {
      this.#emitter.emit("updated", { name: key });
    }
  }

  get(key: Keys, now = Date.now()) {
    const item = this.#store.get(key);
    if (!item) {
      return null;
    }
    if (item.expiresAt !== undefined && item.expiresAt <= now) {
      this._expired(key);
      return null;
    }
    this.#emitter.emit("read", { name: key });
    return item.value;
  }

  delete(key: Keys) {
    this._clearTimeout(key);
    this.#store.delete(key);
    this._saveChange();
    this.#emitter.emit("deleted", { name: key });
  }

  clear() {
    this.#store.forEach((_, key) => this.delete(key));
  }

  // --

  persist() {
    /* istanbul ignore next */
    if (typeof window === "undefined") {
      throw new Error("SessionKeystore.persist is only available in the browser.");
    }
    this._writeSessionStorageHalf();
  }

  private _saveChange() {
    if (this.#canPersist) {
      // Drops the sessionStorage share first: if the old revision cannot be
      // removed, pagehide has no old share to write. Then drops the old
      // revision: if the new one cannot be saved, no share and no cached page
      // can match.
      window.sessionStorage.removeItem(this.#storageKey);
      this.#halves = null;
      removeRevision(this.name);
      this.#revision = null;
      if (this.#store.size > 0) {
        this.#revision = Math.random().toString(36).slice(2);
        try {
          saveRevision(this.name, this.#revision);
        } catch {}
      }
    }
    this._writeWindowNameHalf();
  }

  private _comeBackFromCache(fromAnotherSite: boolean) {
    if (fromAnotherSite) {
      this._forgetAll();
    } else if (this._changedElsewhere()) {
      this._dropOutdatedKeys();
    } else if (this._ownsWindowName()) {
      this._writeWindowNameHalf();
    }
  }

  private _changedElsewhere() {
    return this.#canPersist && readRevision(this.name) !== this.#revision;
  }

  // Another page changed the store while this one was in the back/forward
  // cache: forget every key, and the shares unless they belong to the
  // current revision.
  private _dropOutdatedKeys() {
    this._dropKeys(() => {
      this.#revision = readRevision(this.name);
      const saved = untagShare(window.sessionStorage.getItem(this.#storageKey) ?? "");
      if (saved?.revision !== this.#revision) {
        window.sessionStorage.removeItem(this.#storageKey);
        removeFromWindowName(this.#storageKey);
      }
    });
  }

  // The tab comes back from another site, or the store cannot tell: forget
  // every key, from memory and from storage, for every store of the tab.
  private _forgetAll() {
    this._dropKeys(() => {
      if (this.#canPersist) {
        this.#revision = null;
        forgetEarlierPages();
      }
    });
  }

  // Emits last, so that a listener that throws cannot keep keys, and in
  // finally, so that listeners hear of the dropped keys even when storage fails
  private _dropKeys(forgetStorage: () => void) {
    const names = Array.from(this.#store.keys());
    names.forEach((name) => this._clearTimeout(name));
    this.#store.clear();
    this.#halves = null;
    try {
      forgetStorage();
    } finally {
      names.forEach((name) => this.#emitter.emit("deleted", { name }));
    }
  }

  private _writeWindowNameHalf() {
    if (!this.#canPersist) {
      return;
    }
    window.sessionStorage.removeItem(this.#storageKey);
    this.#halves = null;
    if (this.#store.size === 0) {
      removeFromWindowName(this.#storageKey);
      return;
    }
    const json = JSON.stringify(Array.from(this.#store.entries()));
    const [windowName, sessionStorage] = split(json);
    saveToWindowName(this.#storageKey, windowName);
    this.#halves = { windowName, sessionStorage };
  }

  private _writeSessionStorageHalf() {
    if (this.#halves && this._ownsWindowName()) {
      window.sessionStorage.setItem(
        this.#storageKey,
        tagShare(this.#halves.sessionStorage, this.#revision!),
      );
    }
  }

  private _ownsWindowName() {
    return (
      this.#halves !== null && readFromWindowName(this.#storageKey) === this.#halves.windowName
    );
  }

  private _load() {
    // After a page of another site: start empty
    if (!followsSameOriginPage()) {
      forgetEarlierPagesOnArrival();
      return;
    }
    const windowNameHalf = readFromWindowName(this.#storageKey);
    const taggedShare = window.sessionStorage.getItem(this.#storageKey);
    window.sessionStorage.removeItem(this.#storageKey);
    if (!windowNameHalf || !taggedShare) {
      return;
    }
    removeFromWindowName(this.#storageKey);
    const saved = untagShare(taggedShare);
    if (!saved || saved.revision !== readRevision(this.name)) {
      return;
    }
    const json = join(windowNameHalf, saved.share);
    if (!json) {
      return;
    }
    const entries: unknown = JSON.parse(json);
    if (!isPayload<Keys>(entries)) {
      return;
    }
    this.#store = new Map(entries);
    this.#revision = saved.revision;
    // Re-establish timeouts
    this.#store.forEach((_, key) => {
      this._setTimeout(key);
    });
  }

  private _setTimeout(key: Keys): "expired" | undefined {
    this._clearTimeout(key);
    const keyEntry = this.#store.get(key);
    if (keyEntry?.expiresAt === undefined) {
      return;
    }
    const now = Date.now();
    const timeout = keyEntry.expiresAt - now;
    if (timeout <= 0) {
      this._expired(key);
      return "expired";
    }
    const t = setTimeout(() => {
      this._expired(key);
    }, timeout);
    this.#timeouts.set(key, t);
    return undefined;
  }

  private _clearTimeout(key: Keys) {
    const timeoutId = this.#timeouts.get(key);
    clearTimeout(timeoutId);
    this.#timeouts.delete(key);
  }

  private _expired(key: Keys) {
    this._clearTimeout(key);
    this.#store.delete(key);
    this._saveChange();
    this.#emitter.emit("expired", { name: key });
  }
}
