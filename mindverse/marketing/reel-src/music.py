# Synthesize a ~30 s ambient-electronic bed for the reel (no samples, no licensing).
# Am - F - C - G pad, sub bass, soft kick + hats from 3 s, riser into the outro.
import numpy as np, wave, sys

SR = 44100
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 29.5
BPM = 96
beat = 60 / BPM
t = np.arange(int(SR * DUR)) / SR
out = np.zeros((len(t), 2))

def note(m):  # midi -> Hz
    return 440 * 2 ** ((m - 69) / 12)

def env(n, a, r):
    e = np.ones(n)
    ai, ri = int(a * SR), int(r * SR)
    e[:ai] = np.linspace(0, 1, ai) if ai else 1
    if ri: e[-ri:] *= np.linspace(1, 0, ri)
    return e

rng = np.random.default_rng(7)
chords = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]]  # Am F C G
bar = beat * 4
# pad: detuned saws softened by a crude low-pass
for i in range(int(DUR / bar) + 1):
    start = i * bar
    s0 = int(start * SR)
    n = min(int((bar + 0.6) * SR), len(t) - s0)
    if n <= 0: break
    tt = np.arange(n) / SR
    sig = np.zeros(n)
    for m in chords[i % 4]:
        for det in (-0.08, 0.0, 0.08):
            f = note(m + det)
            sig += ((tt * f) % 1.0 - 0.5) * 0.5 + np.sin(2 * np.pi * f * tt)
    # one-pole low-pass, cutoff opening over the track
    cutoff = 600 + 2400 * min(1, start / 20)
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.zeros(n); acc = 0.0
    for k in range(n):
        acc = (1 - a) * sig[k] + a * acc
        y[k] = acc
    y *= env(n, 0.5, 0.6) * 0.035
    out[s0:s0 + n, 0] += y * 0.9
    out[s0:s0 + n, 1] += y * 1.1
    # sub bass on the root
    f = note(chords[i % 4][0] - 24)
    b = np.sin(2 * np.pi * f * tt) * env(n, 0.05, 0.3) * 0.12
    if start >= 3: out[s0:s0 + n] += b[:, None]

# drums from 3 s until the outro
for k in range(int(DUR / (beat / 2))):
    st = k * beat / 2
    if st < 3.0 or st > DUR - 3.2: continue
    s0 = int(st * SR)
    if k % 2 == 0:  # kick
        n = int(0.35 * SR); tt = np.arange(n) / SR
        f = 50 + 90 * np.exp(-tt * 30)
        kick = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 9) * 0.5
        out[s0:s0 + n] += kick[: len(out) - s0, None]
    n = int(0.05 * SR)  # hat
    hat = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * 90) * (0.05 if k % 2 else 0.025)
    hat = np.diff(hat, prepend=0)
    out[s0:s0 + n, 0] += hat[: len(out) - s0] * 0.8
    out[s0:s0 + n, 1] += hat[: len(out) - s0] * 1.2

# whoosh at each scene cut (times passed in argv[3] as comma list)
cuts = [float(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 else []
for c in cuts:
    n = int(0.6 * SR); s0 = int((c - 0.45) * SR)
    if s0 < 0: continue
    noise = rng.standard_normal(n)
    sw = np.sin(np.linspace(0, np.pi, n)) ** 2 * 0.06
    y = np.convolve(noise, np.ones(12) / 12, mode='same') * sw
    out[s0:s0 + n] += y[: len(out) - s0, None]

# master: gentle fade in/out, soft clip
fade = np.ones(len(t)); fi = int(0.4 * SR); fo = int(1.5 * SR)
fade[:fi] = np.linspace(0, 1, fi); fade[-fo:] = np.linspace(1, 0, fo)
out *= fade[:, None]
out = np.tanh(out * 1.6) * 0.8
pcm = (out * 32767).astype('<i2')
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('wrote', sys.argv[1], DUR, 's')
