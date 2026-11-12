import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Outfit";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import TL from "./timeline.json";
import T from "./terms.json";

const { fontFamily: SANS } = loadFont("normal", { weights: ["400", "500", "600", "700", "800"], subsets: ["latin"] });
const { fontFamily: MONO } = loadMono("normal", { weights: ["400", "700"], subsets: ["latin"] });
const BLUE = "#0000FF", NAVY = "#0C0E44", FPS = 30;
const A = (f) => staticFile(`assets/${f}`);

const useIn = (delay = 0, damping = 18) => { const f = useCurrentFrame(); return spring({ frame: f - delay, fps: FPS, config: { damping } }); };
const Rise = ({ delay = 0, children, style }) => { const p = useIn(delay); return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 30}px)`, ...style }}>{children}</div>; };

const Heading = ({ kicker, title }) => (
  <div style={{ position: "absolute", left: 90, top: 56, color: "white" }}>
    <Rise><div style={{ fontSize: 24, fontWeight: 600, letterSpacing: 3, textTransform: "uppercase", opacity: 0.75 }}>{kicker}</div></Rise>
    <Rise delay={4}><div style={{ fontSize: 50, fontWeight: 700, letterSpacing: -1, marginTop: 4 }}>{title}</div></Rise>
  </div>
);
const Tag = () => (
  <div style={{ position: "absolute", right: 70, top: 64, background: "rgba(255,255,255,.14)", color: "white", padding: "10px 20px", borderRadius: 999, fontSize: 22, fontWeight: 600 }}>
    Testnet demo · local Base Sepolia fork</div>
);

// ---------------- terminal ----------------
const hl = (line) => {
  const rules = [[/(402 Payment Required|HTTP\/1\.1 402)/, "#ff8a80"], [/(\[PASS\]|success=true|HTTP 200|13 passed|13 tests passed|ok\.)/, "#7dffaf"], [/(recordPayment|bought s\w+|paid operating cost|booked payment)/, "#ffe27a"], [/^(\$ .*)$/, "#9fb3ff"]];
  const parts = [{ t: line, c: null }];
  for (const [re, c] of rules) {
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].c) continue; const m = parts[i].t.match(re); if (!m) continue;
      const s = m.index, e = s + m[0].length, t = parts[i].t;
      parts.splice(i, 1, { t: t.slice(0, s), c: null }, { t: t.slice(s, e), c }, { t: t.slice(e), c: null }); i++;
    }
  }
  return parts.map((p, i) => <span key={i} style={{ color: p.c || "#dfe4ff", fontWeight: p.c ? 700 : 400 }}>{p.t}</span>);
};
const Terminal = ({ lines, dur, title = "terminal", font = 23, width = 1700, top = 200, height }) => {
  const f = useCurrentFrame(); const p = useIn(0);
  const shown = Math.floor(interpolate(f, [8, Math.max(20, dur * FPS * 0.55)], [0, lines.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return (
    <div style={{ position: "absolute", left: (1920 - width) / 2, top, width, height, background: NAVY, borderRadius: 18, boxShadow: "0 30px 80px rgba(0,0,30,.45)", opacity: p, transform: `scale(${0.96 + 0.04 * p})`, overflow: "hidden" }}>
      <div style={{ height: 46, background: "#1a1d5c", display: "flex", alignItems: "center", gap: 10, paddingLeft: 18 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />)}
        <div style={{ color: "#aab3e8", fontFamily: MONO, fontSize: 18, marginLeft: 14 }}>{title}</div>
      </div>
      <div style={{ padding: "18px 26px", fontFamily: MONO, fontSize: font, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        {lines.slice(0, shown).map((l, i) => <div key={i} style={{ minHeight: font * 1.2 }}>{hl(l)}</div>)}
        {shown < lines.length && Math.floor(f / 8) % 2 === 0 ? <span style={{ color: "#dfe4ff" }}>▋</span> : null}
      </div>
    </div>
  );
};

// ---------------- browser window with real dashboard captures ----------------
const Browser = ({ children, left = 110, top = 190, width = 1700, height = 760 }) => {
  const p = useIn(0);
  return (
    <div style={{ position: "absolute", left, top, width, height, background: "#f5f6fb", borderRadius: 18, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,30,.45)", opacity: p, transform: `translateY(${(1 - p) * 40}px)` }}>
      <div style={{ height: 46, background: "#e4e7f4", display: "flex", alignItems: "center", gap: 10, paddingLeft: 18 }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />)}
        <div style={{ marginLeft: 16, background: "white", borderRadius: 8, padding: "5px 16px", fontSize: 18, color: "#5b6185", fontFamily: MONO }}>localhost:4021 — ClipFund dashboard</div>
      </div>
      <div style={{ position: "relative", height: height - 46 }}>{children}</div>
    </div>
  );
};
const Shot = ({ src, x, y, w, delay = 0, zoom = 0.03, dur = 8, ring }) => {
  const f = useCurrentFrame(); const p = useIn(delay);
  const z = 1 + interpolate(f, [0, dur * FPS], [0, zoom]);
  return <div style={{ position: "absolute", left: x, top: y, width: w, opacity: p, transform: `scale(${z})`, transformOrigin: "50% 0%", borderRadius: 12, boxShadow: ring ? `0 0 0 4px ${BLUE}` : "none" }}><Img src={A(src)} style={{ width: "100%", display: "block", borderRadius: 12 }} /></div>;
};
const Note = ({ x, y, children, delay = 20, w = 520 }) => (
  <Rise delay={delay} style={{ position: "absolute", left: x, top: y, width: w, background: BLUE, color: "white", padding: "14px 20px", borderRadius: 14, fontSize: 26, fontWeight: 600, boxShadow: "0 12px 30px rgba(0,0,80,.35)" }}>{children}</Rise>
);

// ---------------- scenes ----------------
const Title = () => {
  const p = useIn(0, 14);
  return (<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", color: "white", textAlign: "center" }}>
    <div style={{ fontSize: 170, fontWeight: 800, letterSpacing: -6, transform: `scale(${0.9 + 0.1 * p})`, opacity: p }}>ClipFund</div>
    <Rise delay={8}><div style={{ fontSize: 46, fontWeight: 500, marginTop: -6 }}>An AI agent that earns its own stock treasury</div></Rise>
    <Rise delay={18} style={{ display: "flex", gap: 16, marginTop: 44, justifyContent: "center" }}>
      {["Base · Stocks Maxxing", "Track 2.1 · Agents that earn their stock treasury", "x402 · USDC"].map((t) => <div key={t} style={{ background: NAVY, padding: "12px 26px", borderRadius: 999, fontSize: 26, fontWeight: 600 }}>{t}</div>)}
    </Rise>
    <Rise delay={28}><div style={{ fontSize: 28, marginTop: 44, opacity: 0.8 }}>by Dip Das · @Dipdas2001</div></Rise>
  </AbsoluteFill>);
};
const Card = ({ delay, icon, head, body, w = 760 }) => (
  <Rise delay={delay} style={{ width: w, background: NAVY, color: "white", borderRadius: 24, padding: "36px 40px" }}>
    <div style={{ fontSize: 60 }}>{icon}</div><div style={{ fontSize: 40, fontWeight: 700, marginTop: 8 }}>{head}</div><div style={{ fontSize: 28, opacity: 0.8, marginTop: 10, lineHeight: 1.35 }}>{body}</div>
  </Rise>
);
const Problem = () => (<AbsoluteFill><Heading kicker="The problem" title="Agents can do the work. Can you trust their money?" />
  <div style={{ position: "absolute", top: 300, left: 0, right: 0, display: "flex", gap: 50, justifyContent: "center" }}>
    <Card delay={6} icon="✂️" head="Clipping is repetitive" body="Streamers and creators need short clips fast. It's the kind of work an agent can just do, and charge for." />
    <Card delay={segF("problem", 1, 0)} icon="🕳️" head="Treasuries are a black box" body="You can't see what an agent earned, kept for costs, or bought, and usually one key can spend all of it." />
  </div></AbsoluteFill>);
const Node = ({ delay, top, label, sub, lock, wide }) => (
  <Rise delay={delay} style={{ width: wide || 300, background: lock ? NAVY : "white", color: lock ? "white" : NAVY, border: lock ? "3px solid white" : "none", borderRadius: 22, padding: "22px 20px", textAlign: "center" }}>
    <div style={{ fontSize: 20, fontWeight: 600, opacity: 0.7, textTransform: "uppercase", letterSpacing: 1.5 }}>{top}</div>
    <div style={{ fontSize: 34, fontWeight: 800, marginTop: 6 }}>{label}</div><div style={{ fontSize: 21, marginTop: 6, opacity: 0.75 }}>{sub}</div>
  </Rise>
);
const Arrow = ({ delay }) => <Rise delay={delay} style={{ color: "white", fontSize: 54, fontWeight: 800, alignSelf: "center" }}>→</Rise>;
const segF = (id, i, add = 0) => Math.round((TL.scenes.find((x) => x.id === id).segs[i].start + add) * FPS);
const Loop = () => (<AbsoluteFill><Heading kicker="How it works" title="Useful work → revenue → reserve → stock treasury" />
  <div style={{ position: "absolute", top: 330, left: 0, right: 0, display: "flex", gap: 22, justifyContent: "center" }}>
    <Node delay={6} top="1 · Work" label="POST /clip" sub="9:16 headline clip" />
    <Arrow delay={30} /><Node delay={34} top="2 · Revenue" label="$0.50 USDC" sub="x402 → treasury contract" />
    <Arrow delay={segF("loop", 1, 0)} /><Node delay={segF("loop", 1, 0.1)} top="3 · First" label="🔒 Reserve" sub="up to $1 · can't be invested" lock />
    <Arrow delay={segF("loop", 1, 2.6)} /><Node delay={segF("loop", 1, 2.7)} top="4 · Surplus" label="60% → stocks" sub="sCOIN · sNVDA · ≤35% each" />
  </div>
  <Rise delay={segF("loop", 1, 4.6)} style={{ position: "absolute", top: 640, left: 0, right: 0, textAlign: "center", color: "white", fontSize: 30 }}>remaining 40% of surplus stays as USDC cash · share set by the owner, enforced onchain</Rise>
</AbsoluteFill>);
const Clip = () => (<AbsoluteFill><Heading kicker="The work" title="What the customer paid for" />
  <div style={{ position: "absolute", left: 300, top: 180, width: 432, height: 768, borderRadius: 36, border: `10px solid ${NAVY}`, overflow: "hidden", background: "black", boxShadow: "0 30px 80px rgba(0,0,30,.5)" }}>
    <OffthreadVideo src={staticFile("clip.mp4")} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  </div>
  <div style={{ position: "absolute", left: 860, top: 330, color: "white" }}>
    {[["Format", "MP4 · 9:16 · 540×960"], ["Length", "15 s cut from the stream"], ["Headline", "burned in with ffmpeg"], ["Price", "$0.50 test USDC via x402"]].map(([k, v], i) => (
      <Rise key={k} delay={8 + i * 10} style={{ marginBottom: 28 }}><div style={{ fontSize: 22, opacity: 0.7, letterSpacing: 2, textTransform: "uppercase" }}>{k}</div><div style={{ fontSize: 40, fontWeight: 700 }}>{v}</div></Rise>))}
    <Rise delay={50}><div style={{ fontSize: 22, opacity: 0.7, maxWidth: 800 }}>Demo source is a synthetic test pattern, so no third-party footage.</div></Rise>
  </div></AbsoluteFill>);
const ListScene = ({ kicker, title, items, cols }) => (<AbsoluteFill><Heading kicker={kicker} title={title} />
  <div style={{ position: "absolute", top: 250, left: 90, right: 90, display: "grid", gridTemplateColumns: cols || "1fr", gap: 22 }}>
    {items.map(([ic, h, b], i) => (
      <Rise key={h} delay={6 + i * 12} style={{ background: NAVY, color: "white", borderRadius: 18, padding: "22px 28px", display: "flex", gap: 22, alignItems: "flex-start" }}>
        <div style={{ fontSize: 36, width: 46 }}>{ic}</div><div><div style={{ fontSize: 32, fontWeight: 700 }}>{h}</div><div style={{ fontSize: 24, opacity: 0.78, marginTop: 4 }}>{b}</div></div>
      </Rise>))}
  </div></AbsoluteFill>);
const Safety = () => <ListScene kicker="Safety rules · enforced in the contract" title="The agent can work. It can't go rogue." items={[
  ["🔑", "Agent key ≠ owner key", "The agent can book, buy and pay opex. Only the owner sets policy, allowlists or withdraws."],
  ["🔒", "Reserve can never be invested", "buyStock() draws from the stock budget only. Reserve pays allowlisted opex payees only."],
  ["🧾", "No fake or double revenue", "A payment books only if the USDC really arrived, once per settlement tx."],
  ["⚖️", "Allowlist + max weight", "Only approved stocks; a buy that pushes one above 35% of NAV reverts."]]} cols="1fr 1fr" />;
const Sim = () => <ListScene kicker="Honest disclosure" title="What's simulated in this demo" items={[
  ["🧪", "Local Base Sepolia fork (chain 84532)", "Anvil fork with the real test-USDC contract. Faucets need a sign-in, so not on public testnet yet."],
  ["💵", "No real money", "Throwaway test keys, test USDC only."],
  ["📈", "sCOIN / sNVDA are simulated test tokens", "Fixed mock prices ($250 / $160). No rights in any company, no affiliation with Coinbase, NVIDIA or any issuer."],
  ["🔁", "In-process x402 facilitator", "Official @x402 facilitator code runs inside the server, since the public one can't see a local fork."]]} cols="1fr 1fr" />;
const Outro = () => (<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", color: "white", textAlign: "center" }}>
  <Rise><div style={{ fontSize: 130, fontWeight: 800, letterSpacing: -5 }}>ClipFund</div></Rise>
  <Rise delay={8}><div style={{ fontSize: 40, fontWeight: 500 }}>useful work → revenue → reserve → stock treasury</div></Rise>
  <Rise delay={20}><div style={{ fontSize: 30, marginTop: 40, background: NAVY, padding: "14px 30px", borderRadius: 999 }}>Built by Dip Das · @Dipdas2001 · for @buildonbase Stocks Maxxing</div></Rise>
</AbsoluteFill>);

const scenes = {
  title: () => <Title />,
  problem: () => <Problem />,
  loop: () => <Loop />,
  forge: ({ dur }) => <><Heading kicker="Contract tests" title="forge test → 13 / 13 passing" /><Terminal lines={T.forge} dur={dur} title="contracts — forge test" font={21} top={190} /></>,
  t402: ({ dur }) => <><Heading kicker="Live demo · step 1" title="No payment → HTTP 402" /><Tag /><Terminal lines={T.t402} dur={dur} title="buyer — curl" font={25} top={230} /></>,
  pay: ({ dur }) => <><Heading kicker="Live demo · step 2" title="Paid x402 call → clip + settlement → recordPayment" /><Tag /><Terminal lines={T.pay} dur={dur} title="buyer + agent log" font={25} top={240} /></>,
  reserve: ({ dur }) => <><Heading kicker="Live demo · step 3" title="Payments 1–2 fill the locked reserve" /><Tag /><Browser>
    <Shot src="s1-flow.png" x={40} y={30} w={1620} dur={dur} ring /><Shot src="s1-payments.png" x={40} y={210} w={1620} delay={20} dur={dur} />
  </Browser><Note x={1250} y={880} w={560}>Reserve $1.00 / $1.00 · invested $0</Note></>,
  buys: ({ dur }) => <><Heading kicker="Live demo · step 4" title="Surplus → stock buys, capped at 35% each" /><Tag /><Browser>
    <Shot src="s2-flow.png" x={40} y={24} w={1620} dur={dur} /><Shot src="s2-buys.png" x={40} y={190} w={800} delay={15} dur={dur} /><Shot src="s2-holdings.png" x={860} y={190} w={800} delay={30} dur={dur} ring />
  </Browser><Note x={1160} y={870} w={660} delay={segF("buys", 1, 0)}>Over the cap → buyStock() reverts (covered by test_weightCapReverts)</Note></>,
  opex: ({ dur }) => <><Heading kicker="Live demo · step 5" title="Operating cost from the reserve, then refill first" /><Tag />
    <Terminal lines={T.opex.slice(0, 8)} dur={dur * 0.8} title="agent log" font={20} top={180} height={400} />
    <Browser top={600} height={300}><Shot src="s3-flow.png" x={40} y={40} w={1620} delay={segF("opex", 0, 2)} dur={dur} ring /></Browser></>,
  recon: ({ dur }) => <><Heading kicker="Live demo · step 6" title="Reconciliation: 12 / 12 checks pass" /><Tag /><Browser>
    <ReconPan dur={dur} /><Shot src="s3-kpis.png" x={720} y={30} w={940} delay={15} dur={dur} /><Shot src="s3-holdings.png" x={720} y={200} w={940} delay={30} dur={dur} />
  </Browser></>,
  clip: () => <Clip />,
  safety: () => <Safety />,
  sim: () => <Sim />,
  outro: () => <Outro />,
};
const ReconPan = ({ dur }) => {
  const f = useCurrentFrame(); const y = interpolate(f, [FPS * 1.5, dur * FPS - FPS], [0, -560], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <div style={{ position: "absolute", left: 40, top: 20 + y, width: 640 }}><Img src={A("s3-recon.png")} style={{ width: "100%", borderRadius: 12, boxShadow: `0 0 0 4px ${BLUE}` }} /></div>;
};

const Captions = ({ big }) => {
  const f = useCurrentFrame(); const t = f / FPS;
  const sc = TL.scenes.find((s) => t >= s.start && t < s.start + s.dur); if (!sc) return null;
  const lt = t - sc.start; const seg = sc.segs.find((s) => lt >= s.start - 0.15 && lt < s.end + 0.4) || sc.segs.filter((s) => lt >= s.start).slice(-1)[0];
  if (!seg) return null;
  const o = interpolate(lt, [seg.start - 0.15, seg.start + 0.1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return big
    ? <div style={{ opacity: o, color: "white", fontSize: 50, fontWeight: 700, lineHeight: 1.25, textAlign: "center", padding: "0 60px" }}>{seg.text}</div>
    : <div style={{ position: "absolute", bottom: 26, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: o }}>
        <div style={{ maxWidth: 1600, background: "rgba(12,14,68,.92)", color: "white", fontSize: 34, fontWeight: 600, padding: "12px 30px", borderRadius: 14, textAlign: "center", lineHeight: 1.3 }}>{seg.text}</div></div>;
};

export const Main = ({ captions = true, audio = true }) => {
  const { durationInFrames } = useVideoConfig();
  return (<AbsoluteFill style={{ background: BLUE, fontFamily: SANS }}>
    {TL.scenes.map((s) => {
      const S = scenes[s.id]; const from = Math.round(s.start * FPS), d = Math.round(s.dur * FPS);
      return <Sequence key={s.id} from={from} durationInFrames={d}><Fade d={d}><S dur={s.dur} /></Fade></Sequence>;
    })}
    {captions ? <Captions /> : null}
    {audio ? <><Audio src={staticFile("vo/voice.wav")} volume={1} />
      <Audio src={staticFile("music.wav")} volume={(f) => 0.09 * interpolate(f, [0, 30, durationInFrames - 60, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} /></> : null}
  </AbsoluteFill>);
};
const Fade = ({ d, children }) => { const f = useCurrentFrame(); const o = interpolate(f, [0, 8, d - 8, d], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }); return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>; };

export const Vertical = () => {
  const s = 1080 / 1920;
  return (<AbsoluteFill style={{ background: BLUE, fontFamily: SANS }}>
    <div style={{ position: "absolute", top: 150, left: 0, right: 0, textAlign: "center", color: "white" }}>
      <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -3 }}>ClipFund</div>
      <div style={{ fontSize: 34, opacity: 0.85 }}>Base Stocks Maxxing · Track 2.1</div></div>
    <div style={{ position: "absolute", top: 560, left: 0, width: 1920, height: 1080, transform: `scale(${s})`, transformOrigin: "0 0", overflow: "hidden", boxShadow: "0 0 0 3px rgba(255,255,255,.25)" }}>
      <Main captions={false} audio={true} /></div>
    <div style={{ position: "absolute", top: 1230, left: 0, right: 0, height: 420, display: "flex", alignItems: "center", justifyContent: "center" }}><Captions big /></div>
    <div style={{ position: "absolute", bottom: 110, left: 0, right: 0, textAlign: "center", color: "white", fontSize: 30, opacity: 0.75 }}>Testnet demo · @Dipdas2001</div>
  </AbsoluteFill>);
};
