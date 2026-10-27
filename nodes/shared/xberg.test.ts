import { describe, expect, it } from 'vitest';

import type { LlmConfig } from '@xberg-io/xberg';

import {
	PROVIDERS,
	buildOcrConfig,
	providerCredentials,
	toOllamaOpenAiBaseUrl,
} from './xberg';

describe('toOllamaOpenAiBaseUrl', () => {
	it('appends /v1 to a bare host', () => {
		expect(toOllamaOpenAiBaseUrl('http://localhost:11434')).toBe('http://localhost:11434/v1');
	});

	it('strips trailing slashes before appending /v1', () => {
		expect(toOllamaOpenAiBaseUrl('http://localhost:11434/')).toBe('http://localhost:11434/v1');
		expect(toOllamaOpenAiBaseUrl('http://localhost:11434///')).toBe('http://localhost:11434/v1');
	});

	it('is idempotent when /v1 is already present', () => {
		expect(toOllamaOpenAiBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
		expect(toOllamaOpenAiBaseUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1');
	});

	it('works for a containerised host alias', () => {
		expect(toOllamaOpenAiBaseUrl('http://host.docker.internal:11434')).toBe(
			'http://host.docker.internal:11434/v1',
		);
	});
});

describe('PROVIDERS / providerCredentials', () => {
	it('exposes exactly the four supported providers', () => {
		expect(Object.keys(PROVIDERS).sort()).toEqual(['anthropic', 'gemini', 'ollama', 'openai']);
	});

	it('maps each provider to its built-in n8n credential', () => {
		expect(PROVIDERS.ollama.credential).toBe('ollamaApi');
		expect(PROVIDERS.openai.credential).toBe('openAiApi');
		expect(PROVIDERS.anthropic.credential).toBe('anthropicApi');
		expect(PROVIDERS.gemini.credential).toBe('googlePalmApi');
	});

	it('declares one credential per provider, each gated by that provider', () => {
		const names = providerCredentials.map((c) => c.name).sort();
		expect(names).toEqual(['anthropicApi', 'googlePalmApi', 'ollamaApi', 'openAiApi']);

		for (const cred of providerCredentials) {
			expect(cred.required).toBe(true);
			expect(cred.displayOptions.show.provider).toHaveLength(1);
			// the provider that gates this credential routes back to this credential
			const [gatedBy] = cred.displayOptions.show.provider;
			expect(PROVIDERS[gatedBy].credential).toBe(cred.name);
		}
	});
});

describe('buildOcrConfig', () => {
	const llm: LlmConfig = { model: 'ollama/llama3.2-vision', temperature: 0, timeoutSecs: 300 };

	it('always targets the VLM backend and forwards the llm config', () => {
		const cfg = buildOcrConfig(llm, {});
		expect(cfg.backend).toBe('vlm');
		expect(cfg.vlmConfig).toBe(llm);
	});

	it('defaults to English when no language is given', () => {
		expect(buildOcrConfig(llm, {}).language).toEqual(['eng']);
	});

	it('splits a comma-separated language list and trims whitespace', () => {
		expect(buildOcrConfig(llm, { language: 'eng, deu , fra' }).language).toEqual([
			'eng',
			'deu',
			'fra',
		]);
	});

	it('falls back to English for an all-empty language string', () => {
		expect(buildOcrConfig(llm, { language: ' , ' }).language).toEqual(['eng']);
	});

	it('omits vlmPrompt unless a non-empty one is supplied', () => {
		expect(buildOcrConfig(llm, {})).not.toHaveProperty('vlmPrompt');
		expect(buildOcrConfig(llm, { vlmPrompt: '' })).not.toHaveProperty('vlmPrompt');
		expect(buildOcrConfig(llm, { vlmPrompt: 'Read it.' }).vlmPrompt).toBe('Read it.');
	});

	it('does not mutate its inputs', () => {
		const opts = { language: 'eng,deu', vlmPrompt: 'x' };
		const snapshot = JSON.stringify(opts);
		buildOcrConfig(llm, opts);
		expect(JSON.stringify(opts)).toBe(snapshot);
	});
});
