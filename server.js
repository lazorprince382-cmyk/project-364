require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { pool } = require('./db/pool');
const { writePdfFromImageFile } = require('./lib/imageToPdf');
const { primaryAggregateFromMarkRows } = require('./lib/primaryDivision');
const oo = require('./lib/onlyoffice');
const { polishComment } = require('./lib/commentAssist');
const { finalizeStudentPassport, unlinkPassportIfOwned } = require('./lib/studentPhoto');
const { subjectsForClassLevel } = require('./lib/oceanSubjects');
const {
  hashPassword,
  verifyPassword,
  signStaffSession,
  verifyStaffSession,
  bearerToken,
} = require('./lib/staffAuth');
const { computeSubjectProgress } = require('./lib/directorAnalytics');

/** Skill subjects (Skills dashboard; class note uploads exclude these). */
const SKILL_SUBJECTS = ['Computer', 'Salon', 'Bakery', 'Fashion and Design', 'Music'];

const PRIMARY_LEVELS = ['primary1', 'primary2'];
const REPORT_PERIODS = ['begin', 'mid', 'end'];

function isPrimaryLevel(cl) {
  const key = String(cl || '').trim().toLowerCase();
  return PRIMARY_LEVELS.includes(key) || key.startsWith('primary');
}

function isValidReportPeriod(period) {
  return REPORT_PERIODS.includes(String(period || '').trim().toLowerCase());
}

function normalizeReportPeriod(period, fallback) {
  const next = String(period || '')
    .trim()
    .toLowerCase();
  return isValidReportPeriod(next) ? next : fallback || 'mid';
}

const DEFAULT_CLASS_CATALOG = [
  {
    id: 'daycare',
    title: 'Day Care',
    needsStream: false,
    streams: [],
    isPrimary: false,
  },
  {
    id: 'baby',
    title: 'Baby Class',
    needsStream: true,
    streams: ['waves', 'pearls'],
    isPrimary: false,
  },
  {
    id: 'middle',
    title: 'Middle Class',
    needsStream: true,
    streams: ['dolphins', 'whales'],
    isPrimary: false,
  },
  {
    id: 'top',
    title: 'Top Class',
    needsStream: false,
    streams: [],
    isPrimary: false,
  },
  {
    id: 'primary1',
    title: 'Primary One',
    needsStream: false,
    streams: [],
    isPrimary: true,
  },
  {
    id: 'primary2',
    title: 'Primary Two',
    needsStream: false,
    streams: [],
    isPrimary: true,
  },
];

function normalizeClassSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeClassCatalogEntry(raw) {
  const id = normalizeClassSlug(raw && raw.id);
  const title = String((raw && raw.title) || '').trim();
  if (!id || !title) return null;
  const isPrimary = !!(raw && raw.isPrimary);
  const streams = Array.isArray(raw && raw.streams)
    ? raw.streams
        .map((s) => normalizeClassStream(s).toLowerCase())
        .filter((s, i, arr) => s && arr.indexOf(s) === i)
    : [];
  const subjects = Array.isArray(raw && raw.subjects)
    ? raw.subjects
        .map((s) => String(s || '').trim())
        .filter((s, i, arr) => s && arr.indexOf(s) === i)
    : [];
  return {
    id,
    title,
    needsStream: streams.length > 0,
    streams,
    isPrimary,
    subjects,
  };
}

async function loadCustomClassCatalog() {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'custom_class_catalog'`);
  if (!rows.length || !Array.isArray(rows[0].value)) return [];
  return rows[0].value.map(normalizeClassCatalogEntry).filter(Boolean);
}

async function mergedClassCatalog() {
  const custom = await loadCustomClassCatalog();
  const defaults = DEFAULT_CLASS_CATALOG.map((x) => ({
    id: x.id,
    title: x.title,
    needsStream: x.needsStream,
    streams: x.streams.slice(),
    isPrimary: !!x.isPrimary,
    isCustom: false,
    subjects: subjectsForClassLevel(x.id),
  }));
  return defaults.concat(
    custom.map((x) => ({
      ...x,
      isCustom: true,
    }))
  );
}

async function subjectsForClassLevelDynamic(classLevel) {
  const cl = String(classLevel || '').trim().toLowerCase();
  const native = subjectsForClassLevel(cl);
  if (native.length) return native;
  const all = await mergedClassCatalog();
  const match = all.find((x) => x.id === cl);
  if (!match) return [];
  if (Array.isArray(match.subjects) && match.subjects.length) return match.subjects.slice();
  return isPrimaryLevel(cl) || match.isPrimary ? subjectsForClassLevel('primary2') : [];
}

function normalizeGradingBands(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => ({
      min: Number(b.min),
      max: Number(b.max),
      agg: String(b.agg != null ? b.agg : '').trim(),
      remark: String(b.remark != null ? b.remark : '').trim(),
    }))
    .filter((b) => !Number.isNaN(b.min) && !Number.isNaN(b.max) && b.min <= b.max);
}

async function getGradingBands() {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'primary_grading_scale'`);
  if (!rows.length) return [];
  const v = rows[0].value;
  if (Array.isArray(v)) return normalizeGradingBands(v);
  if (v && Array.isArray(v.bands)) return normalizeGradingBands(v.bands);
  return [];
}

/** Bands min/max are percentages (0–100). Each mark is scored out of 100 (stored full_marks is always 100). Division is learner-level — see GET /api/marks/aggregate. */
function gradeFromPercent(percent, bands) {
  const n = Number(percent);
  if (Number.isNaN(n)) return { agg: '', remark: '' };
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (n >= b.min && n <= b.max) {
      return { agg: b.agg, remark: b.remark };
    }
  }
  return { agg: '', remark: '' };
}

/** Division is not stored per subject — clear legacy `division` values on this snapshot when marks change. */
async function clearStoredMarkDivisions(studentId, termNum, period, academicYear) {
  await pool.query(
    `UPDATE student_subject_marks SET division = '', updated_at = NOW()
     WHERE student_id = $1 AND term = $2 AND period = $3 AND academic_year = $4`,
    [studentId, termNum, period, academicYear]
  );
}

function reportWorkflowKey(classLevel, stream, term, period) {
  const cl = String(classLevel || '').trim();
  const st = normalizeClassStream(stream);
  return `report_workflow_${cl}_${st || '_'}_${Number(term)}_${period}`;
}

async function getReportWorkflowState(classLevel, stream, term, period) {
  const key = reportWorkflowKey(classLevel, stream, term, period);
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
  const base = { locked: false, approvalState: 'draft', updatedAt: '', updatedBy: '' };
  if (!rows.length || !rows[0].value || typeof rows[0].value !== 'object') return base;
  const v = rows[0].value;
  return {
    locked: !!v.locked,
    approvalState: ['draft', 'submitted', 'approved'].includes(String(v.approvalState))
      ? String(v.approvalState)
      : 'draft',
    updatedAt: v.updatedAt ? String(v.updatedAt) : '',
    updatedBy: v.updatedBy ? String(v.updatedBy) : '',
  };
}

async function setReportWorkflowState(classLevel, stream, term, period, patch, actor) {
  const cur = await getReportWorkflowState(classLevel, stream, term, period);
  const next = Object.assign({}, cur, patch || {});
  if (!['draft', 'submitted', 'approved'].includes(String(next.approvalState))) next.approvalState = 'draft';
  next.locked = !!next.locked;
  next.updatedAt = new Date().toISOString();
  next.updatedBy = actor || 'class_teacher';
  const key = reportWorkflowKey(classLevel, stream, term, period);
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(next)]
  );
  return next;
}

async function isReportLocked(classLevel, stream, term, period) {
  const st = await getReportWorkflowState(classLevel, stream, term, period);
  return !!st.locked;
}

const STAFF_SYSTEM_LOCK_KEY = 'staff_system_lock';

async function getStaffSystemLockState() {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [STAFF_SYSTEM_LOCK_KEY]);
  const base = { locked: false, updatedAt: '', updatedBy: '' };
  if (!rows.length || !rows[0].value || typeof rows[0].value !== 'object') return base;
  const v = rows[0].value;
  return {
    locked: !!v.locked,
    updatedAt: v.updatedAt ? String(v.updatedAt) : '',
    updatedBy: v.updatedBy ? String(v.updatedBy) : '',
  };
}

async function setStaffSystemLockState(locked, actorStaffId) {
  const next = {
    locked: !!locked,
    updatedAt: new Date().toISOString(),
    updatedBy: actorStaffId != null ? String(actorStaffId) : '',
  };
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [STAFF_SYSTEM_LOCK_KEY, JSON.stringify(next)]
  );
  return next;
}

async function isStaffSystemLocked() {
  const st = await getStaffSystemLockState();
  return !!st.locked;
}

async function appendReportAudit(entry) {
  try {
    await pool.query(
      `INSERT INTO report_audit_log
        (class_level, stream, student_id, term, period, action, entity_type, subject, old_value, new_value, actor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,
      [
        entry.classLevel || '',
        normalizeClassStream(entry.stream),
        entry.studentId || null,
        entry.term || null,
        entry.period || null,
        entry.action || '',
        entry.entityType || '',
        entry.subject || null,
        JSON.stringify(entry.oldValue || {}),
        JSON.stringify(entry.newValue || {}),
        entry.actor || 'class_teacher',
      ]
    );
  } catch (err) {
    if (err && (err.code === '42P01' || err.code === '42703')) return;
    console.warn('[report_audit]', err && err.message ? err.message : err);
  }
}

function resolveReportActor(req, fallback = 'class_teacher') {
  const s = req && req.staffSession;
  if (s && s.role) {
    const role = String(s.role);
    if (role === 'skill_teacher' || role === 'head_teacher' || role === 'director' || role === 'system_admin' || role === 'ghost') {
      return role === 'system_admin' || role === 'ghost' ? 'director' : role;
    }
    return 'class_teacher';
  }
  return fallback;
}

function optionalStaffSession(req, res, next) {
  const token = bearerToken(req);
  const payload = verifyStaffSession(token);
  if (payload && payload.id) {
    req.staffSession = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      display_name: payload.display_name,
      class_level: payload.class_level,
      stream: payload.stream || '',
    };
  }
  next();
}

const PORT = process.env.PORT || 3000;
const app = express();

const ROOT = __dirname;
const UPLOADS = path.join(ROOT, 'uploads');
const STUDENT_PHOTOS = path.join(UPLOADS, 'students');
const NOTES = path.join(UPLOADS, 'notes');
const PROFILES = path.join(UPLOADS, 'profiles');
const CLASS_MESSAGES = path.join(UPLOADS, 'class-messages');

[UPLOADS, STUDENT_PHOTOS, NOTES, PROFILES, CLASS_MESSAGES].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(
  '/uploads',
  express.static(UPLOADS, {
    setHeaders(res, filePath) {
      const low = String(filePath || '').toLowerCase();
      if (low.endsWith('.webm')) res.setHeader('Content-Type', 'audio/webm');
      else if (low.endsWith('.ogg')) res.setHeader('Content-Type', 'audio/ogg');
      else if (low.endsWith('.m4a') || low.endsWith('.mp4')) res.setHeader('Content-Type', 'audio/mp4');
      else if (low.endsWith('.mp3')) res.setHeader('Content-Type', 'audio/mpeg');
      else if (low.endsWith('.wav')) res.setHeader('Content-Type', 'audio/wav');
    },
  })
);

const storageStudents = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, STUDENT_PHOTOS),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
    cb(null, safe);
  },
});

const storageNotes = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, NOTES),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`;
    cb(null, safe);
  },
});

const uploadStudent = multer({
  storage: storageStudents,
  limits: { fileSize: 8 * 1024 * 1024 },
});
const uploadNote = multer({
  storage: storageNotes,
  limits: { fileSize: 15 * 1024 * 1024 },
});

const storageProfile = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PROFILES),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const safe = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, safe);
  },
});

const uploadProfile = multer({
  storage: storageProfile,
  limits: { fileSize: 4 * 1024 * 1024 },
});

const storageClassMessage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, CLASS_MESSAGES),
  filename: (_req, file, cb) => {
    const ext = path.extname(path.basename(file.originalname || '')) || '';
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    cb(null, safe);
  },
});

const uploadClassMessage = multer({
  storage: storageClassMessage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

function normalizeClassStream(stream) {
  if (stream === undefined || stream === null) return '';
  return String(stream).trim();
}

async function currentReportingYear() {
  const nowYear = new Date().getFullYear();
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'school_reporting_context'`);
    if (!rows.length || !rows[0].value || typeof rows[0].value !== 'object') return nowYear;
    const y = Number(rows[0].value.year);
    return Number.isFinite(y) && y >= 2000 && y <= 2100 ? y : nowYear;
  } catch (_) {
    return nowYear;
  }
}

async function resolveAcademicYear(rawYear) {
  const y = Number(rawYear);
  if (Number.isFinite(y) && y >= 2000 && y <= 2100) return y;
  return currentReportingYear();
}

function sameClassStream(aClass, aStream, bClass, bStream) {
  return (
    String(aClass || '').trim().toLowerCase() === String(bClass || '').trim().toLowerCase() &&
    String(aStream || '').trim().toLowerCase() === String(bStream || '').trim().toLowerCase()
  );
}

function classStreamMatchesRequested(classLevel, stream, rowClass, rowStream) {
  if (String(classLevel || '').trim().toLowerCase() !== String(rowClass || '').trim().toLowerCase()) return false;
  const reqStream = normalizeClassStream(stream);
  const rowKey = normalizeClassStream(rowStream);
  if (reqStream) return String(reqStream).toLowerCase() === String(rowKey).toLowerCase();
  return !rowKey;
}

async function rosterStudentsForClassYear(classLevel, stream, year, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const studentId = Number(options.studentId);
  const hasStudentId = Number.isFinite(studentId) && !Number.isNaN(studentId);
  const targetYear = Number(year);
  const currentYear = await currentReportingYear();

  const baseParams = [];
  let baseFilter = '';
  if (hasStudentId) {
    baseFilter = 'WHERE id = $1';
    baseParams.push(studentId);
  }
  const { rows: studentRows } = await pool.query(
    `SELECT id, full_name, reg_no, class_level, COALESCE(NULLIF(TRIM(stream), ''), '') AS stream, passport_path
     FROM students ${baseFilter}
     ORDER BY full_name ASC`,
    baseParams
  );
  if (!studentRows.length) return [];

  const byId = new Map();
  studentRows.forEach((s) => {
    byId.set(Number(s.id), {
      id: s.id,
      full_name: s.full_name,
      reg_no: s.reg_no,
      passport_path: s.passport_path,
      class_level: s.class_level,
      stream: normalizeClassStream(s.stream),
    });
  });

  if (Number.isFinite(targetYear) && targetYear < currentYear) {
    const ids = Array.from(byId.keys());
    if (ids.length) {
      const { rows: hist } = await pool.query(
        `SELECT id, student_id, from_class_level, COALESCE(NULLIF(TRIM(from_stream), ''), '') AS from_stream,
                to_class_level, COALESCE(NULLIF(TRIM(to_stream), ''), '') AS to_stream, to_year, created_at
         FROM student_class_history
         WHERE student_id = ANY($1::int[]) AND to_year > $2
         ORDER BY created_at DESC, id DESC`,
        [ids, targetYear]
      );
      hist.forEach((h) => {
        const cur = byId.get(Number(h.student_id));
        if (!cur) return;
        if (sameClassStream(cur.class_level, cur.stream, h.to_class_level, h.to_stream)) {
          cur.class_level = String(h.from_class_level || '').trim();
          cur.stream = normalizeClassStream(h.from_stream);
        }
      });
    }
  }

  return Array.from(byId.values())
    .filter((s) => classStreamMatchesRequested(classLevel, stream, s.class_level, s.stream))
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
}

function nextPromotionTargetForStudent(classLevel, stream, catalog, studentId) {
  const cl = String(classLevel || '').trim().toLowerCase();
  const st = normalizeClassStream(stream).toLowerCase();
  const byId = {};
  (catalog || []).forEach((c) => {
    byId[String(c.id || '').toLowerCase()] = c;
  });
  function streamForTarget(targetId, preferred) {
    const cfg = byId[String(targetId || '').toLowerCase()];
    if (!cfg || !cfg.needsStream) return '';
    const list = Array.isArray(cfg.streams) ? cfg.streams : [];
    if (!list.length) return '';
    if (preferred && list.indexOf(preferred) !== -1) return preferred;
    if (list.length >= 2 && Number.isFinite(Number(studentId))) {
      const idx = Math.abs(Number(studentId)) % list.length;
      return list[idx] || list[0];
    }
    return list[0];
  }
  if (cl === 'daycare' && byId.baby) return { classLevel: 'baby', stream: streamForTarget('baby', '') };
  if (cl === 'baby' && byId.middle) {
    const mapped = st === 'pearls' ? 'whales' : st === 'waves' ? 'dolphins' : '';
    return { classLevel: 'middle', stream: streamForTarget('middle', mapped) };
  }
  if (cl === 'middle' && byId.top) return { classLevel: 'top', stream: '' };
  if (cl === 'top' && byId.primary1) return { classLevel: 'primary1', stream: '' };
  if (cl === 'primary1' && byId.primary2) return { classLevel: 'primary2', stream: '' };

  const m = /^primary(\d+)$/.exec(cl);
  if (m) {
    const nextId = 'primary' + (Number(m[1]) + 1);
    if (byId[nextId]) return { classLevel: nextId, stream: '' };
  }
  return { classLevel: cl, stream: st };
}

async function runAutomaticPromotionForYear(targetYear, actorRole, actorId, dbClient) {
  const y = Number(targetYear);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) return { moved: 0, skipped: true, reason: 'invalid_year' };
  const q = dbClient || pool;
  const catalog = await mergedClassCatalog();
  const { rows: learners } = await q.query(
    `SELECT id, class_level, COALESCE(NULLIF(TRIM(stream), ''), '') AS stream FROM students ORDER BY id`
  );
  let moved = 0;
  for (const st of learners) {
    const next = nextPromotionTargetForStudent(st.class_level, st.stream, catalog, st.id);
    if (
      String(next.classLevel || '').trim().toLowerCase() === String(st.class_level || '').trim().toLowerCase() &&
      String(next.stream || '').trim().toLowerCase() === String(st.stream || '').trim().toLowerCase()
    ) {
      continue;
    }
    await q.query(`UPDATE students SET class_level = $2, stream = $3, updated_at = NOW() WHERE id = $1`, [
      st.id,
      next.classLevel,
      next.stream || null,
    ]);
    await q.query(
      `INSERT INTO student_class_history
         (student_id, action, from_class_level, from_stream, to_class_level, to_stream, from_year, to_year, actor_role, actor_id, note)
       VALUES
         ($1, 'promote', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        st.id,
        st.class_level,
        st.stream || '',
        next.classLevel,
        next.stream || '',
        y - 1,
        y,
        String(actorRole || ''),
        Number.isFinite(actorId) ? Number(actorId) : null,
        'Automatic year rollover promotion',
      ]
    );
    moved += 1;
  }
  return { moved, skipped: false };
}

async function runAutomaticRollbackForYear(targetYear, actorRole, actorId, dbClient) {
  const y = Number(targetYear);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) return { moved: 0, skipped: true, reason: 'invalid_year' };
  const q = dbClient || pool;
  let moved = 0;
  while (true) {
    const { rows } = await q.query(
      `SELECT DISTINCT ON (h.student_id)
          h.student_id, h.from_class_level, COALESCE(NULLIF(TRIM(h.from_stream), ''), '') AS from_stream,
          h.to_class_level, COALESCE(NULLIF(TRIM(h.to_stream), ''), '') AS to_stream
       FROM student_class_history h
       JOIN students s ON s.id = h.student_id
       WHERE h.action = 'promote'
         AND h.to_year = $1
         AND h.note = 'Automatic year rollover promotion'
         AND LOWER(COALESCE(NULLIF(TRIM(s.class_level), ''), '')) = LOWER(COALESCE(NULLIF(TRIM(h.to_class_level), ''), ''))
         AND LOWER(COALESCE(NULLIF(TRIM(s.stream), ''), '')) = LOWER(COALESCE(NULLIF(TRIM(h.to_stream), ''), ''))
       ORDER BY h.student_id, h.created_at DESC`,
      [y]
    );
    if (!rows.length) break;
    for (const r of rows) {
      await q.query(`UPDATE students SET class_level = $2, stream = $3, updated_at = NOW() WHERE id = $1`, [
        r.student_id,
        r.from_class_level,
        r.from_stream || null,
      ]);
      await q.query(
        `INSERT INTO student_class_history
           (student_id, action, from_class_level, from_stream, to_class_level, to_stream, from_year, to_year, actor_role, actor_id, note)
         VALUES
           ($1, 'demote', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          r.student_id,
          r.to_class_level,
          r.to_stream || '',
          r.from_class_level,
          r.from_stream || '',
          y,
          y - 1,
          String(actorRole || ''),
          Number.isFinite(actorId) ? Number(actorId) : null,
          'Automatic year rollback',
        ]
      );
      moved += 1;
    }
  }
  return { moved, skipped: false };
}

async function writeReportingContextAndPromotion(term, period, year, updatedBy, staffSession) {
  const prevYear = await currentReportingYear();
  const role = staffSession && staffSession.role ? String(staffSession.role) : String(updatedBy || '');
  const actorId = staffSession && Number.isFinite(Number(staffSession.id)) ? Number(staffSession.id) : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const next = { term, period, year, updatedAt: new Date().toISOString(), updatedBy: String(updatedBy || '') };
    await client.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('school_reporting_context', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(next)]
    );
    let movedTotal = 0;
    let direction = 'same_year';
    if (Number(year) > Number(prevYear)) {
      direction = 'forward';
      for (let y = Number(prevYear) + 1; y <= Number(year); y += 1) {
        const step = await runAutomaticPromotionForYear(y, role, actorId, client);
        movedTotal += Number(step.moved || 0);
      }
    } else if (Number(year) < Number(prevYear)) {
      direction = 'backward';
      for (let y = Number(prevYear); y > Number(year); y -= 1) {
        const step = await runAutomaticRollbackForYear(y, role, actorId, client);
        movedTotal += Number(step.moved || 0);
      }
    }
    await client.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('auto_promotion_last_year', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify({ year: Number(year), moved: movedTotal, direction, updatedAt: new Date().toISOString(), updatedBy: role })]
    );
    await client.query('COMMIT');
    return { context: next, promotion: { moved: movedTotal, skipped: direction === 'same_year', direction } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function normalizeSkillSubject(s) {
  if (s === undefined || s === null) return '';
  return String(s).trim().slice(0, 120);
}

function normalizeViewerLabel(s) {
  if (s === undefined || s === null) return '';
  return String(s).trim().slice(0, 80);
}

function normalizeNoteScope(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  if (v === 'director' || v === 'class' || v === 'skill') return v;
  return '';
}

function normalizeNoteToken(value, maxLen) {
  const v = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  return v.slice(0, Math.max(1, Number(maxLen) || 40));
}

function notesSettingsKey(scope, classLevel, stream, subject) {
  if (scope === 'director') return 'workspace_notes_director';
  if (scope === 'class') {
    const cl = normalizeNoteToken(classLevel, 40);
    if (!cl) return '';
    const st = normalizeNoteToken(stream, 40) || '_';
    return 'workspace_notes_class_' + cl + '_' + st;
  }
  if (scope === 'skill') {
    const sub = normalizeNoteToken(subject, 60);
    if (!sub) return '';
    return 'workspace_notes_skill_' + sub;
  }
  return '';
}

function sanitizeNotesHtml(input) {
  const raw = String(input || '').slice(0, 50000);
  return raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/\sjavascript:/gi, '');
}

function escapeHtmlText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeTypedNoteFilename(title) {
  const base =
    String(title || 'note')
      .trim()
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'note';
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${base}.html`;
}

function writeTypedNoteHtmlFile(title, html) {
  const filename = safeTypedNoteFilename(title);
  const full = path.join(NOTES, filename);
  const doc = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtmlText(
    title
  )}</title></head><body>${sanitizeNotesHtml(html)}</body></html>`;
  fs.writeFileSync(full, doc, 'utf8');
  return `/uploads/notes/${filename}`;
}

function typedNoteHasContent(html) {
  const raw = String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();
  return Boolean(raw);
}

/** When viewer loads a thread, record “delivered” for others’ messages (not own). */
async function recordDeliveredForMessages(messageRows, viewerLabel) {
  const v = normalizeViewerLabel(viewerLabel);
  if (!v || !messageRows.length) return;
  const ids = messageRows
    .filter((m) => String(m.sender_label || '').trim() !== v)
    .map((m) => m.id);
  if (!ids.length) return;
  await pool.query(
    `INSERT INTO class_message_receipts (message_id, reader_label, delivered_at)
     SELECT m.id, $2, NOW()
     FROM class_teacher_messages m
     WHERE m.id = ANY($1::int[])
       AND TRIM(m.sender_label) IS DISTINCT FROM TRIM($2::text)
     ON CONFLICT (message_id, reader_label)
     DO UPDATE SET
       delivered_at = COALESCE(class_message_receipts.delivered_at, EXCLUDED.delivered_at)`,
    [ids, v]
  );
}

/** 1 = sent, 2 = delivered (✓✓ grey), 3 = seen (✓✓ blue) for own messages. */
async function attachReceiptTicks(messageRows, viewerLabel) {
  const v = normalizeViewerLabel(viewerLabel);
  if (!v || !messageRows.length) return;
  const ownIds = messageRows
    .filter((m) => String(m.sender_label || '').trim() === v)
    .map((m) => m.id);
  messageRows.forEach((m) => {
    if (String(m.sender_label || '').trim() !== v) m.receipt_tick = null;
  });
  if (!ownIds.length) return;
  const { rows: agg } = await pool.query(
    `SELECT message_id,
            BOOL_OR(seen_at IS NOT NULL) AS any_seen,
            BOOL_OR(delivered_at IS NOT NULL) AS any_delivered
     FROM class_message_receipts
     WHERE message_id = ANY($1::int[])
       AND TRIM(reader_label) IS DISTINCT FROM TRIM($2::text)
     GROUP BY message_id`,
    [ownIds, v]
  );
  const map = new Map(agg.map((r) => [r.message_id, r]));
  messageRows.forEach((m) => {
    if (String(m.sender_label || '').trim() !== v) return;
    const a = map.get(m.id);
    let tick = 1;
    if (a && a.any_seen) tick = 3;
    else if (a && a.any_delivered) tick = 2;
    m.receipt_tick = tick;
  });
}

async function finalizeClassMessageRows(rows, viewerLabel) {
  if (!rows.length) return;
  try {
    await recordDeliveredForMessages(rows, viewerLabel);
    await attachReceiptTicks(rows, viewerLabel);
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') {
      rows.forEach((m) => {
        m.receipt_tick = null;
      });
      return;
    }
    throw err;
  }
}

const STAFF_DM_ROLES = ['director', 'head_teacher', 'class_teacher', 'skill_teacher', 'system_admin'];
const SYSTEM_ADMIN_ROLE = 'system_admin';
const SQL_STAFF_LISTABLE = `role NOT IN ('${SYSTEM_ADMIN_ROLE}', 'ghost')`;

function isSystemAdminRole(role) {
  const r = String(role || '').trim();
  return r === SYSTEM_ADMIN_ROLE || r === 'ghost';
}

function staffRoleSatisfied(sessionRole, allowedRoles) {
  if (isSystemAdminRole(sessionRole)) return true;
  return Array.isArray(allowedRoles) && allowedRoles.includes(sessionRole);
}

function requireSystemAdmin(req, res, next) {
  Promise.resolve()
    .then(async () => {
      const token = bearerToken(req);
      const payload = verifyStaffSession(token);
      if (!payload) {
        res.status(403).json({ error: 'System admin session required' });
        return;
      }
      const row = await loadStaffRow(payload.id);
      if (!row || !row.active || !isSystemAdminRole(row.role)) {
        res.status(403).json({ error: 'System admin session required' });
        return;
      }
      req.staffSession = {
        id: row.id,
        email: row.email,
        role: row.role,
        display_name: row.display_name,
        class_level: row.class_level,
        stream: row.stream || '',
      };
      next();
    })
    .catch(next);
}

function staffRoleLabel(role) {
  const r = String(role || '').trim();
  const map = {
    director: 'Director',
    head_teacher: 'Head teacher',
    class_teacher: 'Class teacher',
    skill_teacher: 'Skill teacher',
    system_admin: 'System admin',
    ghost: 'System admin',
  };
  return map[r] || r.replace(/_/g, ' ');
}

const STAFF_CLASS_TITLES = {
  daycare: 'Day Care',
  baby: 'Baby Class',
  middle: 'Middle Class',
  top: 'Top Class',
  primary1: 'Primary One',
  primary2: 'Primary Two',
};

const STAFF_STREAM_TITLES = {
  waves: 'Waves',
  pearls: 'Pearls',
  dolphins: 'Dolphins',
  whales: 'Whales',
};

function staffClassLabel(classLevel, stream) {
  const cl = String(classLevel || '').trim();
  if (!cl) return '';
  const title = STAFF_CLASS_TITLES[cl] || cl.replace(/_/g, ' ');
  const st = String(stream || '').trim();
  if (!st) return title;
  return title + ' — ' + (STAFF_STREAM_TITLES[st] || st);
}

function staffWorkspaceLabel(row) {
  const role = staffRoleLabel(row.role);
  const r = String(row.role || '').trim();
  if ((r === 'class_teacher' || r === 'skill_teacher') && row.class_level) {
    const cl = staffClassLabel(row.class_level, row.stream);
    if (cl) return role + ' · ' + cl;
  }
  return role;
}

function staffScopeLabel(row) {
  const r = String(row.role || '').trim();
  const cl = String(row.class_level || '').trim();
  if (r === 'class_teacher' && cl) return staffClassLabel(row.class_level, row.stream);
  if (r === 'skill_teacher' && cl) return cl;
  return '';
}

function mapStaffContactRow(r) {
  const scope = staffScopeLabel(r);
  return {
    id: r.id,
    email: r.email,
    display_name: r.display_name,
    role: r.role,
    role_label: staffRoleLabel(r.role),
    class_level: r.class_level,
    stream: r.stream || '',
    class_label: staffClassLabel(r.class_level, r.stream),
    scope_label: scope || '—',
    workspace_label: staffWorkspaceLabel(r),
    avatar_url: r.avatar_url || null,
    active: r.active !== false,
  };
}

/** Local testing only — never enabled on production VPS unless ALLOW_DEV_AUTH=true */
function isLocalDevRequest(req) {
  if (process.env.ALLOW_DEV_AUTH === 'true') return true;
  const h = String(req.hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function staffClientProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    class_level: row.class_level,
    stream: row.stream,
    avatar_url: row.avatar_url || null,
  };
}

async function loadStaffRow(staffId) {
  const { rows } = await pool.query(
    `SELECT id, email, display_name, role, class_level, stream, active, avatar_url
     FROM school_staff WHERE id = $1`,
    [staffId]
  );
  return rows[0] || null;
}

const STAFF_ACCOUNT_ROLES = ['director', 'head_teacher', 'class_teacher', 'skill_teacher', 'system_admin'];

/** WhatsApp-style ticks on messages you sent: recipient delivery / seen receipts. */
async function attachStaffDmReceiptTicks(rows, viewerStaffId) {
  if (!rows.length || !viewerStaffId) return;
  const viewer = Number(viewerStaffId);
  if (!viewer || Number.isNaN(viewer)) return;
  const sent = rows.filter((m) => Number(m.sender_staff_id) === viewer);
  rows.forEach((m) => {
    if (Number(m.sender_staff_id) !== viewer) m.receipt_tick = null;
  });
  if (!sent.length) return;
  const ids = sent.map((m) => m.id);
  const { rows: receiptRows } = await pool.query(
    `SELECT m.id AS message_id, r.delivered_at, r.seen_at
     FROM staff_direct_messages m
     LEFT JOIN staff_direct_message_receipts r
       ON r.message_id = m.id AND r.reader_staff_id = m.recipient_staff_id
     WHERE m.sender_staff_id = $1 AND m.id = ANY($2::int[])`,
    [viewer, ids]
  );
  const byId = new Map(
    receiptRows.map((r) => [
      r.message_id,
      { delivered_at: r.delivered_at, seen_at: r.seen_at },
    ])
  );
  sent.forEach((m) => {
    const rec = byId.get(m.id);
    m.receipt_tick = receiptTickLevel(rec);
  });
}

function receiptTickLevel(rec) {
  if (!rec) return 1;
  if (rec.seen_at != null && String(rec.seen_at).trim() !== '') return 3;
  if (rec.delivered_at != null && String(rec.delivered_at).trim() !== '') return 2;
  return 1;
}

async function recordDeliveredStaffDm(rows, readerStaffId) {
  if (!rows.length || !readerStaffId) return;
  const incoming = rows
    .filter((m) => Number(m.sender_staff_id) !== Number(readerStaffId))
    .map((m) => m.id);
  if (!incoming.length) return;
  await pool.query(
    `INSERT INTO staff_direct_message_receipts (message_id, reader_staff_id, delivered_at)
     SELECT m.id, $2, NOW()
     FROM staff_direct_messages m
     WHERE m.id = ANY($1::int[])
     ON CONFLICT (message_id, reader_staff_id)
     DO UPDATE SET delivered_at = COALESCE(staff_direct_message_receipts.delivered_at, EXCLUDED.delivered_at)`,
    [incoming, readerStaffId]
  );
}

/** Opening a thread counts as read — clears unread for that conversation. */
async function markStaffDmPeerSeen(readerStaffId, senderStaffId) {
  const reader = Number(readerStaffId);
  const sender = Number(senderStaffId);
  if (!reader || !sender || Number.isNaN(reader) || Number.isNaN(sender) || reader === sender) {
    return;
  }
  await pool.query(
    `INSERT INTO staff_direct_message_receipts (message_id, reader_staff_id, delivered_at, seen_at)
     SELECT m.id, $1, NOW(), NOW()
     FROM staff_direct_messages m
     WHERE m.recipient_staff_id = $1 AND m.sender_staff_id = $2
     ON CONFLICT (message_id, reader_staff_id)
     DO UPDATE SET
       delivered_at = COALESCE(staff_direct_message_receipts.delivered_at, EXCLUDED.delivered_at),
       seen_at = NOW()`,
    [reader, sender]
  );
}

const STAFF_GROUP_UNREAD_SQL = `
  NOT EXISTS (
    SELECT 1 FROM staff_group_message_receipts r
    WHERE r.message_id = m.id AND r.reader_staff_id = $1 AND r.seen_at IS NOT NULL
  )
`;

async function isStaffGroupMember(groupId, staffId) {
  const gid = Number(groupId);
  const sid = Number(staffId);
  if (!gid || !sid || Number.isNaN(gid) || Number.isNaN(sid)) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM staff_message_group_members WHERE group_id = $1 AND staff_id = $2`,
    [gid, sid]
  );
  return rows.length > 0;
}

async function recordDeliveredStaffGroupMessages(rows, readerStaffId) {
  if (!rows.length || !readerStaffId) return;
  const incoming = rows
    .filter((m) => Number(m.sender_staff_id) !== Number(readerStaffId))
    .map((m) => m.id);
  if (!incoming.length) return;
  await pool.query(
    `INSERT INTO staff_group_message_receipts (message_id, reader_staff_id, delivered_at)
     SELECT m.id, $2, NOW()
     FROM staff_group_messages m
     WHERE m.id = ANY($1::int[])
     ON CONFLICT (message_id, reader_staff_id)
     DO UPDATE SET delivered_at = COALESCE(staff_group_message_receipts.delivered_at, EXCLUDED.delivered_at)`,
    [incoming, readerStaffId]
  );
}

async function markStaffGroupSeen(readerStaffId, groupId) {
  const reader = Number(readerStaffId);
  const gid = Number(groupId);
  if (!reader || !gid || Number.isNaN(reader) || Number.isNaN(gid)) return;
  if (!(await isStaffGroupMember(gid, reader))) return;
  await pool.query(
    `INSERT INTO staff_group_message_receipts (message_id, reader_staff_id, delivered_at, seen_at)
     SELECT m.id, $1, NOW(), NOW()
     FROM staff_group_messages m
     WHERE m.group_id = $2 AND m.sender_staff_id <> $1
     ON CONFLICT (message_id, reader_staff_id)
     DO UPDATE SET
       delivered_at = COALESCE(staff_group_message_receipts.delivered_at, EXCLUDED.delivered_at),
       seen_at = NOW()`,
    [reader, gid]
  );
}

async function unlinkClassMessageAttachment(rel) {
  if (rel && typeof rel === 'string' && rel.startsWith('/uploads/class-messages/')) {
    const diskPath = path.join(ROOT, rel.replace(/^\//, ''));
    try {
      if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
    } catch (_) {}
  }
}

function attachmentIsVoiceNote(path, origName) {
  const s = (String(path || '') + ' ' + String(origName || '')).toLowerCase();
  return /voice-note|\.(webm|ogg|m4a|mp3|wav|aac|opus)(\?|$)/i.test(s);
}

function messageAttachmentPreview(body, path, origName) {
  const text = body != null ? String(body).trim() : '';
  if (text) return text;
  if (!path) return '';
  if (attachmentIsVoiceNote(path, origName)) return 'Voice message';
  return 'Attachment';
}

async function loadStaffGroupInboxRows(me) {
  const { rows } = await pool.query(
    `SELECT
       g.id AS group_id,
       g.name,
       g.created_at AS group_created_at,
       (
         SELECT COUNT(*)::int FROM staff_message_group_members gm WHERE gm.group_id = g.id
       ) AS member_count,
       COALESCE(lm.created_at, g.created_at) AS last_at,
       lm.id AS last_message_id,
       lm.body AS last_body,
       lm.sender_staff_id AS last_sender_id,
       lm.attachment_path AS last_attachment_path,
       ls.display_name AS last_sender_name,
       (
         SELECT COUNT(*)::int
         FROM staff_group_messages m
         WHERE m.group_id = g.id
           AND m.sender_staff_id <> $1
           AND ${STAFF_GROUP_UNREAD_SQL}
       ) AS unread_count
     FROM staff_message_groups g
     JOIN staff_message_group_members mem ON mem.group_id = g.id AND mem.staff_id = $1
     LEFT JOIN LATERAL (
       SELECT id, body, sender_staff_id, attachment_path, created_at
       FROM staff_group_messages
       WHERE group_id = g.id
       ORDER BY created_at DESC
       LIMIT 1
     ) lm ON TRUE
     LEFT JOIN school_staff ls ON ls.id = lm.sender_staff_id
     ORDER BY COALESCE(lm.created_at, g.created_at) DESC`,
    [me]
  );
  return rows.map((r) => {
    const lastIsMine = r.last_sender_id != null && Number(r.last_sender_id) === me;
    const unread = lastIsMine ? 0 : Number(r.unread_count) || 0;
    const previewBody =
      (r.last_body && String(r.last_body).trim()) ||
      messageAttachmentPreview(null, r.last_attachment_path, r.last_attachment_original_name);
    const preview = r.last_message_id
      ? lastIsMine
        ? 'You: ' + previewBody
        : (r.last_sender_name ? r.last_sender_name + ': ' : '') + previewBody
      : 'No messages yet';
    return {
      kind: 'group',
      group_id: r.group_id,
      name: r.name,
      member_count: r.member_count,
      display_name: r.name,
      workspace_label: r.member_count + ' members · Group',
      last_at: r.last_at,
      last_body: r.last_body,
      last_preview: preview,
      last_is_mine: lastIsMine,
      unread_count: unread,
    };
  });
}

function sessionIsSystemAdmin(req) {
  return isSystemAdminRole(req.staffSession && req.staffSession.role);
}

/** System admin (ghost): all staff DM pairs in the school. */
async function loadGhostStaffDmInboxRows() {
  const { rows } = await pool.query(
    `WITH pairs AS (
       SELECT
         LEAST(m.sender_staff_id, m.recipient_staff_id) AS staff_a,
         GREATEST(m.sender_staff_id, m.recipient_staff_id) AS staff_b,
         MAX(m.created_at) AS last_at
       FROM staff_direct_messages m
       GROUP BY LEAST(m.sender_staff_id, m.recipient_staff_id),
                GREATEST(m.sender_staff_id, m.recipient_staff_id)
     )
     SELECT
       p.staff_a,
       p.staff_b,
       p.last_at,
       lm.id AS last_message_id,
       lm.body AS last_body,
       lm.sender_staff_id AS last_sender_id,
       lm.attachment_path AS last_attachment_path,
       sa.display_name AS name_a,
       sb.display_name AS name_b,
       sa.role AS role_a,
       sb.role AS role_b,
       sa.avatar_url AS avatar_a,
       sb.avatar_url AS avatar_b
     FROM pairs p
     JOIN school_staff sa ON sa.id = p.staff_a
     JOIN school_staff sb ON sb.id = p.staff_b
     JOIN LATERAL (
       SELECT id, body, sender_staff_id, attachment_path, created_at
       FROM staff_direct_messages
       WHERE (sender_staff_id = p.staff_a AND recipient_staff_id = p.staff_b)
          OR (sender_staff_id = p.staff_b AND recipient_staff_id = p.staff_a)
       ORDER BY created_at DESC
       LIMIT 1
     ) lm ON TRUE
     WHERE sa.role <> $1 AND sb.role <> $1
     ORDER BY p.last_at DESC`,
    [SYSTEM_ADMIN_ROLE]
  );
  return rows.map((r) => {
    const previewBody =
      (r.last_body && String(r.last_body).trim()) ||
      messageAttachmentPreview(null, r.last_attachment_path, r.last_attachment_original_name);
    const who =
      Number(r.last_sender_id) === Number(r.staff_a)
        ? r.name_a
        : Number(r.last_sender_id) === Number(r.staff_b)
        ? r.name_b
        : '';
    return {
      kind: 'dm',
      observer: true,
      staff_id: r.staff_a,
      peer_staff_id: r.staff_b,
      display_name: String(r.name_a || 'Staff') + ' ↔ ' + String(r.name_b || 'Staff'),
      workspace_label: staffRoleLabel(r.role_a) + ' · ' + staffRoleLabel(r.role_b),
      avatar_url: r.avatar_a || null,
      peer_avatar_url: r.avatar_b || null,
      last_at: r.last_at,
      last_body: r.last_body,
      last_preview: previewBody ? (who ? who + ': ' + previewBody : previewBody) : '',
      last_is_mine: false,
      unread_count: 0,
    };
  });
}

/** System admin (ghost): every group chat in the school. */
async function loadGhostStaffAllGroupInboxRows() {
  const { rows } = await pool.query(
    `SELECT
       g.id AS group_id,
       g.name,
       g.created_at AS group_created_at,
       (
         SELECT COUNT(*)::int FROM staff_message_group_members gm WHERE gm.group_id = g.id
       ) AS member_count,
       COALESCE(lm.created_at, g.created_at) AS last_at,
       lm.id AS last_message_id,
       lm.body AS last_body,
       lm.sender_staff_id AS last_sender_id,
       lm.attachment_path AS last_attachment_path,
       ls.display_name AS last_sender_name
     FROM staff_message_groups g
     LEFT JOIN LATERAL (
       SELECT id, body, sender_staff_id, attachment_path, created_at
       FROM staff_group_messages
       WHERE group_id = g.id
       ORDER BY created_at DESC
       LIMIT 1
     ) lm ON TRUE
     LEFT JOIN school_staff ls ON ls.id = lm.sender_staff_id
     ORDER BY COALESCE(lm.created_at, g.created_at) DESC`
  );
  return rows.map((r) => {
    const previewBody =
      (r.last_body && String(r.last_body).trim()) ||
      messageAttachmentPreview(null, r.last_attachment_path, r.last_attachment_original_name);
    const preview = r.last_message_id
      ? (r.last_sender_name ? r.last_sender_name + ': ' : '') + previewBody
      : 'No messages yet';
    return {
      kind: 'group',
      observer: true,
      group_id: r.group_id,
      name: r.name,
      member_count: r.member_count,
      display_name: r.name,
      workspace_label: (r.member_count || 0) + ' members · Group',
      last_at: r.last_at,
      last_body: r.last_body,
      last_preview: preview,
      last_is_mine: false,
      unread_count: 0,
    };
  });
}

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function requireDirector(req, res, next) {
  Promise.resolve()
    .then(async () => {
      const token = bearerToken(req);
      const payload = verifyStaffSession(token);
      if (!payload || (payload.role !== 'director' && !isSystemAdminRole(payload.role))) {
        res.status(403).json({ error: 'Director session required' });
        return;
      }
      const row = await loadStaffRow(payload.id);
      if (!row || !row.active) {
        res.status(403).json({ error: 'Director session required' });
        return;
      }
      req.directorSession = {
        id: row.id,
        email: row.email,
        role: row.role,
        display_name: row.display_name,
        class_level: row.class_level,
        stream: row.stream || '',
      };
      req.staffSession = req.directorSession;
      next();
    })
    .catch(next);
}

function requireStaffRoles(roles) {
  return (req, res, next) => {
    Promise.resolve()
      .then(async () => {
        const token = bearerToken(req);
        const payload = verifyStaffSession(token);
        if (!payload) {
          res.status(403).json({ error: 'Authorized staff session required' });
          return;
        }
        const row = await loadStaffRow(payload.id);
        if (!row || !row.active) {
          res.status(403).json({ error: 'Authorized staff session required' });
          return;
        }
        req.staffSession = {
          id: row.id,
          email: row.email,
          role: row.role,
          display_name: row.display_name,
          class_level: row.class_level,
          stream: row.stream || '',
        };
        if (!staffRoleSatisfied(req.staffSession.role, roles)) {
          res.status(403).json({ error: 'Authorized staff session required' });
          return;
        }
        if (!isSystemAdminRole(req.staffSession.role) && (await isStaffSystemLocked())) {
          res.status(503).json({
            error: 'All staff sign-ins are temporarily disabled by the system administrator.',
          });
          return;
        }
        next();
      })
      .catch(next);
  };
}

function staffAccountsUnavailable(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

async function isRegNoTaken(regNo, excludeStudentId) {
  let sql = 'SELECT id FROM students WHERE TRIM(reg_no) = TRIM($1)';
  const params = [regNo];
  if (excludeStudentId != null) {
    sql += ' AND id <> $2';
    params.push(excludeStudentId);
  }
  const { rows } = await pool.query(sql, params);
  return rows.length > 0;
}

app.post(
  '/api/profile/avatar',
  requireStaffRoles(STAFF_ACCOUNT_ROLES),
  uploadProfile.single('avatar'),
  asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'avatar file required' });
    const url = `/uploads/profiles/${req.file.filename}`;
    const staffId = req.staffSession && req.staffSession.id ? Number(req.staffSession.id) : null;
    if (staffId) {
      await pool.query(`UPDATE school_staff SET avatar_url = $2, updated_at = NOW() WHERE id = $1`, [
        staffId,
        url,
      ]);
    }
    res.json({ url });
  })
);

app.get(
  '/api/students',
  asyncRoute(async (req, res) => {
    const { classLevel, stream } = req.query;
    if (!classLevel) {
      return res.status(400).json({ error: 'classLevel is required' });
    }
    if (req.query.year != null && String(req.query.year).trim() !== '') {
      const academicYear = await resolveAcademicYear(req.query.year);
      const rows = await rosterStudentsForClassYear(String(classLevel).trim(), normalizeClassStream(stream), academicYear);
      return res.json(rows);
    }
    let q = 'SELECT * FROM students WHERE class_level = $1';
    const params = [classLevel];
    if (stream && String(stream).trim()) {
      q += ' AND LOWER(TRIM(COALESCE(stream, \'\'))) = LOWER(TRIM($2))';
      params.push(normalizeClassStream(stream));
    } else {
      q += ' AND (stream IS NULL OR TRIM(COALESCE(stream, \'\')) = \'\')';
    }
    q += ' ORDER BY full_name ASC';
    const { rows } = await pool.query(q, params);
    res.json(rows);
  })
);

app.get(
  '/api/students/search',
  requireStaffRoles(STAFF_ACCOUNT_ROLES),
  asyncRoute(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const limit = Math.min(40, Math.max(5, Number(req.query.limit) || 20));
    const like = '%' + q + '%';
    const { rows } = await pool.query(
      `SELECT id, full_name, reg_no, class_level, stream, passport_path
       FROM students
       WHERE full_name ILIKE $1 OR reg_no ILIKE $1
       ORDER BY full_name ASC
       LIMIT $2`,
      [like, limit]
    );
    res.json(rows);
  })
);

app.post(
  '/api/students',
  uploadStudent.single('passport'),
  asyncRoute(async (req, res) => {
    const { full_name, reg_no, class_level, stream } = req.body;
    if (!full_name || !reg_no || !class_level) {
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) {}
      }
      return res.status(400).json({ error: 'full_name, reg_no, class_level required' });
    }
    const nameTrim = full_name.trim();
    const regTrim = reg_no.trim();
    if (await isRegNoTaken(regTrim, null)) {
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) {}
      }
      return res.status(409).json({
        error: 'Child already exists — this registration number is already in use.',
      });
    }
    let passportPath = null;
    if (req.file) {
      const fin = await finalizeStudentPassport({
        pool,
        file: req.file,
        fullName: nameTrim,
        studentPhotosDir: STUDENT_PHOTOS,
        excludeStudentId: null,
        previousPassportPath: null,
      });
      if (!fin.ok) return res.status(fin.status).json({ error: fin.error });
      passportPath = fin.passportPath;
    }
    const streamVal = stream && String(stream).trim() ? String(stream).trim() : null;
    const { rows } = await pool.query(
      `INSERT INTO students (full_name, reg_no, class_level, stream, passport_path)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nameTrim, regTrim, class_level, streamVal, passportPath]
    );
    res.status(201).json(rows[0]);
  })
);

app.patch(
  '/api/students/:id',
  uploadStudent.single('passport'),
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const existing = await pool.query('SELECT * FROM students WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Not found' });
    const cur = existing.rows[0];
    const full_name =
      req.body.full_name !== undefined ? String(req.body.full_name).trim() : cur.full_name;
    const reg_no = req.body.reg_no !== undefined ? String(req.body.reg_no).trim() : cur.reg_no;
    const class_level =
      req.body.class_level !== undefined ? req.body.class_level : cur.class_level;
    const stream =
      req.body.stream !== undefined
        ? req.body.stream && String(req.body.stream).trim()
          ? String(req.body.stream).trim()
          : null
        : cur.stream;
    if (await isRegNoTaken(reg_no, id)) {
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) {}
      }
      return res.status(409).json({
        error: 'Child already exists — this registration number is already in use.',
      });
    }
    let passport_path = cur.passport_path;
    if (req.file) {
      const fin = await finalizeStudentPassport({
        pool,
        file: req.file,
        fullName: full_name,
        studentPhotosDir: STUDENT_PHOTOS,
        excludeStudentId: id,
        previousPassportPath: cur.passport_path,
      });
      if (!fin.ok) return res.status(fin.status).json({ error: fin.error });
      passport_path = fin.passportPath;
    }
    const { rows } = await pool.query(
      `UPDATE students SET full_name = $1, reg_no = $2, class_level = $3, stream = $4, passport_path = $5, updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [full_name, reg_no, class_level, stream, passport_path, id]
    );
    if (req.file && cur.passport_path && cur.passport_path !== passport_path) {
      unlinkPassportIfOwned(ROOT, cur.passport_path);
    }
    res.json(rows[0]);
  })
);

app.get(
  '/api/class-messages/channels',
  requireStaffRoles(STAFF_DM_ROLES),
  asyncRoute(async (req, res) => {
    try {
      const ghost = sessionIsSystemAdmin(req);
      const classLevel = req.query.classLevel != null ? String(req.query.classLevel).trim() : '';
      const streamKey = normalizeClassStream(req.query.stream);
      let q = `SELECT
         m.class_level,
         m.stream,
         COALESCE(NULLIF(TRIM(m.skill_subject), ''), '') AS skill_subject,
         MAX(m.created_at) AS last_at,
         COUNT(*)::int AS message_count
       FROM class_teacher_messages m`;
      const params = [];
      const where = [];
      if (!ghost) {
        const cl =
          classLevel ||
          (req.staffSession.class_level != null ? String(req.staffSession.class_level).trim() : '');
        if (!cl) {
          return res.status(400).json({ error: 'classLevel is required' });
        }
        params.push(cl);
        where.push(`m.class_level = $${params.length}`);
        const st =
          streamKey ||
          (req.staffSession.stream != null ? normalizeClassStream(req.staffSession.stream) : '');
        if (st) {
          params.push(st);
          where.push(`m.stream = $${params.length}`);
        } else {
          where.push(`(m.stream IS NULL OR TRIM(m.stream) = '')`);
        }
      } else if (classLevel) {
        params.push(classLevel);
        where.push(`m.class_level = $${params.length}`);
        if (streamKey) {
          params.push(streamKey);
          where.push(`m.stream = $${params.length}`);
        }
      }
      if (where.length) q += ' WHERE ' + where.join(' AND ');
      q += ` GROUP BY m.class_level, m.stream, COALESCE(NULLIF(TRIM(m.skill_subject), ''), '')
             ORDER BY last_at DESC`;
      const { rows: groups } = await pool.query(q, params);
      const channels = [];
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        let detailQ = `SELECT id, sender_label, body, attachment_path, attachment_original_name, created_at
           FROM class_teacher_messages
           WHERE class_level = $1`;
        const dParams = [g.class_level];
        let n = 2;
        const gStream = normalizeClassStream(g.stream);
        if (gStream) {
          detailQ += ` AND stream = $${n++}`;
          dParams.push(gStream);
        } else {
          detailQ += ` AND (stream IS NULL OR TRIM(stream) = '')`;
        }
        detailQ += ` AND COALESCE(NULLIF(TRIM(skill_subject), ''), '') = $${n}`;
        dParams.push(g.skill_subject || '');
        detailQ += ' ORDER BY created_at DESC LIMIT 1';
        const { rows: lastRows } = await pool.query(detailQ, dParams);
        const last = lastRows[0] || {};
        const roomLabel = staffClassLabel(g.class_level, g.stream) || g.class_level;
        const skill = String(g.skill_subject || '').trim();
        const title = skill ? roomLabel + ' → ' + skill : roomLabel + ' — all staff';
        const previewBody = messageAttachmentPreview(
          last.body,
          last.attachment_path,
          last.attachment_original_name
        );
        channels.push({
          kind: 'class_channel',
          class_level: g.class_level,
          stream: gStream || '',
          skill_subject: skill,
          display_name: title,
          workspace_label: skill ? 'Skill inbox' : 'Class staff channel',
          last_at: g.last_at,
          last_preview: previewBody
            ? (last.sender_label ? String(last.sender_label).trim() + ': ' : '') + previewBody
            : 'No messages yet',
          message_count: g.message_count,
          observer: ghost,
        });
      }
      res.json({ channels, observer_mode: ghost });
    } catch (err) {
      if (err.code === '42P01' || err.code === '42703') {
        return res.status(503).json({
          error:
            'Messages are not set up yet. From the project folder run: npm run db:init (needs DATABASE_URL in .env).',
        });
      }
      throw err;
    }
  })
);

app.get(
  '/api/class-messages',
  asyncRoute(async (req, res) => {
    try {
      const { classLevel, stream, skillSubject, viewerLabel } = req.query;
      const viewer = normalizeViewerLabel(viewerLabel);
      const skillKey = normalizeSkillSubject(skillSubject);
      const classLevelTrim = classLevel != null ? String(classLevel).trim() : '';

      /** Skill teacher inbox: all messages routed to this subject (any class). */
      if (skillKey && !classLevelTrim) {
        const { rows } = await pool.query(
          `SELECT id, class_level, stream, skill_subject, origin_class_level, origin_stream, sender_label, body, attachment_path, attachment_original_name, created_at
           FROM class_teacher_messages
           WHERE COALESCE(NULLIF(TRIM(skill_subject), ''), '') = $1
           ORDER BY created_at ASC`,
          [skillKey]
        );
        await finalizeClassMessageRows(rows, viewer);
        return res.json(rows);
      }

      if (!classLevelTrim) {
        return res.status(400).json({
          error: 'Pass classLevel (and optional stream, skillSubject), or skillSubject alone for a skill inbox.',
        });
      }

      const streamKey = normalizeClassStream(stream);
      let q = `SELECT id, class_level, stream, skill_subject, origin_class_level, origin_stream, sender_label, body, attachment_path, attachment_original_name, created_at
         FROM class_teacher_messages WHERE class_level = $1`;
      const params = [classLevelTrim];
      let n = 2;
      if (streamKey) {
        q += ` AND stream = $${n++}`;
        params.push(streamKey);
      } else {
        q += ` AND (stream IS NULL OR TRIM(stream) = '')`;
      }
      q += ` AND COALESCE(NULLIF(TRIM(skill_subject), ''), '') = $${n}`;
      params.push(skillKey);
      q += ' ORDER BY created_at ASC';
      const { rows } = await pool.query(q, params);
      await finalizeClassMessageRows(rows, viewer);
      res.json(rows);
    } catch (err) {
      if (err.code === '42P01' || err.code === '42703') {
        return res.status(503).json({
          error:
            'Messages are not set up yet. From the project folder run: npm run db:init (needs DATABASE_URL in .env).',
        });
      }
      throw err;
    }
  })
);

app.post(
  '/api/class-messages',
  uploadClassMessage.single('attachment'),
  asyncRoute(async (req, res) => {
    try {
      const class_level = req.body.class_level != null ? String(req.body.class_level).trim() : '';
      if (!class_level) {
        if (req.file) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (_) {}
        }
        return res.status(400).json({ error: 'class_level is required' });
      }
      const streamKey = normalizeClassStream(req.body.stream);
      const skillKey = normalizeSkillSubject(req.body.skill_subject);
      let originClass = req.body.origin_class_level != null ? String(req.body.origin_class_level).trim() : '';
      let originStream = normalizeClassStream(req.body.origin_stream);
      if (originClass.length > 80) originClass = originClass.slice(0, 80);
      if (originClass === class_level && originStream === streamKey && !skillKey) {
        originClass = '';
        originStream = '';
      }
      if (skillKey) {
        originClass = '';
        originStream = '';
      }
      const sender_label =
        (req.body.sender_label != null ? String(req.body.sender_label) : 'Teacher').trim() || 'Teacher';
      const bodyStr = req.body.body != null ? String(req.body.body).trim() : '';
      const origName = req.file ? path.basename(req.file.originalname || '') : null;
      let attachPath = null;
      let attachOrig = null;
      if (req.file) {
        attachPath = `/uploads/class-messages/${req.file.filename}`;
        attachOrig = origName || req.file.filename;
      }
      if (!bodyStr && !attachPath) {
        if (req.file) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (_) {}
        }
        return res.status(400).json({ error: 'Message text or a file attachment is required' });
      }
      if (bodyStr.length > 8000) {
        if (req.file) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (_) {}
        }
        return res.status(400).json({ error: 'Message too long (max 8000 characters)' });
      }

      if (!attachPath && bodyStr) {
        const dup = await pool.query(
          `SELECT id FROM class_teacher_messages
           WHERE class_level = $1
             AND COALESCE(NULLIF(TRIM(stream), ''), '') = COALESCE(NULLIF(TRIM($2::text), ''), '')
             AND COALESCE(NULLIF(TRIM(skill_subject), ''), '') = COALESCE(NULLIF(TRIM($3::text), ''), '')
             AND COALESCE(NULLIF(TRIM(origin_class_level), ''), '') = COALESCE(NULLIF(TRIM($4::text), ''), '')
             AND COALESCE(NULLIF(TRIM(origin_stream), ''), '') = COALESCE(NULLIF(TRIM($5::text), ''), '')
             AND sender_label = $6 AND body = $7
             AND (attachment_path IS NULL OR TRIM(attachment_path) = '')
             AND created_at > NOW() - INTERVAL '3 minutes'
           LIMIT 1`,
          [class_level, streamKey, skillKey, originClass, originStream, sender_label, bodyStr]
        );
        if (dup.rows.length) {
          return res.status(409).json({
            error:
              'You just sent this same message. Wait a moment or change the text so you are not repeating yourself.',
          });
        }
      }

      const { rows } = await pool.query(
        `INSERT INTO class_teacher_messages (class_level, stream, skill_subject, origin_class_level, origin_stream, sender_label, body, attachment_path, attachment_original_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, class_level, stream, skill_subject, origin_class_level, origin_stream, sender_label, body, attachment_path, attachment_original_name, created_at`,
        [class_level, streamKey, skillKey, originClass, originStream, sender_label, bodyStr, attachPath, attachOrig]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) {}
      }
      if (err.code === '42703' || err.code === '42P01') {
        return res.status(503).json({
          error:
            'Messages database needs updating. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.delete(
  '/api/class-messages/:id',
  asyncRoute(async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const viewer = normalizeViewerLabel(req.query.viewerLabel);
      if (!id || Number.isNaN(id) || !viewer) {
        return res.status(400).json({ error: 'Valid id and viewerLabel query are required' });
      }
      const { rows } = await pool.query(
        `SELECT id, sender_label, attachment_path FROM class_teacher_messages WHERE id = $1`,
        [id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Message not found' });
      if (String(rows[0].sender_label || '').trim() !== viewer) {
        return res.status(403).json({ error: 'You can only delete messages you sent' });
      }
      const rel = rows[0].attachment_path;
      if (rel && typeof rel === 'string' && rel.startsWith('/uploads/class-messages/')) {
        const diskPath = path.join(ROOT, rel.replace(/^\//, ''));
        try {
          if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
        } catch (_) {}
      }
      await pool.query(`DELETE FROM class_teacher_messages WHERE id = $1`, [id]);
      res.json({ ok: true });
    } catch (err) {
      if (err.code === '42P01' || err.code === '42703') {
        return res.status(503).json({
          error: 'Messages database needs updating. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.post(
  '/api/class-messages/clear',
  requireStaffRoles(STAFF_DM_ROLES),
  asyncRoute(async (req, res) => {
    try {
      if (sessionIsSystemAdmin(req)) {
        return res.status(403).json({ error: 'System admin can only view this channel, not clear it.' });
      }
      const class_level =
        req.body && req.body.classLevel != null
          ? String(req.body.classLevel).trim()
          : req.body && req.body.class_level != null
          ? String(req.body.class_level).trim()
          : '';
      if (!class_level) {
        return res.status(400).json({ error: 'classLevel is required' });
      }
      const streamKey = normalizeClassStream(
        (req.body && (req.body.stream ?? req.body.streamKey)) != null ? req.body.stream : ''
      );
      const skillKey = normalizeSkillSubject(
        (req.body && (req.body.skillSubject ?? req.body.skill_subject)) != null
          ? req.body.skillSubject ?? req.body.skill_subject
          : ''
      );
      let q = `SELECT attachment_path FROM class_teacher_messages WHERE class_level = $1`;
      const params = [class_level];
      let n = 2;
      if (streamKey) {
        q += ` AND stream = $${n++}`;
        params.push(streamKey);
      } else {
        q += ` AND (stream IS NULL OR TRIM(stream) = '')`;
      }
      q += ` AND COALESCE(NULLIF(TRIM(skill_subject), ''), '') = $${n}`;
      params.push(skillKey);
      const { rows: att } = await pool.query(q, params);
      att.forEach((r) => unlinkClassMessageAttachment(r.attachment_path));
      await pool.query(
        `DELETE FROM class_teacher_messages
         WHERE class_level = $1
           AND ${streamKey ? `stream = $2` : `(stream IS NULL OR TRIM(stream) = '')`}
           AND COALESCE(NULLIF(TRIM(skill_subject), ''), '') = $${streamKey ? 3 : 2}`,
        streamKey ? [class_level, streamKey, skillKey] : [class_level, skillKey]
      );
      res.json({
        ok: true,
        cleared: 'class_channel',
        class_level,
        stream: streamKey || '',
        skill_subject: skillKey,
      });
    } catch (err) {
      if (err.code === '42P01' || err.code === '42703') {
        return res.status(503).json({
          error: 'Messages database needs updating. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.post(
  '/api/class-messages/seen',
  asyncRoute(async (req, res) => {
    try {
      const viewer = normalizeViewerLabel(req.body && req.body.viewerLabel);
      const rawIds = req.body && req.body.messageIds;
      const ids = Array.isArray(rawIds)
        ? rawIds
            .map((x) => parseInt(x, 10))
            .filter((n) => !Number.isNaN(n) && n > 0)
            .slice(0, 400)
        : [];
      if (!viewer || !ids.length) {
        return res.status(400).json({ error: 'viewerLabel and messageIds required' });
      }
      await pool.query(
        `INSERT INTO class_message_receipts (message_id, reader_label, delivered_at, seen_at)
         SELECT m.id, $2, NOW(), NOW()
         FROM class_teacher_messages m
         WHERE m.id = ANY($1::int[])
           AND TRIM(m.sender_label) IS DISTINCT FROM TRIM($2::text)
         ON CONFLICT (message_id, reader_label)
         DO UPDATE SET
           delivered_at = COALESCE(class_message_receipts.delivered_at, EXCLUDED.delivered_at),
           seen_at = COALESCE(class_message_receipts.seen_at, EXCLUDED.seen_at)`,
        [ids, viewer]
      );
      res.json({ ok: true });
    } catch (err) {
      if (err.code === '42703' || err.code === '42P01') {
        return res.status(503).json({
          error: 'Messages receipts not set up. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.get(
  '/api/staff-messages/contacts',
  requireStaffRoles(STAFF_DM_ROLES),
  asyncRoute(async (req, res) => {
    try {
      const me = req.staffSession.id;
      const { rows } = await pool.query(
        `SELECT id, email, display_name, role, class_level, stream, active, avatar_url
         FROM school_staff
         WHERE active = TRUE AND id <> $1 AND ${SQL_STAFF_LISTABLE}
         ORDER BY role, display_name`,
        [me]
      );
      res.json(rows.map(mapStaffContactRow));
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Private messages need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

const STAFF_DM_UNREAD_SQL = `
  NOT EXISTS (
    SELECT 1 FROM staff_direct_message_receipts r
    WHERE r.message_id = m.id AND r.reader_staff_id = $1 AND r.seen_at IS NOT NULL
  )
`;

app.get(
  '/api/staff-messages/unread-summary',
  requireStaffRoles(STAFF_DM_ROLES),
  asyncRoute(async (req, res) => {
    try {
      if (sessionIsSystemAdmin(req)) {
        return res.json({ total: 0, by_peer: {}, by_group: {}, observer_mode: true });
      }
      const me = Number(req.staffSession.id);
      const totalDmRes = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM staff_direct_messages m
         WHERE m.recipient_staff_id = $1
           AND m.sender_staff_id <> $1
           AND ${STAFF_DM_UNREAD_SQL}`,
        [me]
      );
      const totalGroupRes = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM staff_group_messages m
         JOIN staff_message_group_members mem ON mem.group_id = m.group_id AND mem.staff_id = $1
         WHERE m.sender_staff_id <> $1
           AND ${STAFF_GROUP_UNREAD_SQL}`,
        [me]
      );
      const byPeerRes = await pool.query(
        `SELECT m.sender_staff_id AS staff_id, COUNT(*)::int AS unread_count
         FROM staff_direct_messages m
         WHERE m.recipient_staff_id = $1
           AND m.sender_staff_id <> $1
           AND ${STAFF_DM_UNREAD_SQL}
         GROUP BY m.sender_staff_id`,
        [me]
      );
      const byGroupRes = await pool.query(
        `SELECT m.group_id, COUNT(*)::int AS unread_count
         FROM staff_group_messages m
         JOIN staff_message_group_members mem ON mem.group_id = m.group_id AND mem.staff_id = $1
         WHERE m.sender_staff_id <> $1
           AND ${STAFF_GROUP_UNREAD_SQL}
         GROUP BY m.group_id`,
        [me]
      );
      const by_peer = {};
      byPeerRes.rows.forEach((r) => {
        by_peer[String(r.staff_id)] = r.unread_count;
      });
      const by_group = {};
      byGroupRes.rows.forEach((r) => {
        by_group[String(r.group_id)] = r.unread_count;
      });
      const dmTotal = totalDmRes.rows[0] ? totalDmRes.rows[0].total : 0;
      const groupTotal = totalGroupRes.rows[0] ? totalGroupRes.rows[0].total : 0;
      res.json({
        total: dmTotal + groupTotal,
        by_peer,
        by_group,
      });
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Private messages need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.get(
  '/api/staff-messages/inbox',
  requireStaffRoles(STAFF_DM_ROLES),
  asyncRoute(async (req, res) => {
    try {
      const me = Number(req.staffSession.id);
      if (sessionIsSystemAdmin(req)) {
        const dmMapped = await loadGhostStaffDmInboxRows();
        const groupRows = await loadGhostStaffAllGroupInboxRows();
        const merged = dmMapped.concat(groupRows).sort((a, b) => {
          const ta = new Date(a.last_at || 0).getTime();
          const tb = new Date(b.last_at || 0).getTime();
          return tb - ta;
        });
        return res.json({ conversations: merged, total_unread: 0, observer_mode: true });
      }
      const { rows } = await pool.query(
        `WITH pairs AS (
           SELECT
             CASE WHEN sender_staff_id = $1 THEN recipient_staff_id ELSE sender_staff_id END AS other_id,
             MAX(created_at) AS last_at
           FROM staff_direct_messages
           WHERE sender_staff_id = $1 OR recipient_staff_id = $1
           GROUP BY other_id
         )
         SELECT
           p.other_id,
           s.display_name,
           s.email,
           s.role,
           s.class_level,
           s.stream,
           p.last_at,
           lm.id AS last_message_id,
           lm.body AS last_body,
           lm.sender_staff_id AS last_sender_id,
           lm.attachment_path AS last_attachment_path,
           lm.attachment_original_name AS last_attachment_original_name,
           (
             SELECT COUNT(*)::int
             FROM staff_direct_messages m
             WHERE m.recipient_staff_id = $1
               AND m.sender_staff_id = p.other_id
               AND m.sender_staff_id <> $1
               AND ${STAFF_DM_UNREAD_SQL}
           ) AS unread_count
         FROM pairs p
         JOIN school_staff s ON s.id = p.other_id
         JOIN LATERAL (
           SELECT id, body, sender_staff_id, attachment_path, attachment_original_name, created_at
           FROM staff_direct_messages
           WHERE (sender_staff_id = $1 AND recipient_staff_id = p.other_id)
              OR (sender_staff_id = p.other_id AND recipient_staff_id = $1)
           ORDER BY created_at DESC
           LIMIT 1
         ) lm ON TRUE
         ORDER BY p.last_at DESC`,
        [me]
      );
      let totalUnread = 0;
      const dmMapped = rows.map((r) => {
        const lastIsMine = Number(r.last_sender_id) === me;
        const unread = lastIsMine ? 0 : Number(r.unread_count) || 0;
        totalUnread += unread;
        const peer = mapStaffContactRow({
          id: r.other_id,
          email: r.email,
          display_name: r.display_name,
          role: r.role,
          class_level: r.class_level,
          stream: r.stream,
        });
        return Object.assign(peer, {
          kind: 'dm',
          staff_id: r.other_id,
          last_at: r.last_at,
          last_body: r.last_body,
          last_preview: messageAttachmentPreview(
            r.last_body,
            r.last_attachment_path,
            r.last_attachment_original_name
          ),
          last_is_mine: Number(r.last_sender_id) === me,
          unread_count: unread,
        });
      });
      const groupRows = await loadStaffGroupInboxRows(me);
      groupRows.forEach((g) => {
        totalUnread += Number(g.unread_count) || 0;
      });
      const merged = dmMapped.concat(groupRows).sort((a, b) => {
        const ta = new Date(a.last_at || 0).getTime();
        const tb = new Date(b.last_at || 0).getTime();
        return tb - ta;
      });
      res.json({ conversations: merged, total_unread: totalUnread });
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Private messages need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.get(
  '/api/staff-messages/thread',
  requireStaffRoles(STAFF_DM_ROLES),
  asyncRoute(async (req, res) => {
    try {
      const me = Number(req.staffSession.id);
      const ghostObserve = sessionIsSystemAdmin(req);
      const groupId = parseInt(req.query.group, 10);
      if (groupId && !Number.isNaN(groupId)) {
        if (!ghostObserve && !(await isStaffGroupMember(groupId, me))) {
          return res.status(403).json({ error: 'You are not a member of this group' });
        }
        const groupRes = await pool.query(
          `SELECT g.id, g.name,
                  (SELECT COUNT(*)::int FROM staff_message_group_members WHERE group_id = g.id) AS member_count
           FROM staff_message_groups g WHERE g.id = $1`,
          [groupId]
        );
        if (!groupRes.rows.length) return res.status(404).json({ error: 'Group not found' });
        const g = groupRes.rows[0];
        const { rows } = await pool.query(
          `SELECT m.id, m.group_id, m.sender_staff_id, m.body, m.attachment_path,
                  m.attachment_original_name, m.created_at,
                  s.display_name AS sender_name, s.role AS sender_role, s.avatar_url AS sender_avatar_url
           FROM staff_group_messages m
           JOIN school_staff s ON s.id = m.sender_staff_id
           WHERE m.group_id = $1
           ORDER BY m.created_at ASC`,
          [groupId]
        );
        if (!ghostObserve) {
          await recordDeliveredStaffGroupMessages(rows, me);
          await markStaffGroupSeen(me, groupId);
        }
        return res.json({
          kind: 'group',
          observer: ghostObserve,
          group: {
            id: g.id,
            name: g.name,
            member_count: g.member_count,
          },
          messages: rows.map((m) => ({
            id: m.id,
            group_id: m.group_id,
            sender_staff_id: m.sender_staff_id,
            sender_name: m.sender_name,
            sender_role: m.sender_role,
            sender_role_label: staffRoleLabel(m.sender_role),
            sender_avatar_url: m.sender_avatar_url || null,
            body: m.body,
            attachment_path: m.attachment_path,
            attachment_original_name: m.attachment_original_name,
            created_at: m.created_at,
            is_mine: Number(m.sender_staff_id) === me,
          })),
        });
      }
      const other = parseInt(req.query.with, 10);
      const observePeer = parseInt(req.query.with_peer, 10);
      if (!other || Number.isNaN(other)) {
        return res.status(400).json({ error: 'with (staff id) or group (id) is required' });
      }
      if (ghostObserve && observePeer && !Number.isNaN(observePeer) && observePeer !== other) {
        const rowA = await loadStaffRow(other);
        const rowB = await loadStaffRow(observePeer);
        if (!rowA || !rowB) {
          return res.status(404).json({ error: 'Staff member not found' });
        }
        const { rows } = await pool.query(
          `SELECT m.id, m.sender_staff_id, m.recipient_staff_id, m.body, m.attachment_path,
                  m.attachment_original_name, m.created_at,
                  s.display_name AS sender_name, s.role AS sender_role, s.avatar_url AS sender_avatar_url
           FROM staff_direct_messages m
           JOIN school_staff s ON s.id = m.sender_staff_id
           WHERE (m.sender_staff_id = $1 AND m.recipient_staff_id = $2)
              OR (m.sender_staff_id = $2 AND m.recipient_staff_id = $1)
           ORDER BY m.created_at ASC`,
          [other, observePeer]
        );
        const peerObserve = {
          id: other,
          peer_staff_id: observePeer,
          display_name: String(rowA.display_name || 'Staff') + ' ↔ ' + String(rowB.display_name || 'Staff'),
          role_label: staffRoleLabel(rowA.role) + ' · ' + staffRoleLabel(rowB.role),
          workspace_label: staffRoleLabel(rowA.role) + ' · ' + staffRoleLabel(rowB.role),
          observer: true,
        };
        return res.json({
          kind: 'dm',
          observer: true,
          peer: peerObserve,
          messages: rows.map((m) => ({
            id: m.id,
            sender_staff_id: m.sender_staff_id,
            recipient_staff_id: m.recipient_staff_id,
            sender_name: m.sender_name,
            sender_role: m.sender_role,
            sender_role_label: staffRoleLabel(m.sender_role),
            sender_avatar_url: m.sender_avatar_url || null,
            body: m.body,
            attachment_path: m.attachment_path,
            attachment_original_name: m.attachment_original_name,
            created_at: m.created_at,
            is_mine: false,
            receipt_tick: null,
          })),
        });
      }
      const otherRow = await loadStaffRow(other);
      if (!otherRow || !otherRow.active) {
        return res.status(404).json({ error: 'Staff member not found' });
      }
      const { rows } = await pool.query(
        `SELECT m.id, m.sender_staff_id, m.recipient_staff_id, m.body, m.attachment_path,
                m.attachment_original_name, m.created_at,
                s.display_name AS sender_name, s.role AS sender_role, s.avatar_url AS sender_avatar_url
         FROM staff_direct_messages m
         JOIN school_staff s ON s.id = m.sender_staff_id
         WHERE (m.sender_staff_id = $1 AND m.recipient_staff_id = $2)
            OR (m.sender_staff_id = $2 AND m.recipient_staff_id = $1)
         ORDER BY m.created_at ASC`,
        [me, other]
      );
      if (!ghostObserve) {
        await recordDeliveredStaffDm(rows, me);
        await markStaffDmPeerSeen(me, other);
        await attachStaffDmReceiptTicks(rows, me);
      }
      res.json({
        kind: 'dm',
        observer: ghostObserve,
        peer: mapStaffContactRow(otherRow),
        messages: rows.map((m) => ({
          id: m.id,
          sender_staff_id: m.sender_staff_id,
          recipient_staff_id: m.recipient_staff_id,
          sender_name: m.sender_name,
          sender_role: m.sender_role,
          sender_role_label: staffRoleLabel(m.sender_role),
          sender_avatar_url: m.sender_avatar_url || null,
          body: m.body,
          attachment_path: m.attachment_path,
          attachment_original_name: m.attachment_original_name,
          created_at: m.created_at,
          is_mine: Number(m.sender_staff_id) === me,
          receipt_tick: m.receipt_tick != null ? Number(m.receipt_tick) : null,
        })),
      });
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Private messages need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.post(
  '/api/staff-messages/groups',
  requireStaffRoles(STAFF_DM_ROLES),
  asyncRoute(async (req, res) => {
    try {
      const me = Number(req.staffSession.id);
      const { name, member_ids } = req.body || {};
      const groupName = String(name || '').trim();
      if (!groupName) return res.status(400).json({ error: 'Group name is required' });
      if (groupName.length > 80) return res.status(400).json({ error: 'Group name max 80 characters' });
      const rawIds = Array.isArray(member_ids) ? member_ids : [];
      const memberSet = new Set([me]);
      rawIds.forEach((x) => {
        const id = Number(x);
        if (id && !Number.isNaN(id) && id !== me) memberSet.add(id);
      });
      if (memberSet.size < 2) {
        return res.status(400).json({ error: 'Select at least one other staff member for the group' });
      }
      const memberList = [...memberSet];
      const activeCheck = await pool.query(
        `SELECT id FROM school_staff WHERE id = ANY($1::int[]) AND active = TRUE`,
        [memberList]
      );
      if (activeCheck.rows.length !== memberList.length) {
        return res.status(400).json({ error: 'One or more selected accounts are missing or disabled' });
      }
      const { rows: gRows } = await pool.query(
        `INSERT INTO staff_message_groups (name, created_by_staff_id)
         VALUES ($1, $2)
         RETURNING id, name, created_by_staff_id, created_at`,
        [groupName, me]
      );
      const group = gRows[0];
      const values = memberList.map((_, i) => `($1, $${i + 2})`).join(', ');
      await pool.query(
        `INSERT INTO staff_message_group_members (group_id, staff_id) VALUES ${values}`,
        [group.id, ...memberList]
      );
      res.status(201).json({
        id: group.id,
        name: group.name,
        member_count: memberList.length,
        kind: 'group',
      });
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Group chats need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.post(
  '/api/staff-messages',
  requireStaffRoles(STAFF_DM_ROLES),
  uploadClassMessage.single('attachment'),
  asyncRoute(async (req, res) => {
    try {
      const me = Number(req.staffSession.id);
      const groupId = parseInt(req.body.group_id, 10);
      if (groupId && !Number.isNaN(groupId)) {
        if (!(await isStaffGroupMember(groupId, me))) {
          if (req.file) {
            try {
              fs.unlinkSync(req.file.path);
            } catch (_) {}
          }
          return res.status(403).json({ error: 'You are not a member of this group' });
        }
        const bodyStr = req.body.body != null ? String(req.body.body).trim() : '';
        let attachPath = null;
        let attachOrig = null;
        if (req.file) {
          attachPath = `/uploads/class-messages/${req.file.filename}`;
          attachOrig = path.basename(req.file.originalname || '') || req.file.filename;
        }
        if (!bodyStr && !attachPath) {
          if (req.file) {
            try {
              fs.unlinkSync(req.file.path);
            } catch (_) {}
          }
          return res.status(400).json({ error: 'Message text or attachment required' });
        }
        if (bodyStr.length > 8000) {
          if (req.file) {
            try {
              fs.unlinkSync(req.file.path);
            } catch (_) {}
          }
          return res.status(400).json({ error: 'Message too long (max 8000 characters)' });
        }
        const { rows } = await pool.query(
          `INSERT INTO staff_group_messages (group_id, sender_staff_id, body, attachment_path, attachment_original_name)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, group_id, sender_staff_id, body, attachment_path, attachment_original_name, created_at`,
          [groupId, me, bodyStr || null, attachPath, attachOrig]
        );
        const sender = await loadStaffRow(me);
        const m = rows[0];
        return res.status(201).json({
          id: m.id,
          group_id: m.group_id,
          sender_staff_id: m.sender_staff_id,
          sender_name: sender ? sender.display_name : 'Staff',
          sender_role: sender ? sender.role : '',
          sender_role_label: staffRoleLabel(sender && sender.role),
          sender_avatar_url: sender ? sender.avatar_url || null : null,
          body: m.body,
          attachment_path: m.attachment_path,
          attachment_original_name: m.attachment_original_name,
          created_at: m.created_at,
          is_mine: true,
        });
      }
      const recipientId = parseInt(req.body.recipient_staff_id, 10);
      if (!recipientId || Number.isNaN(recipientId)) {
        if (req.file) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (_) {}
        }
        return res.status(400).json({ error: 'recipient_staff_id is required' });
      }
      if (recipientId === me) {
        if (req.file) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (_) {}
        }
        return res.status(400).json({ error: 'Cannot message yourself' });
      }
      const recipient = await loadStaffRow(recipientId);
      if (!recipient || !recipient.active) {
        if (req.file) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (_) {}
        }
        return res.status(404).json({ error: 'Recipient not found' });
      }
      const bodyStr = req.body.body != null ? String(req.body.body).trim() : '';
      let attachPath = null;
      let attachOrig = null;
      if (req.file) {
        attachPath = `/uploads/class-messages/${req.file.filename}`;
        attachOrig = path.basename(req.file.originalname || '') || req.file.filename;
      }
      if (!bodyStr && !attachPath) {
        if (req.file) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (_) {}
        }
        return res.status(400).json({ error: 'Message text or attachment required' });
      }
      if (bodyStr.length > 8000) {
        if (req.file) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (_) {}
        }
        return res.status(400).json({ error: 'Message too long (max 8000 characters)' });
      }
      const { rows } = await pool.query(
        `INSERT INTO staff_direct_messages (sender_staff_id, recipient_staff_id, body, attachment_path, attachment_original_name)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, sender_staff_id, recipient_staff_id, body, attachment_path, attachment_original_name, created_at`,
        [me, recipientId, bodyStr || null, attachPath, attachOrig]
      );
      const sender = await loadStaffRow(me);
      const m = rows[0];
      res.status(201).json({
        id: m.id,
        sender_staff_id: m.sender_staff_id,
        recipient_staff_id: m.recipient_staff_id,
        sender_name: sender ? sender.display_name : 'Staff',
        sender_role: sender ? sender.role : '',
        sender_role_label: staffRoleLabel(sender && sender.role),
        sender_avatar_url: sender ? sender.avatar_url || null : null,
        body: m.body,
        attachment_path: m.attachment_path,
        attachment_original_name: m.attachment_original_name,
        created_at: m.created_at,
        is_mine: true,
        receipt_tick: 1,
      });
    } catch (err) {
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) {}
      }
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Private messages need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.post(
  '/api/staff-messages/clear',
  requireStaffRoles(STAFF_DM_ROLES),
  asyncRoute(async (req, res) => {
    try {
      const me = Number(req.staffSession.id);
      const groupId = parseInt(req.body && req.body.group_id, 10);
      if (groupId && !Number.isNaN(groupId)) {
        if (sessionIsSystemAdmin(req)) {
          return res.status(403).json({ error: 'System admin can only view this group, not clear it.' });
        }
        if (!(await isStaffGroupMember(groupId, me))) {
          return res.status(403).json({ error: 'You are not a member of this group' });
        }
        const { rows: att } = await pool.query(
          `SELECT attachment_path FROM staff_group_messages WHERE group_id = $1 AND attachment_path IS NOT NULL`,
          [groupId]
        );
        att.forEach((r) => unlinkClassMessageAttachment(r.attachment_path));
        await pool.query(`DELETE FROM staff_group_messages WHERE group_id = $1`, [groupId]);
        return res.json({ ok: true, cleared: 'group', group_id: groupId });
      }
      const other = parseInt(req.body && req.body.with, 10);
      if (!other || Number.isNaN(other)) {
        return res.status(400).json({ error: 'with (staff id) or group_id is required' });
      }
      if (other === me) return res.status(400).json({ error: 'Cannot clear a conversation with yourself' });
      const otherRow = await loadStaffRow(other);
      if (!otherRow || !otherRow.active) return res.status(404).json({ error: 'Staff member not found' });
      if (sessionIsSystemAdmin(req)) {
        const { rows: ghostDm } = await pool.query(
          `SELECT 1 FROM staff_direct_messages
           WHERE (sender_staff_id = $1 AND recipient_staff_id = $2)
              OR (sender_staff_id = $2 AND recipient_staff_id = $1)
           LIMIT 1`,
          [me, other]
        );
        if (!ghostDm.length) {
          return res.status(403).json({
            error: 'System admin can only view this conversation, not clear it.',
          });
        }
      }
      const { rows: att } = await pool.query(
        `SELECT attachment_path FROM staff_direct_messages
         WHERE (sender_staff_id = $1 AND recipient_staff_id = $2)
            OR (sender_staff_id = $2 AND recipient_staff_id = $1)`,
        [me, other]
      );
      att.forEach((r) => unlinkClassMessageAttachment(r.attachment_path));
      await pool.query(
        `DELETE FROM staff_direct_messages
         WHERE (sender_staff_id = $1 AND recipient_staff_id = $2)
            OR (sender_staff_id = $2 AND recipient_staff_id = $1)`,
        [me, other]
      );
      res.json({ ok: true, cleared: 'dm', with: other });
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Private messages need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.delete(
  '/api/staff-messages/:id',
  requireStaffRoles(STAFF_DM_ROLES),
  asyncRoute(async (req, res) => {
    try {
      const me = Number(req.staffSession.id);
      const id = parseInt(req.params.id, 10);
      if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'Valid id required' });
      const scope = String(req.query.scope || req.query.kind || 'dm').toLowerCase();
      if (scope === 'group') {
        const { rows } = await pool.query(
          `SELECT m.id, m.sender_staff_id, m.group_id, m.attachment_path
           FROM staff_group_messages m
           WHERE m.id = $1`,
          [id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Message not found' });
        if (Number(rows[0].sender_staff_id) !== me) {
          return res.status(403).json({ error: 'You can only delete messages you sent' });
        }
        if (!(await isStaffGroupMember(rows[0].group_id, me))) {
          return res.status(403).json({ error: 'You are not a member of this group' });
        }
        unlinkClassMessageAttachment(rows[0].attachment_path);
        await pool.query(`DELETE FROM staff_group_messages WHERE id = $1`, [id]);
        return res.json({ ok: true });
      }
      const { rows } = await pool.query(
        `SELECT id, sender_staff_id, attachment_path FROM staff_direct_messages WHERE id = $1`,
        [id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Message not found' });
      if (Number(rows[0].sender_staff_id) !== me) {
        return res.status(403).json({ error: 'You can only delete messages you sent' });
      }
      unlinkClassMessageAttachment(rows[0].attachment_path);
      await pool.query(`DELETE FROM staff_direct_messages WHERE id = $1`, [id]);
      res.json({ ok: true });
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Private messages need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.post(
  '/api/staff-messages/read-with',
  requireStaffRoles(STAFF_DM_ROLES),
  asyncRoute(async (req, res) => {
    try {
      if (sessionIsSystemAdmin(req)) {
        return res.json({ ok: true, observer: true });
      }
      const me = Number(req.staffSession.id);
      const groupId = parseInt(req.body && req.body.group_id, 10);
      if (groupId && !Number.isNaN(groupId)) {
        if (!(await isStaffGroupMember(groupId, me))) {
          return res.status(403).json({ error: 'You are not a member of this group' });
        }
        await markStaffGroupSeen(me, groupId);
        return res.json({ ok: true, reader_id: me, group_id: groupId });
      }
      const other = parseInt(req.body && req.body.with, 10);
      if (!other || Number.isNaN(other)) {
        return res.status(400).json({ error: 'with (staff id) or group_id is required' });
      }
      if (other === me) {
        return res.status(400).json({ error: 'Cannot mark a conversation with yourself' });
      }
      const otherRow = await loadStaffRow(other);
      if (!otherRow || !otherRow.active) {
        return res.status(404).json({ error: 'Staff member not found' });
      }
      await markStaffDmPeerSeen(me, other);
      res.json({ ok: true, reader_id: me, peer_id: other });
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Private messages need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.post(
  '/api/staff-messages/seen',
  requireStaffRoles(STAFF_DM_ROLES),
  asyncRoute(async (req, res) => {
    try {
      if (sessionIsSystemAdmin(req)) {
        return res.json({ ok: true, observer: true });
      }
      const me = Number(req.staffSession.id);
      const rawIds = req.body && req.body.messageIds;
      const ids = Array.isArray(rawIds)
        ? rawIds
            .map((x) => parseInt(x, 10))
            .filter((n) => !Number.isNaN(n) && n > 0)
            .slice(0, 400)
        : [];
      if (!ids.length) return res.status(400).json({ error: 'messageIds required' });
      await pool.query(
        `INSERT INTO staff_direct_message_receipts (message_id, reader_staff_id, delivered_at, seen_at)
         SELECT m.id, $2, NOW(), NOW()
         FROM staff_direct_messages m
         WHERE m.id = ANY($1::int[])
           AND m.recipient_staff_id = $2
         ON CONFLICT (message_id, reader_staff_id)
         DO UPDATE SET
           delivered_at = COALESCE(staff_direct_message_receipts.delivered_at, EXCLUDED.delivered_at),
           seen_at = NOW()`,
        [ids, me]
      );
      res.json({ ok: true });
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Private messages need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.get(
  '/api/comments',
  asyncRoute(async (req, res) => {
    const { classLevel, stream, subject, term, period } = req.query;
    const academicYear = await resolveAcademicYear(req.query.year);
    if (!classLevel) return res.status(400).json({ error: 'classLevel required' });
    const cl = String(classLevel).trim();
    const streamKey = normalizeClassStream(stream);
    const roster = await rosterStudentsForClassYear(cl, streamKey, academicYear);
    const ids = roster.map((r) => Number(r.id)).filter((x) => Number.isFinite(x));
    if (!ids.length) return res.json([]);
    let q = `
      SELECT c.id, c.student_id, c.subject, c.term, c.period, c.academic_year, c.body, c.author_role, c.updated_at
      FROM student_subject_comments c
      WHERE c.student_id = ANY($1::int[]) AND c.academic_year = $2`;
    const params = [ids, academicYear];
    let n = 3;
    if (subject) {
      q += ` AND c.subject = $${n++}`;
      params.push(subject);
    }
    if (term) {
      q += ` AND c.term = $${n++}`;
      params.push(Number(term));
    }
    if (period && isValidReportPeriod(period)) {
      q += ` AND c.period = $${n++}`;
      params.push(normalizeReportPeriod(period));
    }
    const { rows } = await pool.query(q, params);
    const byId = new Map(roster.map((r) => [String(r.id), r]));
    const out = rows
      .map((r) => {
        const s = byId.get(String(r.student_id));
        if (!s) return null;
        return Object.assign({}, r, {
          full_name: s.full_name,
          reg_no: s.reg_no,
          class_level: s.class_level,
          stream: s.stream || null,
          passport_path: s.passport_path || null,
        });
      })
      .filter(Boolean)
      .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
    res.json(out);
  })
);

/** All subject comments for a term/period (head teacher review). Optional filters narrow the set. */
app.get(
  '/api/comments/school-review',
  asyncRoute(async (req, res) => {
    const { term, period, classLevel, stream, subject } = req.query;
    const academicYear = await resolveAcademicYear(req.query.year);
    if (!term || !period) return res.status(400).json({ error: 'term and period (begin|mid|end) required' });
    const termNum = Number(term);
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    if (!isValidReportPeriod(period)) return res.status(400).json({ error: 'period must be begin, mid, or end' });
    let q = `
      SELECT c.id, c.student_id, c.subject, c.term, c.period, c.body, c.author_role, c.updated_at,
             s.full_name, s.reg_no, s.class_level, s.stream, s.passport_path
      FROM student_subject_comments c
      INNER JOIN students s ON s.id = c.student_id
      WHERE c.term = $1 AND c.period = $2 AND c.academic_year = $3`;
    const params = [termNum, period, academicYear];
    let n = 4;
    if (classLevel && String(classLevel).trim()) {
      q += ` AND s.class_level = $${n++}`;
      params.push(String(classLevel).trim());
    }
    if (stream !== undefined && stream !== null && String(stream).trim()) {
      q += ` AND LOWER(TRIM(COALESCE(s.stream, ''))) = LOWER(TRIM($${n++}))`;
      params.push(String(stream).trim());
    }
    if (subject && String(subject).trim()) {
      q += ` AND TRIM(c.subject) = TRIM($${n++}::text)`;
      params.push(String(subject).trim());
    }
    q += ' ORDER BY s.class_level ASC, s.stream ASC NULLS FIRST, s.full_name ASC, c.subject ASC';
    const { rows } = await pool.query(q, params);
    res.json(rows);
  })
);

/** Head teacher: edit comment text only (author_role unchanged). */
app.patch(
  '/api/comments/head-review',
  asyncRoute(async (req, res) => {
    const { student_id, subject, term, period, body } = req.body;
    const academicYear = await resolveAcademicYear(req.body && req.body.year);
    if (!student_id || !subject || !term || !period || body == null) {
      return res.status(400).json({ error: 'student_id, subject, term, period, body required' });
    }
    if (!isValidReportPeriod(period)) {
      return res.status(400).json({ error: 'period must be begin, mid, or end' });
    }
    const termNum = Number(term);
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    const sid = Number(student_id);
    if (!sid || Number.isNaN(sid)) return res.status(400).json({ error: 'Invalid student_id' });
    const st = await pool.query('SELECT class_level, stream FROM students WHERE id = $1', [sid]);
    if (!st.rows.length) return res.status(404).json({ error: 'Student not found' });
    if (await isReportLocked(st.rows[0].class_level, st.rows[0].stream || '', termNum, period)) {
      return res.status(423).json({ error: 'This term report is locked. Unlock it from Reports before editing.' });
    }
    const subj = String(subject).trim();
    const bodyStr = String(body).trim();
    if (!bodyStr.length) return res.status(400).json({ error: 'Comment cannot be empty' });
    if (bodyStr.length > 300) return res.status(400).json({ error: 'Comment max 300 characters' });
    const prev = (
      await pool.query(
        `SELECT body FROM student_subject_comments
         WHERE student_id = $1 AND TRIM(subject) = TRIM($2::text) AND term = $3 AND period = $4 AND academic_year = $5`,
        [sid, subj, termNum, period, academicYear]
      )
    ).rows[0] || null;
    const r = await pool.query(
      `UPDATE student_subject_comments
       SET body = $1, updated_at = NOW()
       WHERE student_id = $2 AND TRIM(subject) = TRIM($3::text) AND term = $4 AND period = $5 AND academic_year = $6
       RETURNING id, student_id, subject, term, period, academic_year, body, author_role, updated_at`,
      [bodyStr, sid, subj, termNum, period, academicYear]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'No comment found for this learner, subject, and term slot' });
    await appendReportAudit({
      classLevel: st.rows[0].class_level,
      stream: st.rows[0].stream || '',
      studentId: sid,
      term: termNum,
      period: period,
      action: 'update',
      entityType: 'subject_comment',
      subject: subj,
      oldValue: prev || {},
      newValue: { body: r.rows[0].body, author_role: r.rows[0].author_role },
      actor: 'head_teacher',
    });
    res.json(r.rows[0]);
  })
);

app.get(
  '/api/settings/grading-scale',
  asyncRoute(async (_req, res) => {
    const bands = await getGradingBands();
    res.json({ bands });
  })
);

const saveGradingScale = asyncRoute(async (req, res) => {
  let raw = req.body;
  if (raw && raw.bands) raw = raw.bands;
  const bands = normalizeGradingBands(Array.isArray(raw) ? raw : []);
  if (!bands.length) {
    return res.status(400).json({ error: 'Provide a non-empty bands array: { min, max, agg, remark }' });
  }
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('primary_grading_scale', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(bands)]
  );
  res.json({ bands });
});

app.put('/api/settings/grading-scale', saveGradingScale);
app.post('/api/settings/grading-scale', saveGradingScale);

app.get(
  '/api/marks/aggregate',
  asyncRoute(async (req, res) => {
    const { student_id, term, period } = req.query;
    const academicYear = await resolveAcademicYear(req.query.year);
    const sid = Number(student_id);
    if (!sid) return res.status(400).json({ error: 'student_id required' });
    if (!term || !period || !isValidReportPeriod(period)) {
      return res.status(400).json({ error: 'term and period (begin|mid|end) required' });
    }
    const termNum = Number(term);
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    const { rows } = await pool.query(
      `SELECT subject, agg FROM student_subject_marks WHERE student_id = $1 AND term = $2 AND period = $3 AND academic_year = $4`,
      [sid, termNum, period, academicYear]
    );
    const agg = primaryAggregateFromMarkRows(rows, SKILL_SUBJECTS);
    res.json({
      sum: agg.sum,
      subject_count: agg.count,
      equivalent_aggregate: agg.equivalentAggregate,
      division: agg.division,
    });
  })
);

app.get(
  '/api/marks',
  asyncRoute(async (req, res) => {
    const { classLevel, stream, subject, term, period } = req.query;
    if (!classLevel) return res.status(400).json({ error: 'classLevel required' });
    const academicYear = await resolveAcademicYear(req.query.year);
    const cl = String(classLevel).trim();
    const streamKey = normalizeClassStream(stream);
    const roster = await rosterStudentsForClassYear(cl, streamKey, academicYear);
    const ids = roster.map((r) => Number(r.id)).filter((x) => Number.isFinite(x));
    if (!ids.length) return res.json([]);
    let q = `
      SELECT m.id, m.student_id, m.subject, m.term, m.period, m.academic_year, m.marks_scored,
             m.agg, m.remark, m.initials, m.updated_at
      FROM student_subject_marks m
      WHERE m.student_id = ANY($1::int[]) AND m.academic_year = $2`;
    const params = [ids, academicYear];
    let n = 3;
    if (subject) {
      q += ` AND m.subject = $${n++}`;
      params.push(subject);
    }
    if (term) {
      q += ` AND m.term = $${n++}`;
      params.push(Number(term));
    }
    if (period && isValidReportPeriod(period)) {
      q += ` AND m.period = $${n++}`;
      params.push(normalizeReportPeriod(period));
    }
    const { rows } = await pool.query(q, params);
    const byId = new Map(roster.map((r) => [String(r.id), r]));
    const out = rows
      .map((r) => {
        const s = byId.get(String(r.student_id));
        if (!s) return null;
        return Object.assign({}, r, {
          full_name: s.full_name,
          reg_no: s.reg_no,
          class_level: s.class_level,
          stream: s.stream || null,
          passport_path: s.passport_path || null,
        });
      })
      .filter(Boolean)
      .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
    res.json(out);
  })
);

app.post(
  '/api/marks',
  optionalStaffSession,
  asyncRoute(async (req, res) => {
    const { student_id, subject, term, period, marks_scored, initials } = req.body;
    const academicYear = await resolveAcademicYear(req.body && req.body.year);
    if (!student_id || !subject || !term || !period) {
      return res.status(400).json({ error: 'student_id, subject, term, period required' });
    }
    if (!isValidReportPeriod(period)) {
      return res.status(400).json({ error: 'period must be begin, mid, or end' });
    }
    const termNum = Number(term);
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    const sid = Number(student_id);
    const st = await pool.query('SELECT class_level, stream FROM students WHERE id = $1', [sid]);
    if (!st.rows.length) return res.status(404).json({ error: 'Student not found' });
    const cl = st.rows[0].class_level;
    const streamVal = st.rows[0].stream || '';
    if (await isReportLocked(cl, streamVal, termNum, period)) {
      return res.status(423).json({ error: 'This term report is locked. Unlock it from Reports before editing.' });
    }
    const subj = String(subject).trim();
    if (!isPrimaryLevel(cl)) {
      return res.status(400).json({ error: 'Marks are only for Primary classes' });
    }
    if (SKILL_SUBJECTS.includes(subj)) {
      return res.status(400).json({ error: 'Skill subjects use comments from the Skills workspace, not marks here' });
    }

    const rawScore = marks_scored;
    const hasScore =
      rawScore !== null && rawScore !== undefined && String(String(rawScore).trim()) !== '';
    const prevMark = (
      await pool.query(
        `SELECT marks_scored, agg, remark, initials
         FROM student_subject_marks WHERE student_id = $1 AND subject = $2 AND term = $3 AND period = $4 AND academic_year = $5`,
        [sid, subj, termNum, period, academicYear]
      )
    ).rows[0] || null;
    if (!hasScore) {
      await pool.query(
        `DELETE FROM student_subject_marks
         WHERE student_id = $1 AND subject = $2 AND term = $3 AND period = $4 AND academic_year = $5`,
        [sid, subj, termNum, period, academicYear]
      );
      await clearStoredMarkDivisions(sid, termNum, period, academicYear);
      await appendReportAudit({
        classLevel: cl,
        stream: streamVal,
        studentId: sid,
        term: termNum,
        period: period,
        action: 'delete',
        entityType: 'marks',
        subject: subj,
        oldValue: prevMark || {},
        newValue: {},
        actor: resolveReportActor(req, 'class_teacher'),
      });
      return res.json({ deleted: true });
    }

    const scored = Number(rawScore);
    if (Number.isNaN(scored) || scored < 0) {
      return res.status(400).json({ error: 'marks_scored must be a non-negative number' });
    }
    if (scored > 100) {
      return res.status(400).json({ error: 'marks_scored cannot exceed 100' });
    }

    const bands = await getGradingBands();
    const pct = scored;
    const g = gradeFromPercent(pct, bands);
    const ini = initials != null ? String(initials).trim().slice(0, 12) : '';

    await pool.query(
      `INSERT INTO student_subject_marks
        (student_id, subject, term, period, academic_year, full_marks, marks_scored, agg, remark, division, initials)
       VALUES ($1, $2, $3, $4, $5, 100, $6, $7, $8, '', $9)
       ON CONFLICT (student_id, subject, term, period, academic_year)
       DO UPDATE SET
         full_marks = 100,
         marks_scored = EXCLUDED.marks_scored,
         agg = EXCLUDED.agg,
         remark = EXCLUDED.remark,
         initials = EXCLUDED.initials,
         updated_at = NOW()
       RETURNING id`,
      [sid, subj, termNum, period, academicYear, scored, g.agg, g.remark, ini]
    );
    await clearStoredMarkDivisions(sid, termNum, period, academicYear);
    const { rows } = await pool.query(
      `SELECT id, student_id, subject, term, period, academic_year, marks_scored, agg, remark, initials, updated_at
       FROM student_subject_marks WHERE student_id = $1 AND subject = $2 AND term = $3 AND period = $4 AND academic_year = $5`,
      [sid, subj, termNum, period, academicYear]
    );
    const r = rows[0];
    const aggInfo = primaryAggregateFromMarkRows(
      (
        await pool.query(
          `SELECT subject, agg FROM student_subject_marks WHERE student_id = $1 AND term = $2 AND period = $3 AND academic_year = $4`,
          [sid, termNum, period, academicYear]
        )
      ).rows,
      SKILL_SUBJECTS
    );
    const payload = {
      id: r.id,
      student_id: r.student_id,
      subject: r.subject,
      term: r.term,
      period: r.period,
      marks_scored: r.marks_scored != null ? Number(r.marks_scored) : null,
      agg: r.agg,
      remark: r.remark,
      initials: r.initials,
      updated_at: r.updated_at,
      aggregate: {
        sum: aggInfo.sum,
        subject_count: aggInfo.count,
        equivalent_aggregate: aggInfo.equivalentAggregate,
        division: aggInfo.division,
      },
    };
    await appendReportAudit({
      classLevel: cl,
      stream: streamVal,
      studentId: sid,
      term: termNum,
      period: period,
      action: prevMark ? 'update' : 'create',
      entityType: 'marks',
      subject: subj,
      oldValue: prevMark || {},
      newValue: {
        marks_scored: r.marks_scored != null ? Number(r.marks_scored) : null,
        agg: r.agg,
        remark: r.remark,
        initials: r.initials,
      },
      actor: resolveReportActor(req, 'class_teacher'),
    });
    res.status(201).json(payload);
  })
);

app.post(
  '/api/comments',
  optionalStaffSession,
  asyncRoute(async (req, res) => {
    const { student_id, subject, term, period, body, author_role } = req.body;
    const academicYear = await resolveAcademicYear(req.body && req.body.year);
    const role = author_role === 'skill_teacher' ? 'skill_teacher' : 'class_teacher';
    if (!student_id || !subject || !term || !period || body == null) {
      return res.status(400).json({ error: 'student_id, subject, term, period, body required' });
    }
    if (!isValidReportPeriod(period)) {
      return res.status(400).json({ error: 'period must be begin, mid, or end' });
    }
    const termNum = Number(term);
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    const sid = Number(student_id);
    const st = await pool.query('SELECT class_level, stream FROM students WHERE id = $1', [sid]);
    if (!st.rows.length) return res.status(404).json({ error: 'Student not found' });
    const cl = st.rows[0].class_level;
    const streamVal = st.rows[0].stream || '';
    if (await isReportLocked(cl, streamVal, termNum, period)) {
      return res.status(423).json({ error: 'This term report is locked. Unlock it from Reports before editing.' });
    }
    const subj = String(subject).trim();
    const bodyStr = String(body).trim();
    if (!bodyStr.length) return res.status(400).json({ error: 'Comment cannot be empty' });
    if (bodyStr.length > 300) return res.status(400).json({ error: 'Comment max 300 characters' });

    if (isPrimaryLevel(cl) && !SKILL_SUBJECTS.includes(subj) && role === 'class_teacher') {
      return res.status(403).json({
        error: 'Primary subjects (except skills) use marks in the Comments tab, not text comments.',
      });
    }
    if (role === 'skill_teacher' && !SKILL_SUBJECTS.includes(subj)) {
      return res.status(400).json({ error: 'Skill comments must use a skill subject' });
    }

    const prev = (
      await pool.query(
        `SELECT body, author_role FROM student_subject_comments
         WHERE student_id = $1 AND subject = $2 AND term = $3 AND period = $4 AND academic_year = $5`,
        [sid, subj, termNum, period, academicYear]
      )
    ).rows[0] || null;
    const { rows } = await pool.query(
      `INSERT INTO student_subject_comments (student_id, subject, term, period, academic_year, body, author_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (student_id, subject, term, period, academic_year)
       DO UPDATE SET body = EXCLUDED.body, author_role = EXCLUDED.author_role, updated_at = NOW()
       RETURNING *`,
      [sid, subj, termNum, period, academicYear, bodyStr, role]
    );
    await appendReportAudit({
      classLevel: cl,
      stream: streamVal,
      studentId: sid,
      term: termNum,
      period: period,
      action: prev ? 'update' : 'create',
      entityType: 'subject_comment',
      subject: subj,
      oldValue: prev || {},
      newValue: { body: rows[0].body, author_role: rows[0].author_role },
      actor: resolveReportActor(req, role),
    });
    res.status(201).json(rows[0]);
  })
);

app.get(
  '/api/head-comments',
  asyncRoute(async (req, res) => {
    try {
      const { classLevel, stream, term, period } = req.query;
      const academicYear = await resolveAcademicYear(req.query.year);
      if (!classLevel) return res.status(400).json({ error: 'classLevel required' });
      const cl = String(classLevel).trim();
      const streamKey = normalizeClassStream(stream);
      const roster = await rosterStudentsForClassYear(cl, streamKey, academicYear);
      const ids = roster.map((r) => Number(r.id)).filter((x) => Number.isFinite(x));
      if (!ids.length) return res.json([]);
      let q = `
      SELECT h.student_id, h.term, h.period, h.academic_year, h.body, h.updated_at
      FROM student_head_comments h
      WHERE h.student_id = ANY($1::int[]) AND h.academic_year = $2`;
      const params = [ids, academicYear];
      let n = 3;
      if (term != null && String(term).trim() !== '') {
        q += ` AND h.term = $${n++}`;
        params.push(Number(term));
      }
      if (period && isValidReportPeriod(period)) {
        q += ` AND h.period = $${n++}`;
        params.push(normalizeReportPeriod(period));
      }
      const { rows } = await pool.query(q, params);
      const byId = new Map(roster.map((r) => [String(r.id), r]));
      const out = rows
        .map((r) => {
          const s = byId.get(String(r.student_id));
          if (!s) return null;
          return Object.assign({}, r, {
            full_name: s.full_name,
            reg_no: s.reg_no,
            class_level: s.class_level,
            stream: s.stream || null,
          });
        })
        .filter(Boolean)
        .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
      res.json(out);
    } catch (err) {
      if (err.code === '42P01' || err.code === '42703') {
        return res.status(503).json({
          error: 'Head comments need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.post(
  '/api/head-comments',
  asyncRoute(async (req, res) => {
    try {
      const { student_id, term, period, body } = req.body;
      const actor = req.body && String(req.body.actor || '').trim() === 'head_teacher' ? 'head_teacher' : 'class_teacher';
      const academicYear = await resolveAcademicYear(req.body && req.body.year);
      const sid = Number(student_id);
      const termNum = Number(term);
      const p = period;
      if (!sid || Number.isNaN(sid) || !termNum || !p || !isValidReportPeriod(p)) {
        return res.status(400).json({ error: 'student_id, term, period (begin|mid|end) required' });
      }
      if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
      const bodyStr = body != null ? String(body).trim() : '';
      if (bodyStr.length > 400) return res.status(400).json({ error: 'Comment max 400 characters' });
      const st = await pool.query('SELECT id, class_level, stream FROM students WHERE id = $1', [sid]);
      if (!st.rows.length) return res.status(404).json({ error: 'Student not found' });
      if (await isReportLocked(st.rows[0].class_level, st.rows[0].stream || '', termNum, p)) {
        return res.status(423).json({ error: 'This term report is locked. Unlock it from Reports before editing.' });
      }
      const prev = (
        await pool.query(`SELECT body FROM student_head_comments WHERE student_id = $1 AND term = $2 AND period = $3 AND academic_year = $4`, [
          sid,
          termNum,
          p,
          academicYear,
        ])
      ).rows[0] || null;
      if (!bodyStr.length) {
        await pool.query(`DELETE FROM student_head_comments WHERE student_id = $1 AND term = $2 AND period = $3 AND academic_year = $4`, [
          sid,
          termNum,
          p,
          academicYear,
        ]);
        await appendReportAudit({
          classLevel: st.rows[0].class_level,
          stream: st.rows[0].stream || '',
          studentId: sid,
          term: termNum,
          period: p,
          action: 'delete',
          entityType: 'head_comment',
          oldValue: prev || {},
          newValue: {},
          actor: 'head_teacher',
        });
        return res.json({ ok: true, deleted: true });
      }
      const { rows } = await pool.query(
        `INSERT INTO student_head_comments (student_id, term, period, academic_year, body)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (student_id, term, period, academic_year)
         DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()
         RETURNING *`,
        [sid, termNum, p, academicYear, bodyStr]
      );
      await appendReportAudit({
        classLevel: st.rows[0].class_level,
        stream: st.rows[0].stream || '',
        studentId: sid,
        term: termNum,
        period: p,
        action: prev ? 'update' : 'create',
        entityType: 'head_comment',
        oldValue: prev || {},
        newValue: { body: rows[0].body },
        actor: 'head_teacher',
      });
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '42P01' || err.code === '42703') {
        return res.status(503).json({
          error: 'Head comments need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.get(
  '/api/class-teacher-comments',
  asyncRoute(async (req, res) => {
    try {
      const { classLevel, stream, term, period } = req.query;
      const academicYear = await resolveAcademicYear(req.query.year);
      if (!classLevel) return res.status(400).json({ error: 'classLevel required' });
      const cl = String(classLevel).trim();
      const streamKey = normalizeClassStream(stream);
      const roster = await rosterStudentsForClassYear(cl, streamKey, academicYear);
      const ids = roster.map((r) => Number(r.id)).filter((x) => Number.isFinite(x));
      if (!ids.length) return res.json([]);
      let q = `
      SELECT c.student_id, c.term, c.period, c.academic_year, c.body, c.updated_at
      FROM student_class_teacher_comments c
      WHERE c.student_id = ANY($1::int[]) AND c.academic_year = $2`;
      const params = [ids, academicYear];
      let n = 3;
      if (term != null && String(term).trim() !== '') {
        q += ` AND c.term = $${n++}`;
        params.push(Number(term));
      }
      if (period && isValidReportPeriod(period)) {
        q += ` AND c.period = $${n++}`;
        params.push(normalizeReportPeriod(period));
      }
      const { rows } = await pool.query(q, params);
      const byId = new Map(roster.map((r) => [String(r.id), r]));
      const out = rows
        .map((r) => {
          const s = byId.get(String(r.student_id));
          if (!s) return null;
          return Object.assign({}, r, {
            full_name: s.full_name,
            reg_no: s.reg_no,
            class_level: s.class_level,
            stream: s.stream || null,
          });
        })
        .filter(Boolean)
        .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
      res.json(out);
    } catch (err) {
      if (err.code === '42P01' || err.code === '42703') {
        return res.status(503).json({
          error: 'Class teacher comments need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.post(
  '/api/class-teacher-comments',
  optionalStaffSession,
  asyncRoute(async (req, res) => {
    try {
      const actor = resolveReportActor(req, 'class_teacher');
      const { student_id, term, period, body } = req.body;
      const academicYear = await resolveAcademicYear(req.body && req.body.year);
      const sid = Number(student_id);
      const termNum = Number(term);
      const p = period;
      if (!sid || Number.isNaN(sid) || !termNum || !p || !isValidReportPeriod(p)) {
        return res.status(400).json({ error: 'student_id, term, period (begin|mid|end) required' });
      }
      if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
      const bodyStr = body != null ? String(body).trim() : '';
      if (bodyStr.length > 300) return res.status(400).json({ error: 'Comment max 300 characters' });
      const st = await pool.query('SELECT id, class_level, stream FROM students WHERE id = $1', [sid]);
      if (!st.rows.length) return res.status(404).json({ error: 'Student not found' });
      if (await isReportLocked(st.rows[0].class_level, st.rows[0].stream || '', termNum, p)) {
        return res.status(423).json({ error: 'This term report is locked. Unlock it from Reports before editing.' });
      }
      const prev = (
        await pool.query(
          `SELECT body FROM student_class_teacher_comments WHERE student_id = $1 AND term = $2 AND period = $3 AND academic_year = $4`,
          [sid, termNum, p, academicYear]
        )
      ).rows[0] || null;
      if (!bodyStr.length) {
        await pool.query(`DELETE FROM student_class_teacher_comments WHERE student_id = $1 AND term = $2 AND period = $3 AND academic_year = $4`, [
          sid,
          termNum,
          p,
          academicYear,
        ]);
        await appendReportAudit({
          classLevel: st.rows[0].class_level,
          stream: st.rows[0].stream || '',
          studentId: sid,
          term: termNum,
          period: p,
          action: 'delete',
          entityType: 'class_teacher_comment',
          oldValue: prev || {},
          newValue: {},
          actor: actor,
        });
        return res.json({ ok: true, deleted: true });
      }
      const { rows } = await pool.query(
        `INSERT INTO student_class_teacher_comments (student_id, term, period, academic_year, body)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (student_id, term, period, academic_year)
         DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()
         RETURNING *`,
        [sid, termNum, p, academicYear, bodyStr]
      );
      await appendReportAudit({
        classLevel: st.rows[0].class_level,
        stream: st.rows[0].stream || '',
        studentId: sid,
        term: termNum,
        period: p,
        action: prev ? 'update' : 'create',
        entityType: 'class_teacher_comment',
        oldValue: prev || {},
        newValue: { body: rows[0].body },
        actor: actor,
      });
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '42P01' || err.code === '42703') {
        return res.status(503).json({
          error: 'Class teacher comments need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.post(
  '/api/auth/staff-login',
  asyncRoute(async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ error: 'email and password required' });
      }
      const { rows } = await pool.query(
        `SELECT * FROM school_staff WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [String(email)]
      );
      if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
      const row = rows[0];
      if (!row.active) return res.status(401).json({ error: 'Account disabled' });
      if (!isSystemAdminRole(row.role) && (await isStaffSystemLocked())) {
        return res.status(503).json({
          error: 'All staff sign-ins are temporarily disabled. Contact your school administrator.',
        });
      }
      if (!verifyPassword(password, row.password_salt, row.password_hash)) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const token = signStaffSession(row);
      res.json({
        token,
        staff: staffClientProfile(row),
      });
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Staff accounts need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.post(
  '/api/auth/change-password',
  requireStaffRoles(STAFF_ACCOUNT_ROLES),
  asyncRoute(async (req, res) => {
    try {
      const staffId = req.staffSession && req.staffSession.id ? Number(req.staffSession.id) : null;
      if (!staffId) return res.status(401).json({ error: 'Unauthorized' });
      const { current_password, new_password } = req.body || {};
      if (!current_password || !new_password) {
        return res.status(400).json({ error: 'current_password and new_password are required' });
      }
      const next = String(new_password);
      if (next.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
      }
      const { rows } = await pool.query(
        `SELECT password_hash, password_salt FROM school_staff WHERE id = $1 AND active = TRUE`,
        [staffId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Account not found' });
      const row = rows[0];
      if (!verifyPassword(current_password, row.password_salt, row.password_hash)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      const { salt, hash } = hashPassword(next);
      await pool.query(
        `UPDATE school_staff SET password_hash = $2, password_salt = $3, updated_at = NOW() WHERE id = $1`,
        [staffId, hash, salt]
      );
      res.json({ ok: true, message: 'Account password has been changed.' });
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Staff accounts need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.get(
  '/api/auth/staff-me',
  asyncRoute(async (req, res) => {
    try {
      const token = bearerToken(req);
      const payload = verifyStaffSession(token);
      if (!payload) return res.status(401).json({ error: 'Unauthorized' });
      const { rows } = await pool.query(
        `SELECT id, email, display_name, role, class_level, stream, active, created_at, avatar_url
         FROM school_staff WHERE id = $1`,
        [payload.id]
      );
      if (!rows.length || !rows[0].active) return res.status(401).json({ error: 'Unauthorized' });
      const row = rows[0];
      if (!isSystemAdminRole(row.role) && (await isStaffSystemLocked())) {
        return res.status(503).json({
          error: 'All staff sign-ins are temporarily disabled by the system administrator.',
        });
      }
      res.json({
        ...staffClientProfile(row),
        active: row.active,
        created_at: row.created_at,
        role_label: staffRoleLabel(row.role),
        class_label: staffClassLabel(row.class_level, row.stream),
        workspace_label: staffWorkspaceLabel(row),
      });
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Staff accounts need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.patch(
  '/api/auth/staff-profile',
  requireStaffRoles(STAFF_ACCOUNT_ROLES),
  asyncRoute(async (req, res) => {
    try {
      const staffId = req.staffSession && req.staffSession.id ? Number(req.staffSession.id) : null;
      if (!staffId) return res.status(401).json({ error: 'Unauthorized' });
      const { display_name, avatar_url } = req.body || {};
      const sets = [];
      const params = [staffId];
      if (display_name !== undefined) {
        const name = String(display_name).trim();
        if (!name) return res.status(400).json({ error: 'display_name cannot be empty' });
        if (name.length > 80) return res.status(400).json({ error: 'display_name max 80 characters' });
        params.push(name);
        sets.push(`display_name = $${params.length}`);
      }
      if (avatar_url !== undefined) {
        const url = avatar_url === null || avatar_url === '' ? null : String(avatar_url).trim();
        if (url && url.length > 500) return res.status(400).json({ error: 'avatar_url too long' });
        params.push(url);
        sets.push(`avatar_url = $${params.length}`);
      }
      if (!sets.length) {
        return res.status(400).json({ error: 'display_name and/or avatar_url required' });
      }
      sets.push('updated_at = NOW()');
      const { rows } = await pool.query(
        `UPDATE school_staff SET ${sets.join(', ')} WHERE id = $1 AND active = TRUE
         RETURNING id, email, display_name, role, class_level, stream, avatar_url`,
        params
      );
      if (!rows.length) return res.status(404).json({ error: 'Account not found' });
      const row = rows[0];
      res.json({
        ...staffClientProfile(row),
        role_label: staffRoleLabel(row.role),
        class_label: staffClassLabel(row.class_level, row.stream),
        workspace_label: staffWorkspaceLabel(row),
      });
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Staff accounts need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.get(
  '/api/auth/dev-session',
  asyncRoute(async (req, res) => {
    if (!isLocalDevRequest(req)) {
      return res.status(403).json({ error: 'Dev sign-in is only available on localhost for testing' });
    }
    try {
      const as = String(req.query.as || 'head_teacher').trim();
      const allowed = ['director', 'head_teacher', 'class_teacher', 'skill_teacher', 'system_admin'];
      const role = allowed.includes(as) ? as : 'head_teacher';
      let { rows } = await pool.query(
        `SELECT id, email, display_name, role, class_level, stream, active, avatar_url
         FROM school_staff WHERE active = TRUE AND role = $1
         ORDER BY id LIMIT 1`,
        [role]
      );
      if (!rows.length) {
        const any = await pool.query(
          `SELECT id, email, display_name, role, class_level, stream, active, avatar_url
           FROM school_staff WHERE active = TRUE ORDER BY id LIMIT 1`
        );
        rows = any.rows;
      }
      if (!rows.length) {
        return res.status(404).json({
          error: 'No staff accounts found. Run: npm run db:init',
        });
      }
      const row = rows[0];
      const token = signStaffSession(row);
      res.json({
        token,
        staff: staffClientProfile(row),
      });
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Staff accounts need database update. Run: npm run db:init',
        });
      }
      throw err;
    }
  })
);

async function loadOverviewAnalyticsForRole(req) {
  let term = Number(req.query.term);
  if (Number.isNaN(term) || term < 1 || term > 3) term = 1;
  let period = req.query.period;
  if (period !== 'begin' && period !== 'mid' && period !== 'end') period = 'mid';
  const academicYear = await resolveAcademicYear(req.query.year);
  const [studentsR, commentsR, marksR, distRows, teachCnt, learnCnt, skillCnt, classCnt, anyComment, anyMark] =
    await Promise.all([
      pool.query(`SELECT id, class_level, COALESCE(TRIM(stream), '') AS stream FROM students ORDER BY id`),
      pool.query(
        `SELECT student_id, subject, body FROM student_subject_comments WHERE term = $1 AND period = $2 AND academic_year = $3`,
        [term, period, academicYear]
      ),
      pool.query(
        `SELECT student_id, subject, marks_scored FROM student_subject_marks WHERE term = $1 AND period = $2 AND academic_year = $3`,
        [term, period, academicYear]
      ),
      pool.query(`
        SELECT class_level, COALESCE(NULLIF(TRIM(stream), ''), '') AS stream, COUNT(*)::int AS count
        FROM students
        GROUP BY class_level, COALESCE(NULLIF(TRIM(stream), ''), '')
        ORDER BY 1, 2
      `),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM school_staff
         WHERE active = TRUE AND ${SQL_STAFF_LISTABLE}
           AND role IN ('class_teacher', 'skill_teacher', 'head_teacher')`
      ),
      pool.query(`SELECT COUNT(*)::int AS n FROM students`),
      pool.query(`SELECT COUNT(DISTINCT subject)::int AS n FROM skill_class_progress WHERE term = $1`, [term]),
      pool.query(`
        SELECT COUNT(*)::int AS n FROM (
          SELECT 1 FROM students
          GROUP BY class_level, COALESCE(NULLIF(TRIM(stream), ''), '')
        ) t
      `),
      pool.query(
        `SELECT COUNT(DISTINCT student_id)::int AS n FROM student_subject_comments
         WHERE term = $1 AND period = $2 AND academic_year = $3 AND TRIM(body) <> ''`,
        [term, period, academicYear]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT student_id)::int AS n FROM student_subject_marks
         WHERE term = $1 AND period = $2 AND academic_year = $3 AND marks_scored IS NOT NULL`,
        [term, period, academicYear]
      ),
    ]);

  const students = studentsR.rows;
  const { byClass, schoolSubjects } = computeSubjectProgress(students, commentsR.rows, marksR.rows);
  const totalLearners = learnCnt.rows[0].n;
  const withCommentAny = anyComment.rows[0].n;
  const withMarkAny = anyMark.rows[0].n;
  const activityPct = totalLearners ? Math.round((100 * withCommentAny) / totalLearners) : 0;
  const marksPct = totalLearners ? Math.round((100 * withMarkAny) / totalLearners) : 0;
  return {
    term,
    period,
    year: academicYear,
    totals: {
      learners: totalLearners,
      teachers: teachCnt.rows[0].n,
      classes: classCnt.rows[0].n,
      skillSubjectsWithProgress: skillCnt.rows[0].n,
    },
    learnerDistribution: distRows.rows,
    subjectProgressByClass: byClass,
    subjectProgressSchool: schoolSubjects,
    reportingSnapshot: {
      learnersWithAnySubjectComment: withCommentAny,
      learnersWithAnySubjectMark: withMarkAny,
      percentLearnersWithComment: activityPct,
      percentLearnersWithMark: marksPct,
    },
  };
}

app.get(
  '/api/director/overview',
  requireDirector,
  asyncRoute(async (req, res) => {
    try {
      res.json(await loadOverviewAnalyticsForRole(req));
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Staff accounts need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.get(
  '/api/head/overview',
  asyncRoute(async (req, res) => {
    try {
      res.json(await loadOverviewAnalyticsForRole(req));
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Staff accounts need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

function registerSystemAdminStaffLockRoutes(pathPrefix) {
  app.get(
    pathPrefix + '/staff-lock',
    requireSystemAdmin,
    asyncRoute(async (_req, res) => {
      try {
        res.json(await getStaffSystemLockState());
      } catch (err) {
        if (staffAccountsUnavailable(err)) {
          return res.status(503).json({
            error: 'Staff accounts need database update. Run: npm run db:init (DATABASE_URL required).',
          });
        }
        throw err;
      }
    })
  );

  app.put(
    pathPrefix + '/staff-lock',
    requireSystemAdmin,
    asyncRoute(async (req, res) => {
      try {
        const locked = !!(req.body && req.body.locked);
        const actorId = req.staffSession && req.staffSession.id ? Number(req.staffSession.id) : null;
        const state = await setStaffSystemLockState(locked, actorId);
        res.json({ ok: true, locked: state.locked, updatedAt: state.updatedAt });
      } catch (err) {
        if (staffAccountsUnavailable(err)) {
          return res.status(503).json({
            error: 'Staff accounts need database update. Run: npm run db:init (DATABASE_URL required).',
          });
        }
        throw err;
      }
    })
  );
}

registerSystemAdminStaffLockRoutes('/api/system-admin');
registerSystemAdminStaffLockRoutes('/api/ghost');

app.get(
  '/api/director/staff',
  requireStaffRoles(['director', 'head_teacher']),
  asyncRoute(async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, email, display_name, role, class_level, stream, active, created_at
         FROM school_staff
         WHERE ${SQL_STAFF_LISTABLE}
         ORDER BY role, display_name`
      );
      res.json(rows);
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Staff accounts need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.post(
  '/api/director/staff',
  requireStaffRoles(['director', 'head_teacher']),
  asyncRoute(async (req, res) => {
    try {
      const { email, password, display_name, role, class_level, stream } = req.body || {};
      const roles = ['director', 'head_teacher', 'class_teacher', 'skill_teacher'];
      if (!email || !password || !display_name || !role) {
        return res.status(400).json({ error: 'email, password, display_name, and role are required' });
      }
      if (!roles.includes(String(role))) return res.status(400).json({ error: 'invalid role' });
      if (String(role) === SYSTEM_ADMIN_ROLE) {
        return res.status(400).json({ error: 'invalid role' });
      }
      if (String(role) === 'class_teacher' && !(class_level && String(class_level).trim())) {
        return res.status(400).json({ error: 'class_level is required for class_teacher accounts' });
      }
      if (String(role) === 'skill_teacher' && !(class_level && String(class_level).trim())) {
        return res.status(400).json({ error: 'Subject name (class_level) is required for skill_teacher accounts, e.g. Computer' });
      }
      const { salt, hash } = hashPassword(String(password));
      const streamKey =
        stream !== undefined && stream !== null && String(stream).trim() ? String(stream).trim() : '';
      const cl =
        class_level !== undefined && class_level !== null && String(class_level).trim()
          ? String(class_level).trim()
          : null;
      const { rows } = await pool.query(
        `INSERT INTO school_staff (email, display_name, role, class_level, stream, password_hash, password_salt)
         VALUES (LOWER(TRIM($1)), $2, $3, $4, $5, $6, $7)
         RETURNING id, email, display_name, role, class_level, stream, active, created_at`,
        [String(email), String(display_name).trim(), String(role), cl, streamKey, hash, salt]
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Staff accounts need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.patch(
  '/api/director/staff/:id',
  requireStaffRoles(['director', 'head_teacher']),
  asyncRoute(async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const { active } = req.body || {};
      if (typeof active !== 'boolean') {
        return res.status(400).json({ error: 'active (boolean) required' });
      }
      const actorId = req.staffSession && req.staffSession.id ? Number(req.staffSession.id) : null;
      if (active === false && id === actorId) {
        return res.status(400).json({ error: 'You cannot deactivate your own account.' });
      }
      const existing = await pool.query(`SELECT role FROM school_staff WHERE id = $1`, [id]);
      if (!existing.rows.length) return res.status(404).json({ error: 'Not found' });
      if (existing.rows[0].role === SYSTEM_ADMIN_ROLE) {
        return res.status(400).json({ error: 'This account cannot be changed.' });
      }
      const { rows } = await pool.query(
        `UPDATE school_staff SET active = $2, updated_at = NOW() WHERE id = $1 AND ${SQL_STAFF_LISTABLE}
         RETURNING id, email, display_name, role, class_level, stream, active, created_at`,
        [id, active]
      );
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      res.json(rows[0]);
    } catch (err) {
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Staff accounts need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.delete(
  '/api/director/staff/:id',
  requireStaffRoles(['director', 'head_teacher']),
  asyncRoute(async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
      const actorId = req.staffSession && req.staffSession.id ? Number(req.staffSession.id) : null;
      if (id === actorId) {
        return res.status(400).json({ error: 'You cannot delete your own account.' });
      }
      const existing = await pool.query(
        `SELECT id, role, active FROM school_staff WHERE id = $1`,
        [id]
      );
      if (!existing.rows.length) return res.status(404).json({ error: 'Not found' });
      const target = existing.rows[0];
      if (target.role === SYSTEM_ADMIN_ROLE) {
        return res.status(400).json({ error: 'This account cannot be removed.' });
      }
      if (target.role === 'director' && target.active) {
        const { rows: dirCnt } = await pool.query(
          `SELECT COUNT(*)::int AS n FROM school_staff WHERE role = 'director' AND active = TRUE`
        );
        if (dirCnt[0].n <= 1) {
          return res.status(400).json({ error: 'Cannot delete the only active director account.' });
        }
      }
      const { rowCount } = await pool.query(`DELETE FROM school_staff WHERE id = $1`, [id]);
      if (!rowCount) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true, deleted: true, id });
    } catch (err) {
      if (err.code === '23503') {
        return res.status(409).json({
          error: 'This account is linked to records that cannot be removed. Disable it instead.',
        });
      }
      if (staffAccountsUnavailable(err)) {
        return res.status(503).json({
          error: 'Staff accounts need database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.get(
  '/api/reporting-context',
  asyncRoute(async (_req, res) => {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'school_reporting_context'`);
    const nowYear = new Date().getFullYear();
    const base = { term: 1, period: 'mid', year: nowYear };
    if (!rows.length || !rows[0].value || typeof rows[0].value !== 'object') return res.json(base);
    const v = rows[0].value;
    const term = Number(v.term);
    const period = String(v.period || '');
    const year = Number(v.year);
    res.json({
      term: term >= 1 && term <= 3 ? term : 1,
      period: normalizeReportPeriod(period, 'mid'),
      year: Number.isFinite(year) && year >= 2000 && year <= 2100 ? year : nowYear,
      updatedAt: v.updatedAt || '',
      updatedBy: v.updatedBy || '',
    });
  })
);

app.put(
  '/api/director/reporting-context',
  requireDirector,
  asyncRoute(async (req, res) => {
    const term = Number(req.body && req.body.term);
    const period = req.body && req.body.period ? String(req.body.period) : '';
    const year = Number(req.body && req.body.year);
    if (term < 1 || term > 3) return res.status(400).json({ error: 'term must be 1–3' });
    if (!isValidReportPeriod(period)) return res.status(400).json({ error: 'period must be begin, mid, or end' });
    if (!Number.isFinite(year) || year < 2000 || year > 2100) return res.status(400).json({ error: 'year must be 2000–2100' });
    const out = await writeReportingContextAndPromotion(term, period, year, 'director', req.staffSession);
    res.json(Object.assign({}, out.context, { promotion: out.promotion }));
  })
);

app.put(
  '/api/head/reporting-context',
  requireStaffRoles(['head_teacher', 'director']),
  asyncRoute(async (req, res) => {
    const term = Number(req.body && req.body.term);
    const period = req.body && req.body.period ? String(req.body.period) : '';
    const year = Number(req.body && req.body.year);
    if (term < 1 || term > 3) return res.status(400).json({ error: 'term must be 1–3' });
    if (!isValidReportPeriod(period)) return res.status(400).json({ error: 'period must be begin, mid, or end' });
    if (!Number.isFinite(year) || year < 2000 || year > 2100) return res.status(400).json({ error: 'year must be 2000–2100' });
    const out = await writeReportingContextAndPromotion(term, period, year, 'head_teacher', req.staffSession);
    res.json(Object.assign({}, out.context, { promotion: out.promotion }));
  })
);

app.get(
  '/api/class-catalog',
  asyncRoute(async (_req, res) => {
    const rows = await mergedClassCatalog();
    res.json(rows);
  })
);

app.put(
  '/api/class-catalog',
  requireStaffRoles(['director', 'head_teacher']),
  asyncRoute(async (req, res) => {
    const next = normalizeClassCatalogEntry(req.body || {});
    if (!next) return res.status(400).json({ error: 'id and title are required' });
    if (!next.isPrimary) {
      return res.status(400).json({ error: 'Only primary classes can be created here.' });
    }
    const existsDefault = DEFAULT_CLASS_CATALOG.some((x) => x.id === next.id);
    if (existsDefault) return res.status(409).json({ error: 'Class already exists in defaults.' });
    const custom = await loadCustomClassCatalog();
    if (custom.some((x) => x.id === next.id)) {
      return res.status(409).json({ error: 'Class id already exists.' });
    }
    if (!next.subjects.length) {
      return res.status(400).json({ error: 'Provide at least one subject for the new class.' });
    }
    const merged = custom.concat([next]);
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('custom_class_catalog', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(merged)]
    );
    res.status(201).json(next);
  })
);

app.delete(
  '/api/class-catalog/:id',
  requireStaffRoles(['director', 'head_teacher']),
  asyncRoute(async (req, res) => {
    const classId = normalizeClassSlug(req.params.id);
    if (!classId) return res.status(400).json({ error: 'Invalid class id' });
    if (DEFAULT_CLASS_CATALOG.some((x) => x.id === classId)) {
      return res.status(403).json({ error: 'Built-in classes cannot be deleted.' });
    }
    const custom = await loadCustomClassCatalog();
    const match = custom.find((x) => x.id === classId);
    if (!match) return res.status(404).json({ error: 'Custom class not found.' });
    const enrolled = await pool.query(
      `SELECT COUNT(*)::int AS n FROM students WHERE class_level = $1`,
      [classId]
    );
    if (enrolled.rows[0].n > 0) {
      return res.status(409).json({
        error:
          'This class still has learners. Move or transfer them first, then delete the class.',
        learners: enrolled.rows[0].n,
      });
    }
    const next = custom.filter((x) => x.id !== classId);
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('custom_class_catalog', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(next)]
    );
    res.json({ ok: true, deleted: classId });
  })
);

app.post(
  '/api/learners/transition',
  requireStaffRoles(['director', 'head_teacher']),
  asyncRoute(async (req, res) => {
    const idsRaw = Array.isArray(req.body && req.body.studentIds) ? req.body.studentIds : [];
    const studentIds = idsRaw
      .map((x) => Number(x))
      .filter((x, i, arr) => Number.isFinite(x) && !Number.isNaN(x) && arr.indexOf(x) === i);
    const targetClassLevel = normalizeClassSlug(req.body && req.body.targetClassLevel);
    const targetStream = normalizeClassStream(req.body && req.body.targetStream).toLowerCase();
    const action = ['promote', 'demote', 'transfer'].includes(String(req.body && req.body.action))
      ? String(req.body.action)
      : 'transfer';
    const effectiveYearRaw = Number(req.body && req.body.effectiveYear);
    const nowYear = new Date().getFullYear();
    const effectiveYear =
      Number.isFinite(effectiveYearRaw) && effectiveYearRaw >= 2000 && effectiveYearRaw <= 2100
        ? effectiveYearRaw
        : nowYear + 1;
    const note = String((req.body && req.body.note) || '').trim();
    if (!studentIds.length) return res.status(400).json({ error: 'studentIds required' });
    if (!targetClassLevel) return res.status(400).json({ error: 'targetClassLevel required' });

    const catalog = await mergedClassCatalog();
    const targetCfg = catalog.find((x) => x.id === targetClassLevel);
    if (!targetCfg) return res.status(400).json({ error: 'Target class does not exist.' });
    if (targetCfg.needsStream && !targetStream) {
      return res.status(400).json({ error: 'Target stream is required for this class.' });
    }
    if (!targetCfg.needsStream && targetStream) {
      return res.status(400).json({ error: 'Target class does not use streams.' });
    }
    if (targetCfg.needsStream && targetCfg.streams.indexOf(targetStream) === -1) {
      return res.status(400).json({ error: 'Invalid target stream.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `SELECT id, class_level, COALESCE(NULLIF(TRIM(stream), ''), '') AS stream
         FROM students WHERE id = ANY($1::int[])`,
        [studentIds]
      );
      if (r.rows.length !== studentIds.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'One or more learners were not found.' });
      }
      const role = req.staffSession && req.staffSession.role ? String(req.staffSession.role) : '';
      const actorId = req.staffSession && req.staffSession.id ? Number(req.staffSession.id) : null;
      for (const st of r.rows) {
        await client.query(
          `UPDATE students SET class_level = $2, stream = $3, updated_at = NOW() WHERE id = $1`,
          [st.id, targetClassLevel, targetStream || null]
        );
        await client.query(
          `INSERT INTO student_class_history
             (student_id, action, from_class_level, from_stream, to_class_level, to_stream, from_year, to_year, actor_role, actor_id, note)
           VALUES
             ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            st.id,
            action,
            st.class_level,
            st.stream || '',
            targetClassLevel,
            targetStream || '',
            effectiveYear - 1,
            effectiveYear,
            role,
            Number.isFinite(actorId) ? actorId : null,
            note,
          ]
        );
      }
      await client.query('COMMIT');
      res.json({
        moved: r.rows.length,
        action,
        targetClassLevel,
        targetStream,
        effectiveYear,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

app.get(
  '/api/learners/:id/class-history',
  requireStaffRoles(['director', 'head_teacher']),
  asyncRoute(async (req, res) => {
    const studentId = Number(req.params.id);
    if (!Number.isFinite(studentId)) return res.status(400).json({ error: 'Invalid learner id' });
    const { rows } = await pool.query(
      `SELECT id, student_id, action, from_class_level, from_stream, to_class_level, to_stream,
              from_year, to_year, actor_role, actor_id, note, created_at
       FROM student_class_history
       WHERE student_id = $1
       ORDER BY created_at DESC`,
      [studentId]
    );
    res.json(rows);
  })
);

app.get(
  '/api/director/notes',
  requireDirector,
  asyncRoute(async (_req, res) => {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'director_private_notes'`);
    let text = '';
    if (rows.length && rows[0].value != null) {
      const v = rows[0].value;
      if (typeof v === 'object' && v.text != null) text = String(v.text);
    }
    res.json({ text });
  })
);

app.get(
  '/api/workspace-notes',
  asyncRoute(async (req, res) => {
    const scope = normalizeNoteScope(req.query && req.query.scope);
    const classLevel = req.query && req.query.classLevel ? String(req.query.classLevel) : '';
    const stream = req.query && req.query.stream ? String(req.query.stream) : '';
    const subject = req.query && req.query.subject ? String(req.query.subject) : '';
    const key = notesSettingsKey(scope, classLevel, stream, subject);
    if (!key) return res.status(400).json({ error: 'Invalid notes scope.' });
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
    let html = '';
    let updatedAt = '';
    if (rows.length && rows[0].value != null && typeof rows[0].value === 'object') {
      html = rows[0].value.html != null ? String(rows[0].value.html) : '';
      updatedAt = rows[0].value.updatedAt != null ? String(rows[0].value.updatedAt) : '';
    }
    res.json({ html, updatedAt });
  })
);

app.put(
  '/api/director/report-workflow',
  requireDirector,
  asyncRoute(async (req, res) => {
    const classLevel = req.body && req.body.classLevel ? String(req.body.classLevel).trim() : '';
    const stream = req.body && req.body.stream ? normalizeClassStream(req.body.stream) : '';
    const term = Number(req.body && req.body.term);
    const period = req.body && req.body.period ? String(req.body.period) : '';
    if (!classLevel) return res.status(400).json({ error: 'classLevel required' });
    if (term < 1 || term > 3) return res.status(400).json({ error: 'term must be 1–3' });
    if (!isValidReportPeriod(period)) return res.status(400).json({ error: 'period must be begin, mid, or end' });

    const patch = {};
    if (req.body && req.body.locked != null) patch.locked = !!req.body.locked;
    if (req.body && req.body.approvalState != null) patch.approvalState = String(req.body.approvalState);
    if (patch.approvalState === 'approved' && patch.locked == null) patch.locked = true;

    const next = await setReportWorkflowState(classLevel, stream, term, period, patch, 'director');
    await appendReportAudit({
      classLevel,
      stream,
      term,
      period,
      action: 'update',
      entityType: 'report_workflow_director',
      oldValue: {},
      newValue: next,
      actor: 'director',
    });
    res.json(Object.assign({ classLevel, stream, term, period }, next));
  })
);

app.put(
  '/api/director/notes',
  requireDirector,
  asyncRoute(async (req, res) => {
    const text = req.body && req.body.text != null ? String(req.body.text).slice(0, 12000) : '';
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('director_private_notes', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify({ text })]
    );
    res.json({ ok: true });
  })
);

app.put(
  '/api/workspace-notes',
  asyncRoute(async (req, res) => {
    const scope = normalizeNoteScope(req.body && req.body.scope);
    const classLevel = req.body && req.body.classLevel ? String(req.body.classLevel) : '';
    const stream = req.body && req.body.stream ? String(req.body.stream) : '';
    const subject = req.body && req.body.subject ? String(req.body.subject) : '';
    const key = notesSettingsKey(scope, classLevel, stream, subject);
    if (!key) return res.status(400).json({ error: 'Invalid notes scope.' });
    const html = sanitizeNotesHtml(req.body && req.body.html != null ? String(req.body.html) : '');
    const payload = { html, updatedAt: new Date().toISOString() };
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(payload)]
    );
    res.json({ ok: true, updatedAt: payload.updatedAt });
  })
);

app.get(
  '/api/report-workflow',
  asyncRoute(async (req, res) => {
    const { classLevel, stream, term, period } = req.query;
    if (!classLevel) return res.status(400).json({ error: 'classLevel required' });
    const t = Number(term);
    if (t < 1 || t > 3) return res.status(400).json({ error: 'term must be 1–3' });
    if (!isValidReportPeriod(String(period || ''))) {
      return res.status(400).json({ error: 'period must be begin, mid, or end' });
    }
    const state = await getReportWorkflowState(String(classLevel).trim(), normalizeClassStream(stream), t, String(period));
    res.json({
      classLevel: String(classLevel).trim(),
      stream: normalizeClassStream(stream),
      term: t,
      period: String(period),
      locked: !!state.locked,
      approvalState: state.approvalState,
      updatedAt: state.updatedAt,
      updatedBy: state.updatedBy,
    });
  })
);

app.put(
  '/api/report-workflow',
  asyncRoute(async (req, res) => {
    const classLevel = req.body && req.body.classLevel ? String(req.body.classLevel).trim() : '';
    const stream = req.body && req.body.stream ? normalizeClassStream(req.body.stream) : '';
    const term = Number(req.body && req.body.term);
    const period = req.body && req.body.period ? String(req.body.period) : '';
    if (!classLevel) return res.status(400).json({ error: 'classLevel required' });
    if (term < 1 || term > 3) return res.status(400).json({ error: 'term must be 1–3' });
    if (!isValidReportPeriod(period)) return res.status(400).json({ error: 'period must be begin, mid, or end' });
    const patch = {};
    if (req.body && req.body.locked != null) patch.locked = !!req.body.locked;
    if (req.body && req.body.approvalState != null) patch.approvalState = String(req.body.approvalState);
    if (patch.approvalState === 'approved' && patch.locked == null) patch.locked = true;
    const next = await setReportWorkflowState(classLevel, stream, term, period, patch, 'class_teacher');
    await appendReportAudit({
      classLevel,
      stream,
      term,
      period,
      action: 'update',
      entityType: 'report_workflow',
      oldValue: {},
      newValue: next,
      actor: 'class_teacher',
    });
    res.json(Object.assign({ classLevel, stream, term, period }, next));
  })
);

app.get(
  '/api/report-validate',
  asyncRoute(async (req, res) => {
    const classLevel = req.query.classLevel != null ? String(req.query.classLevel).trim() : '';
    const stream = normalizeClassStream(req.query.stream);
    const term = Number(req.query.term);
    const period = req.query.period != null ? String(req.query.period) : '';
    const academicYear = await resolveAcademicYear(req.query.year);
    const studentId = req.query.studentId != null && String(req.query.studentId).trim() !== '' ? Number(req.query.studentId) : null;
    if (!classLevel) return res.status(400).json({ error: 'classLevel required' });
    if (term < 1 || term > 3) return res.status(400).json({ error: 'term must be 1–3' });
    if (!isValidReportPeriod(period)) return res.status(400).json({ error: 'period must be begin, mid, or end' });

    const roster = await rosterStudentsForClassYear(classLevel, stream, academicYear, { studentId: studentId || undefined });

    const subjects = await subjectsForClassLevelDynamic(classLevel);
    const requiredMarks = subjects.filter((s) => isPrimaryLevel(classLevel) && !SKILL_SUBJECTS.includes(s));
    const requiredComments = subjects.filter((s) => !isPrimaryLevel(classLevel) || SKILL_SUBJECTS.includes(s));

    const ids = roster.map((r) => r.id);
    const marksRows = ids.length
      ? (
          await pool.query(
            `SELECT student_id, subject, marks_scored
             FROM student_subject_marks
             WHERE student_id = ANY($1::int[]) AND term = $2 AND period = $3 AND academic_year = $4`,
            [ids, term, period, academicYear]
          )
        ).rows
      : [];
    const commentRows = ids.length
      ? (
          await pool.query(
            `SELECT student_id, subject, body FROM student_subject_comments
             WHERE student_id = ANY($1::int[]) AND term = $2 AND period = $3 AND academic_year = $4`,
            [ids, term, period, academicYear]
          )
        ).rows
      : [];
    const headRows = ids.length
      ? (
          await pool.query(
            `SELECT student_id, body FROM student_head_comments
             WHERE student_id = ANY($1::int[]) AND term = $2 AND period = $3 AND academic_year = $4`,
            [ids, term, period, academicYear]
          )
        ).rows
      : [];
    const ctRows = ids.length
      ? (
          await pool.query(
            `SELECT student_id, body FROM student_class_teacher_comments
             WHERE student_id = ANY($1::int[]) AND term = $2 AND period = $3 AND academic_year = $4`,
            [ids, term, period, academicYear]
          )
        ).rows
      : [];

    const markMap = new Map(marksRows.map((r) => [`${r.student_id}\t${r.subject}`, r]));
    const commentMap = new Map(commentRows.map((r) => [`${r.student_id}\t${r.subject}`, r]));
    const headMap = new Map(headRows.map((r) => [String(r.student_id), r]));
    const ctMap = new Map(ctRows.map((r) => [String(r.student_id), r]));

    const learners = roster.map((s) => {
      const missing = [];
      requiredMarks.forEach((sub) => {
        const mk = markMap.get(`${s.id}\t${sub}`);
        if (!mk || mk.marks_scored == null || String(mk.marks_scored).trim() === '') missing.push(`Marks: ${sub}`);
      });
      requiredComments.forEach((sub) => {
        const c = commentMap.get(`${s.id}\t${sub}`);
        if (!c || !String(c.body || '').trim()) missing.push(`Comment: ${sub}`);
      });
      const hc = headMap.get(String(s.id));
      const ctc = ctMap.get(String(s.id));
      if (!ctc || !String(ctc.body || '').trim()) missing.push(`Class teacher comment`);
      if (!hc || !String(hc.body || '').trim()) missing.push(`Head teacher/caregiver comment`);
      return {
        student_id: s.id,
        full_name: s.full_name,
        reg_no: s.reg_no,
        missing,
        complete: missing.length === 0,
      };
    });
    const completeCount = learners.filter((l) => l.complete).length;
    res.json({
      classLevel,
      stream,
      term,
      period,
      totalLearners: learners.length,
      completeLearners: completeCount,
      incompleteLearners: learners.length - completeCount,
      learners,
    });
  })
);

app.get(
  '/api/report-audit',
  asyncRoute(async (req, res) => {
    try {
      const sid = Number(req.query.student_id);
      const term = Number(req.query.term);
      const period = req.query.period != null ? String(req.query.period) : '';
      if (!sid || Number.isNaN(sid)) return res.status(400).json({ error: 'student_id required' });
      if (term < 1 || term > 3) return res.status(400).json({ error: 'term must be 1–3' });
      if (!isValidReportPeriod(period)) return res.status(400).json({ error: 'period must be begin, mid, or end' });
      const { rows } = await pool.query(
        `SELECT id, action, entity_type, subject, old_value, new_value, actor, created_at
         FROM report_audit_log
         WHERE student_id = $1 AND term = $2 AND period = $3
         ORDER BY created_at DESC
         LIMIT 300`,
        [sid, term, period]
      );
      res.json(rows);
    } catch (err) {
      if (err.code === '42P01' || err.code === '42703') {
        return res.status(503).json({
          error: 'Report audit log needs database update. Run: npm run db:init (DATABASE_URL required).',
        });
      }
      throw err;
    }
  })
);

app.get(
  '/api/report-settings',
  asyncRoute(async (req, res) => {
    const classLevel = req.query.classLevel != null ? String(req.query.classLevel).trim() : '';
    if (!classLevel) return res.status(400).json({ error: 'classLevel required' });
    const stream =
      req.query.stream != null && String(req.query.stream).trim()
        ? String(req.query.stream).trim()
        : '';
    const key = `report_next_term_${classLevel}_${stream || '_'}`;
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
    let nextTermBegins = '';
    let fontScale = 1;
    let templatePath = '';
    let fontFamily = 'default';
    let layout = {
      subjectOrder: [],
      subjectGridOffsetX: 0,
      subjectGridOffsetY: 0,
      commentsOffsetX: 0,
      commentsOffsetY: 0,
    };
    if (rows.length && rows[0].value && typeof rows[0].value === 'object') {
      nextTermBegins =
        rows[0].value.nextTermBegins != null ? String(rows[0].value.nextTermBegins) : '';
      fontScale =
        rows[0].value.fontScale != null ? Number(rows[0].value.fontScale) : 1;
      if (Number.isNaN(fontScale) || fontScale < 0.8 || fontScale > 1.4) fontScale = 1;
      templatePath =
        rows[0].value.templatePath != null ? String(rows[0].value.templatePath) : '';
      fontFamily =
        rows[0].value.fontFamily != null ? String(rows[0].value.fontFamily).trim() : 'default';
      const rawLayout = rows[0].value.layout && typeof rows[0].value.layout === 'object' ? rows[0].value.layout : {};
      layout = {
        subjectOrder: Array.isArray(rawLayout.subjectOrder)
          ? rawLayout.subjectOrder
              .map((x) => String(x || '').trim())
              .filter((x, i, arr) => x && arr.indexOf(x) === i)
              .slice(0, 32)
          : [],
        subjectGridOffsetX:
          rawLayout.subjectGridOffsetX != null && Number.isFinite(Number(rawLayout.subjectGridOffsetX))
            ? Math.max(-160, Math.min(160, Number(rawLayout.subjectGridOffsetX)))
            : 0,
        subjectGridOffsetY:
          rawLayout.subjectGridOffsetY != null && Number.isFinite(Number(rawLayout.subjectGridOffsetY))
            ? Math.max(-160, Math.min(160, Number(rawLayout.subjectGridOffsetY)))
            : 0,
        commentsOffsetX:
          rawLayout.commentsOffsetX != null && Number.isFinite(Number(rawLayout.commentsOffsetX))
            ? Math.max(-160, Math.min(160, Number(rawLayout.commentsOffsetX)))
            : 0,
        commentsOffsetY:
          rawLayout.commentsOffsetY != null && Number.isFinite(Number(rawLayout.commentsOffsetY))
            ? Math.max(-160, Math.min(160, Number(rawLayout.commentsOffsetY)))
            : 0,
      };
    }
    // If a stream-specific report has no template yet, reuse any template
    // already configured for this class level (e.g. Baby Waves -> Baby Pearls).
    if (!templatePath && stream) {
      const fallbackKeyPrefix = `report_next_term_${classLevel}_%`;
      const fb = await pool.query(
        `SELECT value->>'templatePath' AS template_path
           FROM app_settings
          WHERE key LIKE $1
            AND COALESCE(value->>'templatePath', '') <> ''
          ORDER BY updated_at DESC
          LIMIT 1`,
        [fallbackKeyPrefix]
      );
      if (fb.rows.length && fb.rows[0].template_path) {
        templatePath = String(fb.rows[0].template_path);
      }
    }
    if (!['default', 'calibri', 'georgia', 'verdana', 'trebuchet', 'times'].includes(fontFamily)) {
      fontFamily = 'default';
    }
    res.json({ classLevel, stream, nextTermBegins, fontScale, templatePath, fontFamily, layout });
  })
);

app.put(
  '/api/report-settings',
  asyncRoute(async (req, res) => {
    const classLevel = req.body && req.body.classLevel != null ? String(req.body.classLevel).trim() : '';
    if (!classLevel) return res.status(400).json({ error: 'classLevel required' });
    const stream =
      req.body && req.body.stream != null && String(req.body.stream).trim()
        ? String(req.body.stream).trim()
        : '';
    const nextTermBegins =
      req.body && req.body.nextTermBegins != null
        ? String(req.body.nextTermBegins).slice(0, 120)
        : '';
    let fontScale =
      req.body && req.body.fontScale != null ? Number(req.body.fontScale) : 1;
    if (Number.isNaN(fontScale) || fontScale < 0.8 || fontScale > 1.4) fontScale = 1;
    let fontFamily =
      req.body && req.body.fontFamily != null ? String(req.body.fontFamily).trim() : 'default';
    if (!['default', 'calibri', 'georgia', 'verdana', 'trebuchet', 'times'].includes(fontFamily)) {
      fontFamily = 'default';
    }
    const rawLayout = req.body && req.body.layout && typeof req.body.layout === 'object' ? req.body.layout : {};
    const layout = {
      subjectOrder: Array.isArray(rawLayout.subjectOrder)
        ? rawLayout.subjectOrder
            .map((x) => String(x || '').trim())
            .filter((x, i, arr) => x && arr.indexOf(x) === i)
            .slice(0, 32)
        : [],
      subjectGridOffsetX:
        rawLayout.subjectGridOffsetX != null && Number.isFinite(Number(rawLayout.subjectGridOffsetX))
          ? Math.max(-160, Math.min(160, Number(rawLayout.subjectGridOffsetX)))
          : 0,
      subjectGridOffsetY:
        rawLayout.subjectGridOffsetY != null && Number.isFinite(Number(rawLayout.subjectGridOffsetY))
          ? Math.max(-160, Math.min(160, Number(rawLayout.subjectGridOffsetY)))
          : 0,
      commentsOffsetX:
        rawLayout.commentsOffsetX != null && Number.isFinite(Number(rawLayout.commentsOffsetX))
          ? Math.max(-160, Math.min(160, Number(rawLayout.commentsOffsetX)))
          : 0,
      commentsOffsetY:
        rawLayout.commentsOffsetY != null && Number.isFinite(Number(rawLayout.commentsOffsetY))
          ? Math.max(-160, Math.min(160, Number(rawLayout.commentsOffsetY)))
          : 0,
    };
    const templatePath =
      req.body && req.body.templatePath != null ? String(req.body.templatePath).slice(0, 500) : '';
    const key = `report_next_term_${classLevel}_${stream || '_'}`;
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify({ nextTermBegins, fontScale, templatePath, fontFamily, layout })]
    );
    res.json({ ok: true });
  })
);

app.post(
  '/api/report-template',
  uploadNote.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const classLevel = req.body && req.body.classLevel != null ? String(req.body.classLevel).trim() : '';
    if (!classLevel) return res.status(400).json({ error: 'classLevel required' });
    const stream =
      req.body && req.body.stream != null && String(req.body.stream).trim()
        ? String(req.body.stream).trim()
        : '';
    const key = `report_next_term_${classLevel}_${stream || '_'}`;
    const rel = `/uploads/notes/${req.file.filename}`;
    const prev = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
    let payload = {
      nextTermBegins: '',
      fontScale: 1,
      templatePath: '',
      fontFamily: 'default',
      layout: {
        subjectOrder: [],
        subjectGridOffsetX: 0,
        subjectGridOffsetY: 0,
        commentsOffsetX: 0,
        commentsOffsetY: 0,
      },
    };
    if (prev.rows.length && prev.rows[0].value && typeof prev.rows[0].value === 'object') {
      payload = Object.assign(payload, prev.rows[0].value);
    }
    payload.templatePath = rel;
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(payload)]
    );
    res.json({ ok: true, templatePath: rel });
  })
);

app.get(
  '/api/students/count-summary',
  asyncRoute(async (_req, res) => {
    const { rows } = await pool.query(`
      SELECT class_level, COALESCE(NULLIF(TRIM(stream), ''), '') AS stream, COUNT(*)::int AS count
      FROM students
      GROUP BY class_level, COALESCE(NULLIF(TRIM(stream), ''), '')
      ORDER BY class_level, stream
    `);
    res.json(rows);
  })
);

app.get(
  '/api/skill-documents',
  asyncRoute(async (req, res) => {
    const { subject, term } = req.query;
    if (!subject) return res.status(400).json({ error: 'subject required' });
    if (!SKILL_SUBJECTS.includes(subject)) {
      return res.status(400).json({ error: 'subject must be a skill subject' });
    }
    let q = `SELECT * FROM class_documents WHERE subject = $1 AND (
      COALESCE(document_scope, 'class') = 'class'
      OR document_scope = 'all_classes'
    )`;
    const params = [subject];
    let n = 2;
    if (term) {
      q += ` AND term = $${n++}`;
      params.push(Number(term));
    }
    q += ' ORDER BY class_level NULLS LAST, stream NULLS LAST, term, created_at DESC';
    const { rows } = await pool.query(q, params);
    res.json(rows);
  })
);

app.get(
  '/api/skill-progress',
  asyncRoute(async (req, res) => {
    const { subject } = req.query;
    if (!subject) return res.status(400).json({ error: 'subject required' });
    if (!SKILL_SUBJECTS.includes(subject)) {
      return res.status(400).json({ error: 'subject must be a skill subject' });
    }
    const { rows } = await pool.query(
      'SELECT * FROM skill_class_progress WHERE subject = $1 ORDER BY class_level, stream, term',
      [subject]
    );
    res.json(rows);
  })
);

app.post(
  '/api/skill-progress',
  asyncRoute(async (req, res) => {
    const { subject, class_level, stream, term, progress_percent, summary } = req.body;
    if (!subject || !class_level || !term) {
      return res.status(400).json({ error: 'subject, class_level, and term are required' });
    }
    if (!SKILL_SUBJECTS.includes(String(subject).trim())) {
      return res.status(400).json({ error: 'subject must be a skill subject' });
    }
    const termNum = Number(term);
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    const pct = progress_percent != null ? Number(progress_percent) : 0;
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: 'progress_percent must be 0–100' });
    }
    const streamKey =
      stream !== undefined && stream !== null && String(stream).trim()
        ? String(stream).trim()
        : '';
    const { rows } = await pool.query(
      `INSERT INTO skill_class_progress (subject, class_level, stream, term, progress_percent, summary)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (subject, class_level, stream, term)
       DO UPDATE SET
         progress_percent = EXCLUDED.progress_percent,
         summary = EXCLUDED.summary,
         updated_at = NOW()
       RETURNING *`,
      [
        String(subject).trim(),
        String(class_level).trim(),
        streamKey,
        termNum,
        pct,
        summary != null ? String(summary) : '',
      ]
    );
    res.status(201).json(rows[0]);
  })
);

app.get(
  '/api/skill-term-goal',
  asyncRoute(async (req, res) => {
    const subject = req.query && req.query.subject != null ? String(req.query.subject).trim() : '';
    const classLevel = req.query && req.query.classLevel != null ? String(req.query.classLevel).trim() : '';
    const stream =
      req.query && req.query.stream != null && String(req.query.stream).trim()
        ? normalizeClassStream(req.query.stream)
        : '';
    const termNum = Number(req.query && req.query.term);
    const academicYear = await resolveAcademicYear(req.query && req.query.year);
    if (!subject || !classLevel || !termNum) {
      return res.status(400).json({ error: 'subject, classLevel, and term are required' });
    }
    if (!SKILL_SUBJECTS.includes(subject)) {
      return res.status(400).json({ error: 'subject must be a skill subject' });
    }
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    const { rows } = await pool.query(
      `SELECT *
         FROM skill_term_goals
        WHERE subject = $1
          AND class_level = $2
          AND stream = $3
          AND term = $4
          AND academic_year = $5
        LIMIT 1`,
      [subject, classLevel, stream, termNum, academicYear]
    );
    if (!rows.length) {
      return res.json({
        subject,
        class_level: classLevel,
        stream,
        term: termNum,
        academic_year: academicYear,
        goal_text: '',
        updated_at: null,
      });
    }
    res.json(rows[0]);
  })
);

app.put(
  '/api/skill-term-goal',
  asyncRoute(async (req, res) => {
    const subject = req.body && req.body.subject != null ? String(req.body.subject).trim() : '';
    const classLevel = req.body && req.body.classLevel != null ? String(req.body.classLevel).trim() : '';
    const stream =
      req.body && req.body.stream != null && String(req.body.stream).trim()
        ? normalizeClassStream(req.body.stream)
        : '';
    const termNum = Number(req.body && req.body.term);
    const academicYear = await resolveAcademicYear(req.body && req.body.year);
    const goalText =
      req.body && req.body.goal_text != null ? String(req.body.goal_text).trim().slice(0, 500) : '';
    if (!subject || !classLevel || !termNum) {
      return res.status(400).json({ error: 'subject, classLevel, and term are required' });
    }
    if (!SKILL_SUBJECTS.includes(subject)) {
      return res.status(400).json({ error: 'subject must be a skill subject' });
    }
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    const { rows } = await pool.query(
      `INSERT INTO skill_term_goals (subject, class_level, stream, term, academic_year, goal_text)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (subject, class_level, stream, term, academic_year)
       DO UPDATE SET goal_text = EXCLUDED.goal_text, updated_at = NOW()
       RETURNING *`,
      [subject, classLevel, stream, termNum, academicYear, goalText]
    );
    res.json(rows[0]);
  })
);

app.get(
  '/api/skill-lesson-progress',
  asyncRoute(async (req, res) => {
    const subject = req.query && req.query.subject != null ? String(req.query.subject).trim() : '';
    const classLevel = req.query && req.query.classLevel != null ? String(req.query.classLevel).trim() : '';
    const stream =
      req.query && req.query.stream != null && String(req.query.stream).trim()
        ? normalizeClassStream(req.query.stream)
        : '';
    const termNum = Number(req.query && req.query.term);
    const lessonNo =
      req.query && req.query.lesson_no != null && String(req.query.lesson_no).trim() !== ''
        ? Number(req.query.lesson_no)
        : null;
    const studentId =
      req.query && req.query.student_id != null && String(req.query.student_id).trim() !== ''
        ? Number(req.query.student_id)
        : null;
    const academicYear = await resolveAcademicYear(req.query && req.query.year);
    if (!subject || !classLevel || !termNum) {
      return res.status(400).json({ error: 'subject, classLevel, and term are required' });
    }
    if (!SKILL_SUBJECTS.includes(subject)) {
      return res.status(400).json({ error: 'subject must be a skill subject' });
    }
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    if (lessonNo != null && (Number.isNaN(lessonNo) || lessonNo < 1 || lessonNo > 40)) {
      return res.status(400).json({ error: 'lesson_no must be 1–40' });
    }
    let q = `
      SELECT p.*,
             s.full_name,
             s.reg_no,
             s.passport_path,
             s.class_level,
             COALESCE(NULLIF(TRIM(s.stream), ''), '') AS stream
        FROM student_skill_lesson_progress p
        INNER JOIN students s ON s.id = p.student_id
       WHERE p.subject = $1
         AND s.class_level = $2
         AND p.term = $3
         AND p.academic_year = $4`;
    const params = [subject, classLevel, termNum, academicYear];
    let n = 5;
    if (stream) {
      q += ` AND LOWER(TRIM(COALESCE(s.stream, ''))) = LOWER(TRIM($${n++}))`;
      params.push(stream);
    } else {
      q += ` AND (s.stream IS NULL OR TRIM(COALESCE(s.stream, '')) = '')`;
    }
    if (lessonNo != null) {
      q += ` AND p.lesson_no = $${n++}`;
      params.push(lessonNo);
    }
    if (studentId != null && !Number.isNaN(studentId)) {
      q += ` AND p.student_id = $${n++}`;
      params.push(studentId);
    }
    q += ` ORDER BY s.full_name ASC, p.lesson_no DESC, p.updated_at DESC`;
    const { rows } = await pool.query(q, params);
    res.json(rows);
  })
);

app.post(
  '/api/skill-lesson-progress',
  asyncRoute(async (req, res) => {
    const subject = req.body && req.body.subject != null ? String(req.body.subject).trim() : '';
    const sid = Number(req.body && req.body.student_id);
    const termNum = Number(req.body && req.body.term);
    const lessonNo = Number(req.body && req.body.lesson_no);
    const lessonDate =
      req.body && req.body.lesson_date != null && String(req.body.lesson_date).trim()
        ? String(req.body.lesson_date).trim()
        : null;
    const status = req.body && req.body.status != null ? String(req.body.status).trim() : '';
    const note =
      req.body && req.body.note != null ? String(req.body.note).trim().slice(0, 500) : '';
    const academicYear = await resolveAcademicYear(req.body && req.body.year);
    const allowedStatuses = ['needs_support', 'progressing', 'on_track', 'goal_met'];
    if (!sid || Number.isNaN(sid)) return res.status(400).json({ error: 'student_id required' });
    if (!subject || !termNum || !lessonNo || !status) {
      return res.status(400).json({ error: 'subject, term, lesson_no, and status are required' });
    }
    if (!SKILL_SUBJECTS.includes(subject)) {
      return res.status(400).json({ error: 'subject must be a skill subject' });
    }
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    if (lessonNo < 1 || lessonNo > 40) return res.status(400).json({ error: 'lesson_no must be 1–40' });
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'status must be needs_support, progressing, on_track, or goal_met' });
    }
    if (lessonDate && !/^\d{4}-\d{2}-\d{2}$/.test(lessonDate)) {
      return res.status(400).json({ error: 'lesson_date must be YYYY-MM-DD' });
    }
    const st = await pool.query('SELECT class_level, stream FROM students WHERE id = $1', [sid]);
    if (!st.rows.length) return res.status(404).json({ error: 'Student not found' });
    const cl = st.rows[0].class_level;
    const streamVal = st.rows[0].stream || '';
    if (await isReportLocked(cl, streamVal, termNum, 'end')) {
      return res.status(423).json({ error: 'This term report is locked. Unlock it from Reports before editing.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO student_skill_lesson_progress
         (student_id, subject, term, academic_year, lesson_no, lesson_date, status, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (student_id, subject, term, academic_year, lesson_no)
       DO UPDATE SET
         lesson_date = EXCLUDED.lesson_date,
         status = EXCLUDED.status,
         note = EXCLUDED.note,
         updated_at = NOW()
       RETURNING *`,
      [sid, subject, termNum, academicYear, lessonNo, lessonDate, status, note]
    );
    res.status(201).json(rows[0]);
  })
);

app.delete(
  '/api/students/:id',
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const r = await pool.query('DELETE FROM students WHERE id = $1 RETURNING id', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  })
);

app.post(
  '/api/assist/comment-polish',
  asyncRoute(async (req, res) => {
    const { text, students, preferredStudentId } = req.body;
    if (text == null || typeof text !== 'string') {
      return res.status(400).json({ error: 'text required' });
    }
    if (text.length > 500) {
      return res.status(400).json({ error: 'text too long' });
    }
    if (!Array.isArray(students)) {
      return res.status(400).json({ error: 'students array required' });
    }
    const roster = students
      .map((s) => ({
        id: Number(s.id),
        full_name: s.full_name != null ? String(s.full_name).trim() : '',
      }))
      .filter((s) => !Number.isNaN(s.id) && s.full_name);
    if (students.length > 400) {
      return res.status(400).json({ error: 'too many students' });
    }
    const pref =
      preferredStudentId != null && preferredStudentId !== ''
        ? Number(preferredStudentId)
        : null;
    const polished = await polishComment(text, roster, Number.isNaN(pref) ? null : pref);
    res.json({ text: polished });
  })
);

app.get(
  '/api/documents',
  asyncRoute(async (req, res) => {
    const { classLevel, stream, term, subject, documentScope } = req.query;

    if (documentScope === 'all_classes' || documentScope === 'skill') {
      if (!subject) {
        return res.status(400).json({ error: 'subject required for school-wide documents' });
      }
      if (!SKILL_SUBJECTS.includes(subject)) {
        return res.status(400).json({ error: 'subject must be a skill subject' });
      }
      let q =
        "SELECT * FROM class_documents WHERE document_scope = 'all_classes' AND subject = $1";
      const params = [subject];
      let n = 2;
      if (term) {
        q += ` AND term = $${n++}`;
        params.push(Number(term));
      }
      q += ' ORDER BY term ASC, created_at DESC';
      const { rows } = await pool.query(q, params);
      return res.json(rows);
    }

    if (!classLevel) {
      return res.status(400).json({ error: 'classLevel required (or documentScope=all_classes for skills)' });
    }

    const streamVal = stream && String(stream).trim() ? String(stream).trim() : null;
    const termNum = term ? Number(term) : null;
    const skillList = SKILL_SUBJECTS.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');

    let q;
    const params = [];

    if (subject) {
      params.push(classLevel, streamVal, subject);
      q = `
        SELECT * FROM class_documents
        WHERE subject = $3
        AND (
          (
            COALESCE(document_scope, 'class') = 'class'
            AND class_level = $1
            AND (
              ($2::text IS NOT NULL AND stream = $2)
              OR ($2::text IS NULL AND (stream IS NULL OR stream = ''))
            )
          )
          OR (
            document_scope = 'all_classes'
            AND $1::text <> 'daycare'
          )
        )`;
      let n = 4;
      if (termNum !== null && !Number.isNaN(termNum)) {
        q += ` AND term = $${n++}`;
        params.push(termNum);
      }
    } else {
      params.push(classLevel, streamVal);
      q = `
        SELECT * FROM class_documents
        WHERE (
          (
            COALESCE(document_scope, 'class') = 'class'
            AND class_level = $1
            AND (
              ($2::text IS NOT NULL AND stream = $2)
              OR ($2::text IS NULL AND (stream IS NULL OR stream = ''))
            )
          )
          OR (
            document_scope = 'all_classes'
            AND subject IN (${skillList})
            AND $1::text <> 'daycare'
          )
        )`;
      let n = 3;
      if (termNum !== null && !Number.isNaN(termNum)) {
        q += ` AND term = $${n++}`;
        params.push(termNum);
      }
    }

    q += ' ORDER BY term ASC, subject ASC, created_at DESC';
    const { rows } = await pool.query(q, params);
    res.json(rows);
  })
);

/** OnlyOffice: Word-accurate in-browser edit (optional — see .env.example + docker-compose.yml) */
app.get(
  '/api/documents/:id/onlyoffice-config',
  asyncRoute(async (req, res) => {
    if (!oo.isOnlyOfficeEnabled()) {
      return res.json({ enabled: false });
    }
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id', enabled: true });
    const { rows } = await pool.query(
      'SELECT id, title, file_path, doc_type, term FROM class_documents WHERE id = $1',
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found', enabled: true });
    const doc = rows[0];
    const ext = (doc.file_path.match(/\.([^.]+)$/i) || [, ''])[1].toLowerCase();
    const wordish = ['doc', 'docx', 'docm', 'dotx', 'rtf', 'odt'].includes(ext);
    if (!wordish) {
      return res.status(400).json({
        error: 'This file type is not opened in the Word editor.',
        enabled: true,
      });
    }
    const disk = path.join(ROOT, doc.file_path.replace(/^\//, ''));
    try {
      fs.accessSync(disk, fs.constants.R_OK);
    } catch {
      return res.status(404).json({ error: 'File missing on disk', enabled: true });
    }
    const config = oo.buildEditorConfig(doc, ROOT);
    res.json({
      enabled: true,
      documentServerUrl: oo.docServerBase(),
      config,
    });
  })
);

app.post(
  '/api/documents/:id/onlyoffice-callback',
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.json({ error: 1 });
    const token = req.query.token != null ? String(req.query.token) : '';
    if (token !== oo.callbackSecret()) {
      console.warn('OnlyOffice callback: invalid token');
      return res.status(403).json({ error: 1 });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const result = await oo.saveFromCallback({ rootDir: ROOT, pool, documentId: id, body });
      if (!result.ok) {
        console.error('OnlyOffice save:', result.message);
        return res.json({ error: 1 });
      }
    } catch (e) {
      console.error('OnlyOffice callback', e);
      return res.json({ error: 1 });
    }
    res.json({ error: 0 });
  })
);

app.post(
  '/api/documents/scheme',
  uploadNote.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const { class_level, stream, term, subject, title, document_scope } = req.body;
    const scope =
      document_scope === 'all_classes' || document_scope === 'skill' ? 'all_classes' : 'class';
    if (!term) return res.status(400).json({ error: 'term required' });
    const termNum = Number(term);
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    const rel = `/uploads/notes/${req.file.filename}`;

    if (scope === 'all_classes') {
      const subj = subject && String(subject).trim();
      if (!subj || !SKILL_SUBJECTS.includes(subj)) {
        return res.status(400).json({
          error: 'School-wide uploads require a valid skill subject',
        });
      }
      const { rows } = await pool.query(
        `INSERT INTO class_documents (document_scope, class_level, stream, term, subject, doc_type, title, file_path)
         VALUES ('all_classes', NULL, NULL, $1, $2, 'scheme', $3, $4)
         RETURNING *`,
        [termNum, subj, title || req.file.originalname, rel]
      );
      return res.status(201).json(rows[0]);
    }

    if (!class_level) return res.status(400).json({ error: 'class_level required for class uploads' });
    const streamVal = stream && String(stream).trim() ? String(stream).trim() : null;
    const { rows } = await pool.query(
      `INSERT INTO class_documents (document_scope, class_level, stream, term, subject, doc_type, title, file_path)
       VALUES ('class', $1, $2, $3, $4, 'scheme', $5, $6)
       RETURNING *`,
      [class_level, streamVal, termNum, subject || null, title || req.file.originalname, rel]
    );
    res.status(201).json(rows[0]);
  })
);

/** Photo of scheme/work → single-page PDF saved under uploads/notes */
app.post(
  '/api/documents/work-from-photo',
  uploadNote.single('photo'),
  asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'photo required' });
    const { class_level, stream, term, subject, title, document_scope } = req.body;
    const scope =
      document_scope === 'all_classes' || document_scope === 'skill' ? 'all_classes' : 'class';
    if (!term) return res.status(400).json({ error: 'term required' });
    const termNum = Number(term);
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });

    const ext = path.extname(req.file.filename).toLowerCase();
    if (!['.jpg', '.jpeg', '.png'].includes(ext)) {
      return res.status(400).json({ error: 'Use JPEG or PNG for photo upload' });
    }

    const pdfName = `${path.basename(req.file.filename, ext)}.pdf`;
    const pdfFull = path.join(NOTES, pdfName);
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    await writePdfFromImageFile(req.file.path, pdfFull, mime);

    try {
      fs.unlinkSync(req.file.path);
    } catch (_) {}

    const rel = `/uploads/notes/${pdfName}`;

    if (scope === 'all_classes') {
      const subj = subject && String(subject).trim();
      if (!subj || !SKILL_SUBJECTS.includes(subj)) {
        return res.status(400).json({
          error: 'School-wide uploads require a valid skill subject',
        });
      }
      const { rows } = await pool.query(
        `INSERT INTO class_documents (document_scope, class_level, stream, term, subject, doc_type, title, file_path)
         VALUES ('all_classes', NULL, NULL, $1, $2, 'work', $3, $4)
         RETURNING *`,
        [termNum, subj, title || 'Work from photo', rel]
      );
      return res.status(201).json(rows[0]);
    }

    if (!class_level) return res.status(400).json({ error: 'class_level required for class uploads' });
    const streamVal = stream && String(stream).trim() ? String(stream).trim() : null;
    const { rows } = await pool.query(
      `INSERT INTO class_documents (document_scope, class_level, stream, term, subject, doc_type, title, file_path)
       VALUES ('class', $1, $2, $3, $4, 'work', $5, $6)
       RETURNING *`,
      [class_level, streamVal, termNum, subject || null, title || 'Work from photo', rel]
    );
    res.status(201).json(rows[0]);
  })
);

/** Typed note from workspace editor → HTML file under uploads/notes */
app.post(
  '/api/documents/typed-note',
  asyncRoute(async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { class_level, stream, term, subject, title, html, document_scope } = body;
    const scope =
      document_scope === 'all_classes' || document_scope === 'skill' ? 'all_classes' : 'class';
    const noteTitle = String(title || '').trim();
    if (!noteTitle) return res.status(400).json({ error: 'title required' });
    const termNum = Number(term);
    if (!termNum || termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    if (!typedNoteHasContent(html)) return res.status(400).json({ error: 'note content required' });

    const rel = writeTypedNoteHtmlFile(noteTitle, html);

    if (scope === 'all_classes') {
      const subj = subject && String(subject).trim();
      if (!subj || !SKILL_SUBJECTS.includes(subj)) {
        return res.status(400).json({ error: 'School-wide uploads require a valid skill subject' });
      }
      const { rows } = await pool.query(
        `INSERT INTO class_documents (document_scope, class_level, stream, term, subject, doc_type, title, file_path)
         VALUES ('all_classes', NULL, NULL, $1, $2, 'note', $3, $4)
         RETURNING *`,
        [termNum, subj, noteTitle, rel]
      );
      return res.status(201).json(rows[0]);
    }

    if (!class_level) return res.status(400).json({ error: 'class_level required' });
    const streamVal = stream && String(stream).trim() ? String(stream).trim() : null;
    const { rows } = await pool.query(
      `INSERT INTO class_documents (document_scope, class_level, stream, term, subject, doc_type, title, file_path)
       VALUES ('class', $1, $2, $3, $4, 'note', $5, $6)
       RETURNING *`,
      [class_level, streamVal, termNum, subject || null, noteTitle, rel]
    );
    res.status(201).json(rows[0]);
  })
);

function normalizeRatingOptions(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  return [];
}

function isLegacyWeeklyBand(value) {
  const b = String(value || '').trim();
  return b === 'strong' || b === 'average' || b === 'weak';
}

app.get(
  '/api/class-term-goal',
  asyncRoute(async (req, res) => {
    const classLevel = req.query && req.query.classLevel != null ? String(req.query.classLevel).trim() : '';
    const stream =
      req.query && req.query.stream != null && String(req.query.stream).trim()
        ? normalizeClassStream(req.query.stream)
        : '';
    const subject = req.query && req.query.subject != null ? String(req.query.subject).trim() : '';
    const termNum = Number(req.query && req.query.term);
    const academicYear = await resolveAcademicYear(req.query && req.query.year);
    if (!classLevel || !subject || !termNum) {
      return res.status(400).json({ error: 'classLevel, subject, and term are required' });
    }
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    const { rows } = await pool.query(
      `SELECT *
         FROM class_subject_term_goals
        WHERE class_level = $1
          AND stream = $2
          AND subject = $3
          AND term = $4
          AND academic_year = $5
        LIMIT 1`,
      [classLevel, stream, subject, termNum, academicYear]
    );
    if (!rows.length) {
      return res.json({
        class_level: classLevel,
        stream,
        subject,
        term: termNum,
        academic_year: academicYear,
        goal_text: '',
        updated_at: null,
      });
    }
    res.json(rows[0]);
  })
);

app.put(
  '/api/class-term-goal',
  asyncRoute(async (req, res) => {
    const classLevel = req.body && req.body.classLevel != null ? String(req.body.classLevel).trim() : '';
    const stream =
      req.body && req.body.stream != null && String(req.body.stream).trim()
        ? normalizeClassStream(req.body.stream)
        : '';
    const subject = req.body && req.body.subject != null ? String(req.body.subject).trim() : '';
    const termNum = Number(req.body && req.body.term);
    const academicYear = await resolveAcademicYear(req.body && req.body.year);
    const goalText =
      req.body && req.body.goal_text != null ? String(req.body.goal_text).trim().slice(0, 2000) : '';
    if (!classLevel || !subject || !termNum) {
      return res.status(400).json({ error: 'classLevel, subject, and term are required' });
    }
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    const { rows } = await pool.query(
      `INSERT INTO class_subject_term_goals (class_level, stream, subject, term, academic_year, goal_text)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (class_level, stream, subject, term, academic_year)
       DO UPDATE SET goal_text = EXCLUDED.goal_text, updated_at = NOW()
       RETURNING *`,
      [classLevel, stream, subject, termNum, academicYear, goalText]
    );
    res.json(rows[0]);
  })
);

app.get(
  '/api/class-weekly-goals',
  asyncRoute(async (req, res) => {
    const classLevel = req.query && req.query.classLevel != null ? String(req.query.classLevel).trim() : '';
    const stream =
      req.query && req.query.stream != null && String(req.query.stream).trim()
        ? normalizeClassStream(req.query.stream)
        : '';
    const subject = req.query && req.query.subject != null ? String(req.query.subject).trim() : '';
    const termNum = Number(req.query && req.query.term);
    const academicYear = await resolveAcademicYear(req.query && req.query.year);
    if (!classLevel || !subject || !termNum) {
      return res.status(400).json({ error: 'classLevel, subject, and term are required' });
    }
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    const { rows } = await pool.query(
      `SELECT week_no, goal_text, rating_options, updated_at
         FROM class_subject_weekly_goals
        WHERE class_level = $1
          AND stream = $2
          AND subject = $3
          AND term = $4
          AND academic_year = $5
        ORDER BY week_no ASC`,
      [classLevel, stream, subject, termNum, academicYear]
    );
    res.json(
      rows.map(function (row) {
        return {
          week_no: row.week_no,
          goal_text: row.goal_text || '',
          rating_options: normalizeRatingOptions(row.rating_options),
          updated_at: row.updated_at,
        };
      })
    );
  })
);

app.get(
  '/api/class-weekly-goal',
  asyncRoute(async (req, res) => {
    const classLevel = req.query && req.query.classLevel != null ? String(req.query.classLevel).trim() : '';
    const stream =
      req.query && req.query.stream != null && String(req.query.stream).trim()
        ? normalizeClassStream(req.query.stream)
        : '';
    const subject = req.query && req.query.subject != null ? String(req.query.subject).trim() : '';
    const termNum = Number(req.query && req.query.term);
    const weekNo = Number(req.query && req.query.week);
    const academicYear = await resolveAcademicYear(req.query && req.query.year);
    if (!classLevel || !subject || !termNum || !weekNo) {
      return res.status(400).json({ error: 'classLevel, subject, term, and week are required' });
    }
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    if (weekNo < 1 || weekNo > 11) return res.status(400).json({ error: 'week must be 1–11' });
    const { rows } = await pool.query(
      `SELECT *
         FROM class_subject_weekly_goals
        WHERE class_level = $1
          AND stream = $2
          AND subject = $3
          AND term = $4
          AND week_no = $5
          AND academic_year = $6
        LIMIT 1`,
      [classLevel, stream, subject, termNum, weekNo, academicYear]
    );
    if (!rows.length) {
      return res.json({
        class_level: classLevel,
        stream,
        subject,
        term: termNum,
        week_no: weekNo,
        academic_year: academicYear,
        goal_text: '',
        rating_options: [],
        updated_at: null,
      });
    }
    const row = rows[0];
    row.rating_options = normalizeRatingOptions(row.rating_options);
    res.json(row);
  })
);

app.put(
  '/api/class-weekly-goal',
  asyncRoute(async (req, res) => {
    const classLevel = req.body && req.body.classLevel != null ? String(req.body.classLevel).trim() : '';
    const stream =
      req.body && req.body.stream != null && String(req.body.stream).trim()
        ? normalizeClassStream(req.body.stream)
        : '';
    const subject = req.body && req.body.subject != null ? String(req.body.subject).trim() : '';
    const termNum = Number(req.body && req.body.term);
    const weekNo = Number(req.body && req.body.week);
    const academicYear = await resolveAcademicYear(req.body && req.body.year);
    const goalText =
      req.body && req.body.goal_text != null ? String(req.body.goal_text).trim().slice(0, 2000) : '';
    const ratingOptions = normalizeRatingOptions(req.body && req.body.rating_options);
    if (!classLevel || !subject || !termNum || !weekNo) {
      return res.status(400).json({ error: 'classLevel, subject, term, and week are required' });
    }
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    if (weekNo < 1 || weekNo > 11) return res.status(400).json({ error: 'week must be 1–11' });
    if (ratingOptions.length && ratingOptions.length < 2) {
      return res.status(400).json({ error: 'Add at least two rating options, one per line' });
    }
    const { rows } = await pool.query(
      `INSERT INTO class_subject_weekly_goals
         (class_level, stream, subject, term, week_no, academic_year, goal_text, rating_options)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (class_level, stream, subject, term, week_no, academic_year)
       DO UPDATE SET goal_text = EXCLUDED.goal_text,
                     rating_options = EXCLUDED.rating_options,
                     updated_at = NOW()
       RETURNING *`,
      [
        classLevel,
        stream,
        subject,
        termNum,
        weekNo,
        academicYear,
        goalText,
        JSON.stringify(ratingOptions),
      ]
    );
    const row = rows[0];
    row.rating_options = normalizeRatingOptions(row.rating_options);
    res.json(row);
  })
);

app.get(
  '/api/weekly-bands',
  asyncRoute(async (req, res) => {
    const { classLevel, stream, subject, term, week, student_id } = req.query;
    if (!classLevel) return res.status(400).json({ error: 'classLevel required' });
    if (!subject) return res.status(400).json({ error: 'subject required' });
    const termNum = Number(term);
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });

    let q = `
      SELECT w.student_id, w.subject, w.term, w.week_no, w.band, w.updated_at,
             s.full_name, s.reg_no, s.class_level, s.stream
      FROM student_subject_weekly_band w
      INNER JOIN students s ON s.id = w.student_id
      WHERE s.class_level = $1
        AND TRIM(w.subject) = TRIM($2::text)
        AND w.term = $3`;
    const params = [String(classLevel).trim(), String(subject).trim(), termNum];
    let n = 4;
    if (stream && String(stream).trim()) {
      q += ` AND LOWER(TRIM(COALESCE(s.stream, ''))) = LOWER(TRIM($${n++}))`;
      params.push(normalizeClassStream(stream));
    } else {
      q += ` AND (s.stream IS NULL OR TRIM(COALESCE(s.stream, '')) = '')`;
    }
    if (week != null && String(week).trim() !== '') {
      const weekNo = Number(week);
      if (weekNo < 1 || weekNo > 11) return res.status(400).json({ error: 'week must be 1–11' });
      q += ` AND w.week_no = $${n++}`;
      params.push(weekNo);
    }
    if (student_id != null && String(student_id).trim() !== '') {
      q += ` AND w.student_id = $${n++}`;
      params.push(Number(student_id));
    }
    q += ` ORDER BY s.full_name ASC, w.week_no ASC`;
    const { rows } = await pool.query(q, params);
    res.json(rows);
  })
);

app.post(
  '/api/weekly-bands',
  asyncRoute(async (req, res) => {
    const { student_id, subject, term, week_no, band } = req.body || {};
    const sid = Number(student_id);
    const termNum = Number(term);
    const weekNo = Number(week_no);
    if (!sid || Number.isNaN(sid)) return res.status(400).json({ error: 'student_id required' });
    if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'subject required' });
    if (termNum < 1 || termNum > 3) return res.status(400).json({ error: 'term must be 1–3' });
    if (weekNo < 1 || weekNo > 11) return res.status(400).json({ error: 'week_no must be 1–11' });
    const subj = String(subject).trim();
    const st = await pool.query('SELECT class_level, stream FROM students WHERE id = $1', [sid]);
    if (!st.rows.length) return res.status(404).json({ error: 'Student not found' });
    const cl = st.rows[0].class_level;
    const streamVal = st.rows[0].stream || '';

    if (await isReportLocked(cl, streamVal, termNum, 'end')) {
      return res.status(423).json({ error: 'This term report is locked. Unlock it from Reports before editing.' });
    }

    if (!band || String(band).trim() === '' || String(band) === 'unset') {
      await pool.query(
        `DELETE FROM student_subject_weekly_band
         WHERE student_id = $1 AND subject = $2 AND term = $3 AND week_no = $4`,
        [sid, subj, termNum, weekNo]
      );
      return res.json({ ok: true, deleted: true });
    }
    const b = String(band).trim();
    if (b.length > 200) return res.status(400).json({ error: 'rating label too long' });

    const { rows } = await pool.query(
      `INSERT INTO student_subject_weekly_band (student_id, subject, term, week_no, band)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (student_id, subject, term, week_no)
       DO UPDATE SET band = EXCLUDED.band, updated_at = NOW()
       RETURNING *`,
      [sid, subj, termNum, weekNo, b]
    );
    res.status(201).json(rows[0]);
  })
);

app.get(
  '/api/subject-bands',
  asyncRoute(async (req, res) => {
    const { classLevel, stream, subject } = req.query;
    if (!classLevel || !subject) {
      return res.status(400).json({ error: 'classLevel and subject are required' });
    }
    let q = `
      SELECT s.id, s.full_name, s.reg_no, s.passport_path, b.band
      FROM students s
      LEFT JOIN student_subject_band b ON b.student_id = s.id AND b.subject = $2
      WHERE s.class_level = $1`;
    const params = [classLevel, subject];
    if (stream) {
      q += ' AND s.stream = $3';
      params.push(stream);
    } else {
      q += " AND (s.stream IS NULL OR s.stream = '')";
    }
    q += ' ORDER BY s.full_name ASC';
    const { rows } = await pool.query(q, params);
    res.json({ students: rows });
  })
);

app.post(
  '/api/subject-bands',
  asyncRoute(async (req, res) => {
    const { student_id, subject, band } = req.body;
    if (!student_id || !subject || !band) {
      return res.status(400).json({ error: 'student_id, subject, and band are required' });
    }
    if (!['strong', 'average', 'weak'].includes(band)) {
      return res.status(400).json({ error: 'band must be strong, average, or weak' });
    }
    const sid = Number(student_id);
    const check = await pool.query('SELECT id FROM students WHERE id = $1', [sid]);
    if (!check.rows.length) return res.status(404).json({ error: 'Student not found' });
    const { rows } = await pool.query(
      `INSERT INTO student_subject_band (student_id, subject, band)
       VALUES ($1, $2, $3)
       ON CONFLICT (student_id, subject)
       DO UPDATE SET band = EXCLUDED.band, updated_at = NOW()
       RETURNING *`,
      [sid, String(subject).trim(), band]
    );
    res.status(201).json(rows[0]);
  })
);

app.delete(
  '/api/subject-bands/:studentId',
  asyncRoute(async (req, res) => {
    const sid = Number(req.params.studentId);
    const subject = req.query.subject;
    if (!sid || !subject) {
      return res.status(400).json({ error: 'studentId and subject query are required' });
    }
    await pool.query('DELETE FROM student_subject_band WHERE student_id = $1 AND subject = $2', [
      sid,
      String(subject).trim(),
    ]);
    res.json({ ok: true });
  })
);

app.patch(
  '/api/documents/:id',
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const title = req.body.title != null ? String(req.body.title).trim() : '';
    if (!title) return res.status(400).json({ error: 'title required' });
    const { rows } = await pool.query(
      `UPDATE class_documents SET title = $1 WHERE id = $2 RETURNING *`,
      [title.slice(0, 300), id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  })
);

app.put(
  '/api/documents/:id/file',
  uploadNote.single('file'),
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const prev = await pool.query('SELECT file_path FROM class_documents WHERE id = $1', [id]);
    if (!prev.rows.length) return res.status(404).json({ error: 'Not found' });
    const oldPath = prev.rows[0].file_path;
    const rel = `/uploads/notes/${req.file.filename}`;
    const { rows } = await pool.query(`UPDATE class_documents SET file_path = $1 WHERE id = $2 RETURNING *`, [
      rel,
      id,
    ]);
    if (oldPath && oldPath.startsWith('/uploads/')) {
      const disk = path.join(ROOT, oldPath.replace(/^\//, ''));
      try {
        fs.unlinkSync(disk);
      } catch (_) {}
    }
    res.json(rows[0]);
  })
);

app.delete(
  '/api/documents/:id',
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const r = await pool.query('DELETE FROM class_documents WHERE id = $1 RETURNING file_path', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    const fp = r.rows[0].file_path;
    if (fp && fp.startsWith('/uploads/')) {
      const disk = path.join(ROOT, fp.replace(/^\//, ''));
      try {
        fs.unlinkSync(disk);
      } catch (_) {}
    }
    res.json({ ok: true });
  })
);

/** After all /api routes so API handlers are never shadowed by static files */
app.use(express.static(path.join(ROOT, 'public')));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.code === '23505') {
    return res.status(409).json({
      error: 'Child already exists — this registration number is already in use.',
    });
  }
  res.status(500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
  console.log(`THE OCEAN OF KNOWLEDGE SCHOOL server http://localhost:${PORT}`);
});
