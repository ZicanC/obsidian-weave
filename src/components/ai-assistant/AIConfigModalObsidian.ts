import { App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import type WeavePlugin from "../../main";
import type { GenerationConfig } from "../../types/ai-types";
import { t } from "../../utils/i18n";
import AIConfigModal from "./AIConfigModal.svelte";

type MountedComponent = Parameters<typeof unmount>[0];

export interface AIConfigModalObsidianOptions {
	plugin: WeavePlugin;
	config: GenerationConfig;
	onSave: (config: GenerationConfig) => void | Promise<void>;
	onClose?: () => void;
}

export class AIConfigModalObsidian extends Modal {
	private component: MountedComponent | null = null;
	private readonly options: AIConfigModalObsidianOptions;

	constructor(app: App, options: AIConfigModalObsidianOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		this.setTitle(t("modals.aiConfig.title"));
		this.modalEl.addClass("weave-ai-config-modal");
		this.modalEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			width: "92vw",
			"max-width": "1000px",
			height: "86vh",
			"max-height": "86vh",
		});

		this.contentEl.empty();
		this.contentEl.addClass("weave-ai-config-modal-content");
		this.contentEl.setCssProps({
			display: "flex",
			"flex-direction": "column",
			flex: "1",
			"min-height": "0",
			padding: "0",
			overflow: "hidden",
		});

		this.component = mount(AIConfigModal, {
			target: this.contentEl,
			props: {
				plugin: this.options.plugin,
				config: this.options.config,
				isOpen: true,
				useObsidianModal: true,
				onClose: () => this.close(),
				onSave: (config: GenerationConfig) => {
					void this.options.onSave(config);
					this.close();
				},
			},
		});
	}

	onClose() {
		if (this.component) {
			void unmount(this.component);
			this.component = null;
		}

		this.contentEl.empty();
		this.options.onClose?.();
	}
}
