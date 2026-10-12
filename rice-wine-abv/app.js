(function () {
  'use strict';

  const R = window.RiceABV;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'riceWineAbv.v1';

  const METHODS = ['combo', 'boiloff', 'boil', 'distill'];
  const METHOD_NAMES = {
    combo: 'Hydrometer + refractometer',
    boiloff: 'Boil-off test',
    boil: 'Boiling point',
    distill: 'Distill + alcoholmeter'
  };
  const PANEL_FIELDS = {
    combo: ['c-sg', 'c-t', 'c-brix'],
    boiloff: ['b-sg1', 'b-t1', 'b-sg2', 'b-t2', 'b-brix1', 'b-brix2', 'b-m0', 'b-m1'],
    boil: ['e-tw', 'e-ts', 'e-brix'],
    distill: ['d-vs', 'd-vd', 'd-read', 'd-t', 'd-sg', 'd-sgt']
  };
  // Readings a 14 % ABV wine with 45 g/L extract would give (rounded like real instruments).
  const EXAMPLES = {
    combo: { 'c-sg': '0.998', 'c-t': '25', 'c-brix': '9.4' },
    boiloff: { 'b-sg1': '0.998', 'b-t1': '25', 'b-sg2': '1.017', 'b-t2': '25', 'b-brix1': '9.4', 'b-brix2': '4.5' },
    boil: { 'e-tw': '99.6', 'e-ts': '90.0', 'e-brix': '9.4' },
    distill: { 'd-vs': '100', 'd-vd': '100', 'd-read': '14.5', 'd-t': '23' }
  };
  const SETTING_IDS = ['s-hscale', 's-hcorr', 's-hprec', 's-rzero', 's-rprec', 's-wcf', 's-testabv', 's-testbrix', 's-ascale', 's-aprec', 's-tprec'];
  const SETTING_DEFAULTS = { 's-hscale': 'sg20', 's-ascale': 'abv20' };
  const TEMP_PLACEHOLDERS = { 'c-t': 20, 'b-t1': 20, 'b-t2': 20, 'e-tw': 99.6, 'e-ts': 90.0, 'd-t': 20, 'd-sgt': 20 };

  const HYD = {
    sg20: { unit: 'SG', prec: 0.0005, placeholder: ['0.998', '1.017'], range: [0.95, 1.2] },
    sg15: { unit: 'SG', prec: 0.0005, placeholder: ['0.998', '1.017'], range: [0.95, 1.2] },
    density20: { unit: 'g/mL', prec: 0.0005, placeholder: ['0.996', '1.015'], range: [0.95, 1.2] },
    smv15: { unit: 'SMV', prec: 0.5, placeholder: ['+3', '-24'], range: [-200, 60] },
    brix20: { unit: '°Bx', prec: 0.25, placeholder: ['-0.5', '4.3'], range: [-6, 45] }
  };
  const ALC = {
    abv20: { unit: '% ABV', prec: 0.5, max: 100 },
    abv15: { unit: '% ABV', prec: 0.5, max: 100 },
    proof60: { unit: 'proof', prec: 1, max: 200 }
  };

  const state = { method: 'combo', unit: 'C', examples: {} };
  let lastResult = null;
  let resultVisible = true;

  // ------------------------------------------------------------------ helpers
  function num(id) {
    const el = $(id);
    if (!el) return null;
    const s = el.value.trim().replace(',', '.').replace('−', '-').replace(/^\+/, '');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  function numOr(id, fallback) {
    const v = num(id);
    return v === null || Number.isNaN(v) ? fallback : v;
  }
  function toC(v) {
    return state.unit === 'F' ? R.fToC(v) : v;
  }
  function degreesToC(d) {
    return state.unit === 'F' ? (d * 5) / 9 : d;
  }
  function fmt(v, d) {
    return v.toFixed(d).replace('-', '−');
  }
  function signed(v, d) {
    return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
  }
  function hScale() {
    return $('s-hscale').value;
  }
  function aScale() {
    return $('s-ascale').value;
  }

  /** Reads a temperature field; blank means the 20 °C default. */
  function tempField(id, warns, label) {
    const v = num(id);
    if (v === null) {
      warns.push({ text: `No ${label} temperature entered, so 20 °C is assumed.` });
      return 20;
    }
    if (Number.isNaN(v)) return NaN;
    const c = toC(v);
    if (c < 0 || c > 40) warns.push({ bad: true, text: `A ${label} temperature of ${fmt(c, 1)} °C is outside the 0–40 °C the correction tables cover.` });
    else if (c < 10 || c > 30) warns.push({ text: `Readings far from 20 °C are less reliable. Warm or cool the sample to 15–25 °C if you can.` });
    return c;
  }

  /** First problem in a list of [value, description], or null. */
  function missing(list) {
    const bad = list.find(([v]) => Number.isNaN(v));
    if (bad) return { need: `The ${bad[1]} isn't a number.` };
    const empty = list.filter(([v]) => v === null).map(([, d]) => d);
    if (empty.length) return { need: `Enter the ${joinList(empty)}.` };
    return null;
  }
  function joinList(a) {
    if (a.length < 2) return a.join('');
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }

  function hydObs(reading, tC, kind, extra) {
    const sc = hScale();
    const spec = HYD[sc];
    if (reading < spec.range[0] || reading > spec.range[1]) {
      throw new Error(`A hydrometer reading of ${reading} doesn't fit the "${spec.unit}" scale chosen in Instrument settings.`);
    }
    const r = reading + numOr('s-hcorr', 0);
    const prec = Math.abs(numOr('s-hprec', spec.prec)) || spec.prec;
    const rho = R.hydrometerDensity(r, tC, sc);
    const sigma = Math.max(Math.abs(R.hydrometerDensity(r + prec, tC, sc) - rho), 0.05);
    return Object.assign({ kind: kind, T: tC, value: rho, sigma: sigma }, extra || {});
  }

  function alcoholScale() {
    const testAbv = num('s-testabv');
    const testBrix = num('s-testbrix');
    if (testAbv === null || testBrix === null || Number.isNaN(testAbv) || Number.isNaN(testBrix) || testAbv <= 0) return 1;
    const k = R.alcoholScaleFromTest(testAbv, testBrix - numOr('s-rzero', 0));
    return k > 0.6 && k < 1.5 ? k : 1;
  }

  function brixObs(reading, kind, extra) {
    if (reading < -2 || reading > 60) throw new Error(`A refractometer reading of ${reading} °Bx is outside the range this works for.`);
    return Object.assign(
      {
        kind: kind,
        value: reading - numOr('s-rzero', 0),
        sigma: Math.abs(numOr('s-rprec', 0.2)) || 0.2,
        wcf: numOr('s-wcf', 1) || 1,
        alcoholScale: alcoholScale()
      },
      extra || {}
    );
  }

  // ------------------------------------------------------------------ methods
  const BUILD = {
    combo() {
      const warns = [];
      const sg = num('c-sg');
      const b = num('c-brix');
      const miss = missing([[sg, 'hydrometer reading'], [b, 'refractometer reading']]);
      if (miss) return miss;
      const t = tempField('c-t', warns, 'sample');
      if (Number.isNaN(t)) return { need: "The sample temperature isn't a number." };
      return { obs: [hydObs(sg, t, 'density'), brixObs(b, 'brix')], model: 0.5, warns: warns, note: 'hydrometer + refractometer' };
    },

    boiloff() {
      const warns = [];
      const useH = $('b-usehyd').checked;
      const useR = $('b-useref').checked;
      if (!useH && !useR) return { need: 'Tick the instrument(s) you used.' };
      const restore = $('b-restore-volume').checked ? 'volume' : 'mass';
      let ratio = 1;
      if (restore === 'mass') {
        const m0 = num('b-m0');
        const m1 = num('b-m1');
        if (Number.isNaN(m0) || Number.isNaN(m1)) return { need: "A weight isn't a number." };
        if (m0 > 0 && m1 > 0) ratio = m1 / m0;
        if (ratio < 0.5 || ratio > 2) return { need: 'The two weights should be close to each other. Top up to the starting weight.' };
      }
      // Topping up isn't perfect: ±0.5 % by weight, ±1.5 % with a measuring jug.
      const restoreRel = restore === 'mass' ? 0.005 : 0.015;
      const obs = [];
      const sg1 = num('b-sg1');
      const sg2 = num('b-sg2');
      const b1 = num('b-brix1');
      const b2 = num('b-brix2');
      const hydGiven = useH && (sg1 !== null || sg2 !== null);
      const refGiven = useR && (b1 !== null || b2 !== null);
      if (!hydGiven && !refGiven) {
        return { need: 'Enter the readings from before and after boiling.' };
      }
      if (hydGiven) {
        const miss = missing([[sg1, 'hydrometer reading before boiling'], [sg2, 'hydrometer reading after topping up']]);
        if (miss) return miss;
        const t1 = tempField('b-t1', warns, 'wine');
        const t2 = tempField('b-t2', warns, 'topped-up sample');
        if (Number.isNaN(t1) || Number.isNaN(t2)) return { need: "A temperature isn't a number." };
        obs.push(hydObs(sg1, t1, 'density'));
        const o = hydObs(sg2, t2, 'residueDensity', { restore: restore, massRatio: ratio });
        o.sigma = Math.hypot(o.sigma, restoreRel * Math.max(o.value - R.waterDensity(t2), 0));
        obs.push(o);
      }
      if (refGiven) {
        const miss = missing([[b1, 'refractometer reading before boiling'], [b2, 'refractometer reading after topping up']]);
        if (miss) return miss;
        obs.push(brixObs(b1, 'brix'));
        const o = brixObs(b2, 'residueBrix', { restore: restore, massRatio: ratio });
        o.sigma = Math.hypot(o.sigma, restoreRel * Math.max(o.value, 0));
        obs.push(o);
      }
      if (hydGiven && obs[1].value < obs[0].value - 0.5) {
        warns.push({ bad: true, text: 'Without its alcohol the topped-up sample should be denser than the wine. Check the readings are in the right boxes.' });
      }
      const both = hydGiven && refGiven;
      return {
        obs: obs,
        model: hydGiven ? 0.15 : 0.4,
        warns: warns,
        note: both ? 'boil-off, hydrometer + refractometer' : hydGiven ? 'boil-off, hydrometer' : 'boil-off, refractometer'
      };
    },

    boil() {
      const warns = [];
      const twRaw = num('e-tw');
      const tsRaw = num('e-ts');
      const miss = missing([[twRaw, 'boiling point of water'], [tsRaw, 'boiling point of the wine']]);
      if (miss) return miss;
      const tw = toC(twRaw);
      const ts = toC(tsRaw);
      if (tw < 70 || tw > 103) return { need: 'Plain water should boil between 70 and 103 °C on any thermometer. Check the water reading and the °C/°F switch.' };
      const dT = tw - ts;
      if (dT <= 0) return { need: 'The wine has to boil below the water. Check the two readings are in the right boxes.' };
      if (dT > 20) return { need: 'More than 20 °C below water is beyond any wine. Check the readings.' };
      const dilution = Number($('e-dil').value) || 0;
      const tprec = Math.abs(degreesToC(numOr('s-tprec', state.unit === 'F' ? 0.2 : 0.1))) || 0.1;
      const obs = [{ kind: 'boil', p: R.pressureFromWaterBoilingPoint(tw), dilution: dilution, value: dT, sigma: Math.SQRT2 * tprec }];
      const b = num('e-brix');
      if (Number.isNaN(b)) return { need: "The refractometer reading isn't a number." };
      let prior;
      if (b !== null) obs.push(brixObs(b, 'brix'));
      else prior = { kind: 'extractPrior', value: 30, sigma: 40 };
      return { obs: obs, prior: prior, model: 0.3, warns: warns, note: dilution ? `boiling point, diluted 1:${dilution}` : 'boiling point' };
    },

    distill() {
      const warns = [];
      const vs = numOr('d-vs', 100);
      const vd = numOr('d-vd', 100);
      const read = num('d-read');
      const miss = missing([[read, 'alcoholmeter reading']]);
      if (miss) return miss;
      if (!(vs > 0) || !(vd > 0)) return { need: 'Enter both volumes in mL.' };
      const sc = aScale();
      if (read < 0 || read > ALC[sc].max) return { need: `An alcoholmeter reading of ${read} doesn't fit the "${ALC[sc].unit}" scale.` };
      const t = tempField('d-t', warns, 'distillate');
      if (Number.isNaN(t)) return { need: "The distillate temperature isn't a number." };
      const prec = Math.abs(numOr('s-aprec', ALC[sc].prec)) || ALC[sc].prec;
      const ratio = vd / vs;
      const abvDist = R.alcoholmeterAbv(read, t, sc);
      const sigDist = Math.abs(R.alcoholmeterAbv(read + prec, t, sc) - abvDist);
      const abvWine = abvDist * ratio;
      // ±1 % for the two volume measurements.
      const obs = [{ kind: 'abv', value: abvWine, sigma: Math.max(Math.hypot(sigDist * ratio, 0.01 * abvWine), 0.02) }];
      if (ratio < 0.5) warns.push({ text: 'Collect at least half the starting volume as distillate, or some alcohol stays in the still.' });
      const sg = num('d-sg');
      if (Number.isNaN(sg)) return { need: "The hydrometer reading isn't a number." };
      if (sg !== null) {
        const tsg = tempField('d-sgt', warns, 'wine');
        if (Number.isNaN(tsg)) return { need: "The wine temperature isn't a number." };
        obs.push(hydObs(sg, tsg, 'density'));
      }
      return { obs: obs, model: 0.15, warns: warns, note: 'distillation + alcoholmeter' };
    }
  };

  const FLAG_TEXT = {
    inconsistent: { bad: true, text: 'Your readings disagree with each other by more than their precision allows. Check sample temperatures, bubbles on the hydrometer, and each instrument in plain water.' },
    'abv-floor': { bad: true, text: 'These readings imply no alcohol at all. Check the hydrometer reads 1.000 in plain water and that the sample is degassed.' },
    'abv-ceiling': { bad: true, text: 'These readings imply over 30 % ABV, more than fermentation can make. Check the inputs and the scale in Instrument settings.' },
    'extract-floor': { bad: true, text: 'These readings imply less than zero dissolved solids, which is impossible. Usually the hydrometer is reading high (bubbles, sediment, wrong temperature) or the refractometer low.' },
    'extract-ceiling': { bad: true, text: 'The readings imply more than 450 g/L of extract, beyond what this model covers.' }
  };

  function sweetness(e) {
    if (e < 25) return 'dry';
    if (e < 45) return 'off-dry';
    if (e < 80) return 'medium-sweet';
    if (e < 150) return 'sweet';
    return 'very sweet';
  }

  // ------------------------------------------------------------------ compute + render
  function compute() {
    const m = state.method;
    $('r-method').textContent = METHOD_NAMES[m];
    let built;
    try {
      built = BUILD[m]();
    } catch (err) {
      built = { need: err.message };
    }
    if (built.need) {
      renderEmpty(built.need);
      return;
    }
    let s;
    try {
      s = R.solve(built.obs, { prior: built.prior });
    } catch (err) {
      renderEmpty('Those readings could not be solved. Check each value.');
      return;
    }
    const d = R.describe(s.abv, s.extract);
    const total = Math.hypot(s.abvSigma, built.model);
    lastResult = { s: s, d: d, total: total, built: built, method: m };
    renderResult(lastResult);
  }

  function renderEmpty(message) {
    lastResult = null;
    $('r-abv').textContent = '–';
    $('r-pm').hidden = true;
    $('r-stats').hidden = true;
    $('r-status').hidden = false;
    $('r-status').textContent = message;
    $('r-warns').innerHTML = '';
    $('r-copy').disabled = true;
    $('mb-abv').textContent = '–';
    $('mb-pm').textContent = '';
    updateMinibar();
  }

  function renderResult(res) {
    const s = res.s;
    const d = res.d;
    const pm = Math.max(res.total, 0.1);
    $('r-abv').textContent = fmt(s.abv, 1);
    $('r-pm').hidden = false;
    $('r-pm-big').textContent = `± ${pm.toFixed(1)}`;
    $('r-range').textContent = `likely ${fmt(Math.max(s.abv - pm, 0), 1)} – ${fmt(s.abv + pm, 1)} % (${res.built.note})`;
    $('r-split').textContent = `readings ±${s.abvSigma.toFixed(2)} · method ±${res.built.model.toFixed(2)}`;
    $('r-status').hidden = true;

    const stats = $('r-stats');
    stats.hidden = false;
    if (s.extractDetermined) {
      $('r-extract').textContent = `${Math.round(s.extract)} ± ${Math.max(Math.round(s.extractSigma), 1)} g/L`;
      $('r-extract-sub').innerHTML =
        `<span class="pill">${sweetness(s.extract)}</span> Mostly sugar; reads ${d.extractBrix.toFixed(1)} °Bx once the alcohol is gone.`;
      $('r-og').textContent = d.equivalentOG.toFixed(3);
      $('r-og-sub').textContent = `${d.originalExtract.toFixed(1)} °Bx: what a must would read if all its sugar were there at the start.`;
      $('r-smv').textContent = signed(d.sakeMeterValue, 1);
      $('r-sg').textContent = d.sg.toFixed(4);
      setStatRows(true);
    } else {
      $('r-extract').textContent = '–';
      $('r-extract-sub').textContent =
        res.method === 'boil' ? 'Add a refractometer reading to estimate sweetness.' : 'Add a hydrometer reading of the wine to estimate sweetness.';
      setStatRows(false);
    }

    const warns = (res.built.warns || []).concat(s.flags.map((f) => FLAG_TEXT[f]).filter(Boolean));
    if (res.method === 'boil' && s.extractDetermined && s.extract > 120 && !Number($('e-dil').value)) {
      warns.push({ text: 'This is a very sweet sample. If it foamed or scorched while boiling, repeat it diluted 1:1 with water.' });
    }
    if (s.abv > 22 && !s.flags.includes('abv-ceiling')) warns.push({ text: 'Above 22 % ABV is unusual for a fermented wine. Double-check the readings.' });
    const ul = $('r-warns');
    ul.innerHTML = '';
    warns.forEach((w) => {
      const li = document.createElement('li');
      if (w.bad) li.className = 'bad';
      li.textContent = w.text;
      ul.appendChild(li);
    });
    $('r-copy').disabled = false;
    $('mb-abv').textContent = fmt(s.abv, 1);
    $('mb-pm').textContent = `± ${pm.toFixed(1)}`;
    updateMinibar();
  }

  function setStatRows(all) {
    ['row-og', 'row-smv', 'row-sg'].forEach((id) => ($(id).hidden = !all));
  }

  function resultText() {
    if (!lastResult) return '';
    const { s, d, total, built } = lastResult;
    const lines = [`Rice wine: ${s.abv.toFixed(1)} % ABV ± ${Math.max(total, 0.1).toFixed(1)} (${built.note})`];
    if (s.extractDetermined) {
      lines.push(`Extract ${Math.round(s.extract)} g/L (${sweetness(s.extract)}), equivalent starting gravity ${d.equivalentOG.toFixed(3)}, SMV ${signed(d.sakeMeterValue, 1)}`);
    }
    const readings = PANEL_FIELDS[lastResult.method]
      .map((id) => [id, $(id)])
      .filter(([, el]) => el.value.trim() !== '' && !el.closest('[hidden]'))
      .map(([id, el]) => `${labelFor(id)} ${el.value.trim()}`);
    if (readings.length) lines.push('Readings: ' + readings.join('; '));
    return lines.join('\n');
  }

  function labelFor(id) {
    const lab = document.querySelector(`label[for="${id}"]`);
    const unit = $(id).parentElement.querySelector('.unit');
    let name = lab ? lab.textContent.trim() : id;
    const legend = $(id).closest('fieldset').querySelector('legend');
    if (legend && /^(Reading|Hydrometer|Refractometer|Temperature)$/.test(name)) name = `${legend.textContent.trim()}: ${name.toLowerCase()}`;
    return `${name}${unit ? ' (' + unit.textContent.trim() + ')' : ''}`;
  }

  async function copyResult() {
    const text = resultText();
    const btn = $('r-copy');
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
    } catch (e) {
      // Fall back to showing the text selected so it can be copied by hand.
      let pre = $('r-copytext');
      if (!pre) {
        pre = document.createElement('textarea');
        pre.id = 'r-copytext';
        pre.rows = 4;
        pre.readOnly = true;
        pre.style.width = '100%';
        pre.className = 'small data';
        btn.parentElement.after(pre);
      }
      pre.value = text;
      pre.select();
      btn.textContent = 'Select and copy';
    }
    setTimeout(() => (btn.textContent = 'Copy result'), 1800);
  }

  // ------------------------------------------------------------------ UI state
  function setMethod(m, focus) {
    if (!METHODS.includes(m)) m = 'combo';
    state.method = m;
    METHODS.forEach((k) => {
      const tab = $('tab-' + k);
      const on = k === m;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      $('panel-' + k).hidden = !on;
    });
    if (focus) $('tab-' + m).focus();
    try {
      history.replaceState(null, '', '#' + m);
    } catch (e) {
      /* not allowed in some frames */
    }
    compute();
    save();
  }

  function updateVisibility() {
    const useH = $('b-usehyd').checked;
    const useR = $('b-useref').checked;
    const mass = $('b-restore-mass').checked;
    document.querySelectorAll('[data-show="hyd"]').forEach((el) => (el.hidden = !useH));
    document.querySelectorAll('[data-show="ref"]').forEach((el) => (el.hidden = !useR));
    document.querySelectorAll('[data-show="mass"]').forEach((el) => (el.hidden = !mass));
    METHODS.forEach((m) => {
      const chip = document.querySelector(`[data-example="${m}"]`);
      if (chip) chip.hidden = !state.examples[m];
    });
  }

  function updateScaleLabels() {
    const h = HYD[hScale()];
    document.querySelectorAll('[data-hunit]').forEach((el) => (el.textContent = h.unit));
    $('c-sg').placeholder = h.placeholder[0];
    $('b-sg1').placeholder = h.placeholder[0];
    $('b-sg2').placeholder = h.placeholder[1];
    $('s-hprec').placeholder = String(h.prec);
    $('s-hcorr').placeholder = '0';
    const a = ALC[aScale()];
    document.querySelectorAll('[data-aunit]').forEach((el) => (el.textContent = a.unit));
    $('s-aprec').placeholder = String(a.prec);
    $('d-read').placeholder = a.unit === 'proof' ? '29' : '14.5';
  }

  function updateTempLabels() {
    const u = state.unit === 'F' ? '°F' : '°C';
    document.querySelectorAll('[data-tunit]').forEach((el) => (el.textContent = u));
    Object.keys(TEMP_PLACEHOLDERS).forEach((id) => {
      const c = TEMP_PLACEHOLDERS[id];
      $(id).placeholder = state.unit === 'F' ? R.cToF(c).toFixed(1).replace(/\.0$/, '') : String(c);
    });
    $('s-tprec').placeholder = state.unit === 'F' ? '0.2' : '0.1';
  }

  function setUnit(u) {
    if (u === state.unit) return;
    const toF = u === 'F';
    document.querySelectorAll('input[data-temp]').forEach((el) => {
      const v = num(el.id);
      if (v === null || Number.isNaN(v)) return;
      const out = toF ? R.cToF(v) : R.fToC(v);
      const boilField = el.id === 'e-tw' || el.id === 'e-ts';
      el.value = out.toFixed(boilField ? 2 : 1).replace(/\.?0+$/, '');
    });
    const tp = num('s-tprec');
    if (tp !== null && !Number.isNaN(tp)) $('s-tprec').value = String(+(toF ? tp * 1.8 : tp / 1.8).toFixed(2));
    state.unit = u;
    $(toF ? 'unit-f' : 'unit-c').checked = true;
    updateTempLabels();
  }

  function updateAlcoholTest() {
    const out = $('s-testout');
    const testAbv = num('s-testabv');
    const testBrix = num('s-testbrix');
    if (testAbv === null || testBrix === null) {
      out.textContent = testAbv > 0 ? `A ${testAbv} % mix should read about ${R.ethanolBrixEquivalent(testAbv).toFixed(1)} °Bx.` : '';
      return;
    }
    if (Number.isNaN(testAbv) || Number.isNaN(testBrix) || testAbv <= 0) {
      out.textContent = 'Enter the strength and the reading as numbers.';
      return;
    }
    const expected = R.ethanolBrixEquivalent(testAbv);
    const k = R.alcoholScaleFromTest(testAbv, testBrix - numOr('s-rzero', 0));
    if (k > 0.6 && k < 1.5) {
      out.textContent = `Expected ${expected.toFixed(1)} °Bx. Your refractometer responds to alcohol at ${k.toFixed(2)}× the handbook value; this is now applied to every refractometer reading.`;
    } else {
      out.textContent = `Expected about ${expected.toFixed(1)} °Bx. That reading is too far off to use; check the mix and the zero.`;
    }
  }

  function updateMinibar() {
    $('minibar').classList.toggle('show', !!lastResult && !resultVisible);
  }

  // ------------------------------------------------------------------ persistence
  const ALL_FIELD_IDS = [].concat(...Object.values(PANEL_FIELDS), SETTING_IDS, ['e-dil']);

  function save() {
    try {
      const data = { v: 1, method: state.method, unit: state.unit, examples: state.examples, fields: {}, checks: {} };
      ALL_FIELD_IDS.forEach((id) => (data.fields[id] = $(id).value));
      ['b-usehyd', 'b-useref', 'b-restore-mass', 'b-restore-volume'].forEach((id) => (data.checks[id] = $(id).checked));
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) {
      /* storage unavailable: the page still works */
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function fillExamples(m) {
    PANEL_FIELDS[m].forEach((id) => ($(id).value = EXAMPLES[m][id] || ''));
    state.examples[m] = true;
  }

  function clearPanel(m) {
    PANEL_FIELDS[m].forEach((id) => ($(id).value = ''));
    if (m === 'boil') $('e-dil').value = '0';
    state.examples[m] = false;
    updateVisibility();
    compute();
    save();
    const first = $(PANEL_FIELDS[m][0]);
    if (first) first.focus();
  }

  function resetSettings() {
    SETTING_IDS.forEach((id) => ($(id).value = SETTING_DEFAULTS[id] || ''));
    updateScaleLabels();
    updateAlcoholTest();
    compute();
    save();
  }

  // ------------------------------------------------------------------ init
  function init() {
    const saved = load();
    if (saved && saved.v === 1) {
      state.unit = saved.unit === 'F' ? 'F' : 'C';
      state.examples = saved.examples || {};
      Object.keys(saved.fields || {}).forEach((id) => {
        if ($(id) && typeof saved.fields[id] === 'string') $(id).value = saved.fields[id];
      });
      Object.keys(saved.checks || {}).forEach((id) => {
        if ($(id)) $(id).checked = !!saved.checks[id];
      });
      state.method = saved.method;
    } else {
      METHODS.forEach(fillExamples);
    }
    $(state.unit === 'F' ? 'unit-f' : 'unit-c').checked = true;
    SETTING_IDS.forEach((id) => {
      if ($(id).tagName === 'SELECT' && !$(id).value) $(id).value = SETTING_DEFAULTS[id];
    });

    const hash = (location.hash || '').replace('#', '');
    if (METHODS.includes(hash)) state.method = hash;

    updateTempLabels();
    updateScaleLabels();
    updateVisibility();
    updateAlcoholTest();

    // Tabs
    METHODS.forEach((m) => $('tab-' + m).addEventListener('click', () => setMethod(m)));
    document.querySelector('.methods').addEventListener('keydown', (e) => {
      const i = METHODS.indexOf(state.method);
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = METHODS[(i + 1) % METHODS.length];
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = METHODS[(i + METHODS.length - 1) % METHODS.length];
      if (e.key === 'Home') next = METHODS[0];
      if (e.key === 'End') next = METHODS[METHODS.length - 1];
      if (next) {
        e.preventDefault();
        setMethod(next, true);
      }
    });

    // Inputs anywhere recompute; editing a panel drops its example banner.
    document.addEventListener('input', (e) => {
      const el = e.target;
      if (el.name === 'unit') {
        setUnit(el.value);
      } else {
        const panel = el.closest('[role="tabpanel"]');
        if (panel && state.examples[panel.dataset.method]) {
          state.examples[panel.dataset.method] = false;
        }
        if (el.id === 's-hscale' || el.id === 's-ascale') updateScaleLabels();
        if (el.id === 's-testabv' || el.id === 's-testbrix' || el.id === 's-rzero') updateAlcoholTest();
      }
      updateVisibility();
      compute();
      save();
    });
    document.querySelectorAll('[data-clear]').forEach((btn) => btn.addEventListener('click', () => clearPanel(btn.dataset.clear)));
    $('s-reset').addEventListener('click', resetSettings);
    $('r-copy').addEventListener('click', copyResult);
    $('mb-go').addEventListener('click', () => $('result').scrollIntoView({ behavior: 'smooth', block: 'start' }));

    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        resultVisible = entries[0].isIntersecting;
        updateMinibar();
      }).observe($('result'));
    }

    setMethod(state.method);
  }

  init();
})();
