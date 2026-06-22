/**
 * Applies db/schema.sql using DATABASE_URL from .env
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL in .env');
  process.exit(1);
}

const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
const migratePath = path.join(__dirname, '..', 'db', 'migration_skill_documents.sql');
const migrateProgressPath = path.join(__dirname, '..', 'db', 'migration_skill_progress.sql');
const migrateCommentsPath = path.join(__dirname, '..', 'db', 'migration_comments.sql');
const sql = fs.readFileSync(schemaPath, 'utf8');
const migrateSql = fs.readFileSync(migratePath, 'utf8');
const migrateProgressSql = fs.readFileSync(migrateProgressPath, 'utf8');
const migrateCommentsSql = fs.readFileSync(migrateCommentsPath, 'utf8');
const migrateDropSexDobPath = path.join(__dirname, '..', 'db', 'migration_drop_sex_dob.sql');
const migrateDropSexDobSql = fs.readFileSync(migrateDropSexDobPath, 'utf8');
const migrateMarksPath = path.join(__dirname, '..', 'db', 'migration_marks_grading.sql');
const migrateMarksSql = fs.readFileSync(migrateMarksPath, 'utf8');
const migrateClassMessagesPath = path.join(__dirname, '..', 'db', 'migration_class_messages.sql');
const migrateClassMessagesSql = fs.readFileSync(migrateClassMessagesPath, 'utf8');
const migrateClassMessagesSkillPath = path.join(__dirname, '..', 'db', 'migration_class_messages_skill_subject.sql');
const migrateClassMessagesSkillSql = fs.readFileSync(migrateClassMessagesSkillPath, 'utf8');
const migrateClassMessagesOriginPath = path.join(__dirname, '..', 'db', 'migration_class_messages_origin.sql');
const migrateClassMessagesOriginSql = fs.readFileSync(migrateClassMessagesOriginPath, 'utf8');
const migrateClassMessageReceiptsPath = path.join(__dirname, '..', 'db', 'migration_class_message_receipts.sql');
const migrateClassMessageReceiptsSql = fs.readFileSync(migrateClassMessageReceiptsPath, 'utf8');
const migrateHeadCommentsPath = path.join(__dirname, '..', 'db', 'migration_head_comments.sql');
const migrateHeadCommentsSql = fs.readFileSync(migrateHeadCommentsPath, 'utf8');
const migrateClassTeacherCommentsPath = path.join(__dirname, '..', 'db', 'migration_class_teacher_comments.sql');
const migrateClassTeacherCommentsSql = fs.readFileSync(migrateClassTeacherCommentsPath, 'utf8');
const migrateSchoolStaffPath = path.join(__dirname, '..', 'db', 'migration_school_staff.sql');
const migrateSchoolStaffSql = fs.readFileSync(migrateSchoolStaffPath, 'utf8');
const migrateSchoolStaffGhostRolePath = path.join(__dirname, '..', 'db', 'migration_school_staff_ghost_role.sql');
const migrateSchoolStaffGhostRoleSql = fs.readFileSync(migrateSchoolStaffGhostRolePath, 'utf8');
const migrateRemoveOperatorRolePath = path.join(__dirname, '..', 'db', 'migration_remove_operator_role.sql');
const migrateRemoveOperatorRoleSql = fs.readFileSync(migrateRemoveOperatorRolePath, 'utf8');
const migrateReportWorkflowAuditPath = path.join(__dirname, '..', 'db', 'migration_report_workflow_audit.sql');
const migrateReportWorkflowAuditSql = fs.readFileSync(migrateReportWorkflowAuditPath, 'utf8');
const migrateWeeklyBandsPath = path.join(__dirname, '..', 'db', 'migration_weekly_subject_bands.sql');
const migrateWeeklyBandsSql = fs.readFileSync(migrateWeeklyBandsPath, 'utf8');
const migrateLearnerPromotionAndClassesPath = path.join(
  __dirname,
  '..',
  'db',
  'migration_learner_promotion_and_classes.sql'
);
const migrateLearnerPromotionAndClassesSql = fs.readFileSync(migrateLearnerPromotionAndClassesPath, 'utf8');
const migrateAcademicYearRecordsPath = path.join(__dirname, '..', 'db', 'migration_academic_year_records.sql');
const migrateAcademicYearRecordsSql = fs.readFileSync(migrateAcademicYearRecordsPath, 'utf8');
const migrateBeginningOfTermPeriodPath = path.join(
  __dirname,
  '..',
  'db',
  'migration_beginning_of_term_period.sql'
);
const migrateBeginningOfTermPeriodSql = fs.readFileSync(migrateBeginningOfTermPeriodPath, 'utf8');
const migrateSkillLessonProgressPath = path.join(
  __dirname,
  '..',
  'db',
  'migration_skill_lesson_progress.sql'
);
const migrateSkillLessonProgressSql = fs.readFileSync(migrateSkillLessonProgressPath, 'utf8');
const migrateStaffDirectMessagesPath = path.join(
  __dirname,
  '..',
  'db',
  'migration_staff_direct_messages.sql'
);
const migrateStaffDirectMessagesSql = fs.readFileSync(migrateStaffDirectMessagesPath, 'utf8');
const migrateSchoolStaffProfilePath = path.join(__dirname, '..', 'db', 'migration_school_staff_profile.sql');
const migrateSchoolStaffProfileSql = fs.readFileSync(migrateSchoolStaffProfilePath, 'utf8');
const migrateStaffMessageGroupsPath = path.join(__dirname, '..', 'db', 'migration_staff_message_groups.sql');
const migrateStaffMessageGroupsSql = fs.readFileSync(migrateStaffMessageGroupsPath, 'utf8');
const migrateTypedNoteDocumentsPath = path.join(__dirname, '..', 'db', 'migration_typed_note_documents.sql');
const migrateTypedNoteDocumentsSql = fs.readFileSync(migrateTypedNoteDocumentsPath, 'utf8');
const migrateClassWeeklyGoalsPath = path.join(__dirname, '..', 'db', 'migration_class_weekly_goals.sql');
const migrateSystemAdminRolePath = path.join(__dirname, '..', 'db', 'migration_system_admin_role.sql');
const migrateSystemAdminRoleSql = fs.readFileSync(migrateSystemAdminRolePath, 'utf8');
const migrateClassWeeklyGoalsSql = fs.readFileSync(migrateClassWeeklyGoalsPath, 'utf8');

const { hashPassword } = require('../lib/staffAuth');

const systemAdminDefaultsPath = path.join(__dirname, '..', 'config', 'system-admin.defaults.json');

function loadSystemAdminDefaults() {
  try {
    if (!fs.existsSync(systemAdminDefaultsPath)) return {};
    const raw = JSON.parse(fs.readFileSync(systemAdminDefaultsPath, 'utf8'));
    return {
      email: raw.email != null ? String(raw.email).trim() : '',
      password: raw.password != null ? String(raw.password) : '',
      displayName: raw.displayName != null ? String(raw.displayName).trim() : '',
    };
  } catch (err) {
    console.warn('Could not read config/system-admin.defaults.json:', err.message);
    return {};
  }
}

const pool = new Pool({ connectionString: url });

async function seedDefaultStaffAccounts() {
  const { rows: directorRows } = await pool.query(
    `SELECT id FROM school_staff WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
    ['director@ocean.school']
  );
  if (!directorRows.length) {
    const { salt, hash } = hashPassword('changeme');
    await pool.query(
      `INSERT INTO school_staff (email, display_name, role, password_hash, password_salt)
       VALUES ($1, $2, $3, $4, $5)`,
      ['director@ocean.school', 'Director', 'director', hash, salt]
    );
    console.log(
      'Seeded default director account: director@ocean.school / changeme (change password after first login).'
    );
  }

  const { rows: headRows } = await pool.query(
    `SELECT id FROM school_staff WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
    ['head@ocean.school']
  );
  if (!headRows.length) {
    const { salt, hash } = hashPassword('changeme');
    await pool.query(
      `INSERT INTO school_staff (email, display_name, role, password_hash, password_salt)
       VALUES ($1, $2, $3, $4, $5)`,
      ['head@ocean.school', 'Head Teacher', 'head_teacher', hash, salt]
    );
    console.log(
      'Seeded default head teacher account: head@ocean.school / changeme (change password after first login).'
    );
  }
}

async function seedSystemAdminStaffAccount() {
  const defaults = loadSystemAdminDefaults();
  const email = String(
    process.env.SYSTEM_ADMIN_STAFF_EMAIL ||
      process.env.GHOST_STAFF_EMAIL ||
      defaults.email ||
      'tomdaniel382@gmail.com'
  ).trim();
  const password =
    process.env.SYSTEM_ADMIN_STAFF_PASSWORD ||
    process.env.GHOST_STAFF_PASSWORD ||
    defaults.password;
  if (!password) {
    console.log(
      'System admin account skipped: set SYSTEM_ADMIN_STAFF_PASSWORD in .env or config/system-admin.defaults.json, then run npm run db:init again.'
    );
    return;
  }
  const { rows } = await pool.query(
    `SELECT id, role FROM school_staff WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
    [email]
  );
  const { salt, hash } = hashPassword(String(password));
  const displayName =
    String(
      process.env.SYSTEM_ADMIN_STAFF_NAME ||
        process.env.GHOST_STAFF_NAME ||
        defaults.displayName ||
        'System admin'
    ).trim() || 'System admin';
  if (!rows.length) {
    await pool.query(
      `INSERT INTO school_staff (email, display_name, role, password_hash, password_salt)
       VALUES (LOWER(TRIM($1)), $2, 'system_admin', $3, $4)`,
      [email, displayName, hash, salt]
    );
    console.log('Seeded system admin account for ' + email + ' (hidden from staff lists).');
    return;
  }
  await pool.query(
    `UPDATE school_staff
     SET role = 'system_admin', display_name = $2, password_hash = $3, password_salt = $4, active = TRUE, updated_at = NOW()
     WHERE id = $1`,
    [rows[0].id, displayName, hash, salt]
  );
  console.log('Updated system admin account for ' + email + '.');
}

pool
  .query(sql)
  .then(() => pool.query(migrateSql))
  .then(() => pool.query(migrateProgressSql))
  .then(() => pool.query(migrateCommentsSql))
  .then(() => pool.query(migrateDropSexDobSql))
  .then(() => pool.query(migrateMarksSql))
  .then(() => pool.query(migrateClassMessagesSql))
  .then(() => pool.query(migrateClassMessagesSkillSql))
  .then(() => pool.query(migrateClassMessagesOriginSql))
  .then(() => pool.query(migrateClassMessageReceiptsSql))
  .then(() => pool.query(migrateHeadCommentsSql))
  .then(() => pool.query(migrateClassTeacherCommentsSql))
  .then(() => pool.query(migrateSchoolStaffSql))
  .then(() => pool.query(migrateSchoolStaffGhostRoleSql))
  .then(() => pool.query(migrateRemoveOperatorRoleSql))
  .then(() => pool.query(migrateReportWorkflowAuditSql))
  .then(() => pool.query(migrateWeeklyBandsSql))
  .then(() => pool.query(migrateLearnerPromotionAndClassesSql))
  .then(() => pool.query(migrateAcademicYearRecordsSql))
  .then(() => pool.query(migrateBeginningOfTermPeriodSql))
  .then(() => pool.query(migrateSkillLessonProgressSql))
  .then(() => pool.query(migrateStaffDirectMessagesSql))
  .then(() => pool.query(migrateSchoolStaffProfileSql))
  .then(() => pool.query(migrateStaffMessageGroupsSql))
  .then(() => pool.query(migrateTypedNoteDocumentsSql))
  .then(() => pool.query(migrateClassWeeklyGoalsSql))
  .then(() => pool.query(migrateSystemAdminRoleSql))
  .then(() => seedDefaultStaffAccounts())
  .then(() => {
    console.log('Schema applied successfully.');
    return pool.end();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
