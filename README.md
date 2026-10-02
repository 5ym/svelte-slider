# svelte-slider

フリック速度の計算等によりスマホに近いスライド操作を実現したスライダー。

動作サンプル: https://5ym.github.io/svelte-slider/

元の jQuery 実装を Svelte 5(runes)で書き直した **ヘッドレス UI** です。
見た目は一切持たず、状態・操作・要素に spread する属性だけを `Slider` クラスが提供します。
サンプル(`demo/`)は [Blades CSS](https://blades.dev/) でスタイリングしています。

## 機能

- スワイプ(指に追従、端ではラバーバンド)/ マウスドラッグ
- フリック: 離した瞬間の速度から移動時間を決定。アニメーション中に掴んで連続フリック可能
- 縦スクロールを妨げない(`touch-action: pan-y` + Pointer Events)
- ドラッグ後はスライド内リンクのクリックを抑止
- 自動スライド(操作でリセット、ホバー・キーボードフォーカス・タブ非表示中は停止)
- 前後ボタン / ページングドット / 矢印キー・Home・End
- スライド幅は CSS で自由(1 枚表示・複数枚表示・ピーク表示など)。リサイズに追従
- `prefers-reduced-motion` でボタン等のアニメーションを無効化

## インストール

npm レジストリには未公開です。GitHub の `release` ブランチ(ビルド済み)から直接インストールします。
`#v3.0.0` のようにタグを指定するとバージョンを固定できます。Svelte 5.29 以上が必要です。

```shell
bun add github:5ym/svelte-slider#release
pnpm add github:5ym/svelte-slider#release
npm i --allow-git=root github:5ym/svelte-slider#release
```

npm 12 以降は git 依存がデフォルトで無効なので `--allow-git=root` が必要です
(プロジェクトの `.npmrc` に `allow-git=root` を書いても可)。

## 使い方

```svelte
<script lang="ts">
	import { Slider } from 'svelte-slider';

	const slider = new Slider({ autoplay: 4000, rewind: true, duration: 400 });
</script>

<section {...slider.root} aria-label="お知らせ">
	<div {...slider.viewport}>
		<div {...slider.track}>
			{#each items as item, i}
				<div class="slide" {...slider.slide(i)}>…</div>
			{/each}
		</div>
	</div>

	<button {...slider.prevButton}>前へ</button>
	<button {...slider.nextButton}>次へ</button>
	{#each { length: slider.count } as _, i}
		<button {...slider.dot(i)}></button>
	{/each}
</section>

<style>
	/* スライドの幅は利用側で指定する */
	.slide { flex: 0 0 100%; }
</style>
```

| props | 役割 |
| --- | --- |
| `root` | カルーセル全体。キーボード操作・自動スライドの停止条件(ホバー/フォーカス) |
| `viewport` | 表示領域。ジェスチャを受け取る(`overflow: hidden` 等を自動付与) |
| `track` | スライドを並べる要素(`display: flex` と `transform` を自動付与) |
| `slide(i)` | 各スライドの ARIA 属性。現在のスライドに `data-active` |
| `prevButton` / `nextButton` / `dot(i)` / `playButton` | 各ボタン。`aria-label` は後ろに書けば上書き可 |

状態: `index` / `count` / `dragging` / `playing` / `canPrev` / `canNext`
設定(実行中に変更可): `autoplay`(ms、0 で無効) / `paused` / `rewind` / `duration`
操作: `next()` / `prev()` / `goTo(i)`

`data-dragging`(viewport)や `data-active`(slide / dot)をスタイルのフックに使えます。

## 開発

```shell
bun install
bun run dev      # 開発サーバー
bun run build    # サンプルサイト(demo/)を build/ に静的ビルド
bun run package  # ライブラリ(src/)を dist/ にビルド
bun run check    # 型チェック(svelte-check)
bun run test     # ブラウザでの操作テスト(Playwright。初回は bunx playwright install chromium)
```

GitHub Actions(`.github/workflows/ci.yml`)が PR と `m` への push で型チェック・配布設定のチェック(publint)・テストを実行します。
`m` への push でそれらが通ると、サンプルサイトを GitHub Pages へデプロイし、ビルド済みライブラリを `release` ブランチへコミットします。
`package.json` の `version` を上げると、そのバージョンのタグ(`v3.0.1` など)も自動で作られます。

## ライセンス

MIT
