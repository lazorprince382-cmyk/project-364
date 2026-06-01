-- Run after initial schema: adds school-wide skill documents (skill teachers).
-- Safe to run multiple times.

ALTER TABLE class_documents
  ADD COLUMN IF NOT EXISTS document_scope TEXT NOT NULL DEFAULT 'class';

UPDATE class_documents SET document_scope = 'class' WHERE document_scope IS NULL;

ALTER TABLE class_documents
  DROP CONSTRAINT IF EXISTS class_documents_document_scope_check;

ALTER TABLE class_documents
  ADD CONSTRAINT class_documents_document_scope_check
  CHECK (document_scope IN ('class', 'all_classes'));

ALTER TABLE class_documents ALTER COLUMN class_level DROP NOT NULL;
