import mitt, { Emitter } from 'mitt'
import { split, saveToWindowName, loadFromWindowName, join } from './utility'

interface ExpirableKeyV0 {
  readonly key: string
  readonly expiresAt?: number // timestamp
}

interface ExpirableKeyV1 {
  v: 1
  readonly value: string
  readonly expiresAt?: number // timestamp
}

const isExpirableKeyV0 = (entry: any): entry is ExpirableKeyV0 => {
  return entry.v === undefined && !!entry.key
}
const isExpirableKeyV1 = (entry: any): entry is ExpirableKeyV1 => {
  return entry.v === 1 && !!entry.value
}

const convertV0toV1 = (v0Entry: ExpirableKeyV0): ExpirableKeyV1 => ({
  v: 1,
  value: v0Entry.key,
  expiresAt: v0Entry.expiresAt
})

// --

export interface KeyEvent<Keys> {
  name: Keys
}

export interface EventMap<Keys> {
  created: KeyEvent<Keys>
  read: KeyEvent<Keys>
  updated: KeyEvent<Keys>
  deleted: KeyEvent<Keys>
  expired: KeyEvent<Keys>
}

export type EventTypes<Keys> = keyof EventMap<Keys>
export type EventPayload<Keys, T extends EventTypes<Keys>> = EventMap<Keys>[T]
export type Callback<Keys, T extends EventTypes<Keys>> = (
  value: EventPayload<Keys, T>
) => void

export interface ConstructorOptions {
  name?: string
}

// --

export default class SessionKeystore<Keys = string> {
  // Members
  readonly name: string
  readonly #storageKey: string
  #emitter: Emitter
  #store: Map<Keys, ExpirableKeyV1>
  #timeouts: Map<Keys, any>
  #debounceTimer: any = null
  #pendingFinalize: (() => void) | null = null

  // --

  constructor(opts: ConstructorOptions = {}) {
    this.name = opts.name || 'default'
    this.#storageKey = `session-keystore:${this.name}`
    this.#emitter = mitt()
    this.#store = new Map()
    this.#timeouts = new Map()
    /* istanbul ignore else */
    if (typeof window !== 'undefined') {
      try {
        this._load()
      } catch {}
      // Phase 2: finalize on pagehide (preferred) with unload fallback.
      // Both may fire — _finalize() is idempotent.
      const finalizeHandler = this._finalize.bind(this)
      window.addEventListener('pagehide', finalizeHandler)
      window.addEventListener('unload', finalizeHandler)
    }
  }

  // Event Emitter --

  // Returns an unsubscribe callback
  on<T extends EventTypes<Keys>>(event: T, callback: Callback<Keys, T>) {
    this.#emitter.on(event, callback as any)
    return () => this.#emitter.off(event, callback as any)
  }

  off<T extends EventTypes<Keys>>(event: T, callback: Callback<Keys, T>) {
    this.#emitter.off(event, callback as any)
  }

  // API --

  set(key: Keys, value: string, expiresAt?: Date | number) {
    let d: number | undefined
    if (expiresAt !== undefined) {
      d = typeof expiresAt === 'number' ? expiresAt : expiresAt.valueOf()
    }
    const newItem: ExpirableKeyV1 = {
      v: 1,
      value,
      expiresAt: d
    }
    const oldItem = this.#store.get(key)
    this.#store.set(key, newItem)
    if (this._setTimeout(key) === 'expired') {
      return // Don't call created or updated
    }
    if (!oldItem) {
      this.#emitter.emit('created', { name: key })
      this._scheduleEagerSave()
    } else if (oldItem.value !== newItem.value) {
      this.#emitter.emit('updated', { name: key })
      this._scheduleEagerSave()
    }
  }

  get(key: Keys, now = Date.now()) {
    const item = this.#store.get(key)
    if (!item) {
      return null
    }
    if (item.expiresAt !== undefined && item.expiresAt <= now) {
      this._expired(key)
      return null
    }
    this.#emitter.emit('read', { name: key })
    return item.value
  }

  delete(key: Keys) {
    this._clearTimeout(key)
    this.#store.delete(key)
    this.#emitter.emit('deleted', { name: key })
    this._scheduleEagerSave()
  }

  clear() {
    this.#store.forEach((_, key) => this.delete(key))
  }

  // --

  /**
   * Manually persist both shares synchronously.
   * Preserved for backwards compatibility.
   */
  persist() {
    /* istanbul ignore next */
    if (typeof window === 'undefined') {
      throw new Error(
        'SessionKeystore.persist is only available in the browser.'
      )
    }
    const finalize = this._save()
    finalize()
  }

  /**
   * Phase 1: XOR-split the store and write share1 to window.name immediately.
   * Returns a finalize callback (phase 2) that writes share2 to sessionStorage.
   *
   * Inspired by ProtonMail's secureSessionStorage (Nov 2025 update):
   * Writing to window.name at pagehide is too late in Chrome/Safari — the
   * browsing context may be frozen and modifications aren't committed.
   * Instead, we write window.name eagerly on every change, and only commit
   * to sessionStorage at pagehide (which still works reliably).
   */
  private _save(): () => void {
    const json = JSON.stringify(Array.from(this.#store.entries()))
    const [a, b] = split(json)
    saveToWindowName(this.#storageKey, a)
    return () => {
      window.sessionStorage.setItem(this.#storageKey, b)
    }
  }

  /**
   * Schedule a debounced phase 1 save.
   * Called on every mutation (set, delete).
   */
  private _scheduleEagerSave() {
    if (typeof window === 'undefined') {
      return
    }
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer)
    }
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null
      this.#pendingFinalize = this._save()
    }, 50)
  }

  /**
   * Phase 2: Flush pending saves and write share2 to sessionStorage.
   * Called on pagehide/unload. Idempotent — safe if both events fire.
   */
  private _finalize() {
    // Flush any pending debounced save that hasn't fired yet
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer)
      this.#debounceTimer = null
      this.#pendingFinalize = this._save()
    }
    // Write share2 to sessionStorage
    if (this.#pendingFinalize) {
      this.#pendingFinalize()
      this.#pendingFinalize = null
    }
  }

  private _load() {
    const a = loadFromWindowName(this.#storageKey)
    const b = window.sessionStorage.getItem(this.#storageKey)
    window.sessionStorage.removeItem(this.#storageKey)
    if (!a || !b) {
      return
    }
    const json = join(a, b)
    /* istanbul ignore next */
    if (!json) {
      return
    }
    const entries: [Keys, ExpirableKeyV1][] = JSON.parse(json)

    this.#store = new Map(
      entries.map(([key, item]) => {
        if (isExpirableKeyV0(item)) {
          return [key, convertV0toV1(item)]
        }
        if (isExpirableKeyV1(item)) {
          return [key, item]
        }
        /* istanbul ignore next */
        return [key, item]
      })
    )
    // Re-establish timeouts
    this.#store.forEach((_, key) => {
      this._setTimeout(key)
    })
  }

  private _setTimeout(key: Keys): 'expired' | undefined {
    this._clearTimeout(key)
    const keyEntry = this.#store.get(key)
    if (keyEntry?.expiresAt === undefined) {
      return
    }
    const now = Date.now()
    const timeout = keyEntry.expiresAt - now
    if (timeout <= 0) {
      this._expired(key)
      return 'expired'
    }
    const t = setTimeout(() => {
      this._expired(key)
    }, timeout)
    this.#timeouts.set(key, t)
    return undefined
  }

  private _clearTimeout(key: Keys) {
    const timeoutId = this.#timeouts.get(key)
    clearTimeout(timeoutId)
    this.#timeouts.delete(key)
  }

  private _expired(key: Keys) {
    this._clearTimeout(key)
    this.#store.delete(key)
    this.#emitter.emit('expired', { name: key })
  }
}
