/*
 * Rice wine ABV engine: estimates alcohol (%ABV) and dissolved extract (g/L)
 * of a finished wine WITHOUT an original gravity, from readings taken on the
 * finished wine with cheap instruments (hydrometer, Brix refractometer,
 * thermometer, alcoholmeter).
 *
 * Model
 *   A wine is treated as "an alcohol-water solution with the same ABV" plus
 *   "a sugar solution with the same extract (g/L)". Their effects on density
 *   and refractive index are added (Tabarié's rule, the oenology standard for
 *   relating wine, distillate and dealcoholised-wine densities). Two unknowns
 *   (ABV, extract) are fitted to whatever readings are supplied by weighted
 *   least squares, which also yields an uncertainty from reading precision.
 *
 * Data sources
 *   - Ethanol-water density vs mass fraction and temperature: OIML R22 (1975)
 *     International Alcoholometric Tables formula (coefficients as in EU
 *     Directive 76/766/EEC).
 *   - Sucrose solutions: SG(20/20) from °Brix via the ASBC/Lincoln equation;
 *     refractive index from a cubic fit to the ICUMSA nD(20 °C) table
 *     (max residual 1.2e-5).
 *   - Ethanol-water refractive index at 20 °C: cubic fit to the CRC Handbook
 *     table, 0-20 % w/w (residuals within table rounding, 5e-5).
 *   - Boiling points: NRTL activity model for ethanol-water (Aspen VLE-IG
 *     parameters) with NIST Antoine vapour pressures, scaled by a small factor
 *     so it reproduces a wine-lab ebulliometer table to within 0.02 °C.
 *     Dissolved extract is treated as an ideal non-volatile solute.
 *
 * Works in the browser (global `RiceABV`) and in Node (`require`).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RiceABV = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Ethanol-water density, OIML R22. p = mass fraction ethanol, t = °C.
  // Each row is a polynomial in (t - 20), highest power first; the rows
  // themselves are the coefficients of a polynomial in p (p^11 ... p^0).
  // ---------------------------------------------------------------------------
  const OIML = [
    [1.285617841998974e3, -3.903285426e4],
    [7.442971530188783, -7.420201433430137e3, 2.234460334e5],
    [-5.411227621436812e-1, -4.414153236817392e1, 1.852373922069467e4, -5.478461354e5],
    [2.458043105903461, 1.08043594285623e2, -2.605562982188164e4, 7.470172998e5],
    [-4.672147440794683, -1.422753946421155e2, 2.248646550400788e4, -6.138381234e5],
    [4.810060584300675, 1.09635566657757e2, -1.210164659068747e4, 3.062874042e5],
    [-2.895696483903638, -5.029988758547014e1, 3.924090430035045e3, -8.829278388e4],
    [-1.51578483698721e-6, 1.02299296671922, 1.353034988843029e1, -7.047478054272792e2, 1.352215441e4],
    [6.515031360099368e-6, -2.002561813734156e-1, -2.170575700536993, 7.196353469546523e1, -1.668103923e3],
    [1.345612883493354e-8, -8.76305857347111e-6, 1.876837790289664e-2, 2.517399633803461e-1, -1.046914743455169e1, 3.891238958e2],
    [-2.788074354782409e-8, 4.075376675622027e-6, -6.802995733503803e-4, -1.19301300505701e-2, 1.693433461530087e-1, -1.929769495e2],
    [-9.9739231e-11, 7.169354e-9, -3.8957702e-7, 3.6130013e-5, -5.2682542e-3, -2.0618513e-1, 9.9820123e2]
  ];

  function horner(coeffs, v) {
    let acc = 0;
    for (let i = 0; i < coeffs.length; i++) acc = acc * v + coeffs[i];
    return acc;
  }

  /** Density of an ethanol-water mixture, kg/m³ (= g/L). */
  function ewDensity(p, t) {
    const dt = t - 20;
    return horner(OIML.map((row) => horner(row, dt)), p);
  }

  function waterDensity(t) {
    return ewDensity(0, t);
  }

  const RHO_W20 = waterDensity(20); // 998.20 g/L
  const RHO_E20 = ewDensity(1, 20); // 789.24 g/L

  /** Generic monotone bisection: finds x in [lo, hi] with f(x) = target. */
  function bisect(f, target, lo, hi, iters) {
    const flo = f(lo) - target;
    let a = lo;
    let b = hi;
    for (let i = 0; i < (iters || 60); i++) {
      const m = (a + b) / 2;
      const fm = f(m) - target;
      if ((fm < 0) === (flo < 0)) a = m;
      else b = m;
    }
    return (a + b) / 2;
  }

  /** %ABV (volume of ethanol at tRef per volume of mixture at tRef). */
  function abvFromMassFraction(p, tRef) {
    const t = tRef === undefined ? 20 : tRef;
    return (100 * p * ewDensity(p, t)) / ewDensity(1, t);
  }

  function massFractionFromAbv(abv, tRef) {
    if (abv <= 0) return 0;
    return bisect((p) => abvFromMassFraction(p, tRef), abv, 0, 1, 50);
  }

  /** Mass fraction of an ethanol-water mixture with density rho (kg/m³) at t °C. */
  function massFractionFromDensity(rho, t) {
    return bisect((p) => -ewDensity(p, t), -rho, 0, 1, 50);
  }

  // ---------------------------------------------------------------------------
  // Sugar / extract (sucrose-equivalent)
  // ---------------------------------------------------------------------------
  /** Specific gravity (20/20) of a sucrose solution of `brix` °Brix. */
  function sucroseSG(brix) {
    return 1 + brix / (258.6 - (brix / 258.2) * 227.1);
  }

  /** Grams of sugar per litre of a `brix` °Brix solution. */
  function extractGLFromBrix(brix) {
    return (brix / 100) * sucroseSG(brix) * RHO_W20;
  }

  function brixFromExtractGL(gl) {
    if (gl <= 0) return 0;
    return bisect(extractGLFromBrix, gl, 0, 85, 50);
  }

  function brixFromSG(sg) {
    if (sg <= 1) return 0;
    return bisect(sucroseSG, sg, 0, 85, 50);
  }

  /** How much `gl` g/L of extract raises density, kg/m³. */
  function extractDensityIncrement(gl) {
    return (sucroseSG(brixFromExtractGL(gl)) - 1) * RHO_W20;
  }

  // ---------------------------------------------------------------------------
  // Refractive index (nD, 20 °C)
  // ---------------------------------------------------------------------------
  const N_WATER = 1.33299;
  const SUCROSE_N = [1.78217e-8, 5.390476e-6, 1.4276147e-3, 0]; // Δn vs °Brix
  const ETHANOL_N = [-3.016187e-7, 1.3327256e-5, 5.5050785e-4, 0]; // Δn vs % w/w

  function sucroseDeltaN(brix) {
    return horner(SUCROSE_N, brix);
  }

  function brixFromDeltaN(dn) {
    return bisect(sucroseDeltaN, dn, -5, 85, 50);
  }

  /** What a sucrose-calibrated refractometer shows for an ethanol-water mix. */
  function ethanolBrixEquivalent(abv) {
    return brixFromDeltaN(horner(ETHANOL_N, 100 * massFractionFromAbv(abv)));
  }

  // ---------------------------------------------------------------------------
  // Wine model: state = (abv %vol at 20 °C, extract g/L at 20 °C)
  // ---------------------------------------------------------------------------
  /** Density of the wine at t °C, kg/m³ (Tabarié: alcohol part + extract part). */
  function wineDensity(abv, extract, t) {
    return ewDensity(massFractionFromAbv(abv), t) + extractDensityIncrement(extract);
  }

  /**
   * True (sucrose-scale) refractometer reading of the wine, °Brix.
   * alcoholScale rescales ethanol's contribution (from a calibration with a
   * known alcohol mix); 1 = handbook value.
   */
  function wineBrix(abv, extract, alcoholScale) {
    const k = alcoholScale > 0 ? alcoholScale : 1;
    const dn =
      k * horner(ETHANOL_N, 100 * massFractionFromAbv(abv)) +
      sucroseDeltaN(brixFromExtractGL(extract));
    return brixFromDeltaN(dn);
  }

  /** Alcohol scale factor from the Brix reading of a sugar-free mix of known %ABV. */
  function alcoholScaleFromTest(testAbv, brixReading) {
    const expected = horner(ETHANOL_N, 100 * massFractionFromAbv(testAbv));
    return expected > 0 ? sucroseDeltaN(brixReading) / expected : 1;
  }

  /**
   * Extract concentration of the boiled-off sample after it was topped back up.
   * restore = 'volume': back to the original volume (concentration unchanged).
   * restore = 'mass':   back to `massRatio` × the original weight (1 = same weight).
   */
  function residueExtract(abv, extract, restore, massRatio) {
    if (restore !== 'mass') return extract;
    const ratio = massRatio > 0 ? massRatio : 1;
    const rhoWine = wineDensity(abv, extract, 20);
    let e2 = extract;
    for (let i = 0; i < 8; i++) {
      const rhoRes = RHO_W20 + extractDensityIncrement(e2);
      e2 = (extract * rhoRes) / (rhoWine * ratio);
    }
    return e2;
  }

  // ---------------------------------------------------------------------------
  // Boiling point (ebulliometry)
  // ---------------------------------------------------------------------------
  const MW_ETHANOL = 46.069;
  const MW_WATER = 18.015;
  const MW_EXTRACT = 180.16; // glucose; rice-wine extract is mostly glucose

  /** Vapour pressures in bar, T in K (NIST: Ambrose & Sprake; Bridgeman & Aldrich). */
  function pEthanol(T) {
    return Math.pow(10, 5.24677 - 1598.673 / (T - 46.424));
  }
  function pWater(T) {
    return Math.pow(10, 5.08354 - 1663.125 / (T - 45.622));
  }

  /** NRTL activity coefficients, ethanol (1) / water (2). */
  function nrtl(x1, T) {
    const x2 = 1 - x1;
    const t12 = -0.8009 + 246.18 / T;
    const t21 = 3.4578 - 586.0809 / T;
    const G12 = Math.exp(-0.3 * t12);
    const G21 = Math.exp(-0.3 * t21);
    const d1 = x1 + x2 * G21;
    const d2 = x2 + x1 * G12;
    const ln1 = x2 * x2 * (t21 * (G21 / d1) * (G21 / d1) + (t12 * G12) / (d2 * d2));
    const ln2 = x1 * x1 * (t12 * (G12 / d2) * (G12 / d2) + (t21 * G21) / (d1 * d1));
    return [Math.exp(ln1), Math.exp(ln2)];
  }

  /** Bubble point (K) of ethanol mole fraction x1 (solute-free) with solute mole fraction xs. */
  function bubblePointK(x1, xs, pBar) {
    const f = (T) => {
      const g = nrtl(x1, T);
      return (1 - xs) * (x1 * g[0] * pEthanol(T) + (1 - x1) * g[1] * pWater(T));
    };
    return bisect(f, pBar, 320, 400, 50);
  }

  /** Pressure (bar) at which pure water boils at `tC` °C. */
  function pressureFromWaterBoilingPoint(tC) {
    return pWater(tC + 273.15);
  }

  function liquidComposition(abv, extract) {
    const total = wineDensity(abv, extract, 20); // g/L
    const ethanol = abv * 10 * (RHO_E20 / 1000); // g/L
    const water = Math.max(total - ethanol - extract, 1);
    const ne = ethanol / MW_ETHANOL;
    const nw = water / MW_WATER;
    const ns = extract / MW_EXTRACT;
    return { x1: ne / (ne + nw), xs: ns / (ne + nw + ns) };
  }

  // Wine-lab ebulliometer tables show slightly more depression than the
  // thermodynamic model (≈2.5 % at 14.6 %vol). Scale the alcohol part by
  // 1 + K·min(abv, 14.6). Beyond the table the factor is held constant.
  const EBULLIO_K = 0.0017;
  const EBULLIO_MAX = 14.6;

  /** Boiling-point depression below pure water, °C, for a wine at pressure pBar. */
  function boilingDepression(abv, extract, pBar) {
    const tWater = bubblePointK(0, 0, pBar);
    const c0 = liquidComposition(abv, 0);
    const tAlcohol = bubblePointK(c0.x1, 0, pBar);
    let depression = (1 + EBULLIO_K * Math.min(Math.max(abv, 0), EBULLIO_MAX)) * (tWater - tAlcohol);
    if (extract > 0) {
      const c = liquidComposition(abv, extract);
      depression -= bubblePointK(c.x1, c.xs, pBar) - tAlcohol;
    }
    return depression;
  }

  // ---------------------------------------------------------------------------
  // Instrument readings → physical quantities
  // ---------------------------------------------------------------------------
  const BETA_GLASS = 25e-6; // cubic expansion of hydrometer glass, 1/°C (OIML)

  const HYDROMETER_SCALES = {
    sg20: { label: 'SG, calibrated 20 °C', calT: 20, mark: (r) => r * RHO_W20 },
    sg15: { label: 'SG, calibrated 15.6 °C / 60 °F', calT: 15.556, mark: (r) => r * waterDensity(15.556) },
    density20: { label: 'Density g/mL, 20 °C', calT: 20, mark: (r) => r * 1000 },
    smv15: { label: 'Sake meter value (Nihonshu-do), 15 °C', calT: 15, mark: (r) => (1443 / (1443 + r)) * 999.972 },
    brix20: { label: '°Brix / °Plato hydrometer, 20 °C', calT: 20, mark: (r) => sucroseSG(r) * RHO_W20 }
  };

  /** Density of the liquid (kg/m³) at its temperature tC, from a hydrometer reading. */
  function hydrometerDensity(reading, tC, scale) {
    const s = HYDROMETER_SCALES[scale || 'sg20'];
    return s.mark(reading) / (1 + BETA_GLASS * (tC - s.calT));
  }

  /** Inverse of hydrometerDensity: what the hydrometer shows in liquid of density rho at tC. */
  function hydrometerReadingFor(rho, tC, scale) {
    const key = scale || 'sg20';
    const ranges = { sg20: [0.9, 1.2], sg15: [0.9, 1.2], density20: [0.9, 1.2], smv15: [-150, 150], brix20: [-5, 45] };
    const r = ranges[key];
    return bisect((x) => hydrometerDensity(x, tC, key), rho, r[0], r[1], 60);
  }

  const ALCOHOLMETER_SCALES = {
    abv20: { label: '% ABV, calibrated 20 °C', calT: 20, toAbv: (r) => r },
    abv15: { label: '% ABV, calibrated 15.6 °C / 60 °F', calT: 15.556, toAbv: (r) => r },
    proof60: { label: 'US proof, 60 °F', calT: 15.556, toAbv: (r) => r / 2 }
  };

  /** True %ABV at 20 °C of an ethanol-water liquid from an alcoholmeter reading at tC. */
  function alcoholmeterAbv(reading, tC, scale) {
    const s = ALCOHOLMETER_SCALES[scale || 'abv20'];
    const pMark = massFractionFromAbv(s.toAbv(reading), s.calT);
    const rhoMark = ewDensity(pMark, s.calT);
    const rhoLiquid = rhoMark / (1 + BETA_GLASS * (tC - s.calT));
    return abvFromMassFraction(massFractionFromDensity(rhoLiquid, tC), 20);
  }

  // ---------------------------------------------------------------------------
  // Fitting
  // ---------------------------------------------------------------------------
  /*
   * Observation kinds (value and sigma in the same units):
   *   density         wine density at T, kg/m³                 {T}
   *   brix            wine refractometer reading, °Brix         {wcf, alcoholScale}
   *   residueDensity  boiled-off + topped-up sample, kg/m³ at T {T, restore, massRatio}
   *   residueBrix     boiled-off + topped-up sample, °Brix      {wcf, restore, massRatio}
   *   boil            boiling-point depression, °C              {p, dilution}
   *   abv             direct %ABV (e.g. distillate)
   *   extractPrior    a guess at extract, g/L
   */
  function predict(o, abv, extract) {
    switch (o.kind) {
      case 'density':
        return wineDensity(abv, extract, o.T);
      case 'brix':
        return (o.wcf || 1) * wineBrix(abv, extract, o.alcoholScale);
      case 'residueDensity':
        return waterDensity(o.T) + extractDensityIncrement(residueExtract(abv, extract, o.restore, o.massRatio));
      case 'residueBrix':
        return (o.wcf || 1) * brixFromExtractGL(residueExtract(abv, extract, o.restore, o.massRatio));
      case 'boil': {
        const k = o.dilution || 0; // parts water added per part wine
        return boilingDepression(abv / (1 + k), extract / (1 + k), o.p);
      }
      case 'abv':
        return abv;
      case 'extractPrior':
        return extract;
      default:
        throw new Error('Unknown observation kind: ' + o.kind);
    }
  }

  const ABV_MAX = 30;
  const EXTRACT_MAX = 450;

  /**
   * Fit (abv, extract) to the observations. Returns estimates, 1-sigma
   * uncertainties from reading precision, and a consistency statistic.
   */
  function solve(observations, options) {
    const opts = options || {};
    const prior = opts.prior || { kind: 'extractPrior', value: 30, sigma: 1000 };
    const obs = observations.concat([prior]);
    const lo = [0, 0];
    const hi = [ABV_MAX, EXTRACT_MAX];
    const clamp = (x) => [0, 1].map((i) => Math.min(hi[i], Math.max(lo[i], x[i])));
    const res = (x) => obs.map((o) => (predict(o, x[0], x[1]) - o.value) / o.sigma);
    const cost = (r) => r.reduce((s, v) => s + v * v, 0);
    const jac = (x, r0) => {
      const h = [1e-4, 1e-3];
      return [0, 1].map((j) => {
        const xp = x.slice();
        xp[j] += h[j];
        const rp = res(xp);
        return rp.map((v, i) => (v - r0[i]) / h[j]);
      });
    };

    let x = clamp(opts.start || [10, 30]);
    let r = res(x);
    let c = cost(r);
    let lambda = 1e-3;
    let J = jac(x, r);
    for (let iter = 0; iter < 100; iter++) {
      // Normal equations (2x2), J stored column-wise.
      const a00 = dot(J[0], J[0]);
      const a01 = dot(J[0], J[1]);
      const a11 = dot(J[1], J[1]);
      const g0 = dot(J[0], r);
      const g1 = dot(J[1], r);
      let improved = false;
      for (let tries = 0; tries < 12; tries++) {
        const m00 = a00 * (1 + lambda) + 1e-12;
        const m11 = a11 * (1 + lambda) + 1e-12;
        const det = m00 * m11 - a01 * a01;
        const d0 = -(m11 * g0 - a01 * g1) / det;
        const d1 = -(m00 * g1 - a01 * g0) / det;
        const xn = clamp([x[0] + d0, x[1] + d1]);
        const rn = res(xn);
        const cn = cost(rn);
        if (cn <= c) {
          const step = Math.abs(xn[0] - x[0]) + Math.abs(xn[1] - x[1]) / 10;
          x = xn;
          r = rn;
          c = cn;
          lambda = Math.max(lambda / 4, 1e-9);
          improved = step > 1e-9;
          break;
        }
        lambda *= 8;
      }
      if (!improved) break;
      J = jac(x, r);
    }

    J = jac(x, r);
    const a00 = dot(J[0], J[0]);
    const a01 = dot(J[0], J[1]);
    const a11 = dot(J[1], J[1]);
    const det = a00 * a11 - a01 * a01;
    const abvSigma = Math.sqrt(a11 / det);
    const extractSigma = Math.sqrt(a00 / det);

    const residuals = r.slice(0, observations.length);
    const chi2 = residuals.reduce((s, v) => s + v * v, 0);
    const extractDetermined = extractSigma < prior.sigma * 0.5;
    const dof = observations.length - (extractDetermined ? 2 : 1);

    const flags = [];
    if (x[0] <= 0.05) flags.push('abv-floor');
    if (x[0] >= ABV_MAX - 0.05) flags.push('abv-ceiling');
    if (extractDetermined && x[1] <= 0.5 && chi2 > 1) flags.push('extract-floor');
    if (dof > 0 && chi2 / dof > 4) flags.push('inconsistent');
    if (x[1] >= EXTRACT_MAX - 1) flags.push('extract-ceiling');

    return {
      abv: x[0],
      abvSigma: abvSigma,
      extract: x[1],
      extractSigma: extractSigma,
      extractDetermined: extractDetermined,
      chi2: chi2,
      dof: dof,
      residuals: residuals,
      flags: flags
    };
  }

  function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  /** Handy derived numbers for a fitted (abv, extract). */
  function describe(abv, extract) {
    const rho20 = wineDensity(abv, extract, 20);
    const ethanolGL = abv * 10 * (RHO_E20 / 1000);
    // Balling: 2.0665 g extract → 1 g ethanol + 0.9565 g CO2 + 0.11 g yeast.
    const ethanolPct = (100 * ethanolGL) / rho20; // % w/w
    const realExtract = (100 * extract) / rho20; // °P
    const originalExtract = (100 * (2.0665 * ethanolPct + realExtract)) / (100 + 1.0665 * ethanolPct);
    const rho15 = wineDensity(abv, extract, 15);
    return {
      sg: rho20 / RHO_W20,
      ethanolGL: ethanolGL,
      ethanolPctMass: ethanolPct,
      extractBrix: brixFromExtractGL(extract),
      originalExtract: originalExtract,
      equivalentOG: sucroseSG(originalExtract),
      sakeMeterValue: (999.972 / rho15 - 1) * 1443,
      refractometerBrix: wineBrix(abv, extract)
    };
  }

  const cToF = (c) => (c * 9) / 5 + 32;
  const fToC = (f) => ((f - 32) * 5) / 9;

  return {
    ewDensity,
    waterDensity,
    abvFromMassFraction,
    massFractionFromAbv,
    massFractionFromDensity,
    sucroseSG,
    brixFromSG,
    extractGLFromBrix,
    brixFromExtractGL,
    extractDensityIncrement,
    ethanolBrixEquivalent,
    alcoholScaleFromTest,
    wineDensity,
    wineBrix,
    residueExtract,
    boilingDepression,
    pressureFromWaterBoilingPoint,
    hydrometerDensity,
    hydrometerReadingFor,
    alcoholmeterAbv,
    HYDROMETER_SCALES,
    ALCOHOLMETER_SCALES,
    predict,
    solve,
    describe,
    cToF,
    fToC
  };
});
