/**
 * Subject lists per class_level — mirrors public/js/subjects.js for server-side analytics.
 */
const VOCATIONAL_ALL = ['Computer', 'Salon', 'Bakery', 'Fashion and Design', 'Music'];
const VOCATIONAL_NO_BAKERY = ['Computer', 'Salon', 'Fashion and Design', 'Music'];

const SUBJECTS_BY_LEVEL = {
  daycare: [
    'Listening and Speaking',
    'Drawing and Shading',
    'General Knowledge',
    'Social Development',
    'Rhythms and Songs',
    'Health Habits',
  ],
  baby: ['Reading', 'Writing', 'Numeracy', 'General Knowledge'].concat(VOCATIONAL_NO_BAKERY),
  middle: ['Language Development', 'Reading', 'Writing', 'Numeracy', 'General Knowledge'].concat(VOCATIONAL_ALL),
  top: [
    'Language Development',
    'Health Habits',
    'Reading',
    'Writing',
    'Social Development',
    'Numeracy',
  ].concat(VOCATIONAL_ALL),
  primary1: [
    'Mathematics',
    'English',
    'Reading',
    'Literacy 1A',
    'Literacy 1B',
    'Religious Education',
  ].concat(VOCATIONAL_ALL),
  primary2: [
    'Mathematics',
    'English',
    'Reading',
    'Literacy 1A',
    'Literacy 1B',
    'Religious Education',
  ].concat(VOCATIONAL_ALL),
};

const SKILL_SUBJECTS = ['Computer', 'Salon', 'Bakery', 'Fashion and Design', 'Music'];

function subjectsForClassLevel(classLevel) {
  const list = SUBJECTS_BY_LEVEL[classLevel];
  return Array.isArray(list) ? list.slice() : [];
}

module.exports = { SUBJECTS_BY_LEVEL, SKILL_SUBJECTS, subjectsForClassLevel };
