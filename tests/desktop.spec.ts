import { expect, test } from '@playwright/test';
import { carousel, openWithoutAutoplay, settle } from './helpers';

test.use({ viewport: { width: 1280, height: 900 } });

test.describe('自動スライド停止', () => {
	test.beforeEach(async ({ page }) => {
		await openWithoutAutoplay(page);
	});

	test('マウスドラッグで次へ移り、リンクは開かない', async ({ page }) => {
		const c = carousel(page);
		const box = (await c.viewport.boundingBox())!;
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		// 半分以上ドラッグして次へ(フリック速度はイベント間隔に左右されるので touch.spec.ts で見る)
		await page.mouse.move(x - box.width * 0.6, y, { steps: 10 });
		await page.mouse.up();
		await settle(page);
		expect(await c.index()).toBe(1);
		expect(new URL(page.url()).hash).toBe('');
	});

	test('ボタンの連打は移動先を基準に進み、端では反対側へ戻る', async ({ page }) => {
		const c = carousel(page);
		await c.root.getByRole('button', { name: '前へ' }).click();
		await settle(page);
		expect(await c.index()).toBe(4);

		// アニメーション中の連打
		await c.root
			.getByRole('button', { name: '次へ' })
			.evaluate((b: HTMLButtonElement) => (b.click(), b.click(), b.click()));
		await settle(page);
		expect(await c.index()).toBe(2);
		expect(await c.scroll()).toBeCloseTo(2 * (await c.width()), 0);
	});

	test('トラックパッドの横スクロールはブラウザの scroll-snap でスライドに吸い付く', async ({ page }) => {
		const c = carousel(page);
		const box = (await c.viewport.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		// 半分を超えて流すと、止まったところから近い次のスライドへ吸い付く
		await page.mouse.wheel(box.width * 0.6, 0);
		await settle(page);
		expect(await c.index()).toBe(1);
		expect(await c.scroll()).toBeCloseTo(await c.width(), 0);
	});

	test('ドットで指定のスライドへ移る', async ({ page }) => {
		const c = carousel(page);
		await c.root.getByRole('button', { name: 'スライド 4' }).click();
		await settle(page);
		expect(await c.index()).toBe(3);
	});

	test('矢印キー・Home・End で操作できる(ブラウザのスクロール)', async ({ page }) => {
		const c = carousel(page);
		await c.viewport.focus();
		for (const [key, expected] of [
			['ArrowRight', 1],
			['ArrowRight', 2],
			['ArrowLeft', 1],
			['End', 4],
			['Home', 0]
		] as const) {
			await page.keyboard.press(key);
			await settle(page);
			expect(await c.index(), key).toBe(expected);
		}
	});

	test('複数枚表示は 3 枚ずつで 6 ページ、CSS の次へボタンで末尾まで進む', async ({ page }) => {
		const cards = carousel(page, 1);
		await expect(cards.root.locator('.card-slide').first()).toHaveAttribute('aria-label', '1 / 6');
		// Chromium では ::scroll-button で描くので JS のボタンは出ない
		await expect(cards.root.locator('.card-fallback')).toBeHidden();

		// 疑似要素は locator で掴めないので、viewport の右下(次へボタンの位置)をクリックする
		await cards.root.scrollIntoViewIfNeeded();
		const box = (await cards.viewport.boundingBox())!;
		const clickNext = () => page.mouse.click(box.x + box.width - 20, box.y + box.height + 30);
		await clickNext();
		await settle(page);
		expect(await cards.scroll()).toBeGreaterThan(0);
		for (let i = 0; i < 6; i++) {
			await clickNext();
			await settle(page);
		}
		expect(await cards.scroll()).toBeCloseTo(await cards.maxScroll(), 0);
		await expect(cards.root.locator('.card-slide').nth(5)).toHaveAttribute('data-active');
	});
});

test('ドラッグして元の位置に戻して離しても自動スライドは止まらない', async ({ page }) => {
	await page.goto('./');
	const c = carousel(page);
	const box = (await c.viewport.boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x - 100, y, { steps: 5 });
	await page.mouse.move(x, y, { steps: 5 });
	// 元の位置で、スクロールが止まったとみなされるまで掴んだままにしてから離す
	await page.waitForTimeout(300);
	await page.mouse.up();
	// ホバー中は止まるので外へ出す
	await page.mouse.move(0, 0);
	await expect(page.getByText('自動スライド (再生中)')).toBeVisible();
});

test('自動スライドで進む', async ({ page }) => {
	await page.goto('./');
	const c = carousel(page);
	// ホバー中は止まるので、マウスをカルーセルの外に置く
	await page.mouse.move(0, 0);
	await page.locator('input[type=range]').fill('1000');
	await expect.poll(() => c.index(), { timeout: 5000 }).toBeGreaterThanOrEqual(2);
});
