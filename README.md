# svelte-slider

フリック速度の計算等によりスマホに近いスライド操作を実現したスライダー。

動作サンプル: https://5ym.github.io/svelte-slider/

元の jQuery 実装(`slider.js`)を廃止し、**Svelte 5(runes)コンポーネント**
`src/lib/Slider.svelte` に書き換えたものです。依存は Svelte のみで、jQuery は使いません。

## 仕様(元実装と同じ)

- 一定間隔での自動スライド(スクロール操作でリセット)
- 左右ボタンによるスライド
- ページングドット(現在位置表示・クリックで移動)
- スワイプによるスライド(縦スクロール開始時は横スライドを抑止)
- フリックによるスライド
- フリック時の加速度からスライド速度を可変

## 使い方

```svelte
<script>
	import Slider from './lib/Slider.svelte';
</script>

<!-- interval: 自動スライド間隔 ms(既定 4000 / 0 で無効) -->
<Slider interval={4000}>
	<a href="/1"><img src="1.png" alt="" /></a>
	<a href="/2"><img src="2.png" alt="" /></a>
	<a href="/3"><img src="3.png" alt="" /></a>
</Slider>
```

子要素はそのままスライドとして横に並びます(1 枚 = コンテナ幅)。

## 開発

```shell
bun install
bun run dev      # 開発サーバー
bun run build    # dist/ に静的ビルド(相対パスなのでそのまま配置可能)
bun run check    # svelte-check
```

`master` への push で GitHub Actions がビルドし GitHub Pages へ自動デプロイします。
