import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

const here = (path: string) => resolve(import.meta.dirname, path);

// ライブラリは src/、サンプルサイトは demo/
export default defineConfig({
	root: here('demo'),
	plugins: [svelte({ configFile: here('svelte.config.ts') })],
	resolve: {
		// サンプルからも利用者と同じパッケージ名で読み込む
		alias: { 'svelte-slider': here('src/index.ts') }
	},
	// 相対パスにして GitHub Pages 等にそのまま置けるようにする
	base: './',
	// dist/ はライブラリ(svelte-package)の出力先なので、サンプルサイトは build/ へ
	build: { outDir: here('build'), emptyOutDir: true }
});
