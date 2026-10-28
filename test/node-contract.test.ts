import { describe, expect, it } from 'vitest';

import { PdfOcr } from '../nodes/PdfOcr/PdfOcr.node';
import { PdfFieldExtractor } from '../nodes/PdfFieldExtractor/PdfFieldExtractor.node';

const NODES = [
	{ name: 'PdfOcr', Klass: PdfOcr },
	{ name: 'PdfFieldExtractor', Klass: PdfFieldExtractor },
] as const;

describe.each(NODES)('$name node contract', ({ Klass }) => {
	const node = new Klass();
	const d = node.description;

	it('declares all four provider credentials, each gated by the provider', () => {
		const names = d.credentials!.map((c) => c.name).sort();
		expect(names).toEqual(['anthropicApi', 'googlePalmApi', 'ollamaApi', 'openAiApi']);
		for (const c of d.credentials!) {
			expect(Array.isArray(c.displayOptions?.show?.provider)).toBe(true);
		}
	});

	it('is usable as an AI tool', () => {
		expect(d.usableAsTool).toBe(true);
	});

	it('exposes a provider dropdown listing all four providers, default ollama', () => {
		const prov = d.properties.find((p) => p.name === 'provider');
		expect(prov?.type).toBe('options');
		const values = (prov!.options as Array<{ value: string }>).map((o) => o.value).sort();
		expect(values).toEqual(['anthropic', 'gemini', 'ollama', 'openai']);
		expect(prov!.default).toBe('ollama');
	});

	it('loads the model list dynamically and reloads when the provider changes', () => {
		const model = d.properties.find((p) => p.name === 'model');
		expect(model?.typeOptions?.loadOptionsMethod).toBe('listModels');
		expect(model?.typeOptions?.loadOptionsDependsOn).toContain('provider');
	});

	it('wires up the listModels loadOptions method and an execute handler', () => {
		expect(typeof node.methods?.loadOptions?.listModels).toBe('function');
		expect(typeof node.execute).toBe('function');
	});
});

describe('PdfOcr specifics', () => {
	const d = new PdfOcr().description;

	it('has a Replace Existing Text Layer boolean defaulting to true', () => {
		const rt = d.properties.find((p) => p.name === 'replaceTextLayer');
		expect(rt?.type).toBe('boolean');
		expect(rt?.default).toBe(true);
	});
});

describe('PdfFieldExtractor specifics', () => {
	const d = new PdfFieldExtractor().description;

	it('orders properties extraction-first', () => {
		const names = d.properties.map((p) => p.name);
		expect(names).toEqual([
			'binaryPropertyName',
			'provider',
			'model',
			'jsonSchema',
			'options',
			'ocrFallback',
			'ocrOptions',
		]);
	});

	it('has Schema Description, Output Fixing Parser, and Max Repair Iterations in the Options collection', () => {
		const opts = d.properties.find((p) => p.name === 'options');
		const fields = (opts!.options as Array<{ name: string }>).map((o) => o.name).sort();
		expect(fields).toEqual(['maxRepairIterations', 'outputFixingParser', 'schemaDescription']);
	});

	it('defaults OCR fallback off and only shows OCR Options when it is on', () => {
		const fb = d.properties.find((p) => p.name === 'ocrFallback');
		expect(fb?.type).toBe('boolean');
		expect(fb?.default).toBe(false);

		const ocrOpts = d.properties.find((p) => p.name === 'ocrOptions');
		expect(ocrOpts?.displayOptions?.show?.ocrFallback?.[0]).toBe(true);
	});
});
