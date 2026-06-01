/**
 * Quick comment suggestions from weekly bands + class-level subject phrasing.
 * Learner English first name = last token of full name. No capitalised subject titles in text.
 */
(function () {
  function learnerEnglishFirstName(fullName) {
    const parts = String(fullName || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return 'The learner';
    if (parts.length === 1) return capitalize(parts[0]);
    return capitalize(parts[parts.length - 1]);
  }

  function capitalize(word) {
    const w = String(word || '').trim();
    if (!w) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }

  function normalizeSubjectKey(subject) {
    return String(subject || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function normalizeClassLevel(classLevel) {
    return String(classLevel || '')
      .trim()
      .toLowerCase();
  }

  function isPrimaryLevel(classLevel) {
    const cl = normalizeClassLevel(classLevel);
    return cl === 'primary1' || cl === 'primary2' || /^primary\d+$/.test(cl);
  }

  function pickFromPools(pools, subjectKey, band) {
    const generic = pools._generic || {};
    const subjectPool = pools[subjectKey];
    if (subjectPool && subjectPool[band]) return subjectPool[band].slice();
    if (subjectPool && subjectPool.average) return subjectPool.average.slice();
    return (generic[band] || generic.average || generic.unset || []).slice();
  }

  /** @param {string} body — starts lowercase; no subject title */
  function line(name, body) {
    return punctuateCommentLine(name, String(body || '').trim());
  }

  function conjugateThirdPersonVerb(verb) {
    const v = String(verb || '').toLowerCase();
    if (!v) return v;
    if (v === 'have') return 'has';
    if (v === 'do') return 'does';
    if (v === 'go') return 'goes';
    if (/(?:s|x|z|ch|sh)$/.test(v)) return v + 'es';
    if (v.endsWith('y') && v.length > 1 && 'aeiou'.indexOf(v.charAt(v.length - 2)) === -1) {
      return v.slice(0, -1) + 'ies';
    }
    if (v.endsWith('s') && v.length > 2) return v;
    return v + 's';
  }

  /** Turn a weekly rating phrase into report-ready text after the learner's name. */
  function grammarFixRatingPhrase(phrase) {
    let p = String(phrase || '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!p) return p;
    const lower = p.charAt(0).toLowerCase() + p.slice(1);

    if (/^not yet\b/i.test(lower)) return lower;
    if (/^is beginning\b/i.test(lower)) return lower;
    if (/^(is|has|have|can|could|will|would|should|may|might|needs|shows|demonstrates|requires|continues|attempts)\b/i.test(lower)) {
      return lower;
    }

    const ingMatch = lower.match(/^([a-z]{3,}ing)\b(\s|$)/);
    if (ingMatch && !/^being\b/.test(lower)) {
      return 'is ' + lower;
    }

    const verbMatch = lower.match(/^([a-z]+)\b(.*)$/i);
    if (verbMatch) {
      const verb = verbMatch[1].toLowerCase();
      const rest = verbMatch[2] || '';
      if (verb.endsWith('s') && verb.length > 2 && !verb.endsWith('ss')) {
        return lower;
      }
      return conjugateThirdPersonVerb(verb) + rest;
    }

    return lower;
  }

  function punctuateCommentLine(name, body) {
    const b = String(body || '').trim();
    if (!b) return String(name || 'The learner').trim() + '.';
    const learner = String(name || 'The learner').trim();
    let text = learner + ' ' + b.charAt(0).toLowerCase() + b.slice(1);
    text = text.replace(/\s+/g, ' ').trim();
    if (!/[.!?]$/.test(text)) text += '.';
    return text;
  }

  function weeklyRatingCommentLine(name, ratingLabel) {
    return punctuateCommentLine(name, grammarFixRatingPhrase(ratingLabel));
  }

  function ratedWeeklyRows(rows, legacyOnly) {
    return (rows || [])
      .filter(function (r) {
        const label = String(r.band || '').trim();
        if (!label) return false;
        const legacy = isLegacyWeeklyBand(label);
        return legacyOnly ? legacy : !legacy;
      })
      .sort(function (a, b) {
        return Number(a.week_no) - Number(b.week_no);
      });
  }

  function summarizeWeeklyBands(rows) {
    const byWeek = {};
    (rows || []).forEach(function (r) {
      const w = Number(r.week_no);
      const b = String(r.band || '').trim();
      if (w >= 1 && w <= 11 && (b === 'strong' || b === 'average' || b === 'weak')) {
        byWeek[w] = b;
      }
    });
    const rated = [];
    for (let w = 1; w <= 11; w++) {
      if (byWeek[w]) rated.push({ week: w, band: byWeek[w] });
    }
    if (!rated.length) {
      return { overall: 'unset', ratedCount: 0, strong: 0, average: 0, weak: 0, trend: null };
    }
    let strong = 0;
    let average = 0;
    let weak = 0;
    rated.forEach(function (x) {
      if (x.band === 'strong') strong += 1;
      else if (x.band === 'average') average += 1;
      else weak += 1;
    });
    let overall = 'average';
    if (strong >= average && strong >= weak && strong > 0) overall = 'strong';
    else if (weak > strong && weak >= average) overall = 'weak';
    else if (average >= strong && average >= weak) overall = 'average';
    else if (strong > weak) overall = 'strong';

    let trend = null;
    if (rated.length >= 3) {
      const mid = Math.ceil(rated.length / 2);
      const early = rated.slice(0, mid);
      const late = rated.slice(mid);
      function score(list) {
        return list.reduce(function (acc, x) {
          return acc + (x.band === 'strong' ? 2 : x.band === 'average' ? 1 : 0);
        }, 0);
      }
      const e = score(early);
      const l = score(late);
      if (l > e + 0.5) trend = 'improving';
      else if (e > l + 0.5) trend = 'declining';
      else trend = 'steady';
    }
    return { overall, ratedCount: rated.length, strong, average, weak, trend };
  }

  function dedupeStrings(list) {
    const out = [];
    (list || []).forEach(function (p) {
      const s = String(p || '').trim();
      if (s && out.indexOf(s) === -1) out.push(s);
    });
    return out;
  }

  function shuffleSlice(list, seed) {
    const arr = list.slice();
    let n = Number(seed) || 0;
    if (!Number.isFinite(n)) n = 0;
    for (let i = arr.length - 1; i > 0; i--) {
      n = (n * 1103515245 + 12345) & 0x7fffffff;
      const j = n % (i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** Split 8 slots by how many strong / average / weak weeks were rated. */
  function allocateEightFromRatings(summary) {
    const strong = summary.strong || 0;
    const average = summary.average || 0;
    const weak = summary.weak || 0;
    const t = strong + average + weak;
    if (!t) return { strong: 0, average: 0, weak: 0 };
    let ns = Math.round((8 * strong) / t);
    let na = Math.round((8 * average) / t);
    let nw = 8 - ns - na;
    if (nw < 0) {
      na += nw;
      nw = 0;
    }
    while (ns + na + nw > 8) {
      if (ns >= na && ns >= nw && ns > 0) ns -= 1;
      else if (na >= nw && na > 0) na -= 1;
      else if (nw > 0) nw -= 1;
      else break;
    }
    while (ns + na + nw < 8) {
      if (strong >= average && strong >= weak) ns += 1;
      else if (average >= weak) na += 1;
      else nw += 1;
    }
    return { strong: ns, average: na, weak: nw };
  }

  /**
   * Build up to 8 unique comment bodies; most lines match weekly strong/average/weak counts.
   */
  function buildBodiesFromWeeklyRatings(getBandPool, summary, seed) {
    const bands = {
      strong: dedupeStrings(getBandPool('strong')),
      average: dedupeStrings(getBandPool('average')),
      weak: dedupeStrings(getBandPool('weak')),
      unset: dedupeStrings(getBandPool('unset')),
    };
    const out = [];
    const used = {};

    function pull(pool, maxTake) {
      const avail = pool.filter(function (b) {
        return !used[b];
      });
      const shuffled = shuffleSlice(avail, seed + out.length * 31);
      let taken = 0;
      for (let i = 0; i < shuffled.length && out.length < 8; i++) {
        if (maxTake != null && taken >= maxTake) break;
        used[shuffled[i]] = true;
        out.push(shuffled[i]);
        taken += 1;
      }
    }

    if (summary.ratedCount > 0) {
      const slots = allocateEightFromRatings(summary);
      if (slots.strong > 0) pull(bands.strong, slots.strong);
      if (slots.average > 0) pull(bands.average, slots.average);
      if (slots.weak > 0) pull(bands.weak, slots.weak);
    } else {
      pull(bands.unset, 5);
      pull(bands.average, 3);
    }

    const fillOrder =
      summary.overall === 'strong'
        ? ['strong', 'average', 'weak', 'unset']
        : summary.overall === 'weak'
        ? ['weak', 'average', 'strong', 'unset']
        : ['average', 'strong', 'weak', 'unset'];
    if (!summary.ratedCount) {
      fillOrder[0] = 'unset';
    }
    for (let f = 0; f < fillOrder.length && out.length < 8; f++) {
      pull(bands[fillOrder[f]]);
    }

    if (
      summary.trend === 'improving' &&
      out.length < 8 &&
      !used['is showing encouraging improvement in recent weeks.']
    ) {
      used['is showing encouraging improvement in recent weeks.'] = true;
      out.push('is showing encouraging improvement in recent weeks.');
    } else if (
      summary.trend === 'steady' &&
      summary.ratedCount >= 2 &&
      out.length < 8 &&
      !used['has worked consistently in recent weeks.']
    ) {
      used['has worked consistently in recent weeks.'] = true;
      out.push('has worked consistently in recent weeks.');
    }

    return out.slice(0, 8);
  }

  /** Baby class — earliest nursery expectations (your original phrasing). */
  const BABY_POOLS = {
      writing: {
        strong: [
          'has improved in shaping letters and numbers.',
          'writes work from the board neatly with growing independence.',
          'forms letters and numbers carefully and takes pride in written work.',
          'copies from the board confidently with only occasional guidance.',
          'shows good pencil control when writing letters and numbers.',
        ],
        average: [
          'has improved in shaping letters and numbers.',
          'fairly writes work from the board and with maximum guidance.',
          'is progressing in forming letters and numbers with teacher support.',
          'copies letters and numbers from the board with care when guided.',
          'shows steady effort in early writing tasks.',
        ],
        weak: [
          'is beginning to shape letters and numbers with close support.',
          'fairly writes work from the board and with maximum guidance.',
          'needs more practice in pencil control and letter formation.',
          'copies from the board when tasks are broken into small steps.',
          'is encouraged to practise tracing letters and numbers at home.',
        ],
        unset: [
          'has improved in shaping letters and numbers.',
          'fairly writes work from the board and with maximum guidance.',
          'is learning to form letters and numbers with teacher guidance.',
          'shows interest in early writing activities.',
        ],
      },
      numeracy: {
        strong: [
          'shows good progress in counting and identifies basic shapes confidently.',
          'recognises numbers 1–10, counts and shows the correct number for objects.',
          'counts aloud accurately and matches numbers to sets of objects.',
          'identifies common shapes and uses them correctly in activities.',
          'enjoys number games and works with confidence.',
        ],
        average: [
          'shows progress in counting and identifies basic shapes.',
          'recognises numbers 1–10, counts and shows the correct number for the object.',
          'is improving in matching numerals to quantities with guidance.',
          'counts with support and is learning to recognise more shapes.',
          'participates well in number activities.',
        ],
        weak: [
          'is building skills in counting with teacher support.',
          'recognises some numbers 1–10 and is learning to count objects correctly.',
          'identifies a few basic shapes and needs more practice with numbers.',
          'benefits from short counting activities at home and at school.',
          'is encouraged to practise counting everyday objects.',
        ],
        unset: [
          'shows progress in counting and identifies basic shapes.',
          'recognises numbers 1–10, counts and shows the correct number for the object.',
          'is learning to count and recognise numerals with guidance.',
        ],
      },
      'language development': {
        strong: [
          'reads words for home objects confidently and identifies most colours.',
          'uses language well in class and identifies things around the room.',
          'is progressing well in reading familiar words.',
          'speaks clearly and takes part in language activities.',
          'builds vocabulary for home and classroom objects.',
        ],
        average: [
          'tries reading words for home objects and identifies most colours.',
          'uses language well in class and identifies things in class.',
          'is progressing in reading words with support.',
          'listens well and repeats new words during lessons.',
          'shows interest in naming objects at home and at school.',
        ],
        weak: [
          'is learning to read words for home objects with guidance.',
          'identifies some colours and common classroom objects.',
          'is progressing in reading words with close support.',
          'benefits from short language games and picture talk at home.',
          'is encouraged to name objects and colours daily.',
        ],
        unset: [
          'tries reading words for home objects and identifies most colours.',
          'uses language well in class and identifies things in class.',
          'is progressing in reading words.',
        ],
      },
      'general knowledge': {
        strong: [
          'confidently shows body parts, things in class and is progressing in reading their words.',
          'relates people at home with what they wear, things in class and important places with ease.',
          'recognises important places, people at school, things at home and classroom objects.',
          'talks clearly about home, school and the community.',
          'answers questions about daily life with confidence.',
        ],
        average: [
          'shows body parts, things in class and is progressing in reading their words.',
          'relates people at home with what they wear and classroom objects with support.',
          'recognises people at school, things at home and classroom objects.',
          'is learning about important places in the community.',
          'takes part well in discussion about home and school.',
        ],
        weak: [
          'is learning to name body parts and classroom objects with guidance.',
          'recognises some people at home and at school with support.',
          'is building knowledge of things at home and in class.',
          'benefits from talking about family, school and places on the way home.',
          'is encouraged to point out and name objects during daily routines.',
        ],
        unset: [
          'confidently shows body parts, things in class and is progressing in reading their words.',
          'relates people at home with what they wear, things in class and important places with ease.',
          'recognises important places, people at school, things at home and classroom objects.',
        ],
      },
      reading: {
        strong: [
          'actively participates in blending and reading two- or three-letter words.',
          'confidently identifies vowel sounds.',
          'shows good progress in blending and reading three-letter words.',
          'reads familiar words with growing fluency.',
          'enjoys reading activities and tries new words willingly.',
        ],
        average: [
          'actively participates in blending and reading two- or three-letter words.',
          'identifies vowel sounds with support.',
          'shows progress in blending and reading three-letter words.',
          'is building confidence in sounding out short words.',
          'listens well during reading lessons.',
          'recognises familiar letters and links them to sounds during reading.',
          'joins in shared reading and repeats words after the teacher.',
          'is developing fluency with short words in class readers.',
        ],
        weak: [
          'is learning to blend sounds and read short words with guidance.',
          'identifies some letter sounds and is progressing in blending.',
          'benefits from daily practice with two- and three-letter words.',
          'is encouraged to read short words at home with a grown-up.',
          'takes part in blending activities when supported step by step.',
        ],
        unset: [
          'actively participates in blending and reading two- or three-letter words.',
          'confidently identifies vowel sounds.',
          'shows progress in blending and reading three-letter words.',
          'enjoys listening to stories and joining in rhymes.',
          'recognises some familiar words in simple books.',
          'takes part in phonics activities with interest.',
          'is learning to sound out short words with guidance.',
          'listens attentively during shared reading.',
        ],
      },
    _generic: {
      strong: [
        'joins in class activities with confidence.',
        'follows simple routines and listens well.',
        'shows good progress for baby class this term.',
        'cooperates with teachers and friends.',
      ],
      average: [
        'takes part in class activities and is settling well.',
        'follows routines with reminders and tries simple tasks.',
        'shows a willing attitude in baby class.',
        'is improving with gentle guidance.',
      ],
      weak: [
        'is settling in and needs close support during activities.',
        'benefits from short, repeated tasks each day.',
        'tries when activities are modelled step by step.',
        'is encouraged to practise naming and counting at home.',
      ],
      unset: [
        'is learning classroom routines in baby class.',
        'shows interest in songs, stories and play activities.',
        'is making early progress with teacher support.',
      ],
    },
  };

  /** Middle class — builds on baby; slightly longer skills. */
  const MIDDLE_POOLS = {
    writing: {
      strong: [
        'writes letters and numbers more clearly and with growing control.',
        'copies words from the board neatly with little guidance.',
        'forms familiar words and numbers with confidence.',
        'shows good pencil grip when writing from the board.',
        'takes pride in neat written work in middle class.',
      ],
      average: [
        'is improving in shaping letters, numbers and simple words.',
        'fairly copies work from the board when guided.',
        'writes familiar letters and numbers with teacher support.',
        'is progressing in handwriting for middle class tasks.',
        'shows steady effort when writing from the board.',
      ],
      weak: [
        'is learning to form letters and simple words with close support.',
        'copies from the board when work is broken into small steps.',
        'needs more practice with pencil control and letter formation.',
        'fairly writes from the board with maximum guidance.',
        'is encouraged to trace letters and short words at home.',
      ],
      unset: [
        'is improving in shaping letters, numbers and early words.',
        'fairly copies work from the board with guidance.',
        'shows progress in middle class writing activities.',
        'is learning to write familiar letters with support.',
        'attempts simple words from the board when helped.',
        'shows interest in handwriting activities.',
        'listens well during writing lessons.',
        'is building confidence with pencil and paper tasks.',
      ],
    },
    numeracy: {
      strong: [
        'counts confidently within 15 and matches numerals to sets.',
        'identifies basic shapes and uses them correctly in tasks.',
        'solves simple counting problems with objects.',
        'recognises number patterns in middle class activities.',
        'enjoys number games and works accurately.',
      ],
      average: [
        'shows progress in counting sets and identifying shapes.',
        'recognises numbers 1–15 and counts objects with support.',
        'is improving in showing the correct number for a group.',
        'compares small groups of objects during lessons.',
        'participates well in middle class number work.',
      ],
      weak: [
        'is building counting skills within 10 with guidance.',
        'recognises some numerals and needs help matching quantities.',
        'identifies a few shapes and benefits from repeated practice.',
        'is encouraged to count objects at home and at school.',
        'works on number tasks when supported step by step.',
      ],
      unset: [
        'shows progress in counting and shape work for middle class.',
        'recognises numbers 1–15 with guidance.',
        'counts objects and is learning to match numerals.',
        'identifies common shapes in class activities.',
        'joins in number rhymes and games.',
        'is improving in comparing small groups.',
        'listens during numeracy lessons.',
        'practises counting during daily routines.',
      ],
    },
    'language development': {
      strong: [
        'uses short phrases clearly and names many classroom objects.',
        'reads familiar word cards for home and school items.',
        'identifies colours and describes pictures with confidence.',
        'retells simple events using new vocabulary.',
        'speaks audibly during middle class language activities.',
      ],
      average: [
        'tries reading words for home objects and identifies most colours.',
        'uses language well in class and names things around the room.',
        'is progressing in reading familiar word cards.',
        'listens and repeats new words during lessons.',
        'shows interest in describing pictures and objects.',
      ],
      weak: [
        'is learning to name objects and colours with support.',
        'reads some familiar words with close guidance.',
        'benefits from picture talk and short language games.',
        'is encouraged to use new words at home each day.',
        'joins in language activities when prompted gently.',
      ],
      unset: [
        'tries reading words for home objects and identifies most colours.',
        'uses language well in class and identifies things in class.',
        'is progressing in reading familiar words in middle class.',
        'builds vocabulary through stories and conversation.',
        'listens well during language lessons.',
        'names common objects at home and at school.',
        'enjoys rhymes and action songs.',
        'is learning to speak in short phrases.',
      ],
    },
    'general knowledge': {
      strong: [
        'confidently names body parts, classroom objects and family members.',
        'relates people at home with roles, clothes and daily activities.',
        'recognises community helpers, school places and things at home.',
        'talks about safety and good habits with understanding.',
        'answers questions about home and school clearly.',
      ],
      average: [
        'shows body parts, classroom objects and is progressing in reading labels.',
        'relates people at home with what they wear and school routines.',
        'recognises important places, people at school and home objects.',
        'takes part in discussions about the neighbourhood.',
        'is learning about weather and simple daily changes.',
      ],
      weak: [
        'is learning to name body parts and classroom items with guidance.',
        'recognises some family members and school staff with support.',
        'benefits from talking about home, school and the community.',
        'is encouraged to notice places and people on the way to school.',
        'builds vocabulary for objects through pictures and play.',
      ],
      unset: [
        'shows body parts, things in class and is progressing in reading labels.',
        'relates people at home with daily activities and classroom objects.',
        'recognises people at school, things at home and in class.',
        'is learning about important places near school.',
        'talks about family with interest.',
        'names classroom objects during activities.',
        'listens to stories about home and community.',
        'is building awareness of good habits at school.',
      ],
    },
    reading: {
      strong: [
        'blends and reads three- and four-letter words with confidence.',
        'identifies beginning and ending sounds in words.',
        'reads familiar word cards and short captions accurately.',
        'shows strong progress in middle class phonics work.',
        'enjoys reading short words in books and on charts.',
      ],
      average: [
        'actively blends and reads three-letter words with support.',
        'identifies vowel sounds in familiar words.',
        'shows progress in reading four-letter words.',
        'is building fluency with word cards and simple sentences.',
        'listens well during shared and guided reading.',
      ],
      weak: [
        'is learning to blend three-letter words with guidance.',
        'identifies some letter sounds and needs help with new words.',
        'benefits from daily practice with word cards at home.',
        'takes part in blending when supported step by step.',
        'is encouraged to read short words with a grown-up.',
      ],
      unset: [
        'actively blends and reads three- and four-letter words.',
        'identifies vowel sounds with growing confidence.',
        'shows progress in middle class reading tasks.',
        'enjoys listening to stories and joining in rhymes.',
        'recognises familiar words on charts and in books.',
        'takes part in phonics activities with interest.',
        'is learning to sound out new words.',
        'listens attentively during guided reading.',
      ],
    },
    _generic: {
      strong: [
        'participates confidently in middle class activities.',
        'follows instructions and tries tasks with growing independence.',
        'shows good progress across middle class learning.',
        'works neatly and cooperates with others.',
      ],
      average: [
        'participates well and is making steady progress in middle class.',
        'responds to guidance and completes most classroom tasks.',
        'shows a positive attitude to learning.',
        'is improving with regular practice.',
      ],
      weak: [
        'is making gradual progress with encouragement in middle class.',
        'benefits from tasks broken into smaller steps.',
        'tries hard when given close guidance.',
        'is encouraged to practise a little each day at home.',
      ],
      unset: [
        'participates in middle class activities.',
        'is making progress with teacher support.',
        'shows interest in learning.',
      ],
    },
  };

  /** Top class — most advanced nursery; readiness for primary. */
  const TOP_POOLS = {
    writing: {
      strong: [
        'writes simple words and short sentences from the board with confidence.',
        'uses neat handwriting when copying and composing short sentences.',
        'spells familiar words correctly in independent writing.',
        'organises written work carefully in top class tasks.',
        'writes numbers and words clearly with little guidance.',
      ],
      average: [
        'writes familiar words and simple sentences with support.',
        'copies sentences from the board fairly well when guided.',
        'is improving spelling of common words in top class.',
        'shows steady progress in sentence writing.',
        'forms letters and numbers clearly in most tasks.',
      ],
      weak: [
        'is learning to write simple sentences with close support.',
        'copies words and short sentences when tasks are guided step by step.',
        'needs more practice with spelling and neat presentation.',
        'fairly writes from the board with maximum guidance.',
        'is encouraged to practise short sentences at home.',
      ],
      unset: [
        'is improving in writing words and simple sentences in top class.',
        'fairly copies sentences from the board with guidance.',
        'shows progress in handwriting and spelling.',
        'attempts independent writing of familiar words.',
        'listens well during writing lessons.',
        'is building confidence with longer written tasks.',
        'uses finger spaces in sentences with support.',
        'shows interest in writing stories and labels.',
      ],
    },
    numeracy: {
      strong: [
        'counts and works with numbers to 20 confidently.',
        'solves simple addition and subtraction using objects.',
        'identifies shapes and uses them in problem tasks.',
        'explains counting strategies clearly in top class.',
        'applies number skills in practical classroom activities.',
      ],
      average: [
        'recognises numbers 1–20 and counts groups accurately with support.',
        'is improving in simple addition with objects.',
        'identifies shapes and compares quantities in tasks.',
        'shows fair progress in top class number work.',
        'participates well in problem-solving activities.',
      ],
      weak: [
        'is building skills with numbers to 15 with guidance.',
        'counts objects with support and is learning simple addition.',
        'benefits from repeated practice with numerals and quantities.',
        'is encouraged to practise counting and simple sums at home.',
        'works on number tasks when helped step by step.',
      ],
      unset: [
        'shows progress with numbers to 20 in top class.',
        'counts groups and is learning simple addition.',
        'identifies shapes and compares small quantities.',
        'joins in mental maths warm-ups.',
        'is improving in number formation.',
        'uses objects to solve simple problems.',
        'listens during numeracy lessons.',
        'practises numbers during classroom routines.',
      ],
    },
    'language development': {
      strong: [
        'speaks in clear sentences and retells simple stories.',
        'reads familiar sentences and word cards with confidence.',
        'uses new vocabulary when describing experiences.',
        'answers questions in full sentences during lessons.',
        'communicates ideas well in top class language work.',
      ],
      average: [
        'uses short sentences and is progressing in reading simple lines.',
        'reads word cards and short phrases with support.',
        'identifies colours, objects and actions in pictures.',
        'listens and contributes during class discussions.',
        'shows interest in storytelling and drama activities.',
      ],
      weak: [
        'is learning to speak in sentences with guidance.',
        'reads familiar words and phrases with close support.',
        'benefits from conversation and story time at home.',
        'is encouraged to describe daily events in simple sentences.',
        'joins in language tasks when prompted step by step.',
      ],
      unset: [
        'uses short sentences in top class language activities.',
        'is progressing in reading simple phrases and word cards.',
        'identifies objects, colours and actions in pictures.',
        'enjoys retelling familiar stories.',
        'listens well during language lessons.',
        'builds vocabulary through reading and talk.',
        'takes part in role play and drama.',
        'is learning to answer in full sentences.',
      ],
    },
    'general knowledge': {
      strong: [
        'describes home, school and community with clear detail.',
        'relates rules, safety and good behaviour to daily life.',
        'recognises maps, signs and important local places.',
        'explains how people help each other at home and at school.',
        'shows strong awareness of health habits and the environment.',
      ],
      average: [
        'talks about family, school and neighbourhood with understanding.',
        'relates classroom learning to home and community experiences.',
        'recognises important places, people and objects in top class topics.',
        'takes part in projects about home, school and the environment.',
        'is learning about rights, responsibilities and cooperation.',
      ],
      weak: [
        'is building vocabulary about home, school and community with support.',
        'recognises some important places and people with guidance.',
        'benefits from discussions about safety and daily routines.',
        'is encouraged to notice signs, places and helpers in the community.',
        'joins in topic work when tasks are guided clearly.',
      ],
      unset: [
        'talks about home, school and the community in top class.',
        'relates classroom topics to experiences at home.',
        'recognises important places, people and objects.',
        'is learning about safety and good citizenship.',
        'takes part in topic discussions with interest.',
        'names local places and community helpers.',
        'listens to stories about people and places.',
        'is building awareness of health and the environment.',
      ],
    },
    reading: {
      strong: [
        'reads short sentences and familiar stories with fluency.',
        'uses phonics confidently for new four- and five-letter words.',
        'answers simple questions about texts read in top class.',
        'reads aloud with expression and accurate word recognition.',
        'shows excellent progress towards primary reading skills.',
      ],
      average: [
        'reads four- and five-letter words and simple sentences with support.',
        'identifies vowel teams and common digraphs in words.',
        'shows progress in reading short paragraphs.',
        'is building comprehension when reading aloud.',
        'listens well during top class guided reading.',
      ],
      weak: [
        'is learning to read longer words and simple sentences with guidance.',
        'benefits from daily reading practice at home.',
        'identifies many letter sounds and needs help blending longer words.',
        'takes part in reading when supported step by step.',
        'is encouraged to read short books with a grown-up.',
      ],
      unset: [
        'reads four- and five-letter words in top class.',
        'shows progress in reading short sentences.',
        'identifies vowel sounds and common word patterns.',
        'enjoys guided reading and library time.',
        'recognises high-frequency words on charts.',
        'takes part in comprehension questions with support.',
        'is learning to read with expression.',
        'listens attentively during shared reading.',
      ],
    },
    _generic: {
      strong: [
        'participates confidently and shows readiness for primary school.',
        'works independently on many top class tasks.',
        'shows excellent progress across learning areas.',
        'is organised, cooperative and responsible in class.',
      ],
      average: [
        'participates well and is making steady progress in top class.',
        'completes most tasks with guidance and growing independence.',
        'shows a positive attitude and good classroom behaviour.',
        'is improving skills needed for primary one.',
      ],
      weak: [
        'is making gradual progress with support in top class.',
        'benefits from revision of early skills before primary.',
        'tries hard when tasks are structured clearly.',
        'is encouraged to read and practise numbers daily at home.',
      ],
      unset: [
        'participates in top class activities.',
        'is building skills for the move to primary school.',
        'shows interest in learning across subjects.',
      ],
    },
  };

  function babyBodies(subjectKey, band) {
    return pickFromPools(BABY_POOLS, subjectKey, band);
  }

  function middleBodies(subjectKey, band) {
    return pickFromPools(MIDDLE_POOLS, subjectKey, band);
  }

  function topBodies(subjectKey, band) {
    return pickFromPools(TOP_POOLS, subjectKey, band);
  }

  function daycareBodies(subjectKey, band) {
    const simple = babyBodies(subjectKey, band === 'strong' ? 'strong' : band === 'weak' ? 'weak' : 'average');
    const extra = [
      'plays well and follows simple routines.',
      'listens to stories and joins in songs.',
      'is learning to share and take turns.',
    ];
    return simple.concat(extra).slice(0, 12);
  }

  function primaryBodies(subjectKey, band) {
    const key = subjectKey;
    const pools = {
      reading: {
        strong: [
          'reads simple passages with good understanding.',
          'uses phonics skills confidently when reading new words.',
          'answers comprehension questions clearly.',
          'reads aloud with expression and accuracy.',
        ],
        average: [
          'reads familiar texts with support and is building fluency.',
          'uses phonics to sound out new words.',
          'shows progress in comprehension tasks.',
          'benefits from daily reading practice at home.',
        ],
        weak: [
          'is learning to read familiar words with guidance.',
          'needs more practice with phonics and short texts.',
          'is encouraged to read aloud at home each day.',
        ],
        unset: [
          'is developing reading fluency and comprehension.',
          'shows progress when reading with support.',
        ],
      },
      writing: {
        strong: [
          'writes clearly and organises ideas well in sentences.',
          'uses punctuation and spelling with good accuracy.',
          'produces neat written work across tasks.',
        ],
        average: [
          'writes simple sentences with support.',
          'is improving spelling and handwriting.',
          'organises ideas with guidance.',
        ],
        weak: [
          'is building confidence in writing sentences.',
          'needs support with spelling and neat presentation.',
        ],
        unset: ['is developing writing skills across class tasks.'],
      },
      mathematics: {
        strong: [
          'solves number problems confidently and explains reasoning.',
          'applies operations accurately in class work.',
          'shows strong understanding of core topics.',
        ],
        average: [
          'works through number problems with steady accuracy.',
          'is improving in applying skills to word problems.',
          'shows fair progress in class exercises.',
        ],
        weak: [
          'is building confidence in core number skills.',
          'benefits from extra practice with guided examples.',
        ],
        unset: ['is making progress in mathematics with support.'],
      },
      english: {
        strong: [
          'communicates ideas clearly in speaking and writing.',
          'uses grammar and vocabulary well for this level.',
          'participates confidently in English lessons.',
        ],
        average: [
          'expresses ideas with support and is improving accuracy.',
          'shows steady progress in speaking and writing.',
        ],
        weak: [
          'is developing confidence in spoken and written English.',
          'benefits from reading and short writing practice at home.',
        ],
        unset: ['is progressing in English with teacher support.'],
      },
    };
    if (pools[key] && pools[key][band]) return pools[key][band].slice();
    if (pools[key] && pools[key].average) return pools[key].average.slice();
    return topBodies(key, band);
  }

  function bodiesFor(classLevel, subject, band) {
    const key = normalizeSubjectKey(subject);
    const cl = normalizeClassLevel(classLevel);
    if (cl === 'daycare') return daycareBodies(key, band);
    if (isPrimaryLevel(cl)) return primaryBodies(key, band);
    if (cl === 'middle') return middleBodies(key, band);
    if (cl === 'top') return topBodies(key, band);
    return babyBodies(key, band);
  }

  function classTeacherBodiesForLevel(classLevel, band) {
    const cl = normalizeClassLevel(classLevel);
    const byLevel = {
      baby: {
        strong: [
          'is settling well in baby class and shows a cheerful attitude.',
          'follows routines and participates in play-based learning.',
          'is confident, cooperative and polite to teachers and friends.',
          'is encouraged to keep short reading and counting practice at home.',
          'shows good progress for baby class this term.',
          'listens during circle time and tries simple tasks.',
          'cooperates with others during class activities.',
          'parents should continue the good support given at home.',
        ],
        average: [
          'is making steady progress in baby class.',
          'participates in activities and responds well to guidance.',
          'shows a willing attitude and benefits from routines at home.',
          'is polite and improving with regular practice.',
          'listens to instructions and tries their best.',
          'has the ability to achieve more with gentle encouragement.',
          'should keep short daily practice at home.',
          'is a pleasant member of the baby class.',
        ],
        weak: [
          'is settling in baby class and building confidence with support.',
          'tries hard during activities when guided step by step.',
          'benefits from calm routines and praise at home.',
          'shows willingness to learn with close teacher support.',
          'is encouraged to practise naming and counting at home.',
          'responds well to positive reinforcement.',
          'with steady support, is making gradual progress.',
          'celebrate small improvements at home and at school.',
        ],
        unset: [
          'is learning baby class routines.',
          'participates in play and early learning activities.',
          'should continue short practice at home.',
          'is encouraged to listen and try simple tasks.',
          'shows potential with praise and routines.',
          'enjoys stories, songs and classroom play.',
          'is polite to teachers and friends.',
          'parents are encouraged to support early learning daily.',
        ],
      },
      middle: {
        strong: [
          'is doing very well in middle class and shows a positive attitude.',
          'is confident, cooperative and responsible in class activities.',
          'completes work carefully and participates actively.',
          'is encouraged to read and practise numbers regularly at home.',
          'shows excellent progress across middle class learning.',
          'listens well and follows classroom expectations.',
          'sets a good example for others through effort and behaviour.',
          'parents should maintain the good support given at home.',
        ],
        average: [
          'is making steady progress in middle class.',
          'participates actively and is developing confidence.',
          'shows a willing attitude and benefits from encouragement at home.',
          'is polite, cooperative and improving with regular practice.',
          'listens to instructions and tries their best.',
          'has the ability to achieve more with continued support.',
          'should keep working consistently at school and at home.',
          'is a pleasant and hardworking member of middle class.',
        ],
        weak: [
          'is a valued member of middle class who is building confidence.',
          'tries hard and is making gradual progress with support.',
          'benefits from calm routines and praise for effort at home.',
          'shows willingness to learn and needs gentle guidance.',
          'with regular practice, can strengthen skills before top class.',
          'responds well to positive reinforcement.',
          'is encouraged to keep trying; steady support will help.',
          'celebrate small improvements at home and at school.',
        ],
        unset: [
          'is settling well in middle class.',
          'participates in activities and is developing socially and academically.',
          'should continue reading and number practice at home.',
          'is encouraged to listen carefully and try their best.',
          'shows potential and will benefit from praise and routines.',
          'enjoys school and is learning to work more independently.',
          'is polite to teachers and classmates.',
          'parents are encouraged to support learning through daily practice.',
        ],
      },
      top: {
        strong: [
          'is doing very well in top class and shows readiness for primary school.',
          'is confident, organised and cooperative in all class activities.',
          'completes work carefully and works independently on many tasks.',
          'is encouraged to read daily and revise number work at home.',
          'shows excellent progress and good discipline this term.',
          'takes responsibility for learning and behaviour.',
          'sets a strong example for others in top class.',
          'parents should maintain the excellent support given at home.',
        ],
        average: [
          'is making steady progress in top class.',
          'participates actively and is preparing well for primary one.',
          'shows a willing attitude and benefits from revision at home.',
          'is polite, cooperative and improving with regular practice.',
          'listens to instructions and tries their best in all areas.',
          'has the ability to achieve more before moving to primary.',
          'should keep reading and practising numbers daily.',
          'is a pleasant and motivated member of top class.',
        ],
        weak: [
          'is working hard in top class and building confidence with support.',
          'tries hard and is revising early skills with teacher guidance.',
          'benefits from extra reading and number practice at home.',
          'shows willingness to learn before moving to primary school.',
          'with consistent support, can strengthen skills for primary one.',
          'responds well to encouragement and clear routines.',
          'is encouraged to keep trying; progress is possible with practice.',
          'celebrate effort and small gains at home and at school.',
        ],
        unset: [
          'is progressing well in top class.',
          'participates in activities and is preparing for primary school.',
          'should continue daily reading and number practice at home.',
          'is encouraged to listen carefully and work independently when possible.',
          'shows potential for primary one with continued support.',
          'enjoys school and takes part in class responsibilities.',
          'is polite to teachers and classmates.',
          'parents are encouraged to support revision through short daily practice.',
        ],
      },
    };
    const level = cl === 'middle' || cl === 'top' ? cl : 'baby';
    const pools = byLevel[level] || byLevel.baby;
    return pools[band] || pools.unset;
  }

  function buildLines(name, classLevel, subject, summary, seed) {
    const bodies = buildBodiesFromWeeklyRatings(
      function (band) {
        return bodiesFor(classLevel, subject, band);
      },
      summary,
      seed
    );
    return bodies.map(function (body) {
      return { snippet: line(name, body) };
    });
  }

  function isLegacyWeeklyBand(band) {
    const b = String(band || '').trim();
    return b === 'strong' || b === 'average' || b === 'weak';
  }

  function hasDynamicWeeklyRatings(rows) {
    return (rows || []).some(function (r) {
      const b = String(r.band || '').trim();
      return b && !isLegacyWeeklyBand(b);
    });
  }

  function buildSubjectCommentsFromRatings(opts) {
    const name = opts.name || 'The learner';
    const rows = ratedWeeklyRows(opts.weeklyRows, false);
    return rows.map(function (r) {
      return { snippet: weeklyRatingCommentLine(name, r.band) };
    });
  }

  function buildSubjectCommentsFromLegacyWeeklyRows(opts) {
    const name = opts.name || 'The learner';
    const classLevel = opts.classLevel || 'baby';
    const subject = opts.subject || '';
    const rows = ratedWeeklyRows(opts.weeklyRows, true);
    const seed = (opts.studentId || 0) + normalizeSubjectKey(subject).length * 17;
    return rows.map(function (r, idx) {
      const pool = dedupeStrings(bodiesFor(classLevel, subject, r.band));
      const picked = pool.length ? shuffleSlice(pool, seed + idx * 13)[0] : r.band;
      const body = String(picked || '')
        .trim()
        .replace(/[.!?]+$/, '');
      return { snippet: punctuateCommentLine(name, body) };
    });
  }

  function buildClassTeacherCommentsFromLegacyWeeklyRows(opts) {
    return buildClassTeacherBehaviorComments(opts);
  }

  function buildClassTeacherCommentsFromRatings(opts) {
    return buildClassTeacherBehaviorComments(opts);
  }

  const CLASS_TEACHER_SUGGEST_COUNT = 5;

  /** Always five comments about classroom behaviour and study habits — not subject weekly ratings. */
  function buildClassTeacherBehaviorComments(opts) {
    const name = opts.name || 'The learner';
    const classLevel = opts.classLevel || 'baby';
    const levelSeed = { baby: 101, middle: 203, top: 307, daycare: 55, primary1: 401, primary2: 503 };
    const ls = levelSeed[normalizeClassLevel(classLevel)] || 101;
    const seed = (opts.studentId || 0) * 3 + ls;
    const bodies = buildFixedClassTeacherBehaviorBodies(classLevel, seed, CLASS_TEACHER_SUGGEST_COUNT);
    return bodies.map(function (body) {
      return { snippet: line(name, body) };
    });
  }

  function buildFixedClassTeacherBehaviorBodies(classLevel, seed, count) {
    const bands = ['unset', 'average', 'strong', 'weak'];
    const merged = [];
    bands.forEach(function (band) {
      dedupeStrings(classTeacherBodiesForLevel(classLevel, band)).forEach(function (body) {
        if (merged.indexOf(body) === -1) merged.push(body);
      });
    });
    const shuffled = shuffleSlice(merged, seed);
    const out = shuffled.slice(0, count);
    let fillSeed = seed + 997;
    while (out.length < count && merged.length) {
      const next = shuffleSlice(merged, fillSeed)[0];
      fillSeed += 131;
      if (next && out.indexOf(next) === -1) out.push(next);
      if (fillSeed > seed + 10000) break;
    }
    return out.slice(0, count);
  }

  function buildSubjectComments(opts) {
    const rows = opts.weeklyRows || [];
    if (hasDynamicWeeklyRatings(rows)) {
      return buildSubjectCommentsFromRatings(opts);
    }
    if (ratedWeeklyRows(rows, true).length) {
      return buildSubjectCommentsFromLegacyWeeklyRows(opts);
    }
    const name = opts.name || 'The learner';
    const subject = opts.subject || '';
    const classLevel = opts.classLevel || 'baby';
    const summary = opts.summary || summarizeWeeklyBands([]);
    const levelSeed = { baby: 11, middle: 29, top: 47, daycare: 5 };
    const ls = levelSeed[normalizeClassLevel(classLevel)] || 11;
    const seed = (opts.studentId || 0) + normalizeSubjectKey(subject).length * 17 + ls;
    return buildLines(name, classLevel, subject, summary, seed);
  }

  function buildClassTeacherComments(opts) {
    return buildClassTeacherBehaviorComments(opts);
  }

  /** Skill dashboard — lesson progress statuses (Progress tab). */
  function summarizeSkillLessonProgress(rows) {
    const counts = { needs_support: 0, progressing: 0, on_track: 0, goal_met: 0 };
    let latest = null;
    (rows || []).forEach(function (r) {
      const st = String(r.status || '').trim();
      if (Object.prototype.hasOwnProperty.call(counts, st)) counts[st] += 1;
      const ln = Number(r.lesson_no);
      if (!Number.isNaN(ln)) {
        if (!latest || ln > Number(latest.lesson_no)) latest = r;
      }
    });
    const ratedCount =
      counts.needs_support + counts.progressing + counts.on_track + counts.goal_met;
    let overall = 'unset';
    if (ratedCount > 0) {
      if (
        counts.goal_met >= counts.on_track &&
        counts.goal_met >= counts.progressing &&
        counts.goal_met >= counts.needs_support &&
        counts.goal_met > 0
      ) {
        overall = 'strong';
      } else if (
        counts.needs_support > counts.goal_met &&
        counts.needs_support >= counts.on_track &&
        counts.needs_support >= counts.progressing
      ) {
        overall = 'weak';
      } else {
        overall = 'average';
      }
      if (latest && latest.status === 'goal_met') overall = 'strong';
      else if (latest && latest.status === 'needs_support' && counts.goal_met === 0) overall = 'weak';
    }
    let trend = null;
    if (ratedCount >= 3) {
      const sorted = (rows || [])
        .slice()
        .sort(function (a, b) {
          return Number(a.lesson_no) - Number(b.lesson_no);
        });
      const mid = Math.ceil(sorted.length / 2);
      const score = { goal_met: 3, on_track: 2, progressing: 1, needs_support: 0 };
      const early = sorted.slice(0, mid).reduce(function (acc, r) {
        return acc + (score[r.status] || 0);
      }, 0);
      const late = sorted.slice(mid).reduce(function (acc, r) {
        return acc + (score[r.status] || 0);
      }, 0);
      if (late > early + 0.5) trend = 'improving';
      else if (early > late + 0.5) trend = 'declining';
      else trend = 'steady';
    }
    return {
      overall: overall,
      ratedCount: ratedCount,
      goal_met: counts.goal_met,
      on_track: counts.on_track,
      progressing: counts.progressing,
      needs_support: counts.needs_support,
      trend: trend,
      latestStatus: latest ? latest.status : null,
    };
  }

  function skillProgressAsRatingSummary(skillSummary) {
    const s = skillSummary || summarizeSkillLessonProgress([]);
    return {
      overall: s.overall,
      ratedCount: s.ratedCount,
      strong: s.goal_met || 0,
      average: (s.on_track || 0) + (s.progressing || 0),
      weak: s.needs_support || 0,
      trend: s.trend,
    };
  }

  const SKILL_COMMENT_POOLS = {
    computer: {
      strong: [
        'uses the computer confidently and follows digital tasks step by step.',
        'completes practical computer work neatly and with growing independence.',
        'applies mouse and keyboard skills well during lessons.',
        'shows good focus when working on set computer activities.',
        'has reached recent lesson targets in practical ICT work.',
        'explains what they did on screen using clear, simple words.',
        'helps peers patiently when working on basic computer tasks.',
        'is ready for slightly more challenging digital activities.',
      ],
      average: [
        'is progressing with basic computer skills and follows guidance well.',
        'completes most digital tasks when supported by the teacher.',
        'is improving in using the mouse and keyboard with care.',
        'takes part willingly in practical computer lessons.',
        'shows steady effort when learning new ICT steps.',
        'is building confidence with simple programs and tools.',
        'listens well during computer demonstrations.',
        'practises set tasks and is moving towards the lesson goal.',
      ],
      weak: [
        'is learning basic computer steps with close teacher support.',
        'benefits from short, repeated practice on mouse and keyboard skills.',
        'tries hard during ICT tasks when they are broken into small steps.',
        'is encouraged to practise simple digital activities at home.',
        'needs more guided practice before working independently on screen.',
        'is building confidence with one-to-one support during lessons.',
        'follows instructions when tasks are modelled slowly.',
        'is making gradual progress with encouragement in practical ICT.',
      ],
      unset: [
        'is beginning practical computer work in class.',
        'shows interest in digital activities and new tools.',
        'is learning to follow simple steps on the computer.',
        'participates when supported during ICT lessons.',
        'is encouraged to explore mouse and keyboard skills safely.',
        'listens during computer demonstrations.',
        'tries new digital tasks with guidance.',
        'is building early confidence with classroom technology.',
      ],
    },
    salon: {
      strong: [
        'handles salon tools safely and follows routines with confidence.',
        'completes practical salon tasks neatly and carefully.',
        'shows good hygiene habits during salon activities.',
        'works independently on set salon skills for this level.',
        'has achieved recent lesson goals in practical salon work.',
        'takes pride in grooming activities and personal presentation.',
        'cooperates well during partner salon tasks.',
        'is ready for more detailed practical salon steps.',
      ],
      average: [
        'is progressing with basic salon routines and follows guidance.',
        'handles tools carefully when supervised during practical work.',
        'shows steady effort in salon activities this term.',
        'is improving in hygiene and grooming habits.',
        'takes part willingly in practical salon lessons.',
        'completes most set tasks with teacher support.',
        'is building confidence with salon equipment.',
        'practises routines and is moving towards lesson targets.',
      ],
      weak: [
        'is learning salon routines with step-by-step support.',
        'benefits from repeated practice with tools and safety rules.',
        'tries hard when salon tasks are broken into smaller parts.',
        'is encouraged to practise simple grooming habits at home.',
        'needs close guidance to handle tools safely.',
        'is building confidence with gentle encouragement in salon work.',
        'follows routines when they are modelled clearly.',
        'is making gradual progress in practical salon skills.',
      ],
      unset: [
        'is beginning salon practical work in class.',
        'shows interest in grooming and salon activities.',
        'is learning safe handling of basic salon tools.',
        'participates when supported during practical lessons.',
        'is encouraged to practise neatness and hygiene habits.',
        'listens well during salon demonstrations.',
        'tries simple salon tasks with guidance.',
        'is building early confidence in practical salon work.',
      ],
    },
    bakery: {
      strong: [
        'follows bakery steps confidently and keeps the work area tidy.',
        'measures and mixes ingredients carefully during practical work.',
        'completes set bakery tasks with growing independence.',
        'shows good food hygiene habits during lessons.',
        'has reached recent lesson goals in practical bakery work.',
        'works cooperatively when preparing simple bakery items.',
        'takes pride in finished products and presentation.',
        'is ready for slightly more complex bakery activities.',
      ],
      average: [
        'is progressing with basic bakery routines and follows guidance.',
        'completes most practical steps when supervised.',
        'shows steady effort when measuring and mixing ingredients.',
        'is improving in food hygiene during bakery lessons.',
        'takes part willingly in practical bakery activities.',
        'follows recipes with support and care.',
        'is building confidence with kitchen tools and routines.',
        'practises set tasks and is moving towards lesson goals.',
      ],
      weak: [
        'is learning bakery steps with close teacher support.',
        'benefits from repeated practice with measuring and mixing.',
        'tries hard when tasks are broken into small, clear steps.',
        'is encouraged to help with simple food preparation at home.',
        'needs guidance to follow hygiene rules consistently.',
        'is building confidence with one-to-one support in bakery work.',
        'follows instructions when each step is modelled slowly.',
        'is making gradual progress in practical bakery skills.',
      ],
      unset: [
        'is beginning practical bakery work in class.',
        'shows interest in food preparation activities.',
        'is learning basic hygiene and safety in the kitchen area.',
        'participates when supported during bakery lessons.',
        'is encouraged to watch and help with simple mixing tasks.',
        'listens during bakery demonstrations.',
        'tries simple practical steps with guidance.',
        'is building early confidence in bakery routines.',
      ],
    },
    'fashion and design': {
      strong: [
        'cuts and joins materials carefully and follows design steps with confidence.',
        'completes practical fashion tasks neatly and creatively.',
        'shows good control when using tools and materials.',
        'works independently on set design activities for this level.',
        'has achieved recent lesson goals in practical design work.',
        'takes pride in finished pieces and presentation.',
        'cooperates well during partner design tasks.',
        'is ready for more detailed fashion and design projects.',
      ],
      average: [
        'is progressing with basic design skills and follows guidance.',
        'handles materials carefully when supervised.',
        'shows steady effort in practical fashion and design lessons.',
        'is improving in cutting, sticking, and simple stitching.',
        'takes part willingly in creative design activities.',
        'completes most set tasks with teacher support.',
        'is building confidence with tools and materials.',
        'practises design steps and is moving towards lesson targets.',
      ],
      weak: [
        'is learning design steps with step-by-step support.',
        'benefits from repeated practice with tools and materials.',
        'tries hard when design tasks are broken into smaller parts.',
        'is encouraged to practise simple creative work at home.',
        'needs close guidance to use tools safely.',
        'is building confidence with gentle support in design work.',
        'follows instructions when tasks are modelled clearly.',
        'is making gradual progress in practical fashion and design.',
      ],
      unset: [
        'is beginning practical fashion and design work in class.',
        'shows interest in creative design activities.',
        'is learning to handle materials and tools safely.',
        'participates when supported during design lessons.',
        'is encouraged to explore colour, shape, and texture.',
        'listens well during design demonstrations.',
        'tries simple creative tasks with guidance.',
        'is building early confidence in design work.',
      ],
    },
    music: {
      strong: [
        'sings and moves to rhythm confidently during music activities.',
        'keeps steady beat and follows music routines well.',
        'takes part enthusiastically in singing and percussion.',
        'shows good listening when others perform.',
        'has achieved recent lesson goals in music activities.',
        'uses instruments carefully and with control.',
        'cooperates well during group music tasks.',
        'is ready for slightly more challenging music activities.',
      ],
      average: [
        'is progressing with rhythm and singing and follows guidance.',
        'takes part willingly in music lessons.',
        'is improving in keeping beat and following simple patterns.',
        'shows steady effort when using classroom instruments.',
        'listens well during music demonstrations.',
        'completes most music activities with support.',
        'is building confidence when performing with others.',
        'practises songs and is moving towards lesson targets.',
      ],
      weak: [
        'is learning music routines with close support.',
        'benefits from repeated practice with beat and simple songs.',
        'tries hard when music tasks are broken into small steps.',
        'is encouraged to sing and clap rhythms at home.',
        'needs gentle encouragement to take part in group music.',
        'is building confidence with one-to-one support in music.',
        'follows actions when songs and movements are modelled.',
        'is making gradual progress in music activities.',
      ],
      unset: [
        'is beginning music activities in class.',
        'shows interest in singing and rhythm games.',
        'is learning to listen and respond to music.',
        'participates when supported during music lessons.',
        'is encouraged to join in songs and simple movements.',
        'listens well during music time.',
        'tries simple rhythm activities with guidance.',
        'is building early confidence in music.',
      ],
    },
    _generic: {
      strong: [
        'achieves practical lesson goals confidently and works with care.',
        'completes set skill tasks with growing independence.',
        'shows excellent effort in practical lessons this term.',
        'follows instructions well during hands-on activities.',
        'has reached recent targets in practical work.',
        'cooperates well during skill-based tasks.',
        'takes pride in work produced during lessons.',
        'is ready for the next practical challenge.',
      ],
      average: [
        'is making steady progress in practical skill lessons.',
        'follows guidance and completes most set tasks.',
        'shows a willing attitude during hands-on activities.',
        'is improving with regular practice in class.',
        'takes part willingly in practical lessons.',
        'is building confidence in skill-based tasks.',
        'listens well during demonstrations.',
        'practises set activities and is moving towards lesson goals.',
      ],
      weak: [
        'is building practical skills with step-by-step support.',
        'benefits from repeated practice and encouragement.',
        'tries hard when tasks are broken into smaller steps.',
        'is encouraged to practise a little at home when possible.',
        'needs close guidance during hands-on activities.',
        'is making gradual progress with teacher support.',
        'follows routines when they are modelled clearly.',
        'is developing confidence in practical work.',
      ],
      unset: [
        'is beginning practical skill work in class.',
        'shows interest in hands-on activities.',
        'is learning to follow simple practical steps.',
        'participates when supported during lessons.',
        'is encouraged to try new practical tasks.',
        'listens during skill demonstrations.',
        'tries activities with guidance.',
        'is building early confidence in practical lessons.',
      ],
    },
  };

  function skillBodiesFor(skillKey, band, skillSummary) {
    const key = normalizeSubjectKey(skillKey);
    const pools = SKILL_COMMENT_POOLS[key] || SKILL_COMMENT_POOLS._generic;
    let bodies = (pools[band] || pools.average || pools.unset || []).slice();
    const latest = skillSummary && skillSummary.latestStatus;
    if (latest === 'goal_met' && bodies.indexOf('has reached recent lesson targets in practical work.') === -1) {
      bodies.push('has reached recent lesson targets in practical work.');
    } else if (latest === 'on_track' && bodies.indexOf('is on track with current practical lesson goals.') === -1) {
      bodies.push('is on track with current practical lesson goals.');
    } else if (latest === 'progressing' && bodies.indexOf('is progressing towards the lesson goal with support.') === -1) {
      bodies.push('is progressing towards the lesson goal with support.');
    } else if (latest === 'needs_support' && bodies.indexOf('needs more guided practice to reach the lesson goal.') === -1) {
      bodies.push('needs more guided practice to reach the lesson goal.');
    }
    return bodies;
  }

  function buildSkillComments(opts) {
    const name = opts.name || 'The learner';
    const skillSubject = opts.skillSubject || opts.subject || '';
    const skillSummary = opts.summary || summarizeSkillLessonProgress([]);
    const ratingSummary = skillProgressAsRatingSummary(skillSummary);
    const seed =
      (opts.studentId || 0) +
      normalizeSubjectKey(skillSubject).length * 29 +
      (skillSummary.ratedCount || 0) * 7;
    const bodies = buildBodiesFromWeeklyRatings(
      function (band) {
        return skillBodiesFor(skillSubject, band, skillSummary);
      },
      ratingSummary,
      seed
    );
    return bodies.map(function (body) {
      return { snippet: line(name, body) };
    });
  }

  function renderCommentBankPicker(bankId, textarea, items, insertFn) {
    const bank = document.getElementById(bankId);
    if (!bank || !textarea) return;
    let slot = bank.querySelector('.comment-bank-slot');
    if (!slot) {
      const old = bank.querySelector('.comment-bank-buttons');
      if (old) old.remove();
      slot = document.createElement('div');
      slot.className = 'comment-bank-slot';
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn comment-bank-open';
      openBtn.setAttribute('aria-expanded', 'false');
      const picker = document.createElement('div');
      picker.className = 'comment-bank-picker';
      picker.hidden = true;
      const list = document.createElement('ul');
      list.className = 'comment-bank-list';
      picker.appendChild(list);
      slot.appendChild(openBtn);
      slot.appendChild(picker);
      bank.appendChild(slot);
      openBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        const show = picker.hidden;
        document.querySelectorAll('.comment-bank-picker').forEach(function (p) {
          if (p !== picker) p.hidden = true;
        });
        document.querySelectorAll('.comment-bank-open').forEach(function (b) {
          if (b !== openBtn) b.setAttribute('aria-expanded', 'false');
        });
        picker.hidden = !show;
        openBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
      });
      picker.addEventListener('click', function (ev) {
        ev.stopPropagation();
      });
      if (!bank._pickerOutsideClose) {
        bank._pickerOutsideClose = true;
        document.addEventListener('click', function () {
          picker.hidden = true;
          openBtn.setAttribute('aria-expanded', 'false');
        });
      }
    }
    const openBtn = slot.querySelector('.comment-bank-open');
    const picker = slot.querySelector('.comment-bank-picker');
    const list = slot.querySelector('.comment-bank-list');
    const insert = insertFn || function (ta, text) {
      if (!ta || !text) return;
      ta.value = String(ta.value || '').trim() ? ta.value.trim() + ' ' + text : text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    };
    list.innerHTML = '';
    picker.hidden = true;
    openBtn.setAttribute('aria-expanded', 'false');
    const seen = {};
    const unique = [];
    (items || []).forEach(function (item) {
      const s = String(item && item.snippet ? item.snippet : '').trim();
      if (!s || seen[s]) return;
      seen[s] = true;
      unique.push({ snippet: s });
    });
    if (!unique.length) {
      openBtn.disabled = true;
      openBtn.textContent = 'Suggested comments (save progress on Progress tab first)';
      return;
    }
    openBtn.disabled = false;
    openBtn.textContent = 'Choose a suggested comment (' + unique.length + ')';
    unique.forEach(function (item) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'comment-bank-pick';
      btn.textContent = item.snippet;
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        insert(textarea, item.snippet);
        picker.hidden = true;
        openBtn.setAttribute('aria-expanded', 'false');
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  window.OceanQuickComments = {
    learnerEnglishFirstName: learnerEnglishFirstName,
    summarizeWeeklyBands: summarizeWeeklyBands,
    hasDynamicWeeklyRatings: hasDynamicWeeklyRatings,
    buildSubjectCommentsFromRatings: buildSubjectCommentsFromRatings,
    buildSubjectComments: buildSubjectComments,
    buildClassTeacherComments: buildClassTeacherComments,
    summarizeSkillLessonProgress: summarizeSkillLessonProgress,
    buildSkillComments: buildSkillComments,
    renderCommentBankPicker: renderCommentBankPicker,
  };
})();
