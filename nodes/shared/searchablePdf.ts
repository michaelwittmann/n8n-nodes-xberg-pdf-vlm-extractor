import {
	PDFArray,
	PDFDocument,
	PDFName,
	PDFRawStream,
	StandardFonts,
	decodePDFRawStream,
	type PDFContext,
	type PDFFont,
	type PDFPage,
	type PDFPageLeaf,
	type PDFRef,
} from 'pdf-lib';

import type { PageContent } from '@xberg-io/xberg';

/**
 * Build a "searchable" PDF by overlaying the OCR'd text onto the original
 * pages as an invisible layer.
 *
 * xberg's VLM OCR returns plain text per page but **no per-word coordinates**,
 * so a pixel-accurate overlay is impossible. Instead we flow each page's text
 * in reading order, word-wrapped to the page width, and draw it fully
 * transparent (`opacity: 0`). The glyphs are invisible but remain part of the
 * page's text content, so a PDF viewer's full-text search (Ctrl+F) and any
 * downstream text extraction find the words and land on the correct page.
 * Exact word-level highlight positions are intentionally not guaranteed.
 *
 * When `replaceTextLayer` is true (the default), each page's existing
 * text-showing operators are stripped before the OCR layer is drawn, so a PDF
 * that already carries a (possibly wrong) text layer doesn't end up with two
 * overlapping layers. Graphics and images are left untouched. If a page's
 * content stream can't be safely rewritten, that page falls back to
 * append-only and the rest of the document is unaffected.
 *
 * WinAnsi (the StandardFonts encoding) cannot encode every Unicode codepoint
 * the VLM may emit, so characters outside its range are stripped per line to
 * avoid pdf-lib throwing mid-draw. Searchability of the ASCII/Latin-1 body is
 * unaffected.
 */
export async function buildSearchablePdf(
	originalBytes: Uint8Array,
	pages: PageContent[],
	replaceTextLayer = true,
): Promise<Uint8Array> {
	const pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
	const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

	const docPages = pdfDoc.getPages();

	// Map xberg's 1-indexed pageNumber onto the pdf-lib page array.
	const contentByPage = new Map<number, string>();
	for (const page of pages) {
		if (typeof page.pageNumber === 'number' && typeof page.content === 'string') {
			contentByPage.set(page.pageNumber, page.content);
		}
	}

	for (let i = 0; i < docPages.length; i++) {
		if (replaceTextLayer) {
			// Best-effort: never let a strip failure abort the whole rebuild.
			try {
				stripTextOperators(docPages[i]);
			} catch {
				// Leave this page's original text in place and append on top.
			}
		}

		const text = contentByPage.get(i + 1);
		if (!text || text.trim().length === 0) {
			continue;
		}
		drawInvisibleText(docPages[i], font, text);
	}

	return pdfDoc.save();
}

/**
 * Remove every text-showing operator from a page's content stream(s) while
 * preserving all other content (paths, images, graphics state). pdf-lib has no
 * public API for this, so we decode each raw content stream, filter its token
 * stream, and write a cleaned, uncompressed stream back in place.
 *
 * We drop the four PDF text-show operators — `Tj`, `TJ`, `'`, `"` — along with
 * their operands, and also the enclosing `BT`/`ET` and intra-block text-state
 * operators so no dangling operands remain. Everything outside `BT…ET` is
 * copied verbatim.
 */
function stripTextOperators(page: PDFPage): void {
	const leaf = page.node as PDFPageLeaf;
	const context = leaf.context;
	const contents = leaf.Contents();
	if (!contents) {
		return;
	}

	const streamRefs: PDFRef[] = [];
	if (contents instanceof PDFArray) {
		for (let i = 0; i < contents.size(); i++) {
			const ref = contents.get(i);
			if (ref) {
				streamRefs.push(ref as PDFRef);
			}
		}
	} else {
		// `Contents` resolved to the stream object itself; find its ref.
		const ref = leaf.get(PDFName.of('Contents'));
		if (ref) {
			streamRefs.push(ref as PDFRef);
		}
	}

	for (const ref of streamRefs) {
		const stream = context.lookup(ref);
		if (!(stream instanceof PDFRawStream)) {
			continue;
		}
		const decoded = decodePDFRawStream(stream).decode();
		const source = latin1Decode(decoded);
		const cleaned = removeTextShowOps(source);
		replaceStream(context, ref, cleaned);
	}
}

/** Replace the object at `ref` with a new uncompressed raw content stream. */
function replaceStream(context: PDFContext, ref: PDFRef, content: string): void {
	const bytes = latin1Encode(content);
	const dict = context.obj({ Length: bytes.length });
	const newStream = PDFRawStream.of(dict, bytes);
	context.assign(ref, newStream);
}

/**
 * Token-level filter over a PDF content stream. Copies tokens through until a
 * `BT` (begin text) is seen, then suppresses everything up to and including the
 * matching `ET`. This cleanly removes all text-show and text-state operators
 * plus their operands in one pass, without needing to understand each operator.
 * String (`(...)` / `<...>`) and array (`[...]`) literals are tokenised so that
 * parentheses/brackets inside strings never confuse the `BT`/`ET` tracking.
 */
function removeTextShowOps(source: string): string {
	let out = '';
	let i = 0;
	let depthText = 0; // >0 while inside a BT…ET block (suppressing output)
	const n = source.length;

	const append = (s: string) => {
		if (depthText === 0) {
			out += s;
		}
	};

	while (i < n) {
		const ch = source[i];

		// Comment: copy to end of line.
		if (ch === '%') {
			let j = i;
			while (j < n && source[j] !== '\n' && source[j] !== '\r') j++;
			append(source.slice(i, j));
			i = j;
			continue;
		}

		// Literal string: ( ... ) with balanced parens and backslash escapes.
		if (ch === '(') {
			let j = i + 1;
			let depth = 1;
			while (j < n && depth > 0) {
				const c = source[j];
				if (c === '\\') {
					j += 2;
					continue;
				}
				if (c === '(') depth++;
				else if (c === ')') depth--;
				j++;
			}
			append(source.slice(i, j));
			i = j;
			continue;
		}

		// Hex string: < ... >  (but not the << dict delimiter).
		if (ch === '<' && source[i + 1] !== '<') {
			let j = i + 1;
			while (j < n && source[j] !== '>') j++;
			j++; // include '>'
			append(source.slice(i, j));
			i = j;
			continue;
		}

		// Whitespace / other single chars: copy as-is.
		if (!isTokenChar(ch)) {
			append(ch);
			i++;
			continue;
		}

		// A bare token (operator or operand keyword/number/name).
		let j = i;
		while (j < n && isTokenChar(source[j])) j++;
		const token = source.slice(i, j);

		if (token === 'BT') {
			depthText++;
			i = j;
			continue;
		}
		if (token === 'ET') {
			if (depthText > 0) depthText--;
			i = j;
			continue;
		}

		append(token);
		i = j;
	}

	return out;
}

/** Characters that can appear in a bare PDF token (operator/operand keyword). */
function isTokenChar(ch: string): boolean {
	// Anything that isn't whitespace or a delimiter.
	if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f' || ch === '\0') {
		return false;
	}
	return !'()<>[]{}/%'.includes(ch);
}

/** Decode raw bytes as latin1 so byte values survive a round-trip unchanged. */
function latin1Decode(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i++) {
		s += String.fromCharCode(bytes[i]);
	}
	return s;
}

/** Encode a latin1 string back to bytes. */
function latin1Encode(s: string): Uint8Array {
	const bytes = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) {
		bytes[i] = s.charCodeAt(i) & 0xff;
	}
	return bytes;
}

/**
 * Flow `text` onto a single page as invisible, selectable glyphs. Lines are
 * wrapped to the page width and the layer is clipped to the page height; any
 * overflow is dropped (the text still lives in the item's JSON output in full).
 */
function drawInvisibleText(page: PDFPage, font: PDFFont, text: string): void {
	const { width, height } = page.getSize();
	const fontSize = 8;
	const lineHeight = fontSize * 1.15;
	const margin = 24;
	const maxWidth = Math.max(width - margin * 2, 1);

	const lines: string[] = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const sanitized = sanitizeForWinAnsi(rawLine);
		if (sanitized.trim().length === 0) {
			lines.push('');
			continue;
		}
		lines.push(...wrapLine(sanitized, font, fontSize, maxWidth));
	}

	let y = height - margin;
	for (const line of lines) {
		if (y < margin) {
			break;
		}
		if (line.length > 0) {
			page.drawText(line, {
				x: margin,
				y,
				size: fontSize,
				font,
				opacity: 0,
			});
		}
		y -= lineHeight;
	}
}

/** Greedy word-wrap of a single logical line to `maxWidth` points. */
function wrapLine(line: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
	const words = line.split(/\s+/).filter((w) => w.length > 0);
	if (words.length === 0) {
		return [];
	}

	const wrapped: string[] = [];
	let current = '';
	for (const word of words) {
		const candidate = current.length === 0 ? word : `${current} ${word}`;
		if (widthOf(font, candidate, fontSize) <= maxWidth || current.length === 0) {
			current = candidate;
		} else {
			wrapped.push(current);
			current = word;
		}
	}
	if (current.length > 0) {
		wrapped.push(current);
	}
	return wrapped;
}

/** Measure text width, tolerating any encoding hiccup. */
function widthOf(font: PDFFont, text: string, fontSize: number): number {
	try {
		return font.widthOfTextAtSize(text, fontSize);
	} catch {
		return Number.MAX_SAFE_INTEGER;
	}
}

/**
 * Drop characters the StandardFonts WinAnsi encoding can't represent. Keeps
 * printable ASCII and the Latin-1 supplement; replaces the rest with a space so
 * word boundaries (and search hits on the surrounding words) survive.
 */
function sanitizeForWinAnsi(text: string): string {
	let out = '';
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;
		if (code === 0x09 || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
			out += ch;
		} else {
			out += ' ';
		}
	}
	return out;
}
