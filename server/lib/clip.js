// The "useful work": cut a vertical 9:16 clip with a headline from a stream recording using ffmpeg.
// Demo source = a synthetic test-pattern "stream" generated locally (no third-party footage).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./chain.js";

const CLIPS = path.join(ROOT, "clips");
const SRC = path.join(CLIPS, "demo-stream.mp4");
const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
fs.mkdirSync(CLIPS, { recursive: true });

function ensureSource() {
  if (fs.existsSync(SRC)) return;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=120",
    "-f", "lavfi", "-i", "sine=frequency=330:duration=120", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", SRC]);
}

const esc = (s) => String(s).replace(/[\\:'%]/g, (c) => "\\" + c).slice(0, 60);

export function makeClip({ start = 10, end = 25, headline = "CLIPFUND DEMO" } = {}) {
  ensureSource();
  start = Math.max(0, Number(start)); end = Math.min(120, Number(end));
  if (!(end > start) || end - start > 60) throw new Error("clip must be 1-60 s inside the 120 s demo stream");
  const id = crypto.randomBytes(6).toString("hex");
  const out = path.join(CLIPS, `clip-${id}.mp4`);
  const vf = `crop=ih*9/16:ih,scale=540:960,drawbox=y=40:w=iw:h=120:color=0x0000FF@0.85:t=fill,drawtext=fontfile=${FONT}:text='${esc(headline)}':fontcolor=white:fontsize=34:x=(w-text_w)/2:y=82`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(start), "-to", String(end), "-i", SRC, "-vf", vf,
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", out]);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(out)).digest("hex");
  return { id, url: `/clips/clip-${id}.mp4`, start, end, seconds: end - start, headline, format: "mp4 9:16 540x960", sha256 };
}
