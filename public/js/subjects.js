/**
 * Subjects per class level (Uganda nursery / primary) + vocational extras.
 * Keys match URL/API class_level slugs.
 * Bakery is omitted for Baby Class only.
 */
(function () {
  /** Skill subjects — uploads only from Skills dashboard (per class or school-wide). */
  window.OCEAN_SKILL_SUBJECTS = [
    'Computer',
    'Salon',
    'Bakery',
    'Fashion and Design',
    'Music',
  ];

  const VOCATIONAL_ALL = ['Computer', 'Salon', 'Bakery', 'Fashion and Design', 'Music'];
  const VOCATIONAL_NO_BAKERY = ['Computer', 'Salon', 'Fashion and Design', 'Music'];

  window.OCEAN_SUBJECTS = {
    daycare: [
      'Listening and Speaking',
      'Drawing and Shading',
      'General Knowledge',
      'Social Development',
      'Rhythms and Songs',
      'Health Habits',
    ],
    baby: [
      'Reading',
      'Writing',
      'Numeracy',
      'General Knowledge',
    ].concat(VOCATIONAL_NO_BAKERY),
    middle: [
      'Language Development',
      'Reading',
      'Writing',
      'Numeracy',
      'General Knowledge',
    ].concat(VOCATIONAL_ALL),
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

  window.OCEAN_SUBJECTS_READY = fetch('/api/class-catalog')
    .then(function (res) {
      if (!res.ok) return [];
      return res.json().catch(function () {
        return [];
      });
    })
    .then(function (rows) {
      (rows || []).forEach(function (r) {
        const id = String(r && r.id ? r.id : '').trim().toLowerCase();
        if (!id || window.OCEAN_SUBJECTS[id]) return;
        const subjects = Array.isArray(r && r.subjects) ? r.subjects : [];
        if (subjects.length) {
          window.OCEAN_SUBJECTS[id] = subjects.slice();
        } else if (String(id).indexOf('primary') === 0) {
          window.OCEAN_SUBJECTS[id] = (window.OCEAN_SUBJECTS.primary2 || []).slice();
        }
      });
      return window.OCEAN_SUBJECTS;
    })
    .catch(function () {
      return window.OCEAN_SUBJECTS;
    });
})();
