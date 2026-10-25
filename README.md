# svelte-slider

ネイティブアプリのページングのように、フリックの速さに合わせて素早く収まるスライダー。
土台はブラウザのスクロールと CSS scroll-snap です。

動作サンプル: https://5ym.github.io/svelte-slider/

元の jQuery 実装を Svelte 5(runes)で書き直した **ヘッドレス UI** です。
見た目は一切持たず、状態・操作・要素に spread する属性だけを `Slider` クラスが提供します。
サンプル(`demo/`)は [Blades CSS](https://blades.dev/) でスタイリングしています。

## 仕組み

`viewport` は横スクロールするコンテナで、スナップは CSS の scroll-snap です。
指で触ったときだけ JS が受け持ちます。

| 機能 | 担当 |
| --- | --- |
| 指(タッチ・ペン)とマウスのドラッグ、フリック、端のバウンド | JS。離した瞬間の速度から移動時間を決める(下記) |
| トラックパッド・ホイール・矢印キー | ブラウザのスクロール + `scroll-snap`(CSS) |
| 縦スクロールとの両立 | `touch-action: pan-y` |
| 前後ボタン・ドット | JS(`prevButton` など)。Chromium 系なら CSS の `::scroll-button()` / `::scroll-marker` だけでも作れる(サンプルの「複数枚表示」) |
| 自動スライド・端から反対側へ戻る(rewind)・Home / End・`index` | JS |

ブラウザの scroll-snap だけでフリックさせると、慣性で流してから後でスナップ位置へ寄せ直すため、
止まるまでに 0.5〜0.6 秒ほどかかって重く感じます。そこで指を離したら JS が引き取り、
ネイティブアプリのページングと同じく「初速 = 離した瞬間の指の速さ」になる時間(80〜350ms)で
次のスライドへ送ります。強く弾くほど速く着きます。移動中に続けてフリックすると、移動先のさらに次へ進みます。
JS が読み込まれる前は、ブラウザのネイティブのスワイプで動きます。

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

次の使い方には対応していません。

- `dir="rtl"`(右から左へ並べる)
- `viewport` への `padding` / `scroll-padding`(余白はスライド側に付けてください)
- Shadow DOM の中での利用(基本の CSS は `document` にだけ読み込まれます)

## 機能

- スワイプ(指に追従、端ではラバーバンド)/ マウスドラッグ
- フリック: 離した瞬間の速度から移動時間を決定。移動中に掴んで連続フリック可能
- トラックパッド・ホイールの横スクロール(ブラウザの scroll-snap)
- 縦スクロールを妨げない
- ドラッグ後はスライド内リンクのクリックを抑止
- 自動スライド(操作でリセット、ホバー・キーボードフォーカス・スクロール中・タブ非表示中は停止)
- 前後ボタン / ページングドット / 矢印キー・Home・End
- スライド幅は CSS で自由(1 枚表示・複数枚表示・ピーク表示など)。リサイズに追従
- `prefers-reduced-motion` ならボタン等での移動をアニメーションさせない

## インストール

npm レジストリには未公開です。GitHub の `release` ブランチ(ビルド済み)から直接インストールします。
`#v4.1.0` のようにタグを指定するとバージョンを固定できます。Svelte 5.29 以上が必要です。

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
設定(実行中に変更可): `autoplay`(ms、0 で無効) / `paused` / `rewind` / `duration`(ボタン・ドット・自動スライドの移動時間 ms)
操作: `next()` / `prev()` / `goTo(i)`

`data-dragging`(viewport)や `data-active`(slide / dot)をスタイルのフックに使えます。
`index` はトラックパッドなどでスクロールしている間も位置に合わせて更新されます。
端のバウンド中はスライドに `translate` を一時的に当てるので、スライドの `translate` プロパティは使わないでください。

### v3 からの移行

- `track` はなくなりました。スライドは `viewport` の直下に置きます(`gap` なども `viewport` へ)
- `viewport` は `overflow: hidden` + `transform` ではなく、横スクロールするコンテナになりました

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
