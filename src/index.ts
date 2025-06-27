import { logger } from "@mjxsn/color-logger";

interface Options {
	debug?: boolean;
	delimiter?: string;
	defaultDomain?: string;
	domainFolder?: string;
	pagesFolder?: string;
	pageExtension?: string;
	appId?: string;
	appDataId?: string;
	domainPattern?: RegExp;
	autoDetectExtension?: boolean;
}

class PageResolver<T> {
	private DOMAIN_PATTERN = /^(?:\[(.*?)\])::(.+)$/;
	private domainsCache = new Set<string>();
	private extensionsCache = new Set<string>();
	private pages: Record<string, Promise<T> | (() => Promise<T>)> = {};
	private delimiter = ".";
	private defaultDomain = "main";
	private domainFolder = "domains";
	private pagesFolder = "pages";
	private pageExtension?: string;
	private debug = false;
	private domainModeEnabled = false;
	private appId = "app";
	private appDataId = "data-page";
	private autoDetectExtension = true;

	private static instance: PageResolver<any> | null = null;

	private constructor() { }

	public static getInstance<U>(): PageResolver<U> {
		if (!PageResolver.instance) {
			PageResolver.instance = new PageResolver<U>();
		}
		return PageResolver.instance as PageResolver<U>;
	}

	public configure(
		pages: Record<string, Promise<T> | (() => Promise<T>)>,
		options: Options = {},
	): this {
		this.pages = pages;
		this.debug = options.debug ?? this.debug;
		this.delimiter = options.delimiter ?? this.delimiter;
		this.defaultDomain = options.defaultDomain ?? this.defaultDomain;
		this.domainFolder = options.domainFolder ?? this.domainFolder;
		this.pagesFolder = options.pagesFolder ?? this.pagesFolder;
		this.pageExtension = options.pageExtension;
		this.appId = options.appId ?? this.appId;
		this.appDataId = options.appDataId ?? this.appDataId;
		this.autoDetectExtension =
			options.autoDetectExtension ?? this.autoDetectExtension;

		// Set custom domain pattern if provided
		if (options.domainPattern) {
			this.validateDomainPattern(options.domainPattern);
			this.DOMAIN_PATTERN = options.domainPattern;
		}

		this.detectDomainUsage();
		this.detectPageExtensions();

		this.getInformation();

		return this;
	}

	private detectDomainUsage(): void {
		this.domainModeEnabled = Object.keys(this.pages).some(
			(page) =>
				page.includes(`../${this.domainFolder}/`) &&
				page.includes(`/${this.pagesFolder}/`),
		);

		if (this.debug) {
			logger.info(`Domain mode enabled: ${this.domainModeEnabled}`);
		}
	}

	private detectPageExtensions(): void {
		if (!this.autoDetectExtension || this.pageExtension) {
			if (this.debug && this.pageExtension) {
				logger.info(`Using configured page extension: ${this.pageExtension}`);
			}
			return;
		}

		this.extensionsCache.clear();
		const extensionRegex = /\.([^./]+)$/;

		for (const pagePath in this.pages) {
			const match = pagePath.match(extensionRegex);
			if (match?.[1]) {
				this.extensionsCache.add(match[1]);
			}
		}

		// If only one extension found, use it as default
		if (this.extensionsCache.size === 1) {
			this.pageExtension = Array.from(this.extensionsCache)[0];
		}

		if (this.debug) {
			logger.info(
				`Auto-detected extensions: ${Array.from(this.extensionsCache).join(", ")}`,
			);
			if (this.pageExtension) {
				logger.info(`Using default extension: ${this.pageExtension}`);
			}
		}
	}

	private getDomains(): Set<string> {
		if (!this.domainModeEnabled) {
			if (this.debug)
				logger.info("Domain mode disabled, no domains to extract.");
			return new Set();
		}

		if (this.domainsCache.size > 0) {
			if (this.debug) logger.info("Using cached domains...");
			return this.domainsCache;
		}

		if (this.debug) logger.warning("Extracting domains from pages...");

		const domainRegex = new RegExp(
			`${this.domainFolder}/([^/]+)/${this.pagesFolder}/`,
		);

		for (const pagePath in this.pages) {
			const match = pagePath.match(domainRegex);
			if (match?.[1]) {
				this.domainsCache.add(match[1]);
			}
		}

		if (this.debug) {
			logger.info(`Found domains: ${Array.from(this.domainsCache).join(", ")}`);
		}

		return this.domainsCache;
	}

	private buildPagePath(input: string): {
		pagePath: string;
		domain: string;
		possiblePaths: string[];
	} {
		const match = input.match(this.DOMAIN_PATTERN);
		let rawDomain = this.defaultDomain;
		let pagePart = input;

		if (match) {
			if (match.length !== 3 || !match[1] || !match[2]) {
				throw new Error(
					`Invalid domain syntax: "${input}"
                    Expected format: domain + delimiter + page path
                    Both domain and page parts must be non-empty`,
				);
			}

			rawDomain = match[1];
			pagePart = match[2];
		}

		const pathSegments = pagePart.split(this.delimiter);
		const domains = this.getDomains();

		const effectiveDomain =
			domains.has(rawDomain) ||
				rawDomain.includes(",") ||
				rawDomain.includes("*")
				? rawDomain
				: this.defaultDomain;

		// Generate possible paths with different extensions
		const possiblePaths: string[] = [];
		const basePath = this.domainModeEnabled
			? `../${this.domainFolder}/${effectiveDomain}/${this.pagesFolder}/${pathSegments.join("/")}`
			: `../${this.pagesFolder}/${pathSegments.join("/")}`;

		// If we have a specific extension configured, use it
		if (this.pageExtension) {
			possiblePaths.push(`${basePath}.${this.pageExtension}`);
		} else if (this.autoDetectExtension && this.extensionsCache.size > 0) {
			// Try all detected extensions
			for (const ext of this.extensionsCache) {
				possiblePaths.push(`${basePath}.${ext}`);
			}
		} else {
			// Fallback to common extensions
			const commonExtensions = ["tsx", "jsx", "vue", "svelte"];
			for (const ext of commonExtensions) {
				possiblePaths.push(`${basePath}.${ext}`);
			}
		}

		const primaryPath = possiblePaths[0];

		if (this.debug) {
			logger.debug(`Resolved primary path: ${primaryPath} for input: ${input}`);
			logger.debug(`Possible paths: ${possiblePaths.join(", ")}`);
		}

		return { pagePath: primaryPath, domain: effectiveDomain, possiblePaths };
	}

	private loadClientPageProps(): void {
		if (typeof window === "undefined") return;

		const appElement = document.getElementById(this.appId);
		const propsData = appElement?.getAttribute(this.appDataId);

		if (!propsData) return;
	}

	public async resolve(pageName: string | string[]): Promise<T> {
		const pageNames = Array.isArray(pageName) ? pageName : [pageName];

		for (const name of pageNames) {
			try {
				const { possiblePaths } = this.buildPagePath(name);

				// Try each possible path
				for (const pagePath of possiblePaths) {
					const pageComponent = this.pages[pagePath];

					if (pageComponent) {
						this.loadClientPageProps();
						return typeof pageComponent === "function"
							? pageComponent()
							: pageComponent;
					}
				}

				if (this.debug) {
					logger.warning(`Page not found: ${name}`);
					logger.info(`Tried paths: ${possiblePaths.join(", ")}`);
				}
			} catch (error) {
				// If it's a domain syntax error, throw it immediately
				if (
					error instanceof Error &&
					error.message.includes("Invalid domain syntax")
				) {
					throw error;
				}

				// For other errors, log and continue to next page name
				if (this.debug) {
					logger.error(
						`Error resolving page "${name}": ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
		}

		throw new Error(`Page not found: ${pageNames.join(", ")}`);
	}

	private getInformation(): void {
		if (!this.debug) return;

		const domains = this.getDetectedDomains();
		const extensions = this.getDetectedExtensions();

		logger.log("Page resolver information:\n", {
			...(domains.length > 0 && { domains }),
			extensions,
			pages: this.getAvailablePages(),
		});
	}

	private clearCache(): void {
		this.domainsCache.clear();
		this.extensionsCache.clear();

		// Re-detect domain usage and extensions after clearing cache
		this.detectDomainUsage();
		this.detectPageExtensions();

		if (this.debug) {
			logger.info("Cache cleared and re-initialized");
		}
	}

	public reloadPages(
		pages: Record<string, Promise<T> | (() => Promise<T>)>,
	): void {
		this.pages = pages;
		this.clearCache();

		if (this.debug) {
			logger.info("Pages reloaded and cache cleared");
		}
	}

	private validateDomainPattern(pattern: RegExp): void {
		const groupCount = new RegExp(`${pattern.source}|`)?.exec("")?.length;

		if (!groupCount || groupCount - 1 !== 2) {
			throw new Error(
				`Invalid domain pattern: ${pattern}
                Pattern must contain exactly 2 capturing groups (domain and page).`,
			);
		}
	}

	private getDetectedExtensions(): string[] {
		return Array.from(this.extensionsCache);
	}

	private getDetectedDomains(): string[] {
		return Array.from(this.domainsCache);
	}

	private getAvailablePages(): string[] {
		return Object.keys(this.pages);
	}
}

/**
 * Resolves a page component based on provided page name
 * @returns Promise resolving to the page component
 */
export async function resolvePageComponent<T>(
	pageName: string | string[],
	pages: Record<string, Promise<T> | (() => Promise<T>)>,
	options: Options = {},
): Promise<T> {
	const resolver = PageResolver.getInstance<T>().configure(pages, options);
	return resolver.resolve(pageName);
}
