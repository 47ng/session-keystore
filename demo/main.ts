import SessionKeystore from '../src/index.ts'

declare global {
  interface Window {
    // Exposed for the end-to-end tests
    store: SessionKeystore
    restoredFromCache: boolean
  }
}

const store = new SessionKeystore()
window.store = store
addEventListener('pageshow', event => {
  window.restoredFromCache = event.persisted
})

const keyNames = ['foo', 'bar']
const output = document.querySelector('#keys')!

function render() {
  output.textContent = keyNames
    .map(name => `${name}: ${JSON.stringify(store.get(name))}`)
    .join('\n')
}

const button = (id: string, onClick: () => void) =>
  document.querySelector(`#${id}`)!.addEventListener('click', onClick)

button('set-foo', () => store.set('foo', crypto.randomUUID()))
button('set-bar', () => store.set('bar', crypto.randomUUID(), Date.now() + 3000))
button('clear', () => store.clear())
button('reload', () => location.reload())

for (const event of ['created', 'updated', 'deleted', 'expired'] as const) {
  store.on(event, render)
}
render()
