import type { AIProvider } from "../constants/settings-constants";

export interface AIProviderVerificationConfig {
	apiKey?: string;
	model?: string;
	baseUrl?: string;
	verified?: boolean;
	lastVerified?: string;
}

export function buildAIProviderVerificationFingerprint(
	config?: AIProviderVerificationConfig
): string {
	return JSON.stringify({
		apiKey: config?.apiKey?.trim() ?? "",
		model: config?.model?.trim() ?? "",
		baseUrl: config?.baseUrl?.trim() ?? "",
	});
}

export function invalidateAIProviderVerification(config?: AIProviderVerificationConfig): boolean {
	if (!config) {
		return false;
	}

	const hadVerificationState = !!config.verified || !!config.lastVerified;
	config.verified = false;
	config.lastVerified = undefined;
	return hadVerificationState;
}

export function buildAIProviderVerificationFingerprintMap(
	providers: readonly AIProvider[],
	apiKeys?: Partial<Record<AIProvider, AIProviderVerificationConfig>>
): Record<AIProvider, string> {
	return Object.fromEntries(
		providers.map((provider) => [
			provider,
			buildAIProviderVerificationFingerprint(apiKeys?.[provider]),
		])
	) as Record<AIProvider, string>;
}
