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
  await page.evaluate(() => {
    document.body.insertAdjacentHTML("beforeend", '<a href="/">Home</a>');
  });
  await page.getByRole("link", { name: "Home" }).click();
  await page.waitForURL(`${origin}/`);
  expect(await getKey(page, "foo")).toEqual("bar");
});

const otherSite = "https://other.test";

const serveOtherSite = (page: Page) =>
  page.route(`${otherSite}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<a href="${origin}/">Back to the store</a>`,
    }),
  );

// Chromium restores the page from the back/forward cache. Playwright turns
// that cache off in Firefox and WebKit, so they load the page again.
async function goBack(page: Page, browserName: string) {
  await page.goBack({ waitUntil: "commit" });
  await page.waitForFunction(
    (fromCache) => window.restoredFromCache === fromCache,
    browserName === "chromium",
  );
}

test("keeps keys after Back and Forward", async ({ page, browserName }) => {
  await page.goto(origin);
  await setKey(page, "foo", "bar");
  await page.goto(`${origin}/other`);
  await goBack(page, browserName);
  expect(await getKey(page, "foo")).toEqual("bar");
  await page.goForward({ waitUntil: "commit" });
  await page.waitForFunction(
    (fromCache) => window.restoredFromCache === fromCache,
    browserName === "chromium",
  );
  expect(await getKey(page, "foo")).toEqual("bar");
  await page.reload();
  expect(await getKey(page, "foo")).toEqual("bar");
});

test("does not bring back a key deleted on another page after Back", async ({
  page,
  browserName,
}) => {
  await page.goto(origin);
  await setKey(page, "foo", "bar");
  await page.goto(`${origin}/other`);
  expect(await getKey(page, "foo")).toEqual("bar");
  await page.evaluate(() => window.store.delete("foo"));
  await goBack(page, browserName);
  expect(await getKey(page, "foo")).toBeNull();
  await page.reload();
  expect(await getKey(page, "foo")).toBeNull();
});

test("keeps keys across history changes in the same page", async ({ page }) => {
  await page.goto(origin);
  await setKey(page, "foo", "bar");
  await page.evaluate(() => history.pushState(null, "", "/route"));
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        addEventListener("popstate", resolve, { once: true });
        history.back();
      }),
  );
  expect(await getKey(page, "foo")).toEqual("bar");
});

test("forgets keys after Back from another site", async ({ page, browserName }) => {
  await serveOtherSite(page);
  await page.goto(origin);
  await setKey(page, "foo", "bar");
  await page.goto(otherSite);
  await goBack(page, browserName);
  expect(await getKey(page, "foo")).toBeNull();
  await page.reload();
  expect(await getKey(page, "foo")).toBeNull();
});

test("forgets keys after a link back from another site", async ({ page }) => {
  await serveOtherSite(page);
  await page.goto(origin);
  await setKey(page, "foo", "bar");
  await page.goto(otherSite);
  await page.getByRole("link", { name: "Back to the store" }).click();
  await page.waitForURL(`${origin}/`);
  expect(await getKey(page, "foo")).toBeNull();
  await page.reload();
  expect(await getKey(page, "foo")).toBeNull();
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
