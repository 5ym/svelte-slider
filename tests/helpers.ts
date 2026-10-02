import { expect, type Locator, type Page } from '@playwright/test';

/** n 番目のカルーセル(0: 基本, 1: 複数枚表示) */
export function carousel(page: Page, n = 0) {
	const root = page.locator('.carousel').nth(n);
	const viewport = root.locator('.viewport');
	return {
		root,
		viewport,
		/** aria-current の付いたドットの番号 */
		index: () =>
			root
				.locator('.dot')
				.evaluateAll((els) => els.findIndex((e) => e.getAttribute('aria-current') === 'true')),
		/** トラックの translateX (px) */
		offset: () =>
			viewport.evaluate(
				(v) => new DOMMatrix(getComputedStyle(v.firstElementChild as Element).transform).m41
			),
		width: async () => (await viewport.boundingBox())!.width
	};
}

/** 基本カルーセルの自動スライドを止めた状態でページを開く */
export async function openWithoutAutoplay(page: Page) {
	await page.goto('./');
	await page.locator('input[role=switch]').click();
	await expect(page.locator('input[role=switch]')).not.toBeChecked();
}

/** 移動アニメーションが終わるのを待つ */
export const settle = (page: Page) => page.waitForTimeout(600);

/**
 * CDP で実際のタッチ入力を送る(Pointer Events と touch-action がブラウザ本来の挙動になる)。
 * dx, dy: 移動量 (px)、ms: かける時間、steps: touchmove の回数
 */
export async function swipe(
	page: Page,
	target: Locator,
	{ dx = 0, dy = 0, ms, steps = 6 }: { dx?: number; dy?: number; ms: number; steps?: number }
) {
	const cdp = await page.context().newCDPSession(page);
	const box = (await target.boundingBox())!;
	const x0 = box.x + box.width / 2;
	const y0 = box.y + box.height / 2;
	const point = (x: number, y: number) => [{ x, y, id: 1 }];

	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x0, y0) });
	for (let i = 1; i <= steps; i++) {
		await page.waitForTimeout(ms / steps);
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: point(x0 + (dx * i) / steps, y0 + (dy * i) / steps)
		});
	}
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await cdp.detach();
}
