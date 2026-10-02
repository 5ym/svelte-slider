import { defineConfig } from '@playwright/test';

// vite preview の既定 (4173) は他のアプリとぶつかりやすいので避ける
const port = Number(process.env.TEST_PORT ?? 4317);

export default defineConfig({
	testDir: 'tests',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['github'], ['list']] : 'list',
	use: {
		baseURL: `http://127.0.0.1:${port}/`,
		browserName: 'chromium',
		trace: 'retain-on-failure'
	},
	// ビルド済みのサンプルサイトに対してテストする。
	// bun run 経由だと終了時に preview が残って待たされるので vite を直接起動する
	webServer: {
		command: `./node_modules/.bin/vite build && exec ./node_modules/.bin/vite preview --host 127.0.0.1 --port ${port} --strictPort`,
		url: `http://127.0.0.1:${port}/`,
		reuseExistingServer: !process.env.CI
	}
});
