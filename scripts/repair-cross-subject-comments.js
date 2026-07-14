/**
 * Finds non-skill subject comments that exactly duplicate a skill-subject comment
 * for the same learner/report slot. Use --apply to delete the duplicate non-skill rows.
 */
require('dotenv').config();
const { Pool } = require('pg');

const SKILL_SUBJECTS = ['Computer', 'Salon', 'Bakery', 'Fashion and Design', 'Music'];
const apply = process.argv.includes('--apply');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL in .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: url });

async function main() {
  const { rows } = await pool.query(
    `
    SELECT dup.id,
           dup.student_id,
           dup.subject AS duplicate_subject,
           skill.subject AS skill_subject,
           dup.term,
           dup.period,
           dup.academic_year,
           dup.body
      FROM student_subject_comments dup
      JOIN student_subject_comments skill
        ON skill.student_id = dup.student_id
       AND skill.term = dup.term
       AND skill.period = dup.period
       AND skill.academic_year = dup.academic_year
       AND BTRIM(skill.body) = BTRIM(dup.body)
       AND skill.id <> dup.id
     WHERE dup.subject <> ALL($1::text[])
       AND skill.subject = ANY($1::text[])
       AND BTRIM(COALESCE(dup.body, '')) <> ''
     ORDER BY dup.academic_year, dup.term, dup.period, dup.student_id, dup.subject
    `,
    [SKILL_SUBJECTS]
  );

  const uniqueRows = Array.from(new Map(rows.map((row) => [row.id, row])).values());

  console.log(`${uniqueRows.length} duplicate non-skill comment row(s) found.`);
  uniqueRows.slice(0, 50).forEach((row) => {
    console.log(
      [
        `id=${row.id}`,
        `student=${row.student_id}`,
        `duplicate=${row.duplicate_subject}`,
        `skill=${row.skill_subject}`,
        `term=${row.term}`,
        `period=${row.period}`,
        `year=${row.academic_year}`,
      ].join(' ')
    );
  });

  if (!apply || !uniqueRows.length) return;
  const ids = uniqueRows.map((row) => row.id);
  await pool.query('DELETE FROM student_subject_comments WHERE id = ANY($1::int[])', [ids]);
  console.log(`Deleted ${ids.length} duplicate non-skill comment row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
