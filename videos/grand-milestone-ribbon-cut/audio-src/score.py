"""Original score + scissors snip for the Grand Milestone ribbon-cut intro.

Deterministic synthesis (fixed RNG seed). Writes float32 stereo WAVs:
  <out>/score.wav  — music bed, 10.0s, timed to the picture's beats
  <out>/snip.wav   — synthesized scissors snip (one-shot)
Beat map (seconds): ribbon 0.1 · motif 0.25+0.45k · CUT 2.95 · title 4.85 ·
details 6.15 / 7.6 · brand 8.75 · end 10.0
"""

import sys
import wave

import numpy as np

SR = 48000
DUR = 10.0
N = int(SR * DUR)
CUT = 2.95
rng = np.random.default_rng(20261012)
t_all = np.arange(N) / SR


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env_ar(n, attack, release, total):
    """Raised-cosine attack/release envelope over n samples."""
    t = np.arange(n) / SR
    e = np.ones(n)
    a = max(attack, 1e-4)
    m = t < a
    e[m] = 0.5 - 0.5 * np.cos(np.pi * t[m] / a)
    r0 = total - release
    m = t > r0
    e[m] *= 0.5 + 0.5 * np.cos(np.pi * np.clip((t[m] - r0) / max(release, 1e-4), 0, 1))
    return e


def place(buf, sig, start):
    i = int(round(start * SR))
    if i >= buf.shape[-1]:
        return
    j = min(buf.shape[-1], i + sig.shape[-1])
    buf[..., i:j] += sig[..., : j - i]


def pan2(mono, pan):
    """Equal-power pan, pan in [-1, 1]."""
    a = (pan + 1) * np.pi / 4
    return np.stack([mono * np.cos(a), mono * np.sin(a)])


def pad(notes, t0, t1, amp, attack, release, bright0=2.5, bright1=None):
    """Warm string-ish pad: additive harmonics, two detuned voices panned wide."""
    n = int((t1 - t0) * SR)
    t = np.arange(n) / SR
    bright1 = bright0 if bright1 is None else bright1
    b = bright0 + (bright1 - bright0) * np.clip(t / max(t1 - t0, 1e-3), 0, 1)
    out = np.zeros((2, n))
    for k, m in enumerate(notes):
        f = hz(m)
        for side, cents in ((0, -6), (1, 6)):
            fv = f * 2 ** (cents / 1200)
            vib = 1 + 0.0012 * np.sin(2 * np.pi * (0.17 + 0.03 * k) * t + k)
            ph = 2 * np.pi * fv * np.cumsum(vib) / SR
            v = np.zeros(n)
            for h in range(1, 11):
                if fv * h > 9000:
                    break
                if fv * h < 110:
                    continue
                v += (1 / h**1.5) * np.exp(-(h - 1) / b) * np.sin(h * ph + 0.7 * h * k)
            out[side] += v / len(notes)
    return out * amp * env_ar(n, attack, release, t1 - t0)


def bell(m, amp, dur=2.6, ratio=3.5, index=2.6):
    """Glassy FM bell / celesta."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m)
    idx = index * np.exp(-t / 0.22)
    sig = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * ratio * t))
    sig += 0.25 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.35)
    e = np.exp(-t / 0.9) * np.minimum(1, t / 0.003)
    return sig * e * amp


def pluck(m, amp, dur=1.8):
    """Harp-like pluck: decaying harmonics, upper ones die faster."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m)
    sig = np.zeros(n)
    for h in range(1, 9):
        if f * h > 10000:
            break
        sig += (1 / h) * np.exp(-t * (1.2 + 0.9 * h)) * np.sin(2 * np.pi * f * h * t + h)
    return sig * np.minimum(1, t / 0.002) * amp


def band_noise(n, lo, hi):
    x = rng.standard_normal(n)
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(n, 1 / SR)
    X[(fr < lo) | (fr > hi)] = 0
    y = np.fft.irfft(X, n)
    return y / (np.max(np.abs(y)) + 1e-9)


def reverb_ir(seconds=2.2, predelay=0.02):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.zeros((2, n + int(predelay * SR)))
    for c in range(2):
        x = rng.standard_normal(n) * np.exp(-6.9 * t / seconds)
        X = np.fft.rfft(x)
        fr = np.fft.rfftfreq(n, 1 / SR)
        X *= 1 / (1 + (fr / 5500) ** 2)  # darker tail
        ir[c, int(predelay * SR):] = np.fft.irfft(X, n)
    return ir / np.sqrt(np.sum(ir**2) / 2)


def convolve(sig, ir):
    L = sig.shape[1] + ir.shape[1]
    nfft = 1 << (L - 1).bit_length()
    out = np.zeros((2, sig.shape[1]))
    for c in range(2):
        y = np.fft.irfft(np.fft.rfft(sig[c], nfft) * np.fft.rfft(ir[c], nfft), nfft)
        out[c] = y[: sig.shape[1]]
    return out


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    pcm = (x.T * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def score():
    dry = np.zeros((2, N))  # pads, bass — little reverb
    wet = np.zeros((2, N))  # bells, plucks, air — generous reverb

    # ---- Act 1: anticipation (B minor 9), hushes just before the snip ----
    place(dry, pad([54, 57, 61, 62, 66], 0.0, 2.9, 0.16, 1.3, 0.35, 1.8, 2.6), 0.0)
    motif = [(78, 0.25), (83, 0.70), (81, 1.15), (86, 1.60), (85, 2.05), (81, 2.50)]
    for k, (m, at) in enumerate(motif):
        a = 0.13 if k < 5 else 0.08
        place(wet, pan2(bell(m, a), -0.35 + 0.14 * k), at)

    # reverse-cymbal air rising into the cut, cut dead at 2.93
    n = int(0.75 * SR)
    t = np.arange(n) / SR
    rev = band_noise(n, 3500, 14000) * (t / t[-1]) ** 3 * 0.11
    place(wet, np.stack([rev, np.roll(rev, 180)]), CUT - 0.02 - 0.75)

    # ---- The cut: D major bloom + sub drop + bell cascade ----
    n = int(1.8 * SR)
    t = np.arange(n) / SR
    f = 36.7 + 30 * np.exp(-t / 0.08)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.5) * 0.2
    place(dry, pan2(boom, 0), CUT)
    place(dry, pad([50, 54, 57, 62, 64, 69], CUT, 4.95, 0.34, 0.06, 0.25, 6.0, 3.0), CUT)
    cascade = [86, 81, 78, 76, 74, 69]
    for k, m in enumerate(cascade):
        place(wet, pan2(bell(m, 0.10 - 0.012 * k, ratio=1.4 if k % 2 else 3.5), 0.4 - 0.16 * k),
              CUT + 0.04 + 0.13 * k + 0.012 * k * k)

    # ---- Title onward: chord per text beat, harp arpeggio underneath ----
    chords = [
        (4.85, 6.25, [55, 59, 62, 66], [67, 71, 74, 78, 79, 83]),  # Gmaj7/D  — title
        (6.15, 7.70, [52, 55, 59, 62, 66], [64, 67, 71, 74, 76, 79]),  # Em9/D — detail A
        (7.60, 8.85, [52, 57, 62, 64], [69, 74, 76, 81, 76, 74]),  # Asus4 — detail B
    ]
    for t0, t1, voicing, arp in chords:
        place(dry, pad(voicing, t0, t1, 0.24, 0.35, 0.3, 3.0), t0)
        order = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1]
        k, at = 0, t0
        while at < t1 - 0.12:
            m = arp[order[k % len(order)]]
            place(wet, pan2(pluck(m, 0.11), -0.5 + 0.1 * (k % 10)), at)
            k, at = k + 1, at + 0.19
    # Asus4 → A: the 4th falls to the 3rd at 8.2
    place(dry, pad([61], 8.2, 8.85, 0.16, 0.2, 0.25, 3.0), 8.2)

    # bass line under it all
    for t0, t1, m in ((CUT, 4.95, 38), (4.85, 7.7, 38), (7.6, 8.85, 33), (8.75, 10.0, 38)):
        n = int((t1 - t0) * SR)
        tt = np.arange(n) / SR
        b = (np.sin(2 * np.pi * hz(m) * tt) + 0.3 * np.sin(4 * np.pi * hz(m) * tt)) * 0.06
        place(dry, pan2(b * env_ar(n, 0.15, 0.15, t1 - t0), 0), t0)

    # light-sweep air swell (5.6–6.9)
    n = int(1.4 * SR)
    t = np.arange(n) / SR
    sw = band_noise(n, 2500, 11000) * np.sin(np.pi * t / t[-1]) ** 2 * 0.05
    place(wet, np.stack([sw, np.roll(sw, 240)]), 5.55)

    # ---- Brand: resolve to D major 9, bell sting, ring out to 10.0 ----
    place(dry, pad([50, 54, 57, 61, 64, 69], 8.75, 10.0, 0.3, 0.12, 0.7, 3.5, 2.2), 8.75)
    for k, m in enumerate([78, 81, 86]):
        place(wet, pan2(bell(m, 0.13), -0.25 + 0.25 * k), 8.75 + 0.12 * k)
    place(wet, pan2(bell(93, 0.05, ratio=1.4), 0.3), 9.25)

    mix = dry + 0.55 * wet + convolve(0.18 * dry + 0.6 * wet, reverb_ir())
    # dynamics arc: hushed build -> full bloom at the snip -> settled under the copy -> lift on the brand
    keys = [(0.0, 0.55), (2.6, 0.62), (CUT - 0.01, 0.62), (CUT + 0.01, 1.0), (4.6, 1.0),
            (5.1, 0.78), (8.6, 0.78), (8.8, 1.0), (10.0, 1.0)]
    kt, kv = zip(*keys)
    mix *= np.interp(t_all, kt, kv)
    # gentle tail-out so the last frame lands on silence
    fade = np.clip((10.0 - t_all) / 0.45, 0, 1) ** 1.5
    mix *= fade
    return mix / (np.max(np.abs(mix)) + 1e-9) * 0.89


def snip():
    """Two blade strikes ~22ms apart: bright noise transient + inharmonic metal ring."""
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k, (at, a) in enumerate(((0.0, 1.0), (0.022, 0.7))):
        tt = np.clip(t - at, 0, None)
        on = (t >= at).astype(float)
        click = band_noise(n, 2500, 12000) * np.exp(-tt / 0.006) * on
        ring = sum(
            g * np.sin(2 * np.pi * fr * tt) * np.exp(-tt / d)
            for fr, g, d in ((3150, 0.5, 0.07), (4720, 0.35, 0.05), (6890, 0.25, 0.035), (9410, 0.15, 0.02))
        ) * on
        out += a * (0.9 * click + 0.45 * ring)
    # a short shear scrape leading into the strike
    pre = int(0.05 * SR)
    scrape = band_noise(pre, 4000, 11000) * np.linspace(0, 1, pre) ** 2 * 0.25
    out = np.concatenate([scrape, out])
    st = np.stack([out, np.roll(out, 36)])
    return st / np.max(np.abs(st)) * 0.89


if __name__ == "__main__":
    out = sys.argv[1]
    write_wav(f"{out}/score.wav", score())
    write_wav(f"{out}/snip.wav", snip())
    print("ok")
