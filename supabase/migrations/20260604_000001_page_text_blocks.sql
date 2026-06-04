-- Persist per-page text-block bounding boxes from the pdfminer text layer.
--
-- Each element of the JSON array is { "t": <block text>, "bbox": [left, top,
-- right, bottom] } with coordinates NORMALISED to 0..1 and a TOP-LEFT origin,
-- so a frontend can draw a highlight overlay on a rendered page image without
-- the PDF's point size. Only populated for text-layer pages — scanned / OCR'd
-- pages have no reliable text-layer coordinates and leave this NULL.
--
-- Additive + nullable: nothing reads it yet. It captures the block coordinates
-- pdfminer already hands us (and that the extractor used to throw away),
-- enabling future grounded citations / answer highlighting for text PDFs
-- without a vision model.

alter table public.document_pages
  add column if not exists text_blocks jsonb;
