import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: { "policy-document": fileURLToPath(new URL("./policy.example.json", import.meta.url)) },
	},
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.dev.jsonc" },
		}),
	],
	test: {
		include: ["test/**/*.test.ts"],
	},
});
