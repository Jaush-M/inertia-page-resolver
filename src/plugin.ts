import path from "node:path";
import { debounce } from "./debounce";
import type { ViteDevServer, Plugin } from "vite";

interface PageResolverPluginOptions {
	pagesFolder?: string;
	watchExtensions?: string[];
}

export default function pageResolverPlugin({
	pagesFolder = "pages",
	watchExtensions = [".tsx", ".jsx", ".vue", ".svelte"],
}: PageResolverPluginOptions = {}): Plugin {
	const isWatchedPageFile = (file: string): boolean => {
		return (
			file.includes(`/${pagesFolder}/`) &&
			watchExtensions.some((ext) => file.endsWith(ext))
		);
	};

	const notify = (message: string, file: string): void => {
		const relativePath = path.relative(process.cwd(), file);
		console.log(
			`  \x1b[1m\x1b[36m[HMR]\x1b[0m ${message}: \x1b[33m${relativePath}\x1b[0m`,
		);
	};

	return {
		name: "page-resolver-plugin",

		configureServer(server: ViteDevServer) {
			const triggerReload = debounce(() => {
				server.ws.send({
					type: "custom",
					event: "page-cache-invalidated",
				});
				server.restart();
			});

			server.watcher.on("add", (file: string) => {
				if (!isWatchedPageFile(file)) return;
				notify("\x1b[32mNew page added\x1b[0m", file);
				triggerReload();
			});

			server.watcher.on("unlink", (file: string) => {
				if (!isWatchedPageFile(file)) return;
				notify("\x1b[31mPage removed\x1b[0m", file);
				triggerReload();
			});
		},
	};
}
