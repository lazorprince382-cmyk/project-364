/**
 * Turn a class-wide weekly goal into individual-learner rating phrases.
 */
(function (global) {
  const MODAL =
    '(?:should|must|will|need to|are to|are expected to|shall|can|could|ought to|has to|have to|needs to)';
  const ABLE = '(?:be able to\\s+|to\\s+)?';

  const CLASS_SUBJECTS = [
    'everyone',
    'everybody',
    'all(?:\\s+the)?(?:\\s+(?:learners?|children|students|pupils|kids?))?',
    'every(?:\\s+(?:learner|child|student|pupil|kid))?',
    'each(?:\\s+(?:learner|child|student|pupil|kid))?',
    '(?:all(?:\\s+the)?\\s+)?(?:learners?|children|students|pupils|kids?)(?:\\s+in(?:\\s+the)?\\s+class)?',
    '(?:the\\s+)?(?:learners?|children|students|pupils|kids?)(?:\\s+in(?:\\s+the)?\\s+class)?',
    'we',
    'the class',
  ].join('|');

  const CLASS_WIDE_PREFIX = new RegExp(
    '^(?:' + CLASS_SUBJECTS + ')\\s+' + MODAL + '\\s+' + ABLE,
    'i'
  );

  const RATING_PREFIX_PATTERNS = [
    /^is\s+not\s+yet\s+able\s+to\s+/i,
    /^is\s+not\s+yet\s+/i,
    /^is\s+beginning\s+to\s+/i,
    /^is\s+able\s+to\s+/i,
    /^be\s+able\s+to\s+/i,
    /^can\s+/i,
    /^could\s+/i,
    /^will\s+be\s+able\s+to\s+/i,
    /^learn(?:ers?)?\s+(?:how\s+)?to\s+/i,
    /^learn(?:ing)?\s+(?:how\s+)?to\s+/i,
    /^learn(?:ing)?\s+/i,
    /^to\s+/i,
  ];

  function lowercaseFirst(text) {
    const s = String(text || '').trim();
    if (!s) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  function stripWeekFraming(text) {
    return String(text || '')
      .trim()
      .replace(/\.+$/, '')
      .trim()
      .replace(/^in this week,?\s*/i, '')
      .replace(/^this week,?\s*/i, '')
      .replace(/^by (?:the )?end of (?:the )?week,?\s*/i, '')
      .replace(/^during (?:this )?week,?\s*/i, '')
      .trim();
  }

  /** Remove learner-rating prefixes so we only keep the skill/action. */
  function stripRatingPhrasePrefixes(text) {
    let out = String(text || '').trim();
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < RATING_PREFIX_PATTERNS.length; i++) {
        const next = out.replace(RATING_PREFIX_PATTERNS[i], '').trim();
        if (next !== out) {
          out = next;
          changed = true;
        }
      }
    }
    return out;
  }

  function stripLearningPrefixes(text) {
    return stripRatingPhrasePrefixes(text);
  }

  function stripClassWideSubject(text) {
    let out = String(text || '').trim();
    for (let i = 0; i < 4; i++) {
      const next = out.replace(CLASS_WIDE_PREFIX, '').trim();
      if (next === out) break;
      out = next;
    }
    return out;
  }

  function looksLikeUnresolvedClassGoal(text) {
    return /\b(should|must|everyone|everybody|learners?|children|students?|pupils?|all)\b/i.test(text);
  }

  function extractSkillFromBrokenGoal(text) {
    const patterns = [
      new RegExp('^(?:' + CLASS_SUBJECTS + ')\\s+' + MODAL + '\\s+' + ABLE + '(.+)$', 'i'),
      new RegExp(MODAL + '\\s+' + ABLE + '(.+)$', 'i'),
      /be able to\s+(.+)$/i,
      /(?:should|must|will|need to)\s+(.+)$/i,
    ];
    for (let i = 0; i < patterns.length; i++) {
      const match = String(text || '').match(patterns[i]);
      if (match && match[1]) {
        return stripLearningPrefixes(match[1].replace(/\.+$/, '').trim());
      }
    }
    return '';
  }

  /** Extract the skill/action one learner is being rated on. */
  function goalToIndividualSkill(goalText) {
    let text = stripWeekFraming(goalText);
    if (!text) return '';

    text = stripClassWideSubject(text);
    text = stripLearningPrefixes(text);

    if (!text || looksLikeUnresolvedClassGoal(text)) {
      const rescued = extractSkillFromBrokenGoal(stripWeekFraming(goalText));
      if (rescued) text = rescued;
    }

    text = stripClassWideSubject(text);
    text = stripLearningPrefixes(text);

    if (!text) {
      return stripLearningPrefixes(stripWeekFraming(goalText));
    }
    return lowercaseFirst(text);
  }

  function isGerundSkill(skill) {
    const firstWord = (skill.split(/\s+/)[0] || '').toLowerCase();
    return /^[a-z]{3,}ing$/.test(firstWord) && firstWord !== 'being';
  }

  /** Fix stored rating lines that doubled prefixes (e.g. "is not yet able to is able to …"). */
  function sanitizeRatingPhrase(phrase) {
    let p = String(phrase || '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!p) return p;
    p = p.replace(/^is\s+not\s+yet\s+able\s+to\s+is\s+able\s+to\s+/i, 'is not yet able to ');
    p = p.replace(/^is\s+not\s+yet\s+able\s+to\s+can\s+/i, 'is not yet able to ');
    p = p.replace(/^not\s+yet\s+able\s+to\s+is\s+able\s+to\s+/i, 'is not yet able to ');
    if (/^can\s+/i.test(p)) p = 'is able to ' + p.slice(4);
    return p;
  }

  function suggestRatingOptionsFromGoal(goalText) {
    const skill = goalToIndividualSkill(goalText);
    if (!skill || looksLikeUnresolvedClassGoal(skill)) return [];

    if (isGerundSkill(skill)) {
      return [
        'is ' + skill + ' with ease',
        'is ' + skill + ' with some guidance',
        'is ' + skill + ' with close support',
        'is making early progress with ' + skill,
        'is not yet ' + skill,
      ].map(sanitizeRatingPhrase);
    }

    return [
      'is able to ' + skill + ' with ease',
      'is able to ' + skill + ' with some guidance',
      'is able to ' + skill + ' with close support',
      'is beginning to ' + skill,
      'is not yet able to ' + skill,
    ].map(sanitizeRatingPhrase);
  }

  /** Short label for progress chart legend; lowest band gets more room. */
  function progressLegendLabel(label, index, total) {
    const full = sanitizeRatingPhrase(label);
    const maxLen = index === total - 1 ? 48 : 34;
    if (full.length <= maxLen) return { text: full, title: full };
    return { text: full.slice(0, maxLen - 1) + '…', title: full };
  }

  global.OceanWeeklyGoalRatings = {
    goalToIndividualSkill: goalToIndividualSkill,
    suggestRatingOptionsFromGoal: suggestRatingOptionsFromGoal,
    sanitizeRatingPhrase: sanitizeRatingPhrase,
    progressLegendLabel: progressLegendLabel,
  };
})(window);
