import { test, expect, devices, type Page, type Locator } from '@playwright/test';

/**
 * Regression suite for the header search, login/sign-up page and mobile layout
 * on iPhone 13 → 17 (every size, portrait + landscape) and small laptops, each
 * with both light and dark OS themes (dark used to make typed text invisible).
 */

interface Screen { name: string; viewport: { width: number; height: number }; mobile: boolean }

const IPHONES = [
  'iPhone 13 Mini', 'iPhone 13', 'iPhone 13 Pro', 'iPhone 13 Pro Max',
  'iPhone 14', 'iPhone 14 Plus', 'iPhone 14 Pro', 'iPhone 14 Pro Max',
  'iPhone 15', 'iPhone 15 Plus', 'iPhone 15 Pro', 'iPhone 15 Pro Max',
  'iPhone 16', 'iPhone 16 Plus', 'iPhone 16 Pro', 'iPhone 16 Pro Max',
  'iPhone 17', 'iPhone Air', 'iPhone 17 Pro', 'iPhone 17 Pro Max',
];

const screens: Screen[] = [];
for (const name of IPHONES) {
  const { width, height } = devices[name].viewport;
  screens.push({ name: `${name} portrait`, viewport: { width, height }, mobile: true });
  screens.push({ name: `${name} landscape`, viewport: { width: height, height: width }, mobile: true });
}
// Small laptops / odd browser windows (Edge, Chrome with toolbars and zoom).
for (const [w, h] of [[1024, 600], [1100, 650], [1280, 600], [1366, 650], [1440, 700], [1536, 730], [1920, 950]]) {
  screens.push({ name: `laptop ${w}x${h}`, viewport: { width: w, height: h }, mobile: false });
}

const SEARCH_RESULTS = {
  success: true,
  data: {
    results: [
      { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', hasLevels: true },
      { symbol: 'AAPD', name: 'Direxion Daily AAPL Bear 1X Shares', exchange: 'NASDAQ', hasLevels: false },
      { symbol: 'AAPU', name: 'Direxion Daily AAPL Bull 2X Shares', exchange: 'NASDAQ', hasLevels: false },
    ],
  },
};

async function mockSearch(page: Page) {
  await page.route('**/api/stocks/search**', route =>
    route.fulfill({ json: route.request().url().includes('scope=remote') ? { success: true, data: { results: [] } } : SEARCH_RESULTS }),
  );
}

/** The header's search box that is actually on screen at this width. */
function visibleSearch(page: Page): Locator {
  return page.locator('header input[role="combobox"]:visible').first();
}

async function noHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'page scrolls sideways').toBeLessThanOrEqual(innerWidth);
}

async function inViewportWidth(page: Page, el: Locator, what: string) {
  const box = await el.boundingBox();
  const vw = page.viewportSize()!.width;
  expect(box, `${what} has a box`).not.toBeNull();
  expect(box!.x, `${what} left edge`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${what} right edge`).toBeLessThanOrEqual(vw + 0.5);
}

function luminance([r, g, b]: number[]) {
  const c = [r, g, b].map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Contrast between an input's text color and the first opaque background behind it. */
async function expectReadableText(input: Locator, what: string) {
  const [fg, bg] = await input.evaluate(el => {
    const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    let node: Element | null = el;
    let bgc = [255, 255, 255];
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.length >= 3 && (c.length === 3 || c[3] > 0.95)) { bgc = c.slice(0, 3); break; }
      node = node.parentElement;
    }
    return [parse(getComputedStyle(el).color).slice(0, 3), bgc];
  });
  const [l1, l2] = [luminance(fg), luminance(bg)];
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  expect(ratio, `${what} text ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
}

function formInput(page: Page, label: string): Locator {
  return page.locator('form').getByText(label, { exact: true }).locator('xpath=following-sibling::input');
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const screen of screens) {
    test.describe(`${screen.name} (${colorScheme})`, () => {
      test.use({
        viewport: screen.viewport,
        colorScheme,
        isMobile: screen.mobile,
        hasTouch: screen.mobile,
        deviceScaleFactor: screen.mobile ? 3 : 1,
      });

      test('header search is usable and its dropdown fits', async ({ page }) => {
        await mockSearch(page);
        await page.goto('/login');
        const input = visibleSearch(page);
        await expect(input).toBeVisible();
        const vw = screen.viewport.width;
        const box = (await input.boundingBox())!;
        // The bug: at laptop widths the box collapsed to a sliver.
        expect(box.width, 'search input width').toBeGreaterThanOrEqual(Math.min(240, vw - 40));
        await inViewportWidth(page, input, 'search input');

        await input.fill('AAPL');
        await expectReadableText(input, 'search');
        const list = page.locator('header [role="listbox"]');
        await expect(list).toBeVisible();
        await expect(list.getByRole('option')).toHaveCount(3);
        const lbox = (await list.boundingBox())!;
        expect(lbox.width, 'dropdown width').toBeGreaterThanOrEqual(Math.min(280, vw - 32) - 1);
        await inViewportWidth(page, list, 'dropdown');
        await noHorizontalScroll(page);
      });

      test('login page: Google button visible, no sideways scroll', async ({ page }) => {
        await page.goto('/login');
        const google = page.getByRole('button', { name: /continue with google/i });
        await expect(google).toBeVisible();
        await inViewportWidth(page, google, 'Google button');
        await expect(google).toBeInViewport({ ratio: 1 }); // visible without scrolling
        await noHorizontalScroll(page);
        for (const tab of ['Log in', 'Sign up']) {
          await page.getByRole('button', { name: tab, exact: true }).first().click();
          await expect(google).toBeInViewport({ ratio: 1 });
        }
      });

      test('sign-up form: typed text is readable', async ({ page }) => {
        await page.goto('/login');
        await page.getByRole('button', { name: 'Sign up', exact: true }).click();
        const fields: Array<[string, string]> = [['Name', 'Jane Doe'], ['Email', 'jane@example.com'], ['Password', 'hunter2hunter2']];
        for (const [label, value] of fields) {
          const input = formInput(page, label);
          await input.fill(value);
          await expectReadableText(input, label);
        }
        const submit = page.getByRole('button', { name: 'Create account' });
        await expect(async () => {
          await submit.scrollIntoViewIfNeeded();
          await expect(submit).toBeInViewport({ ratio: 1, timeout: 1000 });
        }).toPass();
        await noHorizontalScroll(page);
      });

      test('log-in form: typed text is readable', async ({ page }) => {
        await page.goto('/login');
        for (const [label, value] of [['Email', 'jane@example.com'], ['Password', 'hunter2hunter2']]) {
          const input = formInput(page, label);
          await input.fill(value);
          await expectReadableText(input, label);
        }
      });

      test('logged-out home page header: aligned, Sign in reachable', async ({ page }) => {
        await mockSearch(page);
        await page.goto('/');
        const header = page.locator('header').first();
        await expect(header).toBeVisible();
        await inViewportWidth(page, header, 'header');
        const signIn = page.locator('header button:visible', { hasText: /^Sign in$/ }).first();
        await expect(signIn).toBeVisible();
        await inViewportWidth(page, signIn, 'Sign in button');
        await expect(page.locator('header img[alt="Neon Trade"]')).toBeInViewport();
        await noHorizontalScroll(page);
      });
    });
  }
}
