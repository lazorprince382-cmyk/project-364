/**
 * Polish teacher comments: spelling/grammar (LanguageTool public API) + fuzzy learner name fixes.
 */

const LT_ALLOWED = new Set([
  'TYPOS',
  'TYPOGRAPHY',
  'CASING',
  'GRAMMAR',
  'CONFUSED_WORDS',
  'REDUNDANCY',
  'MISSING_WORD',
]);

const STOP = new Set(
  `the and for are but not can all new any may way did got let put say she who boy girl one two how our out day too also into from with have been very each come work will time when them they this that than then what your more most much such only over just even like well back here many some make than then been were said each other about after again before under while where which their there these those would could should must might shall needs need needs being does doing done made make took take give gave given find found keep kept seem seemed help helped try tried use used using show showed think thought know knew want wanted look looked feel felt play played learn learned teach taught class term week year good great poor nice kind hard easy high low same both few lot much little long short big small small read write wrote speak spoke listen listened parent parents teacher teachers school pupil pupils child children learner learners student students care cares caring progress effort behaviour behavior attitude attend attendance punctual late absent homework classmate`.split(
    /\s+/
  )
);

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n];
}

function maxEditsForLen(len) {
  if (len < 4) return 1;
  if (len < 9) return 2;
  return Math.min(3, Math.floor(len / 3));
}

function nameParts(full) {
  return String(full || '')
    .split(/\s+/)
    .filter((p) => p.length >= 2);
}

/** If original was ALL CAPS, uppercase result; else use canonical part casing */
function preserveCasePattern(original, canonical) {
  if (original === original.toUpperCase() && /[A-Z]/.test(original)) {
    return canonical.toUpperCase();
  }
  return canonical;
}

/**
 * Fix typos only for the current learner's name tokens — never inject another child's full name.
 * @param {string} text
 * @param {{ id: number, full_name: string }[]} students
 * @param {number|null} preferredStudentId
 */
function fixChildNames(text, students, preferredStudentId) {
  if (!text || !students || !students.length) return text;
  const prefId = Number(preferredStudentId);
  const pref = students.find((s) => Number(s.id) === prefId);
  if (!pref) return text;

  const prefParts = nameParts(pref.full_name);
  if (!prefParts.length) return text;
  const prefLower = prefParts.map((p) => p.toLowerCase());

  return text.replace(/\b[A-Za-z][A-Za-z'-]*\b/g, (raw) => {
    const wLower = raw.toLowerCase();
    if (raw.length < 3 || STOP.has(wLower)) return raw;

    const exactIdx = prefLower.indexOf(wLower);
    if (exactIdx >= 0) return preserveCasePattern(raw, prefParts[exactIdx]);

    let bestPart = null;
    let bestD = Infinity;
    for (const part of prefParts) {
      const pl = part.toLowerCase();
      const d = levenshtein(wLower, pl);
      const thresh = maxEditsForLen(Math.max(raw.length, part.length));
      if (d <= thresh && d > 0 && d < bestD) {
        bestD = d;
        bestPart = part;
      }
    }
    if (bestPart) return preserveCasePattern(raw, bestPart);
    return raw;
  });
}

/** Remove accidental full-name insertions for other learners (legacy polish bug). */
function stripOtherLearnersFullNames(text, students, preferredStudentId) {
  if (!text || !students || !students.length) return text;
  const prefId = Number(preferredStudentId);
  let out = text;
  for (const s of students) {
    if (Number(s.id) === prefId) continue;
    const full = String(s.full_name || '').trim();
    if (full.length < 5) continue;
    const escaped = full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp('\\b' + escaped + '\\b', 'gi');
    const parts = nameParts(full);
    const first = parts[0] || '';
    out = out.replace(re, (match) => preserveCasePattern(match, first));
  }
  return out;
}

async function callLanguageTool(text) {
  if (!text || text.length < 2) return text;
  const params = new URLSearchParams();
  params.append('text', text);
  params.append('language', 'en');
  params.append('enabledOnly', 'false');
  let res;
  try {
    res = await fetch('https://api.languagetool.org/v2/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return text;
  }
  if (res.status === 429 || !res.ok) return text;
  let data;
  try {
    data = await res.json();
  } catch {
    return text;
  }
  const matches = data.matches || [];
  let out = text;
  const sorted = matches.slice().sort((a, b) => (b.offset || 0) - (a.offset || 0));
  for (const m of sorted) {
    if (m.offset == null || m.length == null) continue;
    const cat = m.rule && m.rule.category && m.rule.category.id;
    if (!cat || !LT_ALLOWED.has(cat)) continue;
    const rep = m.replacements && m.replacements[0];
    if (!rep || rep.value == null) continue;
    const start = m.offset;
    const len = m.length;
    if (start < 0 || start + len > out.length) continue;
    out = out.slice(0, start) + rep.value + out.slice(start + len);
  }
  return out;
}

/**
 * @param {string} text
 * @param {{ id: number, full_name: string }[]} students
 * @param {number|null} preferredStudentId
 * @param {{ skipLanguageTool?: boolean }} opts
 */
async function polishComment(text, students, preferredStudentId, opts = {}) {
  let t = String(text || '').trim();
  if (!t) return t;
  t = fixChildNames(t, students, preferredStudentId);
  t = stripOtherLearnersFullNames(t, students, preferredStudentId);
  if (!opts.skipLanguageTool) {
    try {
      t = await callLanguageTool(t);
      t = fixChildNames(t, students, preferredStudentId);
      t = stripOtherLearnersFullNames(t, students, preferredStudentId);
    } catch (_) {
      /* keep name-fixed text if LT fails */
    }
  }
  if (t.length > 300) t = t.slice(0, 300);
  return t;
}

module.exports = {
  polishComment,
  fixChildNames,
  stripOtherLearnersFullNames,
  levenshtein,
};
