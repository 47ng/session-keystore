import { test, expect } from '@playwright/test'

test.describe('Persistence across page refresh', () => {
  test('data set before refresh is available after refresh', async ({
    page
  }) => {
    await page.goto('/')
    await page.waitForSelector('#status')

    // Set a key
    await page.evaluate(() => {
      ;(window as any).store.set('test-key', 'hello-world')
    })

    // Wait for share1 to be written to window.name
    await page.waitForFunction(() => window.name !== '')

    // Reload the page — triggers pagehide, then fresh load
    await page.reload()
    await page.waitForSelector('#status')

    // The key should be available in the new store
    const value = await page.evaluate(() => {
      return (window as any).store.get('test-key')
    })
    expect(value).toBe('hello-world')
  })

  test('multiple keys persist across refresh', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('#status')

    await page.evaluate(() => {
      const store = (window as any).store
      store.set('key-a', 'value-a')
      store.set('key-b', 'value-b')
      store.set('key-c', 'value-c')
    })

    await page.waitForFunction(() => window.name !== '')
    await page.reload()
    await page.waitForSelector('#status')

    const values = await page.evaluate(() => {
      const store = (window as any).store
      return {
        a: store.get('key-a'),
        b: store.get('key-b'),
        c: store.get('key-c')
      }
    })
    expect(values).toEqual({
      a: 'value-a',
      b: 'value-b',
      c: 'value-c'
    })
  })

  test('data is lost in a new browser context (session end)', async ({
    browser
  }) => {
    // First context: set a key
    const context1 = await browser.newContext()
    const page1 = await context1.newPage()
    await page1.goto('/')
    await page1.waitForSelector('#status')
    await page1.evaluate(() => {
      ;(window as any).store.set('secret', 'should-not-leak')
    })
    await page1.waitForFunction(() => window.name !== '')
    await context1.close()

    // Second context: key should not be available
    const context2 = await browser.newContext()
    const page2 = await context2.newPage()
    await page2.goto('/')
    await page2.waitForSelector('#status')
    const value = await page2.evaluate(() => {
      return (window as any).store.get('secret')
    })
    expect(value).toBeNull()
    await context2.close()
  })

  test('window.name is written on mutation before pagehide', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('#status')

    await page.evaluate(() => {
      ;(window as any).store.set('eager-key', 'eager-value')
    })

    // Check that window.name has data (share1 written synchronously on set())
    const windowName = await page.evaluate(() => window.name)
    expect(windowName).not.toBe('')

    // Check that sessionStorage does NOT yet have the share
    // (phase 2 hasn't happened — no pagehide yet)
    const sessionData = await page.evaluate(() => {
      return window.sessionStorage.getItem('session-keystore:default')
    })
    expect(sessionData).toBeNull()
  })
})
