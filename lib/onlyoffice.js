/**
 * Optional OnlyOffice Document Server integration (Word-accurate view/edit).
 * Set ONLYOFFICE_DOCUMENT_SERVER_URL + PUBLIC_APP_URL (+ callback secret) in .env.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function docServerBase() {
  return (process.env.ONLYOFFICE_DOCUMENT_SERVER_URL || '').trim().replace(/\/$/, '');
}

function publicAppBase() {
  return (process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
}

function isOnlyOfficeEnabled() {
  return Boolean(docServerBase() && publicAppBase());
}

function callbackSecret() {
  return process.env.ONLYOFFICE_CALLBACK_SECRET || 'dev-onlyoffice-callback-change-in-production';
}

function documentCacheKey(diskPath) {
  let stamp = String(Date.now());
  try {
    stamp = String(fs.statSync(diskPath).mtimeMs);
  } catch (_) {}
  return crypto.createHash('sha256').update(stamp + diskPath).digest('hex').slice(0, 24);
}

/**
 * @param {{ id: number, title: string | null, file_path: string }} doc
 * @param {string} rootDir project root (dirname of server)
 */
function buildEditorConfig(doc, rootDir) {
  const rel = doc.file_path.startsWith('/') ? doc.file_path : `/${doc.file_path}`;
  const disk = path.join(rootDir, rel.replace(/^\//, ''));
  const key = `${doc.id}-${documentCacheKey(disk)}`;
  const base = publicAppBase();
  const m = /\.([^.]+)$/i.exec(rel);
  const fileType = (m ? m[1] : 'docx').toLowerCase();
  const documentUrl = `${base}${rel}`;
  const secret = callbackSecret();
  const callbackUrl = `${base}/api/documents/${doc.id}/onlyoffice-callback?token=${encodeURIComponent(secret)}`;

  let title = (doc.title && String(doc.title).trim()) || 'document';
  title = title.replace(/[/\\?%*:|"<>]+/g, '').slice(0, 200) || 'document';
  const ext = path.extname(rel) || '.docx';
  if (!title.toLowerCase().endsWith(ext.toLowerCase())) {
    title += ext;
  }

  return {
    type: 'desktop',
    width: '100%',
    height: '100%',
    documentType: 'word',
    document: {
      fileType,
      key,
      title,
      url: documentUrl,
    },
    editorConfig: {
      mode: 'edit',
      lang: 'en-US',
      callbackUrl,
      user: { id: 'ocean-teacher', name: 'Teacher' },
    },
  };
}

function normalizeDownloadUrl(downloadUrl, docServerBaseUrl) {
  if (!downloadUrl || !docServerBaseUrl) return downloadUrl;
  try {
    const u = new URL(downloadUrl);
    if (u.hostname === 'onlyoffice' || u.hostname === 'documentserver') {
      const b = new URL(docServerBaseUrl.endsWith('/') ? docServerBaseUrl : `${docServerBaseUrl}/`);
      return `${b.origin}${u.pathname}${u.search}`;
    }
  } catch (_) {}
  return downloadUrl;
}

/**
 * Persist edited file from OnlyOffice callback.
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function saveFromCallback({ rootDir, pool, documentId, body, fetchImpl = fetch }) {
  const status = body && body.status;
  if (status !== 2 && status !== 6) {
    return { ok: true };
  }
  const downloadUrl = body.url;
  if (!downloadUrl) {
    return { ok: true };
  }

  const { rows } = await pool.query('SELECT id, file_path FROM class_documents WHERE id = $1', [documentId]);
  if (!rows.length) {
    return { ok: false, message: 'document not found' };
  }
  const rel = rows[0].file_path.startsWith('/') ? rows[0].file_path : `/${rows[0].file_path}`;
  const disk = path.join(rootDir, rel.replace(/^\//, ''));

  const fixedUrl = normalizeDownloadUrl(downloadUrl, docServerBase());
  const res = await fetchImpl(fixedUrl, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) {
    return { ok: false, message: `download failed ${res.status}` };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.writeFile(disk, buf);
  return { ok: true };
}

module.exports = {
  isOnlyOfficeEnabled,
  docServerBase,
  publicAppBase,
  callbackSecret,
  buildEditorConfig,
  saveFromCallback,
};
