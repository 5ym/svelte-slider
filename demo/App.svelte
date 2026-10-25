<script lang="ts">
	import { Slider } from 'svelte-slider';

	const hero = new Slider({ autoplay: 4000 });
	const cards = new Slider({ autoplay: 0, rewind: false });

	const slides = [
		{ title: 'スワイプ', text: 'ブラウザのスクロールそのもの。慣性も端のバウンドも OS のまま。', hue: 210 },
		{ title: 'スナップ', text: 'CSS の scroll-snap で 1 枚ずつ止まります。', hue: 280 },
		{ title: '縦スクロール', text: '縦に動かしたときはページのスクロールを邪魔しません。', hue: 340 },
		{ title: 'ヘッドレス', text: '見た目は持たず、状態と属性だけを提供します。', hue: 30 },
		{ title: 'アクセシブル', text: '矢印キー・Home / End、ARIA 属性に対応。', hue: 150 }
	];
</script>

<main class="container">
	<hgroup>
		<h1>Svelte Slider</h1>
		<p>ブラウザのスクロールと CSS scroll-snap で動くヘッドレススライダー。サンプルは Blades CSS でスタイリングしています。</p>
	</hgroup>

	<section>
		<h2>基本</h2>
		<div class="carousel" {...hero.root} aria-label="機能紹介">
			<div class="viewport" {...hero.viewport}>
				{#each slides as s, i (s.title)}
					<a href="#{i + 1}" class="slide" style:--hue={s.hue} {...hero.slide(i)}>
						<strong>{s.title}</strong>
						<span>{s.text}</span>
					</a>
				{/each}
			</div>

			<nav class="controls">
				<button class="outline secondary" {...hero.prevButton}>←</button>
				<div class="dots">
					{#each { length: hero.count } as _, i (i)}
						<button class="dot" {...hero.dot(i)}></button>
					{/each}
				</div>
				<button class="outline secondary" {...hero.nextButton}>→</button>
			</nav>
		</div>

		<fieldset class="grid">
			<label>
				<input type="checkbox" role="switch" checked={!hero.paused} onchange={() => (hero.paused = !hero.paused)} />
				自動スライド {hero.playing ? '(再生中)' : '(停止中)'}
			</label>
			<label>
				間隔 {hero.autoplay / 1000} 秒
				<input type="range" min="1000" max="8000" step="500" bind:value={hero.autoplay} />
			</label>
		</fieldset>
	</section>

	<section>
		<h2>複数枚表示</h2>
		<p>
			スライドの幅は利用側の CSS で自由に決められます。スナップ位置は各スライドの左端です。
			前後ボタンとドットは、対応ブラウザでは CSS の <code>::scroll-button</code> /
			<code>::scroll-marker</code> だけで描いています(未対応のブラウザでは JS のボタン)。
		</p>
		<div class="carousel" {...cards.root} aria-label="カード">
			<div class="viewport card-viewport" {...cards.viewport}>
				{#each { length: 8 } as _, i (i)}
					<article class="card-slide" {...cards.slide(i)}>
						<header>カード {i + 1}</header>
						<p>幅 80% / 2 枚 / 3 枚とブレークポイントごとに変わります。</p>
					</article>
				{/each}
			</div>
			<nav class="controls card-fallback">
				<button class="outline secondary" {...cards.prevButton}>←</button>
				<small>{cards.index + 1} / {cards.count}</small>
				<button class="outline secondary" {...cards.nextButton}>→</button>
			</nav>
		</div>
	</section>
</main>

<style>
	.carousel {
		margin-bottom: var(--pico-spacing);
	}
	.viewport {
		border-radius: var(--pico-border-radius);
		cursor: grab;
	}
	.viewport[data-dragging] {
		cursor: grabbing;
	}

	.slide {
		flex: 0 0 100%;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.5rem;
		aspect-ratio: 16 / 9;
		max-height: 60vh;
		padding: calc(var(--pico-spacing) * 2);
		color: #fff;
		text-decoration: none;
		background: linear-gradient(135deg, hsl(var(--hue) 70% 45%), hsl(calc(var(--hue) + 40) 70% 35%));
	}
	.slide strong {
		font-size: clamp(1.5rem, 6vw, 3rem);
	}
	.slide:focus-visible {
		outline: var(--pico-outline-width) solid var(--pico-primary-focus);
		outline-offset: calc(var(--pico-outline-width) * -1);
	}

	.controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--pico-spacing);
		margin-top: calc(var(--pico-spacing) / 2);
	}
	.controls button {
		margin: 0;
		padding: 0.25rem 1rem;
	}
	.dots {
		display: flex;
		gap: 0.5rem;
	}
	.controls .dot {
		width: 0.75rem;
		height: 0.75rem;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: var(--pico-muted-border-color);
		transition: background-color var(--pico-transition), transform var(--pico-transition);
	}
	.controls .dot[data-active] {
		background: var(--pico-primary-background);
		transform: scale(1.3);
	}

	.card-viewport {
		gap: var(--pico-spacing);
	}
	.card-slide {
		flex: 0 0 80%;
		margin: 0;
	}
	.card-slide > header {
		border-radius: var(--pico-border-radius) var(--pico-border-radius) 0 0;
	}
	@media (min-width: 768px) {
		.card-slide {
			flex-basis: calc((100% - var(--pico-spacing)) / 2);
		}
	}
	@media (min-width: 1024px) {
		.card-slide {
			flex-basis: calc((100% - var(--pico-spacing) * 2) / 3);
		}
	}

	/* 対応ブラウザでは前後ボタンとドットを CSS だけで出し、JS のボタンは隠す */
	@supports selector(::scroll-button(*)) and selector(::scroll-marker) {
		.card-fallback {
			display: none;
		}
		.card-viewport {
			anchor-name: --cards;
			scroll-marker-group: after;
		}
		.card-viewport::scroll-button(*) {
			position: absolute;
			/* 後ろに並ぶドットの列にクリックを取られないように */
			z-index: 1;
			position-anchor: --cards;
			margin-top: calc(var(--pico-spacing) / 2);
			padding: 0.25rem 1rem;
			border: var(--pico-border-width) solid var(--pico-secondary-border);
			border-radius: var(--pico-border-radius);
			background: transparent;
			color: var(--pico-secondary);
			font-size: 1rem;
			line-height: var(--pico-line-height);
			cursor: pointer;
		}
		.card-viewport::scroll-button(*):disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
		.card-viewport::scroll-button(left) {
			content: '←' / '前へ';
			position-area: bottom span-right;
		}
		.card-viewport::scroll-button(right) {
			content: '→' / '次へ';
			position-area: bottom span-left;
		}
		.card-viewport::scroll-marker-group {
			display: flex;
			justify-content: center;
			align-items: center;
			gap: 0.5rem;
			/* 前後ボタンと同じ高さに並べる */
			min-height: 2.5rem;
			margin-top: calc(var(--pico-spacing) / 2);
		}
		.card-slide::scroll-marker {
			content: '';
			width: 0.75rem;
			height: 0.75rem;
			border-radius: 50%;
			background: var(--pico-muted-border-color);
			transition:
				background-color var(--pico-transition),
				transform var(--pico-transition);
		}
		.card-slide::scroll-marker:target-current {
			background: var(--pico-primary-background);
			transform: scale(1.3);
		}
	}
</style>
