const { SUBJECTS_BY_LEVEL, subjectsForClassLevel } = require('./oceanSubjects');

function normalizeStream(s) {
  if (s === undefined || s === null) return '';
  return String(s).trim();
}

function normalizeSubjectKey(s) {
  return String(s || '').trim();
}

/**
 * Build a set of "studentId\tSubject" where the learner has a non-empty comment or a scored mark
 * for the given term/period.
 */
function buildEnteredSet(commentRows, markRows) {
  const set = new Set();
  for (const r of commentRows) {
    const body = r.body != null ? String(r.body).trim() : '';
    if (body) set.add(`${r.student_id}\t${normalizeSubjectKey(r.subject)}`);
  }
  for (const r of markRows) {
    if (r.marks_scored != null && !Number.isNaN(Number(r.marks_scored))) {
      set.add(`${r.student_id}\t${normalizeSubjectKey(r.subject)}`);
    }
  }
  return set;
}

function groupStudents(students) {
  const groups = new Map();
  for (const s of students) {
    const stream = normalizeStream(s.stream);
    const key = `${s.class_level}\t${stream}`;
    if (!groups.has(key)) {
      groups.set(key, {
        class_level: s.class_level,
        stream,
        label: stream ? `${s.class_level} · ${stream}` : s.class_level,
        studentIds: [],
      });
    }
    groups.get(key).studentIds.push(s.id);
  }
  return groups;
}

function subjectProgressForStudentIds(studentIds, subjects, enteredSet) {
  const total = studentIds.length;
  return subjects.map((subject) => {
    let entered = 0;
    for (const sid of studentIds) {
      if (enteredSet.has(`${sid}\t${normalizeSubjectKey(subject)}`)) entered += 1;
    }
    const percent = total ? Math.round((100 * entered) / total) : 0;
    return { subject, total, entered, percent };
  });
}

/**
 * School-wide row per subject name: only learners in levels that take that subject are counted.
 */
function schoolSubjectRollup(students, enteredSet) {
  const bySubject = new Map();

  for (const [level, subjects] of Object.entries(SUBJECTS_BY_LEVEL)) {
    const idsInLevel = students.filter((s) => s.class_level === level).map((s) => s.id);
    if (!idsInLevel.length) continue;
    for (const subject of subjects) {
      if (!bySubject.has(subject)) {
        bySubject.set(subject, []);
      }
      bySubject.get(subject).push(...idsInLevel);
    }
  }

  const out = [];
  for (const [subject, idList] of bySubject) {
    const uniqueIds = [...new Set(idList)];
    let entered = 0;
    for (const sid of uniqueIds) {
      if (enteredSet.has(`${sid}\t${normalizeSubjectKey(subject)}`)) entered += 1;
    }
    const total = uniqueIds.length;
    const percent = total ? Math.round((100 * entered) / total) : 0;
    out.push({ subject, total, entered, percent });
  }
  out.sort((a, b) => a.subject.localeCompare(b.subject));
  return out;
}

/**
 * @param {Array<{id:number,class_level:string,stream:string|null}>} students
 * @param {Array<{student_id:number,subject:string,body:string}>} commentRows
 * @param {Array<{student_id:number,subject:string,marks_scored:any}>} markRows
 */
function computeSubjectProgress(students, commentRows, markRows) {
  const enteredSet = buildEnteredSet(commentRows, markRows);
  const groups = groupStudents(students);
  const byClass = [];

  for (const g of groups.values()) {
    const subjects = subjectsForClassLevel(g.class_level);
    if (!subjects.length) continue;
    const rows = subjectProgressForStudentIds(g.studentIds, subjects, enteredSet);
    byClass.push({
      class_level: g.class_level,
      stream: g.stream,
      label: g.label,
      subjects: rows,
    });
  }

  byClass.sort((a, b) => {
    const c = a.class_level.localeCompare(b.class_level);
    if (c !== 0) return c;
    return (a.stream || '').localeCompare(b.stream || '');
  });

  const schoolSubjects = schoolSubjectRollup(students, enteredSet);

  return { byClass, schoolSubjects, enteredSetSize: enteredSet.size };
}

module.exports = { computeSubjectProgress, normalizeStream };
