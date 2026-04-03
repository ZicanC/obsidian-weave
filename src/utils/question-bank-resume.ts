import type WeavePlugin from "../main";
import { showObsidianChoice } from "./obsidian-confirm";

export type QuestionBankSessionEntryAction = "resume" | "configure" | "cancel";

/**
 * 统一处理题库考试入口的恢复会话决策。
 * - 无进行中会话：进入配置流程
 * - 有进行中会话：允许恢复、重新开始或取消
 */
export async function resolveQuestionBankSessionEntryAction(
	plugin: WeavePlugin,
	bankId: string,
	bankName: string
): Promise<QuestionBankSessionEntryAction> {
	if (!plugin.questionBankStorage) {
		return "configure";
	}

	const persisted = await plugin.questionBankStorage.loadInProgressSession(bankId);
	if (!persisted || persisted.status !== "in_progress") {
		return "configure";
	}

	const action = await showObsidianChoice<"resume" | "configure">(
		plugin.app,
		`题库「${bankName}」存在未完成的考试学习会话。`,
		{
			title: "恢复学习会话",
			cancelText: "取消",
			layout: "horizontal",
			choices: [
				{
					value: "resume",
					text: "恢复学习",
					className: "mod-cta",
				},
				{
					value: "configure",
					text: "重新开始",
				},
			],
		}
	);

	if (action === "configure") {
		await plugin.questionBankStorage.clearInProgressSession(bankId);
		return "configure";
	}

	if (action === "resume") {
		return "resume";
	}

	return "cancel";
}
