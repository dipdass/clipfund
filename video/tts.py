import json, subprocess, wave, os, numpy as np
S = json.load(open("script.json")); OUT = "remotion/public/vo"; os.makedirs(OUT, exist_ok=True)
SR = 22050; GAP = 0.45; LEAD = 0.5; TAIL = 0.9
timeline = []; full = []; t = 0.0
for sc in S:
    segs = []; audio = [np.zeros(int(LEAD * SR), np.int16)]; cur = LEAD
    for i, (say, cap) in enumerate(sc["lines"]):
        f = f"/tmp/vo-{sc['id']}-{i}.wav"
        subprocess.run(["/workspace/.venv-tts/bin/piper", "-m", "/workspace/tts-voices/en_US-ryan-high.onnx", "--length_scale", "1.0", "-f", f], input=say.encode(), check=True, capture_output=True)
        w = wave.open(f); a = np.frombuffer(w.readframes(w.getnframes()), np.int16); w.close()
        d = len(a) / SR; segs.append({"start": cur, "end": cur + d, "text": cap}); audio += [a, np.zeros(int(GAP * SR), np.int16)]; cur += d + GAP
    dur = max(sc["min"], cur - GAP + TAIL)
    pad = int(dur * SR) - sum(len(x) for x in audio)
    if pad > 0: audio.append(np.zeros(pad, np.int16))
    a = np.concatenate(audio)[: int(dur * SR)]; full.append(a)
    timeline.append({"id": sc["id"], "start": round(t, 3), "dur": round(dur, 3), "segs": segs}); t += dur
w = wave.open(f"{OUT}/voice.wav", "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(np.concatenate(full).tobytes()); w.close()
json.dump({"total": round(t, 3), "scenes": timeline}, open("remotion/src/timeline.json", "w"), indent=1)
print("total", round(t, 1)); [print(s["id"], s["dur"]) for s in timeline]
