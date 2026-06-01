/**
 * Class cards + which levels need a stream before opening the dashboard.
 */
window.OCEAN_CLASSES = [
  {
    id: 'daycare',
    title: 'Day Care',
    blurb: 'Learners, marks, notes, and reports.',
    needsStream: false,
  },
  {
    id: 'baby',
    title: 'Baby Class',
    blurb: 'Select year data stream to continue.',
    needsStream: true,
    streams: [
      { id: 'waves', label: 'Waves' },
      { id: 'pearls', label: 'Pearls' },
    ],
  },
  {
    id: 'middle',
    title: 'Middle Class',
    blurb: 'Select your class stream to continue.',
    needsStream: true,
    streams: [
      { id: 'dolphins', label: 'Dolphins' },
      { id: 'whales', label: 'Whales' },
    ],
  },
  {
    id: 'top',
    title: 'Top Class',
    blurb: 'Learners, marks, notes, and reports.',
    needsStream: false,
  },
  {
    id: 'primary1',
    title: 'Primary One',
    blurb: 'Learners, marks, notes, and reports.',
    needsStream: false,
  },
  {
    id: 'primary2',
    title: 'Primary Two',
    blurb: 'Learners, marks, notes, and reports.',
    needsStream: false,
  },
  {
    id: 'skills',
    title: 'Skills',
    blurb: 'Computer, Salon, Bakery, Fashion & Design, or Music.',
    needsStream: false,
    needsSkillPick: true,
    skills: [
      { id: 'computer', subject: 'Computer', label: 'Computer' },
      { id: 'salon', subject: 'Salon', label: 'Salon' },
      { id: 'bakery', subject: 'Bakery', label: 'Bakery' },
      { id: 'fashion', subject: 'Fashion and Design', label: 'Fashion and Design' },
      { id: 'music', subject: 'Music', label: 'Music' },
    ],
  },
];
