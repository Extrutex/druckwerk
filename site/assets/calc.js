// Druckpreis – 3D-Druck Preisrechner
// Reine Client-Logik, keine Daten verlassen das Geraet.

(function () {
  const form = document.getElementById('calcForm');
  const resultBox = document.getElementById('calcResult');
  const printQuote = document.getElementById('printQuote');
  if (!form || !resultBox) return;

  const STORAGE_KEY = 'druckpreis-inputs';
  const ids = [
    'filamentPrice', 'grams', 'wastePct',
    'hours', 'powerW', 'kwhPrice', 'machinePrice', 'lifetimeHours', 'maintPerHour',
    'laborMin', 'laborRate',
    'failurePct', 'marginPct', 'qty', 'vatPct',
  ];

  const eur = (n) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(
      Number.isFinite(n) ? n : 0,
    );

  function num(id) {
    const el = document.getElementById(id);
    if (!el) return 0;
    const v = parseFloat(String(el.value).replace(',', '.'));
    return Number.isFinite(v) ? v : 0;
  }

  function calculate() {
    const filamentPrice = num('filamentPrice');
    const grams = num('grams');
    const wastePct = num('wastePct');
    const hours = num('hours');
    const powerW = num('powerW');
    const kwhPrice = num('kwhPrice');
    const machinePrice = num('machinePrice');
    const lifetimeHours = Math.max(1, num('lifetimeHours'));
    const maintPerHour = num('maintPerHour');
    const laborMin = num('laborMin');
    const laborRate = num('laborRate');
    const failurePct = num('failurePct');
    const marginPct = num('marginPct');
    const qty = Math.max(1, Math.round(num('qty')));
    const vatOn = document.getElementById('vatOn')?.checked;
    const vatPct = num('vatPct');

    const materialCost = (grams / 1000) * filamentPrice * (1 + wastePct / 100);
    const energyCost = (powerW / 1000) * hours * kwhPrice;
    const depreciation = (machinePrice / lifetimeHours) * hours;
    const maintenance = maintPerHour * hours;
    const machineCost = energyCost + depreciation + maintenance;
    const laborCost = (laborMin / 60) * laborRate;

    const baseCost = materialCost + machineCost + laborCost;
    const riskSurcharge = baseCost * (failurePct / 100);
    const totalCost = baseCost + riskSurcharge;
    const marginValue = totalCost * (marginPct / 100);
    const netPrice = totalCost + marginValue;

    const unitNet = netPrice;
    const totalNet = unitNet * qty;
    const totalGross = totalNet * (1 + (vatOn ? vatPct / 100 : 0));

    return {
      materialCost, energyCost, depreciation, maintenance, machineCost,
      laborCost, baseCost, riskSurcharge, totalCost, marginValue, marginPct,
      unitNet, qty, totalNet, totalGross, vatOn, vatPct,
    };
  }

  function row(label, value, opts = {}) {
    const cls = opts.strong ? ' class="calc-row strong"' : ' class="calc-row"';
    return `<div${cls}><span>${label}</span><span>${eur(value)}</span></div>`;
  }

  function render() {
    const r = calculate();
    const profitHint =
      r.unitNet > 0
        ? `Deckungsbeitrag pro Stück (Preis minus echte Kosten): <strong>${eur(r.unitNet - r.totalCost)}</strong>`
        : '';

    resultBox.innerHTML = `
      <div class="calc-headline">
        <p class="calc-label">Empfohlener Preis pro Stück (netto)</p>
        <p class="calc-price">${eur(r.unitNet)}</p>
      </div>
      <div class="calc-breakdown">
        ${row('Material', r.materialCost)}
        ${row('Energie', r.energyCost)}
        ${row('Abschreibung Drucker', r.depreciation)}
        ${row('Wartung / Verschleiß', r.maintenance)}
        ${row('Arbeitszeit', r.laborCost)}
        ${row('Fehldruck-Risiko', r.riskSurcharge)}
        <div class="calc-divider"></div>
        ${row('Selbstkosten gesamt', r.totalCost, { strong: true })}
        ${row(`Marge (${r.marginPct}%)`, r.marginValue)}
        <div class="calc-divider"></div>
        ${row('Preis pro Stück (netto)', r.unitNet, { strong: true })}
        ${r.qty > 1 ? row(`Gesamt für ${r.qty} Stück (netto)`, r.totalNet, { strong: true }) : ''}
        ${r.vatOn ? row(`Gesamt inkl. ${r.vatPct}% MwSt.`, r.totalGross, { strong: true }) : ''}
      </div>
      <p class="calc-hint">${profitHint}</p>
      <button type="button" class="btn btn-primary calc-print-btn" id="calcPrint" data-track-cta="calc_print_quote">
        Angebot als PDF / drucken
      </button>
      <p class="calc-note">Richtwert ohne Gewähr. Prüfe deine eigenen Kosten. Eingaben bleiben in deinem Browser.</p>
    `;

    const printBtn = document.getElementById('calcPrint');
    if (printBtn) printBtn.addEventListener('click', () => printQuoteSheet(r));

    save();
  }

  function printQuoteSheet(r) {
    if (!printQuote) return;
    const today = new Date().toLocaleDateString('de-DE');
    printQuote.innerHTML = `
      <div class="pq-head">
        <h1>Angebot – 3D-Druck</h1>
        <p>Datum: ${today}</p>
      </div>
      <table class="pq-table">
        <tbody>
          <tr><td>Material</td><td>${eur(r.materialCost)}</td></tr>
          <tr><td>Energie</td><td>${eur(r.energyCost)}</td></tr>
          <tr><td>Abschreibung Drucker</td><td>${eur(r.depreciation)}</td></tr>
          <tr><td>Wartung / Verschleiß</td><td>${eur(r.maintenance)}</td></tr>
          <tr><td>Arbeitszeit</td><td>${eur(r.laborCost)}</td></tr>
          <tr><td>Fehldruck-Risiko</td><td>${eur(r.riskSurcharge)}</td></tr>
          <tr><td>Marge (${r.marginPct}%)</td><td>${eur(r.marginValue)}</td></tr>
        </tbody>
        <tfoot>
          <tr><td>Preis pro Stück (netto)</td><td>${eur(r.unitNet)}</td></tr>
          ${r.qty > 1 ? `<tr><td>Menge ${r.qty} – Gesamt (netto)</td><td>${eur(r.totalNet)}</td></tr>` : ''}
          ${r.vatOn ? `<tr><td>Gesamt inkl. ${r.vatPct}% MwSt.</td><td>${eur(r.totalGross)}</td></tr>` : ''}
        </tfoot>
      </table>
      <p class="pq-foot">Erstellt mit Druckpreis · druckpreis.netlify.app</p>
    `;
    printQuote.setAttribute('aria-hidden', 'false');
    window.print();
  }

  function save() {
    try {
      const data = {};
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) data[id] = el.value;
      });
      data.vatOn = document.getElementById('vatOn')?.checked || false;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* localStorage nicht verfügbar – egal */
    }
  }

  function restore() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el && data[id] !== undefined) el.value = data[id];
      });
      const vat = document.getElementById('vatOn');
      if (vat) vat.checked = Boolean(data.vatOn);
    } catch {
      /* ungültige Daten – ignorieren */
    }
  }

  restore();
  render();

  form.addEventListener('input', render);
  form.addEventListener('reset', () => {
    // Nach dem Reset (Standardwerte) neu rendern.
    window.setTimeout(() => {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* egal */ }
      render();
    }, 0);
  });
})();
