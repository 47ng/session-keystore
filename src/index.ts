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
      window.addEventListener('unload', this.persist.bind(this))
    }
  }

  // Event Emitter --

  // Returns an unsubscribe callback
  on<T extends EventTypes<Keys>>(event: T, callback: Callback<Keys, T>) {
    this.#emitter.on(event, callback)
    return () => this.#emitter.off(event, callback)
  }

  off<T extends EventTypes<Keys>>(event: T, callback: Callback<Keys, T>) {
    this.#emitter.off(event, callback)
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
    } else if (oldItem.value !== newItem.value) {
      this.#emitter.emit('updated', { name: key })
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
  }

  clear() {
    this.#store.forEach((_, key) => this.delete(key))
  }

  // --

  persist() {
    /* istanbul ignore next */
    if (typeof window === 'undefined') {
      throw new Error(
        'SessionKeystore.persist is only available in the browser.'
      )
    }
    const json = JSON.stringify(Array.from(this.#store.entries()))
    const [a, b] = split(json)
    saveToWindowName(this.#storageKey, a)
    window.sessionStorage.setItem(this.#storageKey, b)
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
