# svelte-slider

ブラウザのスクロールと CSS scroll-snap でスマホそのままのスライド操作を実現したスライダー。

動作サンプル: https://5ym.github.io/svelte-slider/

元の jQuery 実装を Svelte 5(runes)で書き直した **ヘッドレス UI** です。
見た目は一切持たず、状態・操作・要素に spread する属性だけを `Slider` クラスが提供します。
サンプル(`demo/`)は [Blades CSS](https://blades.dev/) でスタイリングしています。

## 仕組み

v4 から、動きはできるだけ CSS とブラウザに任せています。

| 機能 | 担当 |
| --- | --- |
| スワイプ・フリック(慣性)・スナップ・端のバウンド・縦スクロールとの両立 | ブラウザのスクロール + `scroll-snap`(CSS) |
| 1 回のフリックで 1 枚ずつ | `scroll-snap-stop: always`(CSS) |
| 矢印キー | ブラウザのスクロール |
| 前後ボタン・ドット | JS(`prevButton` など)。Chromium 系なら CSS の `::scroll-button()` / `::scroll-marker` だけでも作れる(サンプルの「複数枚表示」) |
| マウスドラッグ・自動スライド・端から反対側へ戻る(rewind)・Home / End・`index` | JS |

`viewport` と `slide(i)` には `data-slider-viewport` / `data-slider-slide` 属性が付き、
次の CSS が詳細度 0(`:where()`)で自動的に読み込まれます。利用側の CSS でそのまま上書きできます。

```css
:where([data-slider-viewport]) {
	display: flex;
	position: relative;
	overflow-x: auto;
	overscroll-behavior-x: contain;
	scroll-snap-type: x mandatory;
	scrollbar-width: none;
}
:where([data-slider-slide]) {
	flex-shrink: 0;
	scroll-snap-align: start;
	scroll-snap-stop: always;
}
```

フリックの速さ・慣性・端のバウンドは OS とブラウザの実装そのままになります(iOS と Android で手触りが違うのは仕様です)。
ボタンでの移動は `scrollTo({ behavior: 'smooth' })` なので、移動時間とイージングは指定できません。

## 機能

- スワイプ / フリック / マウスドラッグ(マウスドラッグは離した速度で次へ進むか判定)
- 縦スクロールを妨げない
- ドラッグ後はスライド内リンクのクリックを抑止
- 自動スライド(操作でリセット、ホバー・キーボードフォーカス・スクロール中・タブ非表示中は停止)
- 前後ボタン / ページングドット / 矢印キー・Home・End
- スライド幅は CSS で自由(1 枚表示・複数枚表示・ピーク表示など)。リサイズに追従
- `prefers-reduced-motion` ならボタン等での移動をアニメーションさせない

## インストール

npm レジストリには未公開です。GitHub の `release` ブランチ(ビルド済み)から直接インストールします。
`#v4.0.0` のようにタグを指定するとバージョンを固定できます。Svelte 5.29 以上が必要です。

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

	const slider = new Slider({ autoplay: 4000, rewind: true });
</script>

<section {...slider.root} aria-label="お知らせ">
	<div {...slider.viewport}>
		{#each items as item, i}
			<div class="slide" {...slider.slide(i)}>…</div>
		{/each}
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
| `root` | カルーセル全体。自動スライドの停止条件(ホバー/フォーカス) |
| `viewport` | スクロールコンテナ。スライドを直接並べる。フォーカス可能(矢印キー・Home・End) |
| `slide(i)` | 各スライドの ARIA 属性。現在のスライドに `data-active` |
| `prevButton` / `nextButton` / `dot(i)` / `playButton` | 各ボタン。`aria-label` は後ろに書けば上書き可 |

状態: `index` / `count` / `dragging` / `playing` / `canPrev` / `canNext`
設定(実行中に変更可): `autoplay`(ms、0 で無効) / `paused` / `rewind`
操作: `next()` / `prev()` / `goTo(i)`

`data-dragging`(viewport)や `data-active`(slide / dot)をスタイルのフックに使えます。
`index` はスワイプ中もスクロール位置に合わせて更新されます。

### v3 からの移行

- `track` はなくなりました。スライドは `viewport` の直下に置きます(`gap` なども `viewport` へ)
- `duration` はなくなりました(移動時間はブラウザが決めます)
- `viewport` は `overflow: hidden` + `transform` ではなく、横スクロールするコンテナになりました
- 移動中のスライドを続けてフリックしても、今の位置から次のスライドまでしか進みません(ブラウザの挙動)

## 開発

```shell
bun install
bun run dev      # 開発サーバー
bun run build    # サンプルサイト(demo/)を build/ に静的ビルド
bun run package  # ライブラリ(src/)を dist/ にビルド
bun run check    # 型チェック(svelte-check。TypeScript 7 の tsgo で実行)
bun run test     # ブラウザでの操作テスト(Playwright。初回は bunx playwright install chromium)
```

GitHub Actions(`.github/workflows/ci.yml`)が PR と `m` への push で型チェック・配布設定のチェック(publint)・テストを実行します。
`m` への push でそれらが通ると、サンプルサイトを GitHub Pages へデプロイし、ビルド済みライブラリを `release` ブランチへコミットします。
`package.json` の `version` を上げると、そのバージョンのタグ(`v4.0.1` など)も自動で作られます。

## ライセンス

MIT
