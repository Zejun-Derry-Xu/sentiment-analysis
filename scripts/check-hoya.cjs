// Run against a local Vite server. APIs are intercepted for UI checks only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const assert = require('node:assert/strict');
const boards = ['spring-sounds', 'campus-makers', 'night-run'].map((id, i) => ({ id, title: ['Halloween Haunted House', 'Campus Food', 'DSAN Feedback'][i], description: 'Community discussion', category: ['Activities', 'Food', 'Academics'][i], location: 'Campus', starts_at: '2026-10-31T23:00:00Z', comment_count: 0 }));
(async () => {
  fs.mkdirSync('test-artifacts', { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let role = 'student', created = null, signedIn = true;
  await page.route('**/api/**', async route => {
    const p = new URL(route.request().url()).pathname;
    let data = [];
    if (p === '/api/session') {
      if (!signedIn) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Sign in required"}' });
      data = { id: 'test-user', username: 'hoya', role };
    }
    if (p === '/api/events') {
      if (route.request().method() === 'POST') { const body = route.request().postDataJSON(); created = { ...boards[0], ...body, id: 'test-flyer' }; }
      data = created ? [...boards, created] : boards;
    }
    if (p === '/api/comments') data = { items: [], total: 0 };
    if (p === '/api/sentiment/evaluation') {
      data = JSON.parse(fs.readFileSync('docs/results/cardiff-cpu-local/evaluation.json', 'utf8'));
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.route('**/ready', r => r.fulfill({ body: 'ready' }));
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('heading', { name: /Big things happening/ }).waitFor();
  assert.equal(await page.locator('.wall-column').count(), 3);
  assert.equal(await page.locator('.wall-flyer').count(), 8);
  await page.screenshot({ path: 'test-artifacts/home-desktop.png', fullPage: true });
  await page.screenshot({ path: 'test-artifacts/home-preview.png' });
  await page.getByRole('button', { name: 'Free Food', exact: true }).click();
  assert.equal(await page.locator('.wall-column').count(), 1);
  assert.equal(await page.locator('.wall-flyer').count(), 3);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('searchbox').fill('DSAN');
  assert.equal(await page.locator('.wall-flyer').count(), 1);
  await page.getByRole('searchbox').fill('not-a-real-flyer');
  await page.getByRole('heading', { name: 'No flyers found.' }).waitFor();
  await page.getByRole('button', { name: 'Show all flyers' }).click();
  const save = page.getByRole('button', { name: 'Save Pizza with a side of campus life.', exact: true });
  await save.click();
  await page.reload();
  await page.getByRole('button', { name: 'Unsave Pizza with a side of campus life.', exact: true }).waitFor();
  await page.locator('.wall-flyer').filter({ hasText: 'HALLOWEEN HAUNTED HOUSE' }).getByRole('button', { name: 'Details ↗' }).click();
  await page.getByRole('dialog').getByText('Registration link pending').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.locator('.header-post').click();
  await page.getByRole('dialog').getByText(/New flyers are posted by campus admins/).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.wall-flyer').filter({ hasText: 'HALLOWEEN HAUNTED HOUSE' }).getByRole('button', { name: 'Who’s going? ↗' }).click();
  await page.waitForURL('**/#/boards/spring-sounds');
  await page.locator('.wordmark').first().click();
  await page.getByRole('heading', { name: /Big things happening/ }).waitFor();
  await page.getByRole('button', { name: 'Evaluation', exact: true }).click();
  await page.getByRole('heading', { name: 'How our models perform.' }).waitFor();
  await page.screenshot({ path: 'test-artifacts/evaluation-desktop.png', fullPage: true });
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.wordmark').first().click();
    await page.locator('.wall-column').first().waitFor();
    const dims = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, columns: getComputedStyle(document.querySelector('.wall-columns')).gridTemplateColumns.split(' ').length }));
    assert.ok(dims.scroll <= dims.width, `Horizontal overflow at ${width}: ${JSON.stringify(dims)}`);
    assert.equal(dims.columns, width <= 760 ? 1 : 3);
    if (width === 390) await page.screenshot({ path: 'test-artifacts/home-mobile.png', fullPage: true });
  }
  role = 'admin'; await page.reload();
  await page.locator('.header-post').click();
  await page.getByLabel('Title', { exact: true }).fill('Student meetup test');
  await page.getByLabel('Description & details').fill('UI test only. Date, venue, and conditions pending confirmation.');
  await page.getByRole('dialog').getByRole('button', { name: 'Post a flyer +' }).click();
  await page.getByRole('heading', { name: 'Student meetup test' }).waitFor();
  assert.equal(created.title, 'Student meetup test');
  signedIn = false; await page.setViewportSize({ width: 390, height: 900 }); await page.reload();
  await page.getByRole('heading', { name: 'Join the conversation.' }).waitFor();
  await page.getByLabel('Username', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'test-artifacts/sign-in-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: desktop/mobile layout, search, filters, saved persistence, details/Escape, discussion route, brand home link, evaluation copy, student permissions, admin publishing. APIs mocked; no live posts created.');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
