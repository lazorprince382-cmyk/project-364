-- Allow typed workspace notes to be stored as document files
ALTER TABLE class_documents
  DROP CONSTRAINT IF EXISTS class_documents_doc_type_check;

ALTER TABLE class_documents
  ADD CONSTRAINT class_documents_doc_type_check
  CHECK (doc_type IN ('scheme', 'work', 'note'));
