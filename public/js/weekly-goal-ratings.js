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

  function stripLearningPrefixes(text) {
    return String(text || '')
      .trim()
      .replace(/^learn(?:ers?)?\s+(?:how\s+)?to\s+/i, '')
      .replace(/^learn(?:ing)?\s+(?:how\s+)?to\s+/i, '')
      .replace(/^learn(?:ing)?\s+/i, '')
      .replace(/^to\s+/i, '')
      .replace(/^be able to\s+/i, '')
      .trim();
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

  function suggestRatingOptionsFromGoal(goalText) {
    const skill = goalToIndividualSkill(goalText);
    if (!skill || looksLikeUnresolvedClassGoal(skill)) return [];

    const firstWord = (skill.split(/\s+/)[0] || '').toLowerCase();
    const isGerund = /^[a-z]{3,}ing$/.test(firstWord) && firstWord !== 'being';

    if (isGerund) {
      return [
        'is ' + skill + ' with ease',
        'is ' + skill + ' with some guidance',
        'is ' + skill + ' with close support',
        'is making early progress with ' + skill,
        'is not yet ' + skill,
      ];
    }

    return [
      'can ' + skill + ' with ease',
      'can ' + skill + ' with some guidance',
      'can ' + skill + ' with close support',
      'is beginning to ' + skill,
      'is not yet able to ' + skill,
    ];
  }

  global.OceanWeeklyGoalRatings = {
    goalToIndividualSkill: goalToIndividualSkill,
    suggestRatingOptionsFromGoal: suggestRatingOptionsFromGoal,
  };
})(window);
