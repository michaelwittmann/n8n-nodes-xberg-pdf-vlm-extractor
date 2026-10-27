import zlib from 'node:zlib';

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PageContent } from '@xberg-io/xberg';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildSearchablePdf } from './searchablePdf';

const OLD = 'ORIGINALOLDLAYER9999';
const NEW = 'FRESHOCRTOKEN12345';

/** Decode every content stream and pull out all literal + hex text tokens. */
function extractText(bytes: Uint8Array): string {
	const s = Buffer.from(bytes).toString('latin1');
	const streams: string[] = [];
	const re = /stream\r?\n/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(s))) {
		const start = m.index + m[0].length;
		const end = s.indexOf('endstream', start);
		if (end < 0) continue;
		const raw = Buffer.from(s.slice(start, end), 'latin1');
		let decoded: string;
		try {
			decoded = zlib.inflateSync(raw).toString('latin1');
		} catch {
			decoded = raw.toString('latin1');
		}
		streams.push(decoded);
	}

	let text = '';
	for (const c of streams) {
		// literal strings ( ... )
		for (const mm of c.matchAll(/\(((?:\\.|[^()\\])*)\)/g)) {
			text += mm[1].replace(/\\(\d{1,3}|.)/g, (_, g: string) =>
				/^\d+$/.test(g) ? String.fromCharCode(parseInt(g, 8)) : g,
			);
		}
		// hex strings < ... >
		for (const mm of c.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
			const hex = mm[1].replace(/\s+/g, '');
			if (hex.length % 2 === 0) {
				for (let k = 0; k < hex.length; k += 2) {
					text += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
				}
			}
		}
	}
	return text;
}

let srcBytes: Uint8Array;
const pages: PageContent[] = [
	{ pageNumber: 1, content: `${NEW} some recognised words` } as PageContent,
];

beforeAll(async () => {
	// A source PDF carrying a real, visible text layer we can later strip.
	const src = await PDFDocument.create();
	const font = await src.embedFont(StandardFonts.Helvetica);
	const page = src.addPage([400, 400]);
	page.drawText(OLD, { x: 50, y: 300, size: 20, font, color: rgb(0, 0, 0) });
	page.drawText('keep me as graphics context', { x: 50, y: 250, size: 10, font });
	srcBytes = await src.save();
});

describe('buildSearchablePdf', () => {
	it('sanity: the source PDF really contains the old text layer', () => {
		expect(extractText(srcBytes)).toContain(OLD);
	});

	it('replaceTextLayer=true removes the old layer and embeds the OCR text', async () => {
		const out = await buildSearchablePdf(srcBytes, pages, true);
		const t = extractText(out);
		expect(t).not.toContain(OLD);
		expect(t).toContain(NEW);
	});

	it('replaceTextLayer=false keeps the old layer and appends the OCR text', async () => {
		const out = await buildSearchablePdf(srcBytes, pages, false);
		const t = extractText(out);
		expect(t).toContain(OLD);
		expect(t).toContain(NEW);
	});

	it('produces a valid PDF that reopens with the same page count', async () => {
		const out = await buildSearchablePdf(srcBytes, pages, true);
		const reopened = await PDFDocument.load(out);
		expect(reopened.getPageCount()).toBe(1);
	});
});
