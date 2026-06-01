/**
 * Default primary grading bands informed by common Ugandan practice:
 * - UNEB PLE reports a digit grade per subject from 1 (best) to 9 (lowest).
 * - Overall division (I, II, III, IV, U) in this app is computed from the
 *   learner’s grades across subjects (see server), not from a field in this table.
 * - This table maps marks scored out of 100 (as percentage 0–100) to AGG + remark.
 */
window.OCEAN_UG_DEFAULT_GRADING_BANDS = [
  { min: 90, max: 100, agg: '1', remark: 'Excellent' },
  { min: 80, max: 89, agg: '2', remark: 'Very good' },
  { min: 70, max: 79, agg: '3', remark: 'Good' },
  { min: 65, max: 69, agg: '4', remark: 'Credit' },
  { min: 60, max: 64, agg: '5', remark: 'Satisfactory' },
  { min: 55, max: 59, agg: '6', remark: 'Fair' },
  { min: 50, max: 54, agg: '7', remark: 'Pass' },
  { min: 40, max: 49, agg: '8', remark: 'Weak' },
  { min: 0, max: 39, agg: '9', remark: 'Below minimum standard' },
];
