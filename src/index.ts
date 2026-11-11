import mitt from "mitt";
import type { Emitter } from "mitt";

import {
  split,
  join,
  canPersist,
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
  readonly #revisionKey: string;
  #emitter: Emitter<EventMap<Keys>>;
  #store: Map<Keys, ExpirableKey>;
  #timeouts: Map<Keys, ReturnType<typeof setTimeout>>;
  #halves: { windowName: string; sessionStorage: string } | null = null;
  #revision: string | null = null;
  readonly #canPersist: boolean = false;

  // --

  constructor(opts: ConstructorOptions = {}) {
    this.name = opts.name || "default";
    this.#storageKey = `session-keystore:${this.name}`;
    this.#revisionKey = `${this.#storageKey}:revision`;
    this.#emitter = mitt();
    this.#store = new Map();
    this.#timeouts = new Map();
    /* istanbul ignore else */
    if (typeof window !== "undefined") {
      try {
        this._load();
      } catch {}
      this.#canPersist = canPersist();
      if (this.#canPersist) {
        this.#revision = window.sessionStorage.getItem(this.#revisionKey);
      }
      if (this.#store.size > 0) {
        this._writeWindowNameHalf();
      }
      window.addEventListener("pagehide", () => this._writeSessionStorageHalf());
      window.addEventListener("pageshow", (event) => {
        if (!event.persisted) {
          return;
        }
        if (this._changedElsewhere()) {
          this._dropOutdatedKeys();
        } else if (this._ownsWindowName()) {
          this._writeWindowNameHalf();
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
      if (this.#store.size === 0) {
        this.#revision = null;
        window.sessionStorage.removeItem(this.#revisionKey);
      } else {
        this.#revision = Math.random().toString(36).slice(2);
        window.sessionStorage.setItem(this.#revisionKey, this.#revision);
      }
    }
    this._writeWindowNameHalf();
  }

  private _changedElsewhere() {
    return this.#canPersist && window.sessionStorage.getItem(this.#revisionKey) !== this.#revision;
  }

  // Another page changed the store while this one was in the back/forward
  // cache: forget the outdated keys and shares, without writing anything.
  private _dropOutdatedKeys() {
    this.#halves = null;
    this.#revision = window.sessionStorage.getItem(this.#revisionKey);
    this.#store.forEach((_, key) => {
      this._clearTimeout(key);
      this.#store.delete(key);
      this.#emitter.emit("deleted", { name: key });
    });
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
      window.sessionStorage.setItem(this.#storageKey, this.#halves.sessionStorage);
    }
  }

  private _ownsWindowName() {
    return (
      this.#halves !== null && readFromWindowName(this.#storageKey) === this.#halves.windowName
    );
  }

  private _load() {
    const windowNameHalf = readFromWindowName(this.#storageKey);
    const sessionStorageHalf = window.sessionStorage.getItem(this.#storageKey);
    window.sessionStorage.removeItem(this.#storageKey);
    if (!windowNameHalf || !sessionStorageHalf) {
      return;
    }
    removeFromWindowName(this.#storageKey);
    const json = join(windowNameHalf, sessionStorageHalf);
    if (!json) {
      return;
    }
    const entries: unknown = JSON.parse(json);
    if (!isPayload<Keys>(entries)) {
      return;
    }
    this.#store = new Map(entries);
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
