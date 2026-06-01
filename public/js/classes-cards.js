/**
 * Classes page — Clear Ocean cards + search
 */
(function () {
  const ICONS = {
    head_teacher:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 10v6M2 10l10-6 10 6-10 6-10-6z"/><path d="M6 12v5c0 1.1 2.7 2 6 2s6-.9 6-2v-5"/></svg>',
    daycare:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="3.5"/><path d="M6 20v-1a6 6 0 0 1 12 0v1"/><circle cx="10" cy="8.5" r="0.6" fill="#fff" stroke="none"/><circle cx="14" cy="8.5" r="0.6" fill="#fff" stroke="none"/></svg>',
    baby:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2v4.5M14 2v4.5"/><path d="M8 7h8v2.5a4 4 0 0 1-8 0V7z"/><path d="M9 14h6v3H9z"/></svg>',
    middle:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    top:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6l2 7h8l2-7z"/></svg>',
    primary1:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    primary2:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    skills:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    default:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12h6M12 9v6"/></svg>',
  };

  const GO_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

  function iconForCard(cfg) {
    if (cfg.kind === 'head') return ICONS.head_teacher;
    const id = String(cfg.id || '').toLowerCase();
    return ICONS[id] || ICONS.default;
  }

  function defaultBlurb(cfg) {
    if (cfg.blurb) return cfg.blurb;
    if (cfg.needsSkillPick) return 'Computer, Salon, Bakery, Fashion & Design, or Music.';
    if (cfg.id === 'baby' && cfg.needsStream) return 'Select year data stream to continue.';
    if (cfg.needsStream) return 'Select your class stream to continue.';
    return 'Learners, marks, notes, and reports.';
  }

  function renderClassCard(cfg, onClick) {
    const article = document.createElement('article');
    article.className = 'class-card';
    article.setAttribute('role', 'button');
    article.setAttribute('tabindex', '0');
    article.dataset.search =
      (cfg.title + ' ' + defaultBlurb(cfg)).toLowerCase();

    const icon = document.createElement('div');
    icon.className = 'class-card-icon';
    icon.innerHTML = iconForCard(cfg);

    const body = document.createElement('div');
    body.className = 'class-card-body';
    const title = document.createElement('h3');
    title.className = 'class-card-title';
    title.textContent = cfg.title;
    const desc = document.createElement('p');
    desc.className = 'class-card-desc';
    desc.textContent = defaultBlurb(cfg);
    body.appendChild(title);
    body.appendChild(desc);

    const go = document.createElement('span');
    go.className = 'class-card-go';
    go.innerHTML = GO_SVG;

    article.appendChild(icon);
    article.appendChild(body);
    article.appendChild(go);

    function activate() {
      if (typeof onClick === 'function') onClick(cfg);
    }
    article.addEventListener('click', activate);
    article.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });

    return article;
  }

  function bindSearch(cardsEl) {
    const input = document.getElementById('classes-search');
    if (!input || !cardsEl) return;
    input.addEventListener('input', function () {
      const q = String(input.value || '')
        .trim()
        .toLowerCase();
      cardsEl.querySelectorAll('.class-card').forEach(function (card) {
        const hay = card.dataset.search || '';
        card.classList.toggle('is-hidden', q && hay.indexOf(q) === -1);
      });
    });
  }

  window.OceanClassesCards = {
    renderClassCard: renderClassCard,
    bindSearch: bindSearch,
    defaultBlurb: defaultBlurb,
  };
})();
