import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [svelte()],
	// 相対パスにして GitHub Pages 等にそのまま置けるようにする
	base: './'
});
