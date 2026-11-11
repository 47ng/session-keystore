import { test, expect, type Page } from "@playwright/test";
import { build, type Rolldown } from "vite";

const origin = "https://keystore.test";

// Every path on the test origin serves the demo page, except its own assets
let files: Map<string, { contentType: string; body: string | Uint8Array }>;

test.beforeAll(async () => {
  const output = (await build({
    root: "demo",
    logLevel: "silent",
    build: { write: false },
  })) as Rolldown.RolldownOutput;
  files = new Map(
    output.output.map((file) => [
      `/${file.fileName}`,
      {
        contentType: file.fileName.endsWith(".html") ? "text/html" : "text/javascript",
        body: file.type === "chunk" ? file.code : file.source,
      },
    ]),
  );
});

test.beforeEach(async ({ context }) => {
  await context.route(`${origin}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    const { contentType, body } = files.get(pathname) ?? files.get("/index.html")!;
    return route.fulfill({ contentType, body: Buffer.from(body) });
  });
});

const setKey = (page: Page, key: string, value: string) =>
  page.evaluate(([k, v]) => window.store.set(k, v), [key, value]);

const getKey = (page: Page, key: string) => page.evaluate((k) => window.store.get(k), key);

test("keeps keys across a reload", async ({ page }) => {
  await page.goto(origin);
  await setKey(page, "foo", "bar");
  await page.reload();
  expect(await getKey(page, "foo")).toEqual("bar");
});

test("keeps keys across several reloads without changes", async ({ page }) => {
  await page.goto(origin);
  await setKey(page, "foo", "bar");
  for (let i = 0; i < 3; i++) {
    await page.reload();
  }
  expect(await getKey(page, "foo")).toEqual("bar");
});

test("keeps keys across same-origin navigations", async ({ page }) => {
  await page.goto(origin);
  await setKey(page, "foo", "bar");
  await page.goto(`${origin}/other`);
  await page.goto(origin);
  expect(await getKey(page, "foo")).toEqual("bar");
});

test("keeps keys after a back/forward cache restore", async ({ page, browserName }) => {
  test.skip(
    browserName !== "chromium",
    "Playwright turns off the back/forward cache in Firefox and WebKit",
  );
  await page.goto(origin);
  await setKey(page, "foo", "bar");
  await page.goto(`${origin}/other`);
  await page.goBack({ waitUntil: "commit" });
  await page.waitForFunction(() => window.restoredFromCache === true);
  await page.reload();
  expect(await getKey(page, "foo")).toEqual("bar");
});

test("does not bring back a key deleted on another page after a back/forward cache restore", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Playwright turns off the back/forward cache in Firefox and WebKit",
  );
  await page.goto(origin);
  await setKey(page, "foo", "bar");
  await page.goto(`${origin}/other`);
  expect(await getKey(page, "foo")).toEqual("bar");
  await page.evaluate(() => window.store.delete("foo"));
  await page.goBack({ waitUntil: "commit" });
  await page.waitForFunction(() => window.restoredFromCache === true);
  await page.reload();
  expect(await getKey(page, "foo")).toBeNull();
});

test("ignores window.name changes from another site after a back/forward cache restore", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "Playwright turns off the back/forward cache in Firefox and WebKit",
  );
  const otherSite = "https://other.test";
  await page.route(`${otherSite}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<script>window.name = "tampered"</script>',
    }),
  );
  await page.goto(origin);
  await setKey(page, "foo", "bar");
  await page.goto(otherSite);
  await page.goBack({ waitUntil: "commit" });
  await page.waitForFunction(() => window.restoredFromCache === true);
  await page.reload();
  expect(await getKey(page, "foo")).toEqual("bar");
});

test("ignores keys another site changes in window.name", async ({ page, browserName }) => {
  test.skip(
    browserName !== "chromium",
    "Firefox and WebKit clear window.name when the tab goes to another site",
  );
  const otherSite = "https://other.test";
  await page.route(`${otherSite}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<script>
        const from = '[["apiKey",{"v":1,"value":"secret"}]]'
        const to = '[["apiKey",{"v":1,"value":"second"}]]'
        const halves = JSON.parse(window.name)
        const half = halves['session-keystore:default']
        const pad = atob(half.replaceAll('-', '+').replaceAll('_', '/'))
        const changed = Array.from(pad, (char, i) =>
          String.fromCharCode(
            char.charCodeAt(0) ^ (from.charCodeAt(i) ^ to.charCodeAt(i) || 0)
          )
        ).join('')
        halves['session-keystore:default'] = btoa(changed)
          .replaceAll('+', '-')
          .replaceAll('/', '_')
        window.name = JSON.stringify(halves)
        window.changed = true
      </script>`,
    }),
  );
  await page.goto(origin);
  await setKey(page, "apiKey", "secret");
  await page.goto(otherSite);
  expect(await page.evaluate(() => "changed" in window)).toBe(true);
  await page.goto(origin);
  expect(await getKey(page, "apiKey")).toBeNull();
});

test("works in memory inside a cross-origin iframe", async ({ page }) => {
  const parentOrigin = "https://parent.test";
  await page.route(`${parentOrigin}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<iframe src="${origin}"></iframe>`,
    }),
  );
  await page.goto(parentOrigin);
  const frame = page.frame({ url: `${origin}/` })!;
  const value = await frame.evaluate(() => {
    const store = window.store;
    store.set("foo", "bar");
    return store.get("foo");
  });
  expect(value).toEqual("bar");
});

test("shows another site no key material in window.name", async ({ page }) => {
  const otherSite = "https://other.test";
  await page.route(`${otherSite}/**`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto(origin);
  await setKey(page, "foo", "secret-value");
  await page.goto(otherSite);
  const windowName = await page.evaluate(() => window.name);
  const halves = Object.values<string>(windowName ? JSON.parse(windowName) : {});
  const decodedHalves = halves.map((half) => Buffer.from(half, "base64url").toString("latin1"));
  expect([windowName, ...decodedHalves].join()).not.toContain("secret");
});

test("demo page lists its keys after a reload", async ({ page }) => {
  await page.goto(origin);
  const keys = page.locator("#keys");
  await expect(keys).toHaveText("foo: null\nbar: null");
  await page.getByRole("button", { name: "Set foo" }).click();
  await expect(keys).toHaveText(/^foo: "[\da-f-]{36}"\nbar: null$/);
  const listed = await keys.textContent();
  await page.reload();
  await expect(keys).toHaveText(listed!);
  await page.getByRole("button", { name: "Clear keys" }).click();
  await expect(keys).toHaveText("foo: null\nbar: null");
});
