import { expect, test, type Locator, type Page } from '@playwright/test';
import type {} from '../../dev/harnessApi';
import { sampleNowBeyond } from '../samples';

// `npx playwright test --project=muse-ui`: the overlay on the sample garden (no server on :8787, so
// every /api call falls back to src/muse/samples.ts). Screenshots go to docs/checkpoints/muse-ui/.

const SHOTS = 'docs/checkpoints/muse-ui';

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => window.__meadow?.isReady === true, undefined, { timeout: 60_000 });
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const shotOf = (target: Locator, name: string) => target.screenshot({ path: `${SHOTS}/${name}.png` });
const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent ?? '');
const centreOffset = async (page: Page, target: Locator): Promise<number> => {
  const box = await target.boundingBox();
  const vp = page.viewportSize() ?? { width: 0, height: 0 };
  return box ? Math.hypot(box.x + box.width / 2 - vp.width / 2, box.y + box.height / 2 - vp.height / 2) : Number.POSITIVE_INFINITY;
};

test('stays out of automated runs without ?muse', async ({ page }) => {
  await open(page, '/#hud=0');
  await page.waitForTimeout(500);
  await expect(page.locator('.mu')).toHaveCount(0);
});

test('the owner roams, follows, opens the mailbox, shelf and settings, and visits a friend', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page, '/?muse&dev#hud=0');
  const status = page.locator('.mu-status').first();
  await expect(status.locator('.mu-name')).toHaveText('Moss');
  await expect(status.locator('.mu-label')).toHaveText('Exploring: Pigment → Ultramarine');
  await expect(status.locator('.mu-tag')).toBeVisible();
  const dev = page.locator('.mu-dev');
  await expect(dev.locator('.mu-interest')).toHaveCount(2);

  await test.step('follow glides the camera to Muse, whose pin then sits mid-screen', async () => {
    await status.getByRole('button', { name: 'Follow' }).click();
    await expect(status.locator('.mu-follow')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(3500);
    const pin = page.locator('.mu-muse');
    await expect(pin).not.toHaveClass(/mu-off/);
    const box = await pin.locator('.mu-muse-mark').boundingBox();
    expect(box).not.toBeNull();
    const vp = page.viewportSize() ?? { width: 0, height: 0 };
    expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - vp.width / 2)).toBeLessThan(40);
    expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) / 2 - vp.height / 2)).toBeLessThan(40);
    await shot(page, '01-follow');
  });

  const dock = page.locator('.mu-dock');
  const mailbox = page.locator('.mu-mailbox');

  await test.step('mailbox: baskets as cards, arrow keys walk them, earlier baskets on request', async () => {
    await dock.getByRole('button', { name: /Mailbox/ }).click();
    await expect(mailbox).toBeVisible();
    await expect(mailbox.locator('.mu-basket')).toHaveCount(1);
    await expect(mailbox.locator('.mu-card')).toHaveCount(3);
    await expect(mailbox.locator('.mu-card-link').first()).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Botanical_illustration');
    await expect(mailbox.locator('.mu-card-link').first()).toHaveAttribute('target', '_blank');
    expect(await focusedText(page)).toContain('Botanical illustration');
    await page.keyboard.press('ArrowRight');
    expect(await focusedText(page)).toContain('Every colour in those plates');
    await page.waitForTimeout(500);
    await shot(page, '02-mailbox-baskets');
    await mailbox.getByRole('button', { name: 'Earlier baskets' }).click();
    await expect(mailbox.locator('.mu-basket')).toHaveCount(2);
    await expect(mailbox.getByRole('button', { name: 'Earlier baskets' })).toHaveCount(0);
    const inBasket = () => page.evaluate(() => [...document.querySelectorAll('.mu-basket')].indexOf(document.activeElement?.closest('.mu-basket') as Element));
    expect(await inBasket()).toBe(1);
    await page.keyboard.press('ArrowLeft');
    expect(await focusedText(page)).toContain('The blue cost more than gold');
    expect(await inBasket()).toBe(0);
    await page.keyboard.press('ArrowDown');
    expect(await inBasket()).toBe(1);
  });

  const glints = page.locator('.mu-pins button.mu-plant');
  const pigment = page.locator('.mu-pins button.mu-plant[aria-label="Pigment"]');

  await test.step('every collected object has a glint; Show on planet glides to it and stops Follow', async () => {
    await expect(glints).toHaveCount(3);
    await mailbox.getByRole('button', { name: 'Show Pigment on the planet' }).first().click();
    await expect(status.locator('.mu-follow')).toHaveAttribute('aria-pressed', 'false');
    await expect(pigment).toHaveClass(/mu-glow/);
    await page.waitForTimeout(2500);
    expect(await centreOffset(page, pigment)).toBeLessThan(40);
  });

  await test.step('hovering or focusing an object previews it; clicking opens its card, never touching the canvas', async () => {
    await page.keyboard.press('Escape');
    await expect(mailbox).toBeHidden();
    const vp = page.viewportSize() ?? { width: 0, height: 0 };
    await page.mouse.move(vp.width / 2 + 180, vp.height / 2 - 120);
    await page.mouse.wheel(0, -170);
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const w = window as unknown as { __canvasDowns: number };
      w.__canvasDowns = 0;
      document.querySelector('#scene')?.addEventListener('pointerdown', () => w.__canvasDowns++);
    });
    await pigment.hover();
    const preview = page.locator('.mu-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Pigment');
    await expect(preview).toContainText('Every colour in those plates came from something ground up.');
    await shot(page, '03-object-hover');
    await page.mouse.move(vp.width - 40, 120);
    await expect(preview).toBeHidden();
    await page.locator('.mu-pins button.mu-plant[aria-label="Ultramarine"]').focus();
    await expect(preview).toContainText('The blue cost more than gold.');

    await pigment.click();
    const card = page.locator('.mu-object');
    await expect(card).toBeVisible();
    await expect(card.locator('.mu-title')).toHaveText('Pigment');
    await expect(card).toContainText('A pigment is a powder used to add or alter color');
    const openLink = card.getByRole('link', { name: 'Open ↗' });
    await expect(openLink).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Pigment');
    await expect(openLink).toHaveAttribute('target', '_blank');
    expect(await page.evaluate(() => (window as unknown as { __canvasDowns: number }).__canvasDowns)).toBe(0);
    await shot(page, '04-object-card');
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(pigment).toBeFocused();
    await page.mouse.move(vp.width / 2 + 180, vp.height / 2 - 120);
    await page.mouse.wheel(0, 170);
    await page.waitForTimeout(1500);
  });

  await test.step('mailbox: photos reopen their exact view as a postcard', async () => {
    await dock.getByRole('button', { name: /Mailbox/ }).click();
    await mailbox.getByRole('tab', { name: 'Photos' }).click();
    const photos = mailbox.locator('.mu-photo');
    await expect(photos).toHaveCount(1);
    await expect(photos.first()).toContainText('With Wren');
    await expect(photos.first()).toContainText('on Wren’s planet');
    const href = (await photos.first().getAttribute('href')) ?? '';
    expect(href).toMatch(/^\/\?muse&dev#seed=2207&g=0\.3&pose=-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+,0\.8&pc=1$/);
    await mailbox.getByRole('button', { name: 'Earlier photos' }).click();
    await expect(photos).toHaveCount(2);
    await shot(page, '05-mailbox-photos');
  });

  await test.step('mailbox: the host may withdraw its invitation; no Visit before the guest uses theirs', async () => {
    await mailbox.getByRole('tab', { name: 'Invitations' }).click();
    const letters = mailbox.locator('.mu-letter');
    await expect(letters).toHaveCount(2);
    const wren = letters.filter({ hasText: 'Wren invites you over' });
    const juniper = letters.filter({ hasText: 'Moss invited Juniper’s human' });
    await expect(wren.getByRole('button')).toHaveCount(0);
    await expect(juniper.getByRole('button')).toHaveText(['Withdraw']);
    await expect(mailbox.getByRole('button', { name: 'Visit' })).toHaveCount(0);
    await shot(page, '06-mailbox-invitations');
    await juniper.getByRole('button', { name: 'Withdraw' }).click();
    await expect(juniper).toContainText('Withdrawn.');
    await page.keyboard.press('Escape');
    await expect(mailbox).toBeHidden();
  });

  await test.step('shelf: the top finds, most loved first', async () => {
    await dock.getByRole('button', { name: 'Shelf' }).click();
    const shelf = page.locator('.mu-shelf');
    await expect(shelf.locator('.mu-shelf-item')).toHaveCount(3);
    await expect(shelf.locator('.mu-shelf-item .mu-title')).toHaveText(['Botanical illustration', 'Pigment', 'Ultramarine']);
    await shot(page, '07-shelf');
    await page.keyboard.press('Escape');
    await expect(shelf).toBeHidden();
    await expect(dock.getByRole('button', { name: 'Shelf' })).toBeFocused();
  });

  await test.step('settings: hide toggles, friends, share code, basket time', async () => {
    await dock.getByRole('button', { name: 'Settings' }).click();
    const settings = page.locator('.mu-settings');
    const tide = settings.getByRole('button', { name: 'Share Tide' });
    await expect(tide).toHaveAttribute('aria-pressed', 'false');
    await tide.click();
    await expect(settings.getByRole('button', { name: 'Share Tide' })).toHaveAttribute('aria-pressed', 'true');
    await expect(settings.getByRole('button', { name: 'Share Tide' })).toBeFocused();
    await expect(settings.locator('.mu-code')).toHaveText('MOSS-7Q2K');
    await expect(settings.getByLabel('Whenever it’s ready')).toBeChecked();
    await shot(page, '08-settings');
    await page.keyboard.press('Escape');
  });

  await test.step('dev: the mind inspector, and MEMORY.md never stays in the page', async () => {
    await shotOf(dev, '09-dev-mind');
    const memory = dev.getByLabel('MEMORY.md');
    await memory.fill('I love jazz standards and pressed flowers.');
    await dev.getByRole('button', { name: 'Send MEMORY.md' }).click();
    await expect(memory).toHaveValue('');
    expect(await page.evaluate(() => document.body.innerHTML.includes('jazz standards'))).toBe(false);
    await dev.getByRole('button', { name: 'Start' }).click();
    await expect(status.locator('.mu-label')).toHaveText('Working (laptop out)');
    await dev.getByRole('button', { name: 'Stop' }).click();
    await expect(status.locator('.mu-label')).toHaveText('Exploring: Pigment → Ultramarine');
  });

  await test.step('visit: for 2 h after the invitation was used, the host planet with its public finds; out after', async () => {
    const hours = dev.getByLabel('Hours to advance');
    await hours.fill('24');
    await dev.getByRole('button', { name: 'Advance' }).click();
    await dock.getByRole('button', { name: /Mailbox/ }).click();
    await mailbox.getByRole('tab', { name: 'Invitations' }).click();
    await mailbox.getByRole('button', { name: 'Visit' }).click();
    const banner = page.locator('.mu-visit');
    await expect(banner).toContainText('Visiting Wren’s planet');
    await expect(banner).toContainText('min left');
    await expect(status).toBeHidden();
    await expect.poll(() => page.evaluate(() => location.hash)).toContain('seed=2207');
    await expect(glints).toHaveCount(1);
    const privateFind = page.locator('.mu-plant.mu-private');
    await expect(privateFind).toHaveCount(1);
    await expect(privateFind).not.toHaveAttribute('tabindex');
    await page.waitForTimeout(3000);
    await expect(glints).not.toHaveClass(/mu-off/);
    expect(await centreOffset(page, glints)).toBeLessThan(40);
    await dock.getByRole('button', { name: /Mailbox/ }).click();
    await mailbox.getByRole('tab', { name: 'Baskets' }).click();
    await expect(mailbox.locator('.mu-basket .mu-card')).toHaveCount(3);
    await expect(mailbox.locator('.mu-show').first()).toBeHidden();
    await glints.click();
    await expect(mailbox).toBeHidden();
    await expect(page.locator('.mu-object')).toContainText('Lichen');
    await expect(page.locator('.mu-object')).toContainText('Two living things sharing one body.');
    await shot(page, '10-visit');

    await hours.fill('2');
    await dev.getByRole('button', { name: 'Advance' }).click();
    await expect(banner).toBeHidden();
    await expect(page.locator('.mu-toast')).toContainText('The visit is over');
    await expect.poll(() => page.evaluate(() => location.hash)).not.toContain('seed=2207');
    await expect(page.locator('.mu-object')).toBeHidden();
    await expect(page.locator('.mu-plant.mu-private')).toHaveCount(0);
    await expect(glints).toHaveCount(3);
    await expect(status).toBeVisible();
  });
});

test('Follow waits, with a reason, while Muse is beyond the planet', async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/now')) return route.fulfill({ json: sampleNowBeyond });
    if (url.endsWith('/invitations')) return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, body: 'not here' });
  });
  await open(page, '/?muse#hud=0');
  const status = page.locator('.mu-status').first();
  await expect(status.locator('.mu-label')).toHaveText('Gone beyond the planet');
  await expect(status.getByRole('button', { name: 'Follow' })).toHaveCount(0);
  await expect(status.locator('.mu-reason')).toHaveText('Follow is back when Moss returns.');
  await expect(page.locator('.mu-muse')).toHaveClass(/mu-off/);
  await expect(status.locator('.mu-tag')).toBeHidden();
  await shot(page, '11-beyond');
});

test('fits a phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await open(page, '/?muse#hud=0&q=low');
  await page.locator('.mu-dock').getByRole('button', { name: /Mailbox/ }).click();
  await expect(page.locator('.mu-mailbox .mu-card')).toHaveCount(3);
  const outside = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.mu-status, .mu-dock, .mu-panel')]
      .filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed')
      .filter((e) => !e.hidden && !e.closest('[hidden]'))
      .map((e) => ({ cls: e.className, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.left < 0 || r.right > window.innerWidth))
      .map(({ cls, r }) => `${cls}: ${Math.round(r.left)}..${Math.round(r.right)}`),
  );
  expect(outside).toEqual([]);
  await shot(page, '12-phone-mailbox');
  await context.close();
});
