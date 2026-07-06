/**
 * Ugandan-style primary division from combined subject grades (AGG digits 1–9).
 * PLE uses four examined subjects (aggregate 4–36). We have more subjects in-app,
 * so we use an equivalent: round((sum of grades / count) * 4), clamped to 4–36,
 * then apply the usual division bands on that value.
 */

const DEFAULT_SKILL_SUBJECTS = ['Computer', 'Salon', 'Bakery', 'Fashion and Design', 'Music'];
const PRIMARY_AGGREGATE_SUBJECTS = ['Mathematics', 'English', 'Literacy 1A', 'Literacy 1B'];

function subjectKey(subject) {
  return String(subject || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const PRIMARY_AGGREGATE_KEYS = new Set(PRIMARY_AGGREGATE_SUBJECTS.map(subjectKey));

function parseAggGrade(agg) {
  const n = parseInt(String(agg == null ? '' : agg).trim(), 10);
  if (Number.isNaN(n) || n < 1 || n > 9) return null;
  return n;
}

/** UNEB-style division from a 4-subject-scale aggregate (4 = best, 36 = worst). */
function divisionFromUnebEquivalentAggregate(eq) {
  if (eq == null || Number.isNaN(eq)) return '';
  const e = Math.floor(Number(eq));
  if (e < 4) return 'I';
  if (e >= 4 && e <= 12) return 'I';
  if (e >= 13 && e <= 23) return 'II';
  if (e >= 24 && e <= 29) return 'III';
  if (e >= 30 && e <= 34) return 'IV';
  return 'U';
}

/**
 * @param {Array<{ subject: string, agg: string }>} rows - mark rows for one learner / term / period
 * @param {string[]} skillSubjects
 * @returns {{ sum: number|null, count: number, equivalentAggregate: number|null, division: string }}
 */
function primaryAggregateFromMarkRows(rows, skillSubjects) {
  const grades = [];
  for (const r of rows || []) {
    if (!PRIMARY_AGGREGATE_KEYS.has(subjectKey(r.subject))) continue;
    const g = parseAggGrade(r.agg);
    if (g != null) grades.push(g);
  }
  if (!grades.length) {
    return { sum: null, count: 0, equivalentAggregate: null, division: '' };
  }
  const sum = grades.reduce((a, b) => a + b, 0);
  const n = grades.length;
  const equiv = Math.round((sum / n) * 4);
  const e = Math.max(4, Math.min(36, equiv));
  return {
    sum,
    count: n,
    equivalentAggregate: e,
    division: divisionFromUnebEquivalentAggregate(e),
  };
}

module.exports = {
  parseAggGrade,
  divisionFromUnebEquivalentAggregate,
  primaryAggregateFromMarkRows,
  DEFAULT_SKILL_SUBJECTS,
  PRIMARY_AGGREGATE_SUBJECTS,
};
