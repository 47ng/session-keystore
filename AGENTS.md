# session-keystore

Browser library: stores keys for one tab session, split between
`window.name` and `sessionStorage` so they survive reloads but not new
tabs or other sites. ESM only, published from `master` by semantic-release.

## Commands

- `pnpm validate`: typecheck, lint, format check, knip, build and unit tests.
  Run it before you hand work back.
- `pnpm test`: unit tests in Chromium, Firefox and WebKit (Vitest browser
  mode), plus `src/server.test.ts` in Node.
  One browser: `pnpm test --project 'browser (chromium)' --project node`.
- `pnpm test:e2e`: Playwright tests in `e2e/`, against the demo page.
- `pnpm format`: fix formatting (oxfmt). `pnpm lint`: oxlint. `pnpm knip`: dead code.
- `pnpm demo`: the demo page, with Vite.

Browsers: `pnpm exec playwright install --with-deps chromium firefox webkit`.
Firefox and WebKit need system libraries; without them, run Chromium only
and let CI cover the rest. CI runs in the Playwright container image, so
bump its tag in `.github/workflows/ci.yml` along with `@playwright/test`.

## Conventions

- Commit messages follow Conventional Commits, checked by commitlint. Types:
  build, chore, ci, clean, doc, feat, fix, perf, ref, revert, style, test.
  `type!:` or a `BREAKING CHANGE:` footer makes a major release.
- Git hooks (Git 2.54+) are in `git-hooks.gitconfig`; `pnpm install` turns
  them on. Fix what they report rather than skipping them.
- Unit tests run in an iframe: the store writes to `window.top.name`, so
  tests read that, not `window.name`.
- Keep error handling light. A key that was deleted must never come back
  after a reload; losing every key is acceptable.
