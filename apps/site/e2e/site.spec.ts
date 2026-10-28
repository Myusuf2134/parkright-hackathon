import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  (page as unknown as { errors: string[] }).errors = errors;
  await page.goto('/');
});

test('every section is present with its headline', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Park smarter. Arrive ready.');
  for (const h of ['Your class starts at 10:20. Parking shouldn’t be the unknown.', 'Your day, parked.', 'From camera to clarity.', 'See both sides of ParkRight.', 'Know when to leave. Not just where to park.', 'What it’s built with.', 'Less searching. More arriving.']) {
    await expect(page.getByRole('heading', { name: h })).toBeAttached();
  }
});

test('no failed requests, no errors, no horizontal overflow, every image loads', async ({ page }) => {
  for (let y = 0; y < 16000; y += 600) await page.evaluate((v) => scrollTo(0, v), y);
  await page.waitForLoadState('networkidle');
  const broken = await page.evaluate(() => [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src));
  expect(broken).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect((page as unknown as { errors: string[] }).errors).toEqual([]);
});

test('without hosted URLs, app and demo buttons go to the run instructions, never localhost', async ({ page }) => {
  const hrefs = await page.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  expect(hrefs.filter((h) => h.includes('localhost') || h.includes('127.0.0.1'))).toEqual([]);
  await expect(page.getByTestId('cta-hero-app')).toHaveAttribute('href', '#run');
  await expect(page.getByTestId('cta-demo')).toHaveAttribute('href', '#run');
  await expect(page.getByTestId('cta-repo')).toHaveAttribute('href', 'https://github.com/Myusuf2134/parkright-hackathon');
  // In-page anchors all resolve.
  const anchors = hrefs.filter((h) => h.startsWith('#') && h.length > 1);
  for (const a of new Set(anchors)) expect(await page.locator(a).count(), a).toBe(1);
  await page.getByTestId('cta-hero-app').click();
  await expect(page.getByRole('heading', { name: 'Run it yourself' })).toBeInViewport();
});

test('app tabs switch with mouse and arrow keys', async ({ page }) => {
  await page.getByTestId('tab-plan').click();
  await expect(page.getByTestId('tab-plan')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('When should I leave?');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tab-you')).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('No account');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tab-explore')).toHaveAttribute('aria-selected', 'true');
});

test('Arrival Intelligence runs the app engine on its demo scenarios, labelled as demo', async ({ page }) => {
  const leave = page.getByTestId('arr-leave');
  await expect(leave).toContainText('9:58 AM');
  await expect(leave).toContainText('Demo estimate');
  await page.getByTestId('scn-traffic').click();
  await expect(page.getByTestId('arr-note')).toContainText('Traffic on your route may add');
  await expect(leave).not.toContainText('9:58 AM'); // the delay moves the departure earlier
  await page.getByTestId('scn-canceled').click();
  await expect(leave).toContainText('No trip needed');
  await page.getByTestId('scn-quiet').click();
  await expect(leave).toContainText('9:58 AM'); // nothing on the trip, nothing added
  await expect(page.locator('.sig.off')).not.toHaveCount(0);
});

test('honest claims: OPEN is off, imagery is rendered, the garage is not a digital twin', async ({ page }) => {
  const body = page.locator('body');
  await expect(body).toContainText('Rendered simulation, not real-world CCTV');
  await expect(body).toContainText('Open-space confirmation is not enabled.');
  await expect(body).toContainText('not an official or exact digital twin');
  await expect(body).toContainText('GPU performance has not been measured yet');
  await expect(body).not.toContainText(/validated open|real-time|\d+% accura/i);
});

test('keyboard: skip link first, then the nav', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path checked on desktop');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});

test('reduced motion shows everything without animation', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('/');
  const hidden = await page.locator('.reveal').evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity !== '1').length);
  expect(hidden).toBe(0);
  expect(await page.locator('.hero-front').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  await ctx.close();
});

test('the campus night photo is one fixed backdrop that never moves or repeats', async ({ page, request }) => {
  const bg = page.locator('.site-background');
  const style = await bg.evaluate((e) => { const s = getComputedStyle(e); return { position: s.position, image: s.backgroundImage, size: s.backgroundSize, repeat: s.backgroundRepeat, z: s.zIndex }; });
  expect(style).toMatchObject({ position: 'fixed', size: 'cover', repeat: 'no-repeat', z: '-1' });
  expect(style.image).toContain('/campus-night-aerial.webp');
  expect((await request.get('/campus-night-aerial.webp')).status()).toBe(200);
  const vh = await page.evaluate(() => innerHeight);
  for (const y of [0, 2500, 6000, 100000]) {
    await page.evaluate((v) => scrollTo({ top: v, behavior: 'instant' }), y);
    const box = (await bg.boundingBox())!;
    expect(box.y).toBe(0);
    expect(box.height).toBeGreaterThanOrEqual(vh);
  }
});
