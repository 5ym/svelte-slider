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
	await swipe(page, c.viewport, { dx: -80, ms: 60, steps: 8 });
	await settle(page);
	expect(await c.index()).toBe(1);
	expect(await c.scroll()).toBeCloseTo(await c.width(), 0);
});

test('ゆっくり半分未満ドラッグすると元のスライドに戻る', async ({ page }) => {
	const c = carousel(page);
	await swipe(page, c.viewport, { dx: -(await c.width()) * 0.3, ms: 600, steps: 12 });
	await settle(page);
	expect(await c.index()).toBe(0);
	expect(await c.scroll()).toBeCloseTo(0, 0);
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
	expect(await c.scroll()).toBeCloseTo(2 * (await c.width()), 0);
});

test('短いフリックは指の速さに合わせて素早く収まる', async ({ page }) => {
	const c = carousel(page);
	const start = Date.now();
	await swipe(page, c.viewport, { dx: -120, ms: 60, steps: 6 });
	await expect.poll(() => c.scroll(), { intervals: [16] }).toBeCloseTo(await c.width(), 0);
	// 離してから最大 350ms で着く(送信の待ち時間を含めて余裕を見る)
	expect(Date.now() - start).toBeLessThan(900);
});

test('端を越えて引っ張ると抵抗がかかり、離すと戻る', async ({ page }) => {
	const c = carousel(page);
	const cdp = await page.context().newCDPSession(page);
	const box = (await c.viewport.boundingBox())!;
	const y = box.y + box.height / 2;
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 50, y, id: 1 }] });
	for (let i = 1; i <= 8; i++) {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 50 + 25 * i, y, id: 1 }] });
	}
	// 端の外側はスライドの translate で見せている
	const shift = await c.viewport.evaluate(
		(v) => parseFloat(getComputedStyle(v.firstElementChild!).translate) || 0
	);
	// 200px 引っ張っても、抵抗で見た目の移動はそれより小さい
	expect(shift).toBeGreaterThan(0);
	expect(shift).toBeLessThan(200);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await cdp.detach();
	await settle(page);
	await expect(c.viewport.locator('> *').first()).not.toHaveAttribute('style', /translate/);
	expect(await c.index()).toBe(0);
});

test('末尾でさらにフリックしても末尾に留まる', async ({ page }) => {
	const c = carousel(page);
	await c.root.locator('.dot').last().click();
	await settle(page);
	await swipe(page, c.viewport, { dx: -150, ms: 60, steps: 4 });
	await settle(page);
	expect(await c.index()).toBe(4);
	expect(await c.scroll()).toBeCloseTo(4 * (await c.width()), 0);
});

test('縦スワイプではスライドが動かず、ページも横にずれない', async ({ page }) => {
	const c = carousel(page);
	await swipe(page, c.viewport, { dx: 10, dy: -250, ms: 200, steps: 8 });
	await settle(page);
	expect(await c.index()).toBe(0);
	expect(await c.scroll()).toBeCloseTo(0, 0);
	expect(await page.evaluate(() => scrollX)).toBe(0);
});

test('ドラッグ後はリンクが開かず、タップでは開く', async ({ page }) => {
	const c = carousel(page);
	await swipe(page, c.viewport, { dx: -80, ms: 60, steps: 8 });
	await settle(page);
	expect(new URL(page.url()).hash).toBe('');

	const box = (await c.viewport.boundingBox())!;
	await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page).toHaveURL(/#2$/);
});

test('複数枚表示はスマホ幅で 1 枚ずつ 8 ページ', async ({ page }) => {
	await expect(carousel(page, 1).root.locator('.card-slide').first()).toHaveAttribute('aria-label', '1 / 8');
});
