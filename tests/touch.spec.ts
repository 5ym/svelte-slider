import { devices, expect, test } from '@playwright/test';
import { carousel, openWithoutAutoplay, settle, swipe } from './helpers';

// defaultBrowserType は describe 内で指定できないので除く
const { defaultBrowserType: _, ...pixel7 } = devices['Pixel 7'];
test.use(pixel7);

test.beforeEach(async ({ page }) => {
	await openWithoutAutoplay(page);
});

test('短く速いフリックで次のスライドへ移ってスナップする', async ({ page }) => {
	const c = carousel(page);
	await swipe(page, c.viewport, { dx: -80, ms: 60, steps: 4 });
	await settle(page);
	expect(await c.index()).toBe(1);
	expect(await c.offset()).toBeCloseTo(-(await c.width()), 0);
});

test('ゆっくり半分未満ドラッグすると元のスライドに戻る', async ({ page }) => {
	const c = carousel(page);
	await swipe(page, c.viewport, { dx: -(await c.width()) * 0.3, ms: 600, steps: 12 });
	await settle(page);
	expect(await c.index()).toBe(0);
	expect(await c.offset()).toBeCloseTo(0, 0);
});

test('ゆっくり半分以上ドラッグすると次のスライドへ移る', async ({ page }) => {
	const c = carousel(page);
	await swipe(page, c.viewport, { dx: -(await c.width()) * 0.6, ms: 700, steps: 12 });
	await settle(page);
	expect(await c.index()).toBe(1);
});

test('移動中に続けてフリックすると移動先のさらに次へ進む', async ({ page }) => {
	const c = carousel(page);
	await swipe(page, c.viewport, { dx: -70, ms: 40, steps: 3 });
	await page.waitForTimeout(60);
	await swipe(page, c.viewport, { dx: -70, ms: 40, steps: 3 });
	await settle(page);
	expect(await c.index()).toBe(2);
});

test('末尾でさらにフリックしても末尾に留まる', async ({ page }) => {
	const c = carousel(page);
	await c.root.locator('.dot').last().click();
	await settle(page);
	await swipe(page, c.viewport, { dx: -150, ms: 60, steps: 4 });
	await settle(page);
	expect(await c.index()).toBe(4);
	expect(await c.offset()).toBeCloseTo(-4 * (await c.width()), 0);
});

test('縦スワイプではスライドが動かず、ページも横にずれない', async ({ page }) => {
	const c = carousel(page);
	await swipe(page, c.viewport, { dx: 10, dy: -250, ms: 200, steps: 8 });
	await settle(page);
	expect(await c.index()).toBe(0);
	expect(await c.offset()).toBeCloseTo(0, 0);
	expect(await page.evaluate(() => scrollX)).toBe(0);
	expect(await c.viewport.evaluate((v) => v.scrollLeft)).toBe(0);
});

test('ドラッグ後はリンクが開かず、タップでは開く', async ({ page }) => {
	const c = carousel(page);
	await swipe(page, c.viewport, { dx: -80, ms: 60, steps: 4 });
	await settle(page);
	expect(new URL(page.url()).hash).toBe('');

	const box = (await c.viewport.boundingBox())!;
	await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page).toHaveURL(/#2$/);
});

test('複数枚表示はスマホ幅で 1 枚ずつ 8 ページ', async ({ page }) => {
	await expect(carousel(page, 1).root.locator('small')).toHaveText('1 / 8');
});
