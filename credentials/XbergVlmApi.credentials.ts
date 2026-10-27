import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Credentials for the VLM (Vision Language Model) endpoint that xberg uses for
 * OCR and structured field extraction.
 *
 * xberg talks to any OpenAI-compatible chat/completions endpoint (Ollama,
 * vLLM, OpenAI, etc.) via liter-llm, so we store the base URL, an optional API
 * key, and a default model name. The node calls the xberg native addon
 * directly rather than through n8n's HTTP layer, so these values are passed
 * into xberg's `LlmConfig` at execution time.
 */
export class XbergVlmApi implements ICredentialType {
	name = 'xbergVlmApi';

	displayName = 'xberg VLM API';

	documentationUrl = 'https://platform.openai.com/docs/api-reference';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'http://localhost:11434/v1',
			placeholder: 'http://localhost:11434/v1',
			required: true,
			description:
				'Base URL of the OpenAI-compatible endpoint. For a local Ollama server use <code>http://localhost:11434/v1</code> (the <code>/v1</code> suffix is required).',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			description:
				'API key for the endpoint. Leave empty for a local Ollama server that does not require authentication.',
		},
		{
			displayName: 'Default Model',
			name: 'model',
			type: 'string',
			default: 'glm-ocr:latest',
			placeholder: 'glm-ocr:latest',
			required: true,
			description:
				'Default vision model used for OCR and extraction. Can be overridden per node. Must match a model served by the endpoint (e.g. an Ollama tag such as <code>glm-ocr:latest</code>).',
		},
	];

	/**
	 * Attach the API key as a Bearer token so the credential test below (and any
	 * future declarative requests) authenticate against OpenAI-compatible APIs.
	 */
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	/**
	 * Validate the credential by listing models on the OpenAI-compatible
	 * endpoint. Works for Ollama (`/v1/models`) and OpenAI alike.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/models',
			method: 'GET',
		},
	};
}
