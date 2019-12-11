# `session-keystore`

[![MIT License](https://img.shields.io/github/license/47ng/session-keystore.svg?color=blue)](https://github.com/47ng/session-keystore/blob/master/LICENSE)
[![Travis CI Build](https://img.shields.io/travis/com/47ng/session-keystore.svg)](https://travis-ci.com/47ng/session-keystore)
[![Average issue resolution time](https://isitmaintained.com/badge/resolution/47ng/session-keystore.svg)](https://isitmaintained.com/project/47ng/session-keystore)
[![Number of open issues](https://isitmaintained.com/badge/open/47ng/session-keystore.svg)](https://isitmaintained.com/project/47ng/session-keystore)

Secure cryptographic key storage in the browser.

## Features

- In-memory storage (no clear-text persistance to disk)
- Session-bound (deleted when closing tab/window)
- Survives hard-reloads of the page
- Optional expiration dates
- Notification callbacks on key access and key expiration

## Installation

```shell
$ yarn add session-keystore
# or
$ npm i session-keystore
```

## Usage

```ts
import SessionKeystore from 'session-keystore'

// Create a store
const store = new SessionKeystore()

// You can create multiple stores, but give them a unique name:
// (default name is 'default')
const otherStore = new SessionKeystore('other')

// Save a session-bound key
store.set('foo', 'supersecret')

// Set an expiration date (Date or number of ms)
store.set('bar', 'supersecret', Date.now() + 1000 * 60 * 5) // 5 minutes

// Retrieve the key
const key = store.get('bar')
// key will be null if it has expired

// Revoke a single key
store.delete('foo')

// Clear all keys in storage
store.clear()

// Strong typing of the possible keys:
const typedStore = new SessionKeystore<'foo' | 'bar'>()

typedStore.get('foo') // ok
typedStore.get('bar') // ok
typedStore.get('egg') // Error: Argument of type '"egg"' is not assignable to parameter of type '"foo" | "bar"'

// Add notification callbacks for key access and expiration
store.set('bar', 'supersecret', Date.now() + 1000 * 60 * 5, {
  onAccess: (keyName, callStack) => console.dir({ keyName, callStack }),
  onExpired: keyName => console.warn(keyName, 'has expired')
})
```

## How it works

Heavily inspired from [ProtonMail's Secure Session Storage](https://github.com/ProtonMail/proton-shared/blob/master/lib/helpers/secureSessionStorage.js#L7).

## License

[MIT](https://github.com/47ng/session-keystore/blob/master/LICENSE) - Made with ❤️ by [François Best](https://francoisbest.com).
