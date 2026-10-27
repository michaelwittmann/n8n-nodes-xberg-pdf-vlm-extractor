import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeProperties,
	INodePropertyOptions,
} from 'n8n-workflow';

import type { LlmConfig, OcrConfig } from '@xberg-io/xberg';

/**
 * Shared building blocks for the PDF OCR and PDF Field Extractor nodes.
 *
 * Both nodes talk to an LLM through xberg's native addon, which routes to the
 * provider via liter-llm. liter-llm addresses a model as `"<provider>/<model>"`
 * (e.g. `ollama/llama3.2-vision`, `openai/gpt-4o`, `anthropic/claude-...`,
 * `gemini/...`) and talks to each provider's native API — so no OpenAI-compat
 * shim is needed for Anthropic or Gemini. This module keeps provider selection,
 * credential reading, model listing, and the shared properties in one place so
 * the two node files stay thin.
 */

/** Providers we expose, mapped to the built-in n8n credential each one uses. */
export type Provider = 'ollama' | 'openai' | 'anthropic' | 'gemini';

interface ProviderSpec {
	/** liter-llm routing prefix (`<prefix>/<model>`). */
	readonly prefix: string;
	/** Name of the built-in n8n credential this provider authenticates with. */
	readonly credential: string;
	/** Human label for the provider dropdown. */
	readonly label: string;
}

/**
 * Per-provider wiring. The credential names are all built-ins shipped with n8n
 * (ollamaApi / openAiApi / anthropicApi from the LangChain nodes, googlePalmApi
 * for Gemini) — this package declares none of its own.
 */
export const PROVIDERS: Record<Provider, ProviderSpec> = {
	ollama: { prefix: 'ollama', credential: 'ollamaApi', label: 'Ollama (Local)' },
	openai: { prefix: 'openai', credential: 'openAiApi', label: 'OpenAI' },
	anthropic: { prefix: 'anthropic', credential: 'anthropicApi', label: 'Anthropic' },
	gemini: { prefix: 'gemini', credential: 'googlePalmApi', label: 'Google Gemini' },
};

/** The full set of credentials both nodes declare, each gated by the provider. */
export const providerCredentials = (Object.keys(PROVIDERS) as Provider[]).map((provider) => ({
	name: PROVIDERS[provider].credential,
	required: true,
	displayOptions: {
		show: {
			provider: [provider],
		},
	},
}));

/**
 * Read the per-provider base URL from a credential object. Ollama stores it in
 * `baseUrl`, OpenAI/Anthropic in `url`, Gemini in `host`. Returns the bare host
 * with any trailing slashes trimmed, or undefined when the credential carries
 * none (liter-llm then uses its own provider default).
 */
function readBaseUrl(provider: Provider, credentials: IDataObject): string | undefined {
	const raw =
		provider === 'ollama'
			? (credentials.baseUrl as string | undefined)
			: provider === 'gemini'
				? (credentials.host as string | undefined)
				: (credentials.url as string | undefined);
	const trimmed = (raw ?? '').replace(/\/+$/, '');
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalise an Ollama base URL to the OpenAI-compatible endpoint liter-llm's
 * Ollama provider expects (`.../v1`). The `ollamaApi` credential stores the bare
 * host (e.g. `http://localhost:11434`).
 */
export function toOllamaOpenAiBaseUrl(baseUrl: string): string {
	const trimmed = baseUrl.replace(/\/+$/, '');
	return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/**
 * Read the selected provider's credential and the node's per-item parameters,
 * and build the xberg `LlmConfig`. The model is prefixed with the liter-llm
 * provider route (`<prefix>/<model>`). The base URL is only forwarded when the
 * credential carries a custom endpoint; for Ollama it is always sent (and `/v1`
 * is appended), for the cloud providers only when the user overrode the default.
 */
export async function getLlmConfig(
	ctx: IExecuteFunctions,
	itemIndex: number,
	ocrOptions: IDataObject,
): Promise<LlmConfig> {
	const provider = ctx.getNodeParameter('provider', itemIndex) as Provider;
	const spec = PROVIDERS[provider];
	const credentials = await ctx.getCredentials(spec.credential, itemIndex);

	const apiKeyRaw = (credentials.apiKey as string) ?? '';
	const apiKey = apiKeyRaw !== '' ? apiKeyRaw : undefined;

	const rawModel = (ctx.getNodeParameter('model', itemIndex) as string).trim();
	// Don't double-prefix if the user typed a fully-qualified route via expression.
	const model = rawModel.includes('/') ? rawModel : `${spec.prefix}/${rawModel}`;

	let baseUrl = readBaseUrl(provider, credentials);
	if (provider === 'ollama') {
		baseUrl = toOllamaOpenAiBaseUrl(baseUrl ?? 'http://localhost:11434');
	}

	return {
		model,
		apiKey,
		...(baseUrl ? { baseUrl } : {}),
		timeoutSecs: (ocrOptions.timeoutSecs as number) ?? 300,
		temperature: (ocrOptions.temperature as number) ?? 0,
	};
}

/**
 * Build the xberg `OcrConfig` (VLM backend) from the shared OCR options.
 * xberg's config interfaces are `readonly`, so the optional `vlmPrompt` is
 * added via a conditional spread rather than mutated in afterwards.
 */
export function buildOcrConfig(llm: LlmConfig, ocrOptions: IDataObject): OcrConfig {
	const language = ((ocrOptions.language as string) ?? 'eng')
		.split(',')
		.map((lang) => lang.trim())
		.filter((lang) => lang.length > 0);

	const vlmPrompt = (ocrOptions.vlmPrompt as string | undefined) || undefined;

	return {
		backend: 'vlm',
		vlmConfig: llm,
		language: language.length > 0 ? language : ['eng'],
		...(vlmPrompt ? { vlmPrompt } : {}),
	};
}

/** Shape a raw model list into sorted dropdown options with a fallback. */
function toModelOptions(models: string[], emptyHint: string): INodePropertyOptions[] {
	const cleaned = models
		.filter((name): name is string => typeof name === 'string' && name.length > 0)
		.sort((a, b) => a.localeCompare(b));
	if (cleaned.length === 0) {
		return [{ name: emptyHint, value: '' }];
	}
	return cleaned.map((name) => ({ name, value: name }));
}

/**
 * `loadOptions` method: list the models available to the selected provider.
 * Each provider exposes a different listing endpoint; on any failure we fall
 * back to a free-text hint so the node is still usable when the endpoint is
 * unreachable at edit time (the user can type a model via an expression).
 */
export async function listModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const provider = this.getCurrentNodeParameter('provider') as Provider;
	const spec = PROVIDERS[provider];

	try {
		const credentials = await this.getCredentials(spec.credential);
		const base = readBaseUrl(provider, credentials);

		let options: IHttpRequestOptions;
		let pluck: (body: unknown) => string[];

		switch (provider) {
			case 'ollama': {
				// Ollama's native tags endpoint, not the /v1 OpenAI shim.
				options = {
					method: 'GET',
					url: `${base ?? 'http://localhost:11434'}/api/tags`,
					json: true,
				};
				pluck = (body) =>
					((body as { models?: Array<{ name?: string; model?: string }> }).models ?? []).map(
						(m) => m.name ?? m.model ?? '',
					);
				break;
			}
			case 'openai': {
				options = {
					method: 'GET',
					url: `${base ?? 'https://api.openai.com/v1'}/models`,
					json: true,
				};
				pluck = (body) =>
					((body as { data?: Array<{ id?: string }> }).data ?? []).map((m) => m.id ?? '');
				break;
			}
			case 'anthropic': {
				options = {
					method: 'GET',
					url: `${base ?? 'https://api.anthropic.com'}/v1/models`,
					headers: { 'anthropic-version': '2023-06-01' },
					json: true,
				};
				pluck = (body) =>
					((body as { data?: Array<{ id?: string }> }).data ?? []).map((m) => m.id ?? '');
				break;
			}
			case 'gemini': {
				options = {
					method: 'GET',
					url: `${base ?? 'https://generativelanguage.googleapis.com'}/v1beta/models`,
					json: true,
				};
				pluck = (body) =>
					((body as { models?: Array<{ name?: string }> }).models ?? []).map((m) =>
						// Gemini returns `models/gemini-1.5-pro`; strip the `models/` prefix.
						(m.name ?? '').replace(/^models\//, ''),
					);
				break;
			}
			default: {
				return [{ name: 'Unknown Provider', value: '' }];
			}
		}

		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			spec.credential,
			options,
		);

		return toModelOptions(
			pluck(response),
			`No Models Found for ${spec.label} — Check the Credential or Type a Model via Expression`,
		);
	} catch (error) {
		return [
			{
				name: `Could Not List Models (${(error as Error).message}) — Check the Credential`,
				value: '',
			},
		];
	}
}

/** The provider selector, shared by both nodes. Shown before the model. */
export const providerProperty: INodeProperties = {
	displayName: 'Provider',
	name: 'provider',
	type: 'options',
	noDataExpression: true,
	default: 'ollama',
	description: 'LLM provider to run the Vision Language Model on',
	hint: 'Pick where the model runs, then attach that provider’s credential below. The Model list reloads to match.',
	options: (Object.keys(PROVIDERS) as Provider[]).map((provider) => ({
		name: PROVIDERS[provider].label,
		value: provider,
	})),
};

/** The model dropdown, shared by both nodes. Reloads per selected provider. */
export const modelProperty: INodeProperties = {
	displayName: 'Model Name or ID',
	name: 'model',
	type: 'options',
	typeOptions: {
		loadOptionsMethod: 'listModels',
		loadOptionsDependsOn: ['provider'],
	},
	default: '',
	required: true,
	hint: 'Must be a vision-capable model (it reads page images). The list is fetched live from the provider; if it’s empty, type the model ID via an expression.',
	description: 'Vision model to use. Choose from the list (loaded from the selected provider), or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

/** The input binary field selector, shared by both nodes. */
export const binaryPropertyNameProperty: INodeProperties = {
	displayName: 'Input Binary Field',
	name: 'binaryPropertyName',
	type: 'string',
	default: 'data',
	required: true,
	placeholder: 'data',
	hint: 'The name of the incoming binary field that holds the PDF (e.g. the field produced by Read/Write Files or HTTP Request). Usually “data”.',
	description: 'Name of the input binary field that holds the PDF file to process',
};

/** The OCR tuning options collection, shared by both nodes. */
export const ocrOptionsProperty: INodeProperties = {
	displayName: 'OCR Options',
	name: 'ocrOptions',
	type: 'collection',
	placeholder: 'Add OCR Option',
	default: {},
	options: [
		{
			displayName: 'Custom OCR Prompt',
			name: 'vlmPrompt',
			type: 'string',
			typeOptions: {
				rows: 4,
			},
			default: '',
			hint: 'Overrides xberg’s built-in OCR prompt entirely — only set this if you know what the full prompt should say. Leave empty to use the tuned default.',
			description:
				'Custom prompt template for VLM OCR. Leave empty to use the xberg default. Supports the <code>{{ language }}</code> template variable.',
		},
		{
			displayName: 'Languages',
			name: 'language',
			type: 'string',
			default: 'eng',
			placeholder: 'eng,deu',
			hint: 'ISO 639 codes hinting the OCR which language(s) the page is in. Separate multiple with commas, e.g. eng,deu.',
			description:
				'Comma-separated ISO 639 language code(s) to guide OCR (e.g. <code>eng</code> or <code>eng,deu</code>)',
		},
		{
			displayName: 'Temperature',
			name: 'temperature',
			type: 'number',
			default: 0,
			typeOptions: {
				minValue: 0,
				numberPrecision: 2,
			},
			hint: 'Keep at 0 for OCR — you want the model to transcribe faithfully, not get creative. Higher values add randomness.',
			description: 'Sampling temperature for the VLM. Lower is more deterministic.',
		},
		{
			displayName: 'Timeout (Seconds)',
			name: 'timeoutSecs',
			type: 'number',
			default: 300,
			typeOptions: {
				minValue: 1,
			},
			hint: 'Max wait per model call. Raise it for large PDFs or slow local models that need longer to respond.',
			description: 'Per-request timeout for the VLM call, in seconds',
		},
	],
};
