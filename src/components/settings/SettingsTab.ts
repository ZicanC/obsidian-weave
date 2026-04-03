import { PluginSettingTab } from "obsidian";
import type WeavePlugin from "../../main";
import type { PluginExtended } from "./types/settings-types";

export class AnkiSettingsTab extends PluginSettingTab {
	plugin: PluginExtended;

	constructor(app: any, plugin: WeavePlugin) {
		super(app, plugin);
		this.plugin = plugin as PluginExtended;
	}

	async display(): Promise<void> {
		const { containerEl } = this;
		containerEl.empty();

		const { mount } = await import("svelte");
		const { default: Component } = await import("./SettingsPanel.svelte");
		mount(Component, { target: containerEl, props: { plugin: this.plugin } });
	}
}
