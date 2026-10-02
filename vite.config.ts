import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vite';

const html = `<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Svelte Slider</title>
	</head>
	<body>
		<div id="app"></div>
		<script type="module" src="/src/main.ts"></script>
	</body>
</html>
`;

/** index.html をファイルとして置かずに、開発サーバーとビルドの両方へ供給する */
function virtualIndexHtml(): Plugin {
	let file = '';
	return {
		name: 'virtual-index-html',
		enforce: 'pre',
		config: () => ({ build: { rollupOptions: { input: 'index.html' } } }),
		configResolved(config) {
			file = resolve(config.root, 'index.html');
		},
		resolveId(id) {
			if (resolve(id) === file || id === 'index.html') return file;
		},
		load(id) {
			if (id === file) return html;
		},
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				const path = req.url?.split('?')[0];
				if (path !== '/' && path !== '/index.html') return next();
				res.setHeader('Content-Type', 'text/html');
				res.end(await server.transformIndexHtml(req.url!, html));
			});
		}
	};
}

export default defineConfig({
	plugins: [virtualIndexHtml(), svelte()],
	// 相対パスにして GitHub Pages 等にそのまま置けるようにする
	base: './',
	// dist/ はライブラリ(svelte-package)の出力先なので、サンプルサイトは build/ へ
	build: { outDir: 'build' }
});
