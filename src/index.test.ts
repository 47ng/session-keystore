import SK from './index'
import { split, saveToWindowName } from './utility'

test('Store with default name', () => {
  const store = new SK()
  expect(store.name).toEqual('default')
})

test('Store with a name', () => {
  const store = new SK({ name: 'foo' })
  expect(store.name).toEqual('foo')
})

describe('Event handlers', () => {
  test('created/updated', () => {
    const store = new SK()
    const created = jest.fn()
    const updated = jest.fn()
    store.on('created', created)
    store.on('updated', updated)
    store.set('foo', 'bar')
    expect(created).toHaveBeenCalledTimes(1)
    expect(created.mock.calls[0][0]).toEqual({ name: 'foo' })
    expect(updated).not.toHaveBeenCalled()
    created.mockReset()
    updated.mockReset()
    store.set('foo', 'egg')
    expect(created).not.toHaveBeenCalled()
    expect(updated).toHaveBeenCalledTimes(1)
    expect(updated.mock.calls[0][0]).toEqual({ name: 'foo' })
    created.mockReset()
    updated.mockReset()
    store.set('foo', 'egg') // Same value
    expect(created).not.toHaveBeenCalled()
    expect(updated).not.toHaveBeenCalled()
  })

  test('read', () => {
    const store = new SK()
    const read = jest.fn()
    store.on('read', read)
    store.set('foo', 'bar')
    expect(read).not.toHaveBeenCalled()
    store.get('foo')
    expect(read).toHaveBeenCalledTimes(1)
    expect(read.mock.calls[0][0]).toEqual({ name: 'foo' })
  })

  test('deleted', () => {
    const store = new SK()
    const deleted = jest.fn()
    store.on('deleted', deleted)
    store.set('foo', 'bar')
    store.get('foo')
    expect(deleted).not.toHaveBeenCalled()
    store.delete('foo')
    expect(deleted).toHaveBeenCalledTimes(1)
    expect(deleted.mock.calls[0][0]).toEqual({ name: 'foo' })
  })

  test('expired', () => {
    const store = new SK()
    const expired = jest.fn()
    const deleted = jest.fn()
    store.on('expired', expired)
    store.on('deleted', deleted)
    const expirationDate = Date.now() + 1000
    store.set('foo', 'bar', expirationDate)
    store.get('foo', expirationDate - 100)
    expect(expired).not.toHaveBeenCalled()
    store.get('foo', expirationDate + 100)
    expect(expired).toHaveBeenCalledTimes(1)
    expect(expired.mock.calls[0][0]).toEqual({ name: 'foo' })
    expect(deleted).not.toHaveBeenCalled()
  })

  test('Unsubscribe via returned off callback', () => {
    const store = new SK()
    const read = jest.fn()
    const off = store.on('read', read)
    store.set('foo', 'bar')
    store.get('foo')
    off()
    store.get('foo')
    expect(read).toHaveBeenCalledTimes(1)
  })

  test('Unsubscribe via off method', () => {
    const store = new SK()
    const read = jest.fn()
    store.on('read', read)
    store.set('foo', 'bar')
    store.get('foo')
    store.off('read', read)
    store.get('foo')
    expect(read).toHaveBeenCalledTimes(1)
  })

  test('By default, this is not bound to the store', () => {
    const store = new SK()
    const nobind = jest.fn().mockReturnThis()
    const bind = jest.fn().mockReturnThis()
    store.on('created', nobind)
    store.on('created', bind.bind(store))
    store.set('foo', 'bar')
    expect(bind.mock.results[0].value).toEqual(store)
    expect(nobind.mock.results[0].value).toBeUndefined()
  })
})

test('Clear', () => {
  const store = new SK()
  const deleted = jest.fn()
  store.on('deleted', deleted)
  store.set('foo', 'bar')
  store.set('egg', 'spam')
  expect(store.get('foo')).toEqual('bar')
  expect(store.get('egg')).toEqual('spam')
  store.clear()
  expect(deleted).toHaveBeenCalledTimes(2)
  expect(deleted.mock.calls[0][0]).toEqual({ name: 'foo' })
  expect(deleted.mock.calls[1][0]).toEqual({ name: 'egg' })
  expect(store.get('foo')).toBeNull()
  expect(store.get('egg')).toBeNull()
})

test('Key expiration', () => {
  jest.useFakeTimers()
  const store = new SK()
  const expired = jest.fn()
  const deleted = jest.fn()
  store.on('expired', expired)
  store.on('deleted', deleted)
  store.set('foo', 'bar', Date.now() + 100)
  store.set('egg', 'qux', Date.now() + 200)
  jest.advanceTimersByTime(150)
  expect(expired).toHaveBeenCalledTimes(1)
  expect(expired.mock.calls[0][0]).toEqual({ name: 'foo' })
  expect(store.get('foo')).toBeNull()
  expect(store.get('egg')).toEqual('qux')
  expect(deleted).not.toHaveBeenCalled()
  jest.useRealTimers()
})

test('Set a key that already expired', () => {
  const store = new SK()
  const created = jest.fn()
  const expired = jest.fn()
  store.on('created', created)
  store.on('expired', expired)
  store.set('foo', 'bar', 0)
  expect(created).not.toHaveBeenCalled()
  expect(expired).toHaveBeenCalledTimes(1)
})

test('Persistence (manual persist)', () => {
  const storeA = new SK()
  storeA.set('foo', 'bar')
  storeA.persist()
  const storeB = new SK()
  expect(storeB.get('foo')).toEqual('bar')
})

describe('Two-phase persist', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    window.top!.name = ''
    window.sessionStorage.clear()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  test('Phase 1: set() writes to window.name after debounce', () => {
    const store = new SK()
    const storageKey = 'session-keystore:default'
    store.set('foo', 'bar')
    // Before debounce fires, window.name should not have our data yet
    // (it was cleared by _load() in constructor)
    jest.advanceTimersByTime(50)
    // After debounce, share1 should be in window.name
    expect(window.top!.name).not.toBe('')
    // But sessionStorage should NOT have share2 yet
    expect(window.sessionStorage.getItem(storageKey)).toBeNull()
  })

  test('Phase 2: pagehide writes share2 to sessionStorage', () => {
    const store = new SK()
    const storageKey = 'session-keystore:default'
    store.set('foo', 'bar')
    jest.advanceTimersByTime(50)
    // Simulate pagehide
    window.dispatchEvent(new Event('pagehide'))
    // Now sessionStorage should have share2
    expect(window.sessionStorage.getItem(storageKey)).not.toBeNull()
  })

  test('Full cycle: eager save + pagehide + new store loads data', () => {
    const storeA = new SK()
    storeA.set('foo', 'bar')
    jest.advanceTimersByTime(50)
    window.dispatchEvent(new Event('pagehide'))
    const storeB = new SK()
    expect(storeB.get('foo')).toEqual('bar')
  })

  test('Finalize flushes pending debounce if timer has not fired', () => {
    const store = new SK()
    const storageKey = 'session-keystore:default'
    store.set('foo', 'bar')
    // Do NOT advance timers — debounce hasn't fired
    // Simulate pagehide — should flush the pending save
    window.dispatchEvent(new Event('pagehide'))
    expect(window.top!.name).not.toBe('')
    expect(window.sessionStorage.getItem(storageKey)).not.toBeNull()
    // And a new store should load the data
    const storeB = new SK()
    expect(storeB.get('foo')).toEqual('bar')
  })

  test('Double finalize (pagehide + unload) is safe', () => {
    const store = new SK()
    store.set('foo', 'bar')
    jest.advanceTimersByTime(50)
    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('unload'))
    // Should not throw, data should still be loadable
    const storeB = new SK()
    expect(storeB.get('foo')).toEqual('bar')
  })

  test('Debouncing: rapid set() calls result in single window.name write', () => {
    const store = new SK()
    store.set('a', '1')
    store.set('b', '2')
    store.set('c', '3')
    // Only advance enough for one debounce cycle
    jest.advanceTimersByTime(50)
    // All three keys should be present after a single save
    window.dispatchEvent(new Event('pagehide'))
    const storeB = new SK()
    expect(storeB.get('a')).toEqual('1')
    expect(storeB.get('b')).toEqual('2')
    expect(storeB.get('c')).toEqual('3')
  })
})

test('v0 to v1 conversion', () => {
  const future = Date.now() + 1000
  const json = JSON.stringify([['foo', { key: 'bar', expiresAt: future }]])
  const [a, b] = split(json)
  const storageKey = 'session-keystore:default'
  saveToWindowName(storageKey, a)
  window.sessionStorage.setItem(storageKey, b)
  const store = new SK()
  expect(store.get('foo')).toEqual('bar')
  expect(store.get('foo', future)).toBeNull()
})

test('Expiration date', () => {
  const future = new Date(Date.now() + 1000)
  const store = new SK()
  store.set('foo', 'bar', future)
  expect(store.get('foo')).toEqual('bar')
  expect(store.get('foo', future.valueOf())).toBeNull()
})
