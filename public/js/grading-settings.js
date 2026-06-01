/**
 * Class dashboard Settings — editable primary grading scale (server).
 * Only shown on Primary One / Primary Two class dashboards.
 */
(function () {
  const block = document.getElementById('settings-primary-grading');
  if (!block) return;
  const params = new URLSearchParams(window.location.search);
  const classLevel = params.get('class') || '';
  const isPrimary = classLevel === 'primary1' || classLevel === 'primary2';
  if (!isPrimary) {
    block.remove();
    return;
  }

  const tbody = document.getElementById('grading-scale-body');
  const addBtn = document.getElementById('grading-add-row');
  const saveBtn = document.getElementById('grading-save');
  const ugBtn = document.getElementById('grading-ug-defaults');
  const msg = document.getElementById('grading-scale-msg');
  if (!tbody || !saveBtn) return;

  function rowTemplate() {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input type="number" class="grading-inp" data-k="min" step="1" /></td>' +
      '<td><input type="number" class="grading-inp" data-k="max" step="1" /></td>' +
      '<td><input type="text" class="grading-inp" data-k="agg" maxlength="20" /></td>' +
      '<td><input type="text" class="grading-inp" data-k="remark" maxlength="80" /></td>' +
      '<td><button type="button" class="btn grading-del">Remove</button></td>';
    tr.querySelector('.grading-del').addEventListener('click', function () {
      tr.remove();
    });
    return tr;
  }

  function fillRows(bands) {
    tbody.innerHTML = '';
    (bands || []).forEach(function (b) {
      const tr = rowTemplate();
      tr.querySelectorAll('.grading-inp').forEach(function (inp) {
        const k = inp.getAttribute('data-k');
        if (k === 'min' || k === 'max') inp.value = b[k] != null ? String(b[k]) : '';
        else inp.value = b[k] != null ? String(b[k]) : '';
      });
      tbody.appendChild(tr);
    });
    if (!tbody.children.length) {
      tbody.appendChild(rowTemplate());
    }
  }

  function readRows() {
    const bands = [];
    tbody.querySelectorAll('tr').forEach(function (tr) {
      const o = {};
      tr.querySelectorAll('.grading-inp').forEach(function (inp) {
        const k = inp.getAttribute('data-k');
        o[k] = inp.value.trim();
      });
      const min = Number(o.min);
      const max = Number(o.max);
      if (Number.isNaN(min) || Number.isNaN(max)) return;
      bands.push({
        min: min,
        max: max,
        agg: o.agg || '',
        remark: o.remark || '',
      });
    });
    bands.sort(function (a, b) {
      return a.min - b.min;
    });
    return bands;
  }

  async function load() {
    msg.textContent = '';
    try {
      const res = await fetch('/api/settings/grading-scale');
      const data = res.ok ? await res.json() : { bands: [] };
      fillRows(data.bands || []);
    } catch (e) {
      msg.textContent = 'Could not load grading scale.';
    }
  }

  if (addBtn) {
    addBtn.addEventListener('click', function () {
      tbody.appendChild(rowTemplate());
    });
  }

  if (ugBtn) {
    ugBtn.addEventListener('click', function () {
      const bands = window.OCEAN_UG_DEFAULT_GRADING_BANDS;
      if (!bands || !bands.length) {
        msg.style.color = 'var(--err, #f87171)';
        msg.textContent = 'Defaults script missing — reload the page.';
        return;
      }
      fillRows(bands.slice());
      msg.style.color = 'var(--muted)';
      msg.textContent = 'Table filled with Uganda-style bands. Click “Save grading scale” to store on the server.';
    });
  }

  saveBtn.addEventListener('click', async function () {
    msg.textContent = '';
    const bands = readRows();
    if (!bands.length) {
      msg.textContent = 'Add at least one valid row (min and max must be numbers).';
      return;
    }
    try {
      const res = await fetch('/api/settings/grading-scale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bands: bands }),
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || res.statusText);
      const saved = data.bands || bands;
      fillRows(saved);
      try {
        window.dispatchEvent(new CustomEvent('ocean-grading-saved', { detail: { bands: saved } }));
      } catch (_) {}
      msg.style.color = 'var(--accent, #38bdf8)';
      msg.textContent = 'Grading scale saved on the server.';
      setTimeout(function () {
        msg.textContent = '';
      }, 4000);
    } catch (e) {
      msg.style.color = 'var(--err, #f87171)';
      msg.textContent = e.message || 'Save failed';
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
