import { logger } from "../utils/logger";
/**
 * 缁熶竴绠＄悊 Weave 鐨勪富棰樻娴嬨€佺洃鍚拰涓婚鍙橀噺娉ㄥ叆銆? */
import { untrack } from "svelte";

export type ThemeMode = "light" | "dark" | "auto";

/** 褰撳墠涓婚鐨勬娴嬬粨鏋溿€?*/
export interface ThemeDetectionResult {
	mode: ThemeMode;
	isDark: boolean;
	source: "obsidian-class" | "system-preference" | "fallback";
	confidence: "high" | "medium" | "low";
}

/** 缁熶竴涓婚鐘舵€侊紝骞跺悜浣跨敤鏂瑰箍鎾彉鏇淬€?*/
export class UnifiedThemeManager {
	private static instance: UnifiedThemeManager;
	private currentTheme: ThemeDetectionResult;
	private listeners: Array<(result: ThemeDetectionResult) => void> = [];
	private mediaQuery: MediaQueryList;
	private mediaQueryChangeHandler: ((e: MediaQueryListEvent) => void) | null = null;
	private domObserver: MutationObserver;
	private isInitialized = false;

	private constructor() {
		this.mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		this.currentTheme = this.detectTheme();
		this.mediaQueryChangeHandler = () => this.handleThemeChange();
		this.domObserver = new MutationObserver(() => this.handleThemeChange());
		this.initialize();
	}

	static getInstance(): UnifiedThemeManager {
		const w = window as any;
		// 将实例挂到 window 上，避免热更新或重复初始化时重复注册监听器。
		if (w.__weaveThemeManager) {
			return w.__weaveThemeManager as UnifiedThemeManager;
		}
		if (!UnifiedThemeManager.instance) {
			UnifiedThemeManager.instance = new UnifiedThemeManager();
			w.__weaveThemeManager = UnifiedThemeManager.instance;
			w.__weaveThemeManagerCleanup = () => {
				try {
					(w.__weaveThemeManager as UnifiedThemeManager | undefined)?.destroy();
				} catch {}
				try {
					w.__weaveThemeManager = undefined;
					w.__weaveThemeManagerCleanup = undefined;
				} catch {
					w.__weaveThemeManager = null;
					w.__weaveThemeManagerCleanup = null;
				}
			};
		}
		return UnifiedThemeManager.instance;
	}

	private initialize(): void {
		if (this.isInitialized) return;

		if (this.mediaQueryChangeHandler) {
			this.mediaQuery.addEventListener("change", this.mediaQueryChangeHandler);
		}

		this.domObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});
		this.domObserver.observe(document.body, {
			attributes: true,
			attributeFilter: ["class"],
		});

		this.isInitialized = true;
	}

	private detectTheme(): ThemeDetectionResult {
		if (document.documentElement.classList.contains("theme-dark")) {
			return {
				mode: "dark",
				isDark: true,
				source: "obsidian-class",
				confidence: "high",
			};
		}

		if (document.documentElement.classList.contains("theme-light")) {
			return {
				mode: "light",
				isDark: false,
				source: "obsidian-class",
				confidence: "high",
			};
		}

		if (document.body.classList.contains("theme-dark")) {
			return {
				mode: "dark",
				isDark: true,
				source: "obsidian-class",
				confidence: "medium",
			};
		}

		if (document.body.classList.contains("theme-light")) {
			return {
				mode: "light",
				isDark: false,
				source: "obsidian-class",
				confidence: "medium",
			};
		}

		const systemPrefersDark = this.mediaQuery.matches;
		return {
			mode: "auto",
			isDark: systemPrefersDark,
			source: "system-preference",
			confidence: "medium",
		};
	}

	private handleThemeChange(): void {
		const newTheme = this.detectTheme();

		if (this.hasThemeChanged(this.currentTheme, newTheme)) {
			const oldTheme = this.currentTheme;
			this.currentTheme = newTheme;

			logger.debug("[ThemeManager] 涓婚鍙樺寲:", {
				from: oldTheme,
				to: newTheme,
			});

			this.listeners.forEach((_listener) => {
				try {
					_listener(newTheme);
				} catch (error) {
					logger.error("[ThemeManager] 鐩戝惉鍣ㄦ墽琛屽け璐?", error);
				}
			});
		}
	}

	private hasThemeChanged(oldTheme: ThemeDetectionResult, newTheme: ThemeDetectionResult): boolean {
		return (
			oldTheme.isDark !== newTheme.isDark ||
			oldTheme.mode !== newTheme.mode ||
			oldTheme.source !== newTheme.source
		);
	}

	getCurrentTheme(): ThemeDetectionResult {
		return { ...this.currentTheme };
	}

	/** 淇濈暀缁欐棫璋冪敤鏂圭殑娣辫壊妯″紡鍒ゆ柇銆?*/
	isDarkMode(): boolean {
		return this.currentTheme.isDark;
	}

	/** 娉ㄥ唽鐩戝惉鍣紝骞剁珛鍗虫帹閫佷竴娆″綋鍓嶇姸鎬併€?*/
	addListener(callback: (result: ThemeDetectionResult) => void): () => void {
		this.listeners.push(callback);

		try {
			callback(this.currentTheme);
		} catch (error) {
			logger.error("[ThemeManager] 鍒濆鐩戝惉鍣ㄨ皟鐢ㄥけ璐?", error);
		}

		return () => {
			const index = this.listeners.indexOf(callback);
			if (index > -1) {
				this.listeners.splice(index, 1);
			}
		};
	}

	/** 閲婃斁鐩戝惉鍣紝渚涙祴璇曟垨鏄惧紡閲嶇疆鏃朵娇鐢ㄣ€?*/
	destroy(): void {
		if (this.mediaQueryChangeHandler) {
			this.mediaQuery.removeEventListener("change", this.mediaQueryChangeHandler);
		}
		this.domObserver.disconnect();
		this.listeners.length = 0;
		this.isInitialized = false;

		try {
			const w = window as any;
			if (w.__weaveThemeManager === this) {
				w.__weaveThemeManager = undefined;
			}
		} catch {}

		UnifiedThemeManager.instance = null as any;
	}
}

/** @deprecated 寤鸿鏀圭敤 `UnifiedThemeManager.getInstance().isDarkMode()`銆?*/
export function isDarkMode(): boolean {
	return UnifiedThemeManager.getInstance().isDarkMode();
}

/** @deprecated 寤鸿鏀圭敤 `UnifiedThemeManager.getInstance().addListener()`銆?*/
export function createThemeListener(callback: (isDark: boolean) => void): () => void {
	const themeManager = UnifiedThemeManager.getInstance();

	return themeManager.addListener((result) => {
		callback(result.isDark);
	});
}

/** 鍒涘缓鍙湪缁勪欢閲屽鐢ㄧ殑鍝嶅簲寮忎富棰樺揩鐓с€?*/
export function createReactiveThemeState() {
	const themeManager = UnifiedThemeManager.getInstance();
	let currentResult = themeManager.getCurrentTheme();
	let themeVersion = 0;
	let cleanup: (() => void) | null = null;

	const initListener = () => {
		if (cleanup) cleanup();

		cleanup = themeManager.addListener((newResult) => {
			currentResult = newResult;
			themeVersion++;
		});
	};

	initListener();

	return {
		get isDark() {
			return currentResult.isDark;
		},
		get mode() {
			return currentResult.mode;
		},
		get source() {
			return currentResult.source;
		},
		get confidence() {
			return currentResult.confidence;
		},
		get version() {
			return themeVersion;
		},
		get result() {
			return { ...currentResult };
		},

		destroy() {
			if (cleanup) {
				cleanup();
				cleanup = null;
			}
		},

		reinit() {
			initListener();
		},
	};
}

/** 鐢熸垚鍜屽綋鍓嶄富棰樼姸鎬佸搴旂殑 CSS 绫诲悕銆?*/
export function getThemeClasses(): string[] {
	const themeManager = UnifiedThemeManager.getInstance();
	const result = themeManager.getCurrentTheme();
	const classes: string[] = [];

	if (result.isDark) {
		classes.push("theme-dark");
	} else {
		classes.push("theme-light");
	}

	classes.push(`theme-source-${result.source}`);
	classes.push(`theme-confidence-${result.confidence}`);

	return classes;
}

/** 涓哄厓绱犻檮鍔犱富棰樼被锛屽苟鍦ㄤ富棰樺彉鍖栨椂鑷姩鏇存柊銆?*/
export function addThemeClasses(element: HTMLElement): () => void {
	const themeManager = UnifiedThemeManager.getInstance();

	const updateClasses = () => {
		removeThemeClasses(element);
		const classes = getThemeClasses();
		element.classList.add(...classes);
	};

	updateClasses();

	const cleanup = themeManager.addListener(() => {
		updateClasses();
	});

	return cleanup;
}

/** 娓呴櫎鏈伐鍏锋坊鍔犺繃鐨勪富棰樼被銆?*/
export function removeThemeClasses(element: HTMLElement): void {
	element.classList.remove("theme-dark", "theme-light");

	element.classList.remove(
		"theme-source-obsidian-class",
		"theme-source-system-preference",
		"theme-source-fallback"
	);

	element.classList.remove(
		"theme-confidence-high",
		"theme-confidence-medium",
		"theme-confidence-low"
	);
}

/** 杩斿洖缂栬緫鍣ㄧ浉鍏崇殑涓婚鍙橀噺銆?*/
export function getThemeVariables(): Record<string, string> {
	const themeManager = UnifiedThemeManager.getInstance();
	const result = themeManager.getCurrentTheme();

	const baseVariables = {
		"--editor-font-family": 'var(--font-text, "Inter", sans-serif)',
		"--editor-font-size": "14px",
		"--editor-line-height": "1.6",
	};

	const themeVariables = result.isDark
		? {
				"--editor-bg": "#1a1a1a",
				"--editor-text": "#e1e4e8",
				"--editor-border": "rgba(255, 255, 255, 0.15)",
				"--editor-cursor": "#8b5cf6",
				"--editor-selection": "rgba(139, 92, 246, 0.25)",
				"--editor-active-line": "rgba(255, 255, 255, 0.05)",
		  }
		: {
				"--editor-bg": "#ffffff",
				"--editor-text": "#24292e",
				"--editor-border": "rgba(17, 24, 39, 0.15)",
				"--editor-cursor": "#8b5cf6",
				"--editor-selection": "rgba(139, 92, 246, 0.2)",
				"--editor-active-line": "rgba(17, 24, 39, 0.03)",
		  };

	return { ...baseVariables, ...themeVariables };
}

/** 灏嗗綋鍓嶄富棰樺彉閲忓啓鍏ュ厓绱狅紝骞跺湪涓婚鍙樺寲鏃跺悓姝ユ洿鏂般€?*/
export function applyThemeVariables(element: HTMLElement): () => void {
	const themeManager = UnifiedThemeManager.getInstance();

	const updateVariables = () => {
		const variables = getThemeVariables();
		Object.entries(variables).forEach(([property, value]) => {
			element.style.setProperty(property, value);
		});
	};

	updateVariables();

	const cleanup = themeManager.addListener(() => {
		updateVariables();
	});

	return cleanup;
}

