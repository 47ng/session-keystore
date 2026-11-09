import { test, expect, type Page } from '@playwright/test'
import { build } from 'esbuild'

const origin = 'https://keystore.test'

const html = `<!doctype html>
<script src="/keystore.js"></script>
<script>
  window.store = new SessionKeystore.default()
  addEventListener('pageshow', event => {
    window.restoredFromCache = event.persisted
  })
</script>`

let bundle: string

test.beforeAll(async () => {
  const { outputFiles } = await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'SessionKeystore',
    external: ['crypto']
  })
  bundle = outputFiles[0].text
})

test.beforeEach(async ({ context }) => {
  await context.route(`${origin}/**`, route => {
    const isBundle = new URL(route.request().url()).pathname === '/keystore.js'
    return route.fulfill(
      isBundle
        ? { contentType: 'text/javascript', body: bundle }
        : { contentType: 'text/html', body: html }
    )
  })
})

const setKey = (page: Page, key: string, value: string) =>
  page.evaluate(([k, v]) => (window as any).store.set(k, v), [key, value])

const getKey = (page: Page, key: string) =>
  page.evaluate(k => (window as any).store.get(k), key)

test('keeps keys across a reload', async ({ page }) => {
  await page.goto(origin)
  await setKey(page, 'foo', 'bar')
  await page.reload()
  expect(await getKey(page, 'foo')).toEqual('bar')
})

test('keeps keys across several reloads without changes', async ({ page }) => {
  await page.goto(origin)
  await setKey(page, 'foo', 'bar')
  for (let i = 0; i < 3; i++) {
    await page.reload()
  }
  expect(await getKey(page, 'foo')).toEqual('bar')
})

test('keeps keys across same-origin navigations', async ({ page }) => {
  await page.goto(origin)
  await setKey(page, 'foo', 'bar')
  await page.goto(`${origin}/other`)
  await page.goto(origin)
  expect(await getKey(page, 'foo')).toEqual('bar')
})

test('keeps keys after a back/forward cache restore', async ({
  page,
  browserName
}) => {
  test.skip(
    browserName !== 'chromium',
    'Playwright turns off the back/forward cache in Firefox and WebKit'
  )
  await page.goto(origin)
  await setKey(page, 'foo', 'bar')
  await page.goto(`${origin}/other`)
  await page.goBack({ waitUntil: 'commit' })
  await page.waitForFunction(() => (window as any).restoredFromCache === true)
  await page.reload()
  expect(await getKey(page, 'foo')).toEqual('bar')
})

test('ignores window.name changes from another site after a back/forward cache restore', async ({
  page,
  browserName
}) => {
  test.skip(
    browserName !== 'chromium',
    'Playwright turns off the back/forward cache in Firefox and WebKit'
  )
  const otherSite = 'https://other.test'
  await page.route(`${otherSite}/**`, route =>
    route.fulfill({
      contentType: 'text/html',
      body: '<script>window.name = "tampered"</script>'
    })
  )
  await page.goto(origin)
  await setKey(page, 'foo', 'bar')
  await page.goto(otherSite)
  await page.goBack({ waitUntil: 'commit' })
  await page.waitForFunction(() => (window as any).restoredFromCache === true)
  await page.reload()
  expect(await getKey(page, 'foo')).toEqual('bar')
})

test('works in memory inside a cross-origin iframe', async ({ page }) => {
  const parentOrigin = 'https://parent.test'
  await page.route(`${parentOrigin}/**`, route =>
    route.fulfill({
      contentType: 'text/html',
      body: `<iframe src="${origin}"></iframe>`
    })
  )
  await page.goto(parentOrigin)
  const frame = page.frame({ url: `${origin}/` })!
  const value = await frame.evaluate(() => {
    const store = (window as any).store
    store.set('foo', 'bar')
    return store.get('foo')
  })
  expect(value).toEqual('bar')
})

test('shows another site no key material in window.name', async ({ page }) => {
  const otherSite = 'https://other.test'
  await page.route(`${otherSite}/**`, route =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html>' })
  )
  await page.goto(origin)
  await setKey(page, 'foo', 'secret-value')
  await page.goto(otherSite)
  const windowName = await page.evaluate(() => window.name)
  const halves = Object.values<string>(
    windowName ? JSON.parse(windowName) : {}
  )
  const decodedHalves = halves.map(half =>
    Buffer.from(half, 'base64url').toString('latin1')
  )
  expect([windowName, ...decodedHalves].join()).not.toContain('secret')
})
