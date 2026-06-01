const path = require('path');
const fs = require('fs');

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function safePassportExt(originalname) {
  const ext = (path.extname(path.basename(originalname || '')) || '.jpg').toLowerCase();
  return ALLOWED_EXT.has(ext) ? ext : '.jpg';
}

/** Original upload base name (no extension) must be ≤ 40 characters. */
function originalBasenameWithinLimit(originalname, ext) {
  const base = path.basename(originalname || '', ext);
  return base.length <= 40;
}

function photoBasenameFromFullName(fullName) {
  const s = String(fullName || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  const out = s.slice(0, 40);
  return out || 'learner';
}

/**
 * Renames multer temp upload to `/uploads/students/{slug(full_name)}{ext}`.
 * @returns {{ ok: true, passportPath: string } | { ok: false, status: number, error: string }}
 */
async function finalizeStudentPassport({
  pool,
  file,
  fullName,
  studentPhotosDir,
  excludeStudentId,
  previousPassportPath,
}) {
  if (!file) return { ok: true, passportPath: null };

  const ext = safePassportExt(file.originalname);
  if (!originalBasenameWithinLimit(file.originalname, ext)) {
    try {
      fs.unlinkSync(file.path);
    } catch (_) {}
    return {
      ok: false,
      status: 400,
      error:
        'The photo file name (without extension) must be 40 characters or fewer. Rename the file or pick another image.',
    };
  }

  const base = photoBasenameFromFullName(fullName);
  const fname = `${base}${ext}`;
  const rel = `/uploads/students/${fname}`;
  const destAbs = path.join(studentPhotosDir, fname);

  let q = 'SELECT id FROM students WHERE passport_path = $1';
  const params = [rel];
  if (excludeStudentId != null) {
    q += ' AND id <> $2';
    params.push(excludeStudentId);
  }
  const { rows: clash } = await pool.query(q, params);
  if (clash.length) {
    try {
      fs.unlinkSync(file.path);
    } catch (_) {}
    return {
      ok: false,
      status: 409,
      error:
        'Another child already has a passport photo saved under this file name. Change the learner’s name slightly or use a different photo file name.',
    };
  }

  const inPlaceReplace =
    excludeStudentId != null && previousPassportPath === rel && fs.existsSync(destAbs);

  if (fs.existsSync(destAbs) && !inPlaceReplace) {
    try {
      fs.unlinkSync(file.path);
    } catch (_) {}
    return {
      ok: false,
      status: 409,
      error:
        'A passport photo with this file name already exists on the server for another learner. Choose a different name or photo.',
    };
  }

  if (inPlaceReplace) {
    try {
      fs.unlinkSync(destAbs);
    } catch (_) {}
  }

  try {
    fs.renameSync(file.path, destAbs);
  } catch (e) {
    try {
      fs.unlinkSync(file.path);
    } catch (_) {}
    return { ok: false, status: 500, error: 'Could not save passport photo.' };
  }

  return { ok: true, passportPath: rel };
}

function unlinkPassportIfOwned(absRoot, passportPath) {
  if (!passportPath || typeof passportPath !== 'string') return;
  if (!passportPath.startsWith('/uploads/students/')) return;
  const disk = path.join(absRoot, passportPath.replace(/^\//, ''));
  try {
    if (fs.existsSync(disk)) fs.unlinkSync(disk);
  } catch (_) {}
}

module.exports = {
  safePassportExt,
  originalBasenameWithinLimit,
  photoBasenameFromFullName,
  finalizeStudentPassport,
  unlinkPassportIfOwned,
};
