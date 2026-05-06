-- Track why a document failed processing so users can see the reason
alter table public.documents
  add column if not exists processing_error text;
