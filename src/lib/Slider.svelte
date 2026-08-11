<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		interval = 4000,
		children
	}: {
		/** 自動スライドの間隔 (ms)。0 で無効。 */
		interval?: number;
		/** スライドとして並べる要素 */
		children: Snippet;
	} = $props();

	// jQuery の 'fast' / 'slow' に相当するアニメーション時間 (ms)
	const FAST = 200;
	const SLOW = 600;

	let wrap = $state<HTMLDivElement>();
	let count = $state(0);
	let current = $state(0);

	// --- スクロールアニメーション(jQuery animate 相当 / swing イージング) ---
	let raf = 0;
	function animateScroll(target: number, duration: number) {
		if (!wrap) return;
		cancelAnimationFrame(raf);
		const el = wrap;
		const from = el.scrollLeft;
		const delta = target - from;
		const start = performance.now();
		const swing = (t: number) => 0.5 - Math.cos(t * Math.PI) / 2;
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / duration);
			el.scrollLeft = from + delta * swing(t);
			if (t < 1) raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
	}

	function slides(): HTMLElement[] {
		return wrap ? (Array.from(wrap.children) as HTMLElement[]) : [];
	}

	// 元実装の position().left 相当(wrap の可視領域基準の相対位置)
	function offsetLeft(el: HTMLElement): number {
		if (!wrap) return 0;
		return el.getBoundingClientRect().left - wrap.getBoundingClientRect().left;
	}

	/** 次のスライドへ。右に 10px 以上はみ出た最初の要素へスナップ、無ければ先頭へ。 */
	export function next(duration = FAST) {
		if (!wrap) return;
		for (const el of slides()) {
			const left = offsetLeft(el);
			if (left > 10) {
				animateScroll(wrap.scrollLeft + left, duration);
				return;
			}
		}
		animateScroll(0, duration);
	}

	/** 前のスライドへ。左に 10px 以上はみ出た最後の要素へスナップ。 */
	export function prev(duration = FAST) {
		if (!wrap) return;
		for (const el of slides().reverse()) {
			const left = offsetLeft(el);
			if (left < -10) {
				animateScroll(wrap.scrollLeft + left, duration);
				return;
			}
		}
	}

	/** 指定インデックスのスライドへ。 */
	function goTo(index: number) {
		const el = slides()[index];
		if (!wrap || !el) return;
		animateScroll(wrap.scrollLeft + offsetLeft(el), FAST);
	}

	// --- 自動スライド(スクロールでリセット) ---
	let timeout: ReturnType<typeof setTimeout> | undefined;
	function armAutoSlide() {
		clearTimeout(timeout);
		if (interval > 0) {
			timeout = setTimeout(() => next(SLOW), interval);
		}
	}

	function onScroll() {
		armAutoSlide();
		if (wrap) {
			current = Math.floor(wrap.scrollLeft / wrap.clientWidth);
		}
	}

	$effect(() => {
		count = slides().length;
		armAutoSlide();
		return () => {
			clearTimeout(timeout);
			cancelAnimationFrame(raf);
		};
	});

	// --- タッチ操作(スワイプ / フリック速度可変) ---
	let startX = 0;
	let startY: number | false = 0;
	let endX = 0;
	let scrollStart = 0;
	let history: number[] = [];

	function onTouchStart(e: TouchEvent) {
		if (!wrap) return;
		scrollStart = wrap.scrollLeft;
		startX = e.changedTouches[0].pageX;
		startY = e.changedTouches[0].pageY;
		history = [];
	}

	function onTouchMove(e: TouchEvent) {
		if (!wrap) return;
		// 最初の移動が縦方向なら横スライドを諦める(縦スクロールを妨げない)
		if (history.length === 0 && startY !== false) {
			const dy = e.changedTouches[0].pageY - startY;
			if (dy < -10 || dy > 10) startY = false;
		}
		if (startY === false) return;
		e.preventDefault();
		endX = e.changedTouches[0].pageX;
		history.unshift(endX);
		if (history.length > 2) history.pop();
		wrap.scrollLeft = startX - endX + scrollStart;
	}

	function onTouchEnd() {
		if (!wrap || startY === false) return;
		const leftVelocity = history[1] - history[0];
		const rightVelocity = history[0] - history[1];
		const half = wrap.clientWidth / 2;
		const moved = endX - startX;
		if (moved > 0) {
			if (moved > half) {
				prev();
			} else if (rightVelocity > 10) {
				prev(5000 / rightVelocity);
			} else {
				next();
			}
		} else if (moved < 0) {
			if (-moved > half) {
				next();
			} else if (leftVelocity > 10) {
				next(5000 / leftVelocity);
			} else {
				prev();
			}
		}
	}
</script>

<div class="slider">
	<button type="button" class="arrow" aria-label="前へ" onclick={() => prev()}>
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
		</svg>
	</button>

	<div
		class="wrap"
		role="group"
		aria-roledescription="carousel"
		aria-label="スライダー"
		bind:this={wrap}
		onscroll={onScroll}
		ontouchstart={onTouchStart}
		ontouchmove={onTouchMove}
		ontouchend={onTouchEnd}
	>
		{@render children()}
	</div>

	<button type="button" class="arrow" aria-label="次へ" onclick={() => next()}>
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z" />
		</svg>
	</button>

	<div class="dots" role="tablist">
		{#each { length: count } as _, i (i)}
			<button
				type="button"
				role="tab"
				class="dot"
				class:now={i === current}
				aria-label={`スライド ${i + 1}`}
				aria-selected={i === current}
				onclick={() => goTo(i)}
			></button>
		{/each}
	</div>
</div>

<style>
	.slider {
		position: relative;
	}
	.wrap {
		overflow-x: scroll;
		position: relative;
		height: 100%;
		white-space: nowrap;
		scrollbar-width: none;
	}
	.wrap::-webkit-scrollbar {
		display: none;
	}
	.wrap > :global(*) {
		display: inline-table;
		width: 100%;
		margin: 0;
	}
	.arrow {
		position: absolute;
		z-index: 100;
		top: calc(50% - 40px);
		left: 0;
		width: 80px;
		height: 80px;
		padding: 0;
		border: none;
		background: transparent;
		color: white;
		cursor: pointer;
	}
	.arrow svg {
		width: 100%;
		height: 100%;
	}
	.arrow:hover {
		background: rgba(0, 0, 0, 0.5);
	}
	.arrow:last-of-type {
		right: 0;
		left: auto;
	}
	.dots {
		position: absolute;
		bottom: 10px;
		left: 0;
		width: 100%;
		text-align: center;
	}
	.dot {
		display: inline-table;
		width: 10px;
		height: 10px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: white;
		cursor: pointer;
	}
	.dot.now {
		background: black;
		pointer-events: none;
	}
	.dot ~ .dot {
		margin: 0 0 0 10px;
	}
</style>
