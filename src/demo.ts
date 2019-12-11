import SessionKeystore from './index'

// Create a store
const store = new SessionKeystore()

// You can create multiple stores, but give them a unique name:
// (default name is 'session-keystore')
// const otherStore = new SessionKeystore('other')

// Save a session-bound key
store.set('foo', 'supersecret')

// Set an expiration date (Date or timestamp in ms)
store.set('bar', 'supersecret', Date.now() + 1000 * 60 * 5) // 5 minutes

// Retrieve the key
// const key = store.get('bar')
// key will be null if it has expired

// Revoke a single key
store.delete('foo')

// Clear all keys in storage
store.clear()

// Strong typing of the possible keys:
const typedStore = new SessionKeystore<'foo' | 'bar'>()

// Add spies for key expiration and key access
store.set('bar', 'supersecret', 1000 * 60 * 5, {
  onAccess: (keyName, callStack) => console.dir({ keyName, callStack }),
  onExpired: () => console.warn
})

typedStore.get('foo') // ok
typedStore.get('bar') // ok
// typedStore.get('egg') // Error: unknown key 'egg'
