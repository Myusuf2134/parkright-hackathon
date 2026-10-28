import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  (page as unknown as { errors: string[] }).errors = errors;
  await page.goto('/');
});

test('every section is present with its headline', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Arrive ready.');
  await expect(page.getByText('MERIDIAN').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A higher standard for how people arrive.' })).toBeAttached();
  for (const h of ['Your day, parked.', 'From camera to clarity.', 'See both sides of ParkRight.', 'Know when to leave. Not just where to park.', 'A clearer way to arrive.']) {
    await expect(page.getByRole('heading', { name: h })).toBeAttached();
  }
  // The new editorial story still includes the real, interactive ParkRight product sections.
  const order = await page.locator('main > section').evaluateAll((els) => els.map((e) => e.id || e.className.split(' ').pop()));
  expect(order).toEqual(['capabilities', 'about', 'md-panel-section', 'md-product-heading', 'app', 'ai', 'demo', 'arrival', 'tech', 'markets']);
  await expect(page.getByText('Your class starts at 10:20.')).toBeVisible();
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
  await expect(body).toContainText('GPU performance has not been measured yet'); // inside Under the hood
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

test('Under the hood is folded by default, opens on click and from the nav link', async ({ page, isMobile }) => {
  const hood = page.getByTestId('hood');
  await expect(hood).not.toHaveAttribute('open', '');
  await expect(page.getByText('Pydantic models exported to TypeScript')).toBeHidden();
  if (isMobile) await hood.locator('summary').click();
  else await page.locator('.nav-links').getByRole('link', { name: 'Under the hood' }).click();
  await expect(hood).toHaveAttribute('open', '');
  await expect(page.getByText('Pydantic models exported to TypeScript')).toBeVisible();
});

test('motion: the pipeline lights in order and tab screens crossfade', async ({ page }) => {
  await page.locator('#ai').scrollIntoViewIfNeeded();
  await page.getByTestId('flow').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('flow')).toHaveClass(/\bon\b/);
  const delays = await page.locator('.flow li').evaluateAll((els) => els.map((e) => getComputedStyle(e).transitionDelay.split(',')[0]));
  expect(delays).toEqual(['0s', '0.28s', '0.56s', '0.84s']);
  await page.getByTestId('tab-you').click();
  await expect(page.locator('.duo-set.on')).toHaveCount(1);
  await expect(page.locator('.duo-set.on img').first()).toHaveAttribute('src', '/media/v5-you.webp');
});

test('Meridian Atlas identity: navbar, footer, SVG favicon and manifest resolve', async ({ page, request }) => {
  for (const id of ['nav-brand', 'footer-brand']) {
    const brand = page.getByTestId(id);
    await expect(brand.locator('img[src="/brand/meridian-atlas.svg"]')).toBeVisible();
    await expect(brand).toContainText('MERIDIAN');
  }
  await expect(page).toHaveTitle('Meridian · Arrive ready.');
  const links = await page.locator('head link[rel~="icon"], head link[rel="manifest"]').evaluateAll((ls) => ls.map((l) => l.getAttribute('href')!));
  expect(links).toEqual(['/favicon.svg', '/site.webmanifest']);
  const manifest = await (await request.get('/site.webmanifest')).json();
  expect(manifest.name).toContain('Meridian');
  for (const url of [...links, ...manifest.icons.map((i: { src: string }) => i.src), '/brand/meridian-atlas.svg']) {
    const r = await request.get(url);
    expect(r.status(), url).toBe(200);
    expect(r.headers()['content-type'], url).toMatch(/image|json|manifest|icon/);
  }
});

test('Meridian content preserves prototype truth and functional product links', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Spatial intelligence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'From real spaces to real possibilities.' })).toBeAttached();
  await expect(page.getByText('Open-space confirmation is not enabled.')).toBeAttached();
  await expect(page.getByText('Today, a campus prototype. Tomorrow, more intelligent connections')).toBeAttached();
  await expect(page.getByTestId('cta-hero-app')).toHaveAttribute('href', '#run');
});
