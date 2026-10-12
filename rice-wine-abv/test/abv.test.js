'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../abv.js');

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg || ''} expected ${expected} ± ${tol}, got ${actual}`);

test('OIML density formula reproduces reference values', () => {
  near(R.waterDensity(20), 998.2, 0.01, 'water 20 °C');
  near(R.ewDensity(1, 20), 789.24, 0.01, 'ethanol 20 °C');
  near(R.ewDensity(R.massFractionFromAbv(40), 20), 948.05, 0.05, '40 %vol');
  near(R.ewDensity(R.massFractionFromAbv(10), 20), 984.71, 0.05, '10 %vol');
  near(R.waterDensity(15.556), 999.02, 0.02, 'water 60 °F');
});

test('boiling-point depression matches a wine-lab ebulliometer table', () => {
  const table = [[4.6, 4.01], [8.1, 6.41], [9.4, 7.21], [9.6, 7.32], [12.1, 8.71], [14.6, 9.91]];
  for (const [abv, dT] of table) near(R.boilingDepression(abv, 0, 1.01325), dT, 0.03, `${abv} %vol`);
});

test('alcoholmeter temperature correction', () => {
  near(R.alcoholmeterAbv(12, 20), 12, 0.001, 'at calibration temperature');
  near(R.alcoholmeterAbv(40, 25), 38.0, 0.3, '40 read at 25 °C');
  assert.ok(R.alcoholmeterAbv(12, 15) > 12, 'cold sample reads low');
  near(R.alcoholmeterAbv(80, 15.556, 'proof60'), 40, 0.1, '80 proof at 60 °F');
});

test('hydrometer scales round-trip', () => {
  for (const scale of Object.keys(R.HYDROMETER_SCALES)) {
    const rho = R.wineDensity(14, 45, 24);
    const reading = R.hydrometerReadingFor(rho, 24, scale);
    near(R.hydrometerDensity(reading, 24, scale), rho, 1e-6, scale);
  }
  near(R.hydrometerReadingFor(R.waterDensity(20), 20, 'sg20'), 1, 1e-9, 'water reads 1.000');
  near(R.hydrometerReadingFor(999.972, 15, 'smv15'), 0, 1e-6, 'SMV 0 = 4 °C water density');
});

const cases = [[6, 70], [8, 30], [12, 25], [15.5, 40], [19, 60], [14, 160]];

test('hydrometer + refractometer recovers ABV and extract', () => {
  for (const [abv, extract] of cases) {
    const T = 24;
    const s = R.solve([
      { kind: 'density', T, value: R.wineDensity(abv, extract, T), sigma: 0.5 },
      { kind: 'brix', value: R.wineBrix(abv, extract), sigma: 0.1 }
    ]);
    near(s.abv, abv, 0.01, `abv ${abv}/${extract}`);
    near(s.extract, extract, 0.1, `extract ${abv}/${extract}`);
    assert.ok(s.extractDetermined);
    assert.ok(s.abvSigma > 0.1 && s.abvSigma < 0.5, `sigma ${s.abvSigma}`);
  }
});

test('boil-off with hydrometer, by volume and by weight', () => {
  for (const [abv, extract] of cases) {
    for (const restore of ['volume', 'mass']) {
      const e2 = R.residueExtract(abv, extract, restore, 1);
      const s = R.solve([
        { kind: 'density', T: 22, value: R.wineDensity(abv, extract, 22), sigma: 0.5 },
        { kind: 'residueDensity', T: 26, restore, massRatio: 1, value: R.waterDensity(26) + R.extractDensityIncrement(e2), sigma: 0.5 }
      ]);
      near(s.abv, abv, 0.01, `${restore} ${abv}/${extract}`);
      near(s.extract, extract, 0.1, `${restore} extract`);
    }
  }
});

test('boil-off with refractometer only', () => {
  for (const [abv, extract] of cases) {
    const s = R.solve([
      { kind: 'brix', value: R.wineBrix(abv, extract), sigma: 0.1 },
      { kind: 'residueBrix', restore: 'mass', massRatio: 1, value: R.brixFromExtractGL(R.residueExtract(abv, extract, 'mass', 1)), sigma: 0.1 }
    ]);
    near(s.abv, abv, 0.02, `${abv}/${extract}`);
  }
});

test('boiling point with altitude, dilution and Brix', () => {
  const p = R.pressureFromWaterBoilingPoint(94.2);
  for (const [abv, extract] of cases) {
    const s = R.solve([
      { kind: 'boil', p, dilution: 1, value: R.boilingDepression(abv / 2, extract / 2, p), sigma: 0.1 },
      { kind: 'brix', value: R.wineBrix(abv, extract), sigma: 0.1 }
    ]);
    near(s.abv, abv, 0.02, `${abv}/${extract}`);
    near(s.extract, extract, 1, `extract ${abv}/${extract}`);
  }
});

test('distillate alcoholmeter reading gives ABV directly', () => {
  const s = R.solve([{ kind: 'abv', value: R.alcoholmeterAbv(13, 18), sigma: 0.5 }]);
  near(s.abv, R.alcoholmeterAbv(13, 18), 1e-3);
  assert.equal(s.extractDetermined, false);
});

test('agrees with the Vinolab wine formula for typical wines', () => {
  const vinolab = (b, sg) => 1.646 * b - 2.703 * (145 - 145 / sg) - 1.794;
  for (const [abv, extract] of [[10, 25], [12, 25], [12, 60], [15, 40], [18, 40], [18, 100]]) {
    const sg = R.wineDensity(abv, extract, 20) / R.waterDensity(20);
    near(vinolab(R.wineBrix(abv, extract), sg), abv, 0.6, `${abv}/${extract}`);
  }
});

test('alcohol calibration factor', () => {
  near(R.alcoholScaleFromTest(10, R.ethanolBrixEquivalent(10)), 1, 1e-6);
  const k = R.alcoholScaleFromTest(10, 3.0);
  assert.ok(k < 1);
  const s = R.solve([
    { kind: 'density', T: 20, value: R.wineDensity(12, 30, 20), sigma: 0.5 },
    { kind: 'brix', alcoholScale: k, value: R.wineBrix(12, 30, k), sigma: 0.1 }
  ]);
  near(s.abv, 12, 0.01);
});

test('contradictory boil-off readings are flagged', () => {
  const s = R.solve([
    { kind: 'density', T: 20, value: R.wineDensity(12, 30, 20), sigma: 0.5 },
    { kind: 'residueDensity', T: 20, restore: 'volume', value: R.waterDensity(20) + R.extractDensityIncrement(30), sigma: 0.5 },
    { kind: 'brix', value: R.wineBrix(12, 30) + 2, sigma: 0.1 },
    { kind: 'residueBrix', restore: 'volume', value: R.brixFromExtractGL(30), sigma: 0.1 }
  ]);
  assert.ok(s.flags.includes('inconsistent'), JSON.stringify(s.flags));
});

test('describe gives plausible derived numbers', () => {
  const d = R.describe(12, 25);
  near(d.sg, 0.9938, 0.0005, 'SG');
  assert.ok(d.equivalentOG > 1.078 && d.equivalentOG < 1.092, `OG ${d.equivalentOG}`);
  const sake = R.describe(15.5, 40);
  assert.ok(sake.sakeMeterValue > 0 && sake.sakeMeterValue < 15, `SMV ${sake.sakeMeterValue}`);
});
