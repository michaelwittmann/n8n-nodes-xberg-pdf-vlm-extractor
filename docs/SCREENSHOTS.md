# Screenshot capture guide

The README references the images below. They aren't committed yet — capture
them from your local dev instance (`npm run dev` → http://localhost:5678) and
drop them in this folder with the exact filenames so the README picks them up.

A clean, readable screenshot: light theme, default zoom, crop tight to the
relevant panel (no OS chrome), export as PNG, keep width ≤ 1600px.

| Filename | Status | What to capture |
| --- | --- | --- |
| `nodes-panel-ocr.png` | ✅ added | The n8n **nodes panel** with "PDF" typed in search, showing **PDF OCR** with its description. |
| `nodes-panel-extractor.png` | ✅ added | The n8n **nodes panel** with "PDF Field Extractor" typed in search, showing that node with its description. |
| `workflow-canvas.png` | ✅ added | The example workflow on the canvas: **Execute Workflow → HTTP Request → PDF OCR → PDF Field Extractor**. |
| `pdf-ocr-config.jpg` | ✅ added | The **PDF OCR** node open, showing Provider = Ollama, a Model chosen from the dropdown, and **Replace Existing Text Layer** on. |
| `field-extractor-config.jpg` | ✅ added | The **PDF Field Extractor** node open, showing the **JSON Schema** field with the invoice schema and the **Options → Schema Description**. |

Optional but nice:

| Filename | What to capture |
| --- | --- |
| `searchable-pdf-ctrlf.png` | The downloaded output PDF opened in a viewer with **Ctrl/Cmd+F** finding a word — proves the invisible text layer is searchable. |

After adding images, run `npm run build` isn't needed — they're docs only. Just
commit the PNGs alongside the README.
