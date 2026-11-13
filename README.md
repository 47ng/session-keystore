<img
  src="./img/header@2x.png"
  width="640px"
  alt="session-keystore"
/>

[![NPM](https://img.shields.io/npm/v/session-keystore?color=red)](https://www.npmjs.com/package/session-keystore)
[![MIT License](https://img.shields.io/github/license/47ng/session-keystore.svg?color=blue)](https://github.com/47ng/session-keystore/blob/master/LICENSE)
[![Continuous Integration](https://github.com/47ng/session-keystore/workflows/Continuous%20Integration/badge.svg?branch=next)](https://github.com/47ng/session-keystore/actions)
[![Coverage Status](https://coveralls.io/repos/github/47ng/session-keystore/badge.svg?branch=next)](https://coveralls.io/github/47ng/session-keystore?branch=next)
[![Dependabot Status](https://api.dependabot.com/badges/status?host=github&repo=47ng/session-keystore)](https://dependabot.com)

Secure cryptographic key storage in the browser and Node.js

Ideal to store keys derived from user credentials (username/password) in
E2EE applications.

## Features

- In-memory storage: no clear-text persistance to disk
- Session-bound: cleared when closing tab/window (browser-only)
- Survives reloads, links, Back and Forward between pages of the same origin in the tab (browser-only)
- Cleared when the tab comes back from another site (browser-only)
- Optional expiration dates
- Event emitter API for key CRUD operations

## Installation

```shell
$ yarn add session-keystore
# or
$ npm i session-keystore
```

## Usage

```ts
import SessionKeystore from "session-keystore";

// Create a store
const store = new SessionKeystore();

// You can create multiple stores, but give them a unique name:
// (default name is 'default')
const otherStore = new SessionKeystore({ name: "other" });

// Save a session-bound key
store.set("foo", "supersecret");

// Set an expiration date (Date or timestamp in ms)
store.set("bar", "supersecret", Date.now() + 1000 * 60 * 5); // 5 minutes

// Retrieve the key
const key = store.get("bar");
// key will be null if it has expired

// Revoke a single key
store.delete("foo");

// Clear all keys in storage
store.clear();
```

## CRUD Event Emitter

Event types:

- `created`
- `read`
- `updated`
- `deleted`
- `expired`

Listen to events on a keystore with the `on` method:

```ts
import SessionKeystore from "session-keystore";

const store = new SessionKeystore();
store.on("created", ({ name }) => console.log("Key created: ", name));
store.on("updated", ({ name }) => console.log("Key updated: ", name));
store.on("deleted", ({ name }) => console.log("Key deleted: ", name));
store.on("expired", ({ name }) => console.log("Key expired: ", name));
store.on("read", ({ name }) => console.log("Key accessed: ", name));
```

Note: `deleted` will be called when the key has been manually deleted,
and `expired` when its expiration date has arrived.

When setting a key that is already expired, `created` or `updated` will
NOT be called, and `expired` will be called instead.

## TypeScript

`session-keystore` is written in TypeScript. You can tell a store about the keys it is supposed to hold:

```ts
import SessionKeystore from "session-keystore";

const store = new SessionKeystore<"foo" | "bar">();

store.get("foo"); // ok
store.get("bar"); // ok
store.get("egg"); // Error: Argument of type '"egg"' is not assignable to parameter of type '"foo" | "bar"'
```

This can be handy if you have multiple stores, to avoid accidental key leakage.

## How it works

Heavily inspired from the [Secure Session Storage](https://github.com/ProtonMail/proton-shared/blob/master/lib/helpers/secureSessionStorage.js#L7) implementation by [ProtonMail](https://protonmail.com),
itself inspired from Thomas Frank's [SessionVars](https://www.thomasfrank.se/sessionvars.html).

Read the [writeup article](https://francoisbest.com/posts/2019/how-to-store-e2ee-keys-in-the-browser) on [my blog](https://francoisbest.com/posts).

From the ProtonMail documentation:

> However, we aim to deliberately be non-persistent. This is useful for
> data that wants to be preserved across refreshes, but is too sensitive
> to be safely written to disk. Unfortunately, although sessionStorage is
> deleted when a session ends, major browsers automatically write it
> to disk to enable a session recovery feature, so using sessionStorage
> alone is inappropriate.
>
> To achieve this, we do two tricks. The first trick is to delay writing
> any possibly persistent data until the user is actually leaving the
> page (onunload). This already prevents any persistence in the face of
> crashes, and severely limits the lifetime of any data in possibly
> persistent form on refresh.
>
> The second, more important trick is to split sensitive data between
> `window.name` and sessionStorage. `window.name` is a property that, like
> sessionStorage, is preserved across refresh and navigation within the
> same tab - however, it seems to never be stored persistently. This
> provides exactly the lifetime we want. Unfortunately, `window.name` is
> readable and transferable between domains, so any sensitive data stored
> in it would leak to random other websites.
>
> To avoid this leakage, we split sensitive data into two shares which
> xor to the sensitive information but which individually are completely
> random and give away nothing. One share is stored in `window.name`, while
> the other share is stored in sessionStorage. This construction provides
> security that is the best of both worlds - random websites can't read
> the data since they can't access sessionStorage, while disk inspections
> can't read the data since they can't access `window.name`. The lifetime
> of the data is therefore the smaller lifetime, that of `window.name`.

### When the shares are written

This store does not wait for `unload` to write the `window.name` share.
Chromium applies writes to `window.name` made while the page unloads
(in `unload`, `pagehide` or `beforeunload`) one navigation late:
the next page gets the value from one navigation earlier.
This was [reported in Chromium 146](https://issues.chromium.org/issues/495842539)
and still happens in version 156.

To avoid this, the store writes the `window.name` share each time a key changes,
and keeps the sessionStorage share in memory.
It writes the sessionStorage share on `pagehide` (or when you call `persist()`),
if `window.name` still holds its share.
It removes the sessionStorage share when the page loads or when a key changes,
so that share stays on disk only for a short time while the page is open.
When a store loses its last key, it removes its share from `window.name`.
A store with no keys does not add one.

Avoid calling `set()`, `delete()` or `clear()` while the page unloads
(in `beforeunload`, `pagehide` or `unload`), even for a missing key or an unchanged value.
Reading a key that has expired has the same effect.
In Chromium, the next page then loads no keys at all, not only the one that changed.
Other browsers also lose the whole store if the call happens after the
store's own `pagehide` listener has run (for example in `unload`).
A key deleted or cleared while the page unloads never comes back.

### When keys are kept

The store loads keys when the page follows another page of the same origin in the tab:
a reload, a link, a form, a redirect, Back or Forward.
When the page before it was on another site, every store starts empty, in every browser,
whether the tab comes back with Back or a link.
The store also removes what earlier pages left in storage, for every store name,
so that it cannot come back on a later page.
To tell, it reads `navigation.activation.from`, which is `null` after a page of another origin.
Without the Navigation API, the store loads the keys it finds.
WebKit clears `window.name` on the way to another site, so the keys are lost anyway;
Firefox restores it on Back, so the keys come back there.

Navigations inside a single-page app (`history.pushState()`, `popstate`)
stay on the same page, so the keys stay in memory.

Safari can load a URL that you type in the address bar before you press Enter
(Settings → Search → "Preload Top Hit in the background").
That page starts without the `window.name` share, so it starts empty.

When Back or Forward brings the page back from the back/forward cache, it still holds the keys in memory.
If the page before it was on another site, the store forgets them, emits `deleted` for each one,
and removes what earlier pages left in storage.
If another page changed the store in the meantime, the keys are out of date,
so the store forgets them and emits `deleted` for each one:
a key deleted on the other page does not come back.
To tell, the store keeps a random revision ID that changes each time a key is set, deleted or expires.
Otherwise, if `window.name` still holds its share, it removes the sessionStorage share,
writes a new `window.name` share and keeps the new sessionStorage share in memory.
If not, it writes no share until a key changes,
and an old sessionStorage share can stay on disk until then.
If anything throws when the page comes back, an event listener included,
the store forgets the keys and removes what earlier pages left in storage.

When a page comes back from the back/forward cache, Safari updates `navigation.activation` only after `pageshow`.
It then gives the entry after this one as `from`: after Back, that entry is correct; after Forward, it is not.
So the first time a page comes back from the back/forward cache,
the store checks whether `navigation.activation` has changed since the page loaded,
and keeps that choice until the page unloads.
If it has not changed, the store stops using `navigation.activation`.
Instead, it reads a note that every page that uses the store writes to sessionStorage on `pagehide`:
the last page of the tab to hide.
If the page that comes back is still the last one, no other page that uses the store hid since,
so the store forgets the keys, as it does after another site. It does the same when the tab has no note.
So in Safari, a page of the same origin that does not use the store counts as another site.
After Back or Forward across more than one page in one step (for example with `history.go(-2)`,
which the other site can also call), Safari can keep the keys even when the tab comes back from another site.
A page that Back loads again (not from the cache) and that later comes back from the same page
gets the same `navigation.activation` twice, so the store uses the note, as in Safari, in every browser.
In Firefox, that page then gets back its own old note, so the store forgets the keys.

When Back or Forward brings a page back from the back/forward cache, Firefox gives it
the sessionStorage and `window.name` it had when it left, without the changes that later pages made.
So the store keeps the revision ID in localStorage, under a random tab ID that it keeps in sessionStorage.
The sessionStorage share names the revision it belongs to.
The store loads a share only if its revision is the current one,
so a share from an old copy of sessionStorage does not bring keys back.
A popup starts with a copy of its opener's sessionStorage, tab ID included.
Each time a store starts in the popup, if it can read the opener's sessionStorage and finds the same tab ID,
it takes a new one.
If a store in the popup saved keys before it could read the opener's sessionStorage,
the popup removes the revision IDs under the shared tab ID before it takes a new one,
so the opener loses its keys on its next page load or back/forward cache restore.
Otherwise, as in a duplicated tab, the two tabs share a tab ID,
and a change in one of them makes the other lose its keys on its next page load or back/forward cache restore.
Clear keys with `clear()`, not by clearing sessionStorage:
in Firefox, a page in the back/forward cache does not see that sessionStorage was cleared, and keeps its keys.

localStorage stays after the tab closes, so each new store removes the revision IDs saved more than 30 days ago.
A store saves a new revision ID each time a key changes, and saves it again each time a page loads its keys.
If a store does neither for 30 days, it loses its keys.

When the store cannot reach `window.top.name`, sessionStorage or localStorage
(in a cross-origin iframe, or with storage blocked), it keeps keys in memory only.
In a cross-origin iframe, it also forgets them each time the page comes back from the back/forward cache.

Chromium usually keeps `window.name` when the tab goes to another site,
so that site can read the store name and the `window.name` share:
base64 text of random bytes. Its length shows the size of the stored JSON (the share holds 32 bytes more).
It cannot read the sessionStorage share, so it cannot rebuild the keys,
and the store does not load them when the tab comes back.

### Integrity check

The sessionStorage share also holds a SHA-256 hash of the `window.name` share.
When the page loads, the store removes both shares, then hashes the `window.name` share again.
If the hashes do not match, it loads no keys.
The hash does not cover the sessionStorage share.
Shares saved by version 1.x have no hash, and shares saved by 2.0 beta versions name no revision,
so after an upgrade, each tab loses the keys that the old version saved.

The `window.name` share holds 32 more random bytes than the XOR needs,
so a disk reader cannot use the hash to confirm a guess of the keys.

## License

[MIT](https://github.com/47ng/session-keystore/blob/master/LICENSE) - Made with ❤️ by [François Best](https://francoisbest.com)

Using this package at work ? [Sponsor me](https://github.com/sponsors/franky47) to help with support and maintenance.
