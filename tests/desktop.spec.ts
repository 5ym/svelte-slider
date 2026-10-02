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
		expect(await c.offset()).toBeCloseTo(-2 * (await c.width()), 0);
	});

	test('ドットで指定のスライドへ移る', async ({ page }) => {
		const c = carousel(page);
		await c.root.getByRole('button', { name: 'スライド 4' }).click();
		await settle(page);
		expect(await c.index()).toBe(3);
	});

	test('矢印キー・Home・End で操作できる', async ({ page }) => {
		const c = carousel(page);
		await c.root.getByRole('button', { name: '次へ' }).focus();
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

	test('複数枚表示は 3 枚ずつで 6 ページ、末尾で次へは無効', async ({ page }) => {
		const cards = carousel(page, 1);
		await expect(cards.root.locator('small')).toHaveText('1 / 6');
		const next = cards.root.getByRole('button', { name: '次へ' });
		for (let i = 0; i < 5; i++) await next.click();
		await expect(cards.root.locator('small')).toHaveText('6 / 6');
		await expect(next).toBeDisabled();
	});
});

test('自動スライドで進む', async ({ page }) => {
	await page.goto('./');
	const c = carousel(page);
	// ホバー中は止まるので、マウスをカルーセルの外に置く
	await page.mouse.move(0, 0);
	await page.locator('input[type=range]').fill('1000');
	await expect.poll(() => c.index(), { timeout: 5000 }).toBeGreaterThanOrEqual(2);
});
