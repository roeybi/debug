# Rice Wine ABV

A small offline web app that estimates the alcohol (% ABV) and sweetness of a
finished rice wine (makgeolli, sake, mijiu, tapai, tuak, sato) or any other
wine **without an original gravity**.

Rice wine never has a usable starting gravity: koji or nuruk turns starch into
sugar while the yeast is already turning that sugar into alcohol. So the app
works only from readings of the finished wine, using cheap instruments.

Open `index.html` in any browser (phone or desktop). No build step, no server,
no network needed apart from the web fonts.

## Methods

| Method | Instruments | Typical accuracy |
| --- | --- | --- |
| Hydrometer + refractometer | hydrometer, Brix refractometer | about ±0.6 % ABV |
| Boil-off test | hydrometer and/or refractometer, pot, kitchen scale or jug | about ±0.4 % with both instruments, ±0.6 % hydrometer only, ±0.8 % refractometer only |
| Boiling point | 0.1° digital thermometer | about ±0.4 % |
| Distill + alcoholmeter | small still, alcoholmeter | about ±0.3 % |

Each method also reports dissolved extract (g/L, mostly sugar) with a
sweetness label, the equivalent starting gravity, and the sake meter value
(Nihonshu-do) whenever the readings pin down the extract.

The ± figure combines the reading precision of your instruments (editable
under *Instrument settings*) with the typical error of the method.

## How it works

The wine is modelled as an alcohol–water mix with the same ABV plus a sugar
solution with the same extract. Their effects on density and refractive index
are added (Tabarié's rule, the standard oenology relationship between wine,
distillate and dealcoholised-wine density). The two unknowns, ABV and extract,
are fitted to every reading you enter by weighted least squares
(`solve()` in `abv.js`), which also gives the reading-precision uncertainty
and flags readings that contradict each other.

- **Hydrometer + refractometer:** alcohol lowers density but raises the
  refractive index; sugar raises both. Two readings, two unknowns.
- **Boil-off:** the boiled and topped-up sample keeps the sugar but loses the
  alcohol, so the before/after difference is the alcohol. Topping up by weight
  is handled exactly.
- **Boiling point:** boiling plain water first fixes thermometer offset and air
  pressure; the depression of the wine's boiling point gives the alcohol. An
  optional Brix reading corrects for sugar.
- **Distillation:** the alcoholmeter reading of the distillate is corrected to
  20 °C and scaled by the volume ratio.

Hydrometer readings are temperature-corrected using the real thermal expansion
of the alcohol–water mix (not just water) plus the expansion of the glass.
Supported hydrometer scales: SG at 20 °C, SG at 15.6 °C / 60 °F, density
g/mL, sake meter value (15 °C) and °Brix/°Plato. Alcoholmeter scales: % ABV at
20 °C or 60 °F, and US proof.

### Data sources

- Alcohol–water density vs strength and temperature: OIML R22 International
  Alcoholometric Tables formula (coefficients as in EU Directive 76/766/EEC).
- Sugar solutions: SG from °Brix (ASBC/Lincoln equation); refractive index from
  a cubic fit to the ICUMSA table.
- Alcohol–water refractive index at 20 °C: cubic fit to the CRC Handbook table.
- Boiling points: NRTL vapour–liquid model of ethanol–water (NIST Antoine
  vapour pressures), scaled by a small factor so it reproduces a wine-lab
  ebulliometer table to within 0.02 °C.

### Validation

`test/abv.test.js` checks the formulas against reference values (OIML
densities, the ebulliometer table, alcoholmeter temperature corrections),
round-trips every method from known wines, and compares the hydrometer +
refractometer model with the independent Vinolab wine formula (agreement
within 0.6 % ABV for 10–18 % wines).

Run the tests with Node 18+:

```sh
node --test rice-wine-abv/test/abv.test.js
```

## Limits

- The refractometer methods assume the extract refracts like glucose/sucrose
  (true for rice wine, sake and grape wine). Beer extract differs; set the
  extract factor to about 1.04 for beer. You can also calibrate your
  refractometer's response to alcohol with a known vodka/soju dilution.
- Cloudy and fizzy samples must be settled/filtered and degassed first.
- Above about 22 % ABV the readings are outside what fermentation produces and
  the boiling-point calibration is extrapolated.

## Files

- `index.html` – the app page
- `app.js` – page logic (inputs, method tabs, rendering, saved readings)
- `abv.js` – calculation engine, usable in the browser (`window.RiceABV`) or Node (`require`)
- `test/abv.test.js` – tests
