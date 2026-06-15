import { useState, useRef, useEffect } from "react";

const SYSTEM_PROMPT = `You are an English learning assistant for Hindi speakers. When given a Hindi sentence or word:

1. Translate it to English
2. Break down EACH word with grammar explanation in simple Hinglish (mix of Hindi and English)

Respond ONLY in this JSON format (no markdown, no extra text):
{
  "translation": "English translation here",
  "words": [
    {
      "hindi": "hindi word",
      "english": "english word",
      "type": "Noun/Verb/Adjective/Adverb/Pronoun/Preposition/Conjunction/Article",
      "explanation": "Simple Hinglish explanation of why this word is used and what grammar role it plays"
    }
  ],
  "grammar_tip": "One simple grammar tip about this sentence in Hinglish"
}`;

// ── Text-to-Speech ─────────────────────────────────────────────
function speak(text, onStart, onEnd) {
  if (!window.speechSynthesis) { onEnd && onEnd(); return; }
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "en-US";
  utt.rate = 0.88;
  utt.pitch = 1;
  const voices = window.speechSynthesis.getVoices();
  const engVoice = voices.find(v => v.lang.startsWith("en") && /samantha|karen|zira|google us|google uk/i.test(v.name))
    || voices.find(v => v.lang === "en-US");
  if (engVoice) utt.voice = engVoice;
  utt.onstart = onStart;
  utt.onend = onEnd;
  utt.onerror = onEnd;
  window.speechSynthesis.speak(utt);
}

function SpeakButton({ text, small, label }) {
  const [playing, setPlaying] = useState(false);
  function toggle() {
    if (playing) { window.speechSynthesis.cancel(); setPlaying(false); return; }
    speak(text, () => setPlaying(true), () => setPlaying(false));
  }
  const size = small ? 30 : 38;
  return (
    <button onClick={toggle} title={playing ? "Rokna" : "Sunna"} style={{
      height: size, borderRadius: size / 2, border: "none", cursor: "pointer",
      background: playing ? "linear-gradient(135deg,#ff6b6b,#ee5a24)" : "linear-gradient(135deg,#00b09b,#96c93d)",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
      padding: label ? "0 12px" : `0 ${size / 2}px`,
      fontSize: small ? 13 : 16, flexShrink: 0,
      boxShadow: playing ? "0 0 10px rgba(255,107,107,0.5)" : "0 0 8px rgba(0,176,155,0.3)",
      transition: "all 0.2s", color: "#fff", fontWeight: 600,
    }}>
      {playing ? "⏹" : "🔊"}{label && <span style={{ fontSize: 12 }}>{label}</span>}
    </button>
  );
}

// ── Mic using getUserMedia + Web Speech (with permission UI) ───
function useMic(onResult, onError) {
  const recRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | requesting | listening | error

  async function start() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { onError("browser"); return; }

    setStatus("requesting");
    try {
      // explicitly ask mic permission first
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus("error");
      onError("permission");
      return;
    }

    const rec = new SR();
    rec.lang = "hi-IN";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = e => {
      const transcript = e.results[0][0].transcript;
      onResult(transcript);
      setStatus("idle");
    };
    rec.onerror = e => {
      setStatus("error");
      if (e.error === "not-allowed") onError("permission");
      else onError("other");
      setTimeout(() => setStatus("idle"), 3000);
    };
    rec.onend = () => { if (status !== "error") setStatus("idle"); };

    recRef.current = rec;
    rec.start();
    setStatus("listening");
  }

  function stop() {
    recRef.current?.stop();
    setStatus("idle");
  }

  function toggle() {
    if (status === "listening") stop();
    else start();
  }

  return { status, toggle, stop };
}

// ── Main App ───────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages] = useState([{
    role: "bot", type: "welcome",
    text: "Namaste! 🙏 Hindi mein likho ya 🎤 mic dabao — main translate karunga aur grammar + pronunciation bhi sikhaunga!",
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [micError, setMicError] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);
  useEffect(() => { window.speechSynthesis?.getVoices(); }, []);

  const typeColors = {
    Noun:"#4CAF50", Verb:"#2196F3", Adjective:"#FF9800", Adverb:"#9C27B0",
    Pronoun:"#F44336", Preposition:"#00BCD4", Conjunction:"#795548", Article:"#607D8B",
  };
  const typeEmoji = {
    Noun:"📦", Verb:"⚡", Adjective:"🎨", Adverb:"🔄",
    Pronoun:"👤", Preposition:"📍", Conjunction:"🔗", Article:"📝",
  };

  async function sendMessage(overrideText) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    setInput("");
    setMessages(p => [...p, { role: "user", text }]);
    setLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: text }],
        }),
      });
      const data = await res.json();
      const raw = data.content?.[0]?.text || "{}";
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      setMessages(p => [...p, { role: "bot", type: "result", data: parsed }]);
    } catch {
      setMessages(p => [...p, { role: "bot", type: "error", text: "Kuch galat ho gaya, dobara try karo! 😅" }]);
    } finally { setLoading(false); }
  }

  const { status: micStatus, toggle: toggleMic } = useMic(
    transcript => { setInput(transcript); sendMessage(transcript); setMicError(null); },
    type => setMicError(type)
  );

  const micBg = {
    idle: "rgba(255,255,255,0.15)",
    requesting: "rgba(255,200,0,0.4)",
    listening: "linear-gradient(135deg,#ff6b6b,#ee5a24)",
    error: "rgba(255,80,80,0.4)",
  }[micStatus];

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg,#0f2027,#203a43,#2c5364)",
      display: "flex", flexDirection: "column", alignItems: "center",
      fontFamily: "'Segoe UI',sans-serif",
    }}>
      {/* Header */}
      <div style={{
        width: "100%", maxWidth: 520,
        background: "linear-gradient(90deg,#00b09b,#96c93d)",
        padding: "14px 20px", display: "flex", alignItems: "center", gap: 12,
        boxShadow: "0 2px 12px rgba(0,0,0,0.3)", position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: "50%",
          background: "rgba(255,255,255,0.25)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
        }}>🤖</div>
        <div>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>English Guru Bot</div>
          <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 12 }}>Hindi → English + Grammar + 🔊 Voice</div>
        </div>
      </div>

      {/* Mic error banner */}
      {micError && (
        <div style={{
          width: "100%", maxWidth: 520, padding: "10px 16px",
          background: micError === "permission" ? "rgba(255,80,80,0.2)" : "rgba(255,180,0,0.2)",
          borderBottom: "1px solid rgba(255,100,100,0.3)",
          color: "#ffaaaa", fontSize: 13, textAlign: "center",
        }}>
          {micError === "permission"
            ? "⚠️ Mic permission denied. Browser settings mein Microphone allow karo."
            : micError === "browser"
            ? "⚠️ Aapka browser mic support nahi karta. Chrome use karo."
            : "⚠️ Mic mein error aaya. Dobara try karo."}
        </div>
      )}

      {/* Chat area */}
      <div style={{
        flex: 1, width: "100%", maxWidth: 520,
        padding: "16px 12px", overflowY: "auto",
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
            {msg.role === "user" ? (
              <div style={{
                background: "linear-gradient(135deg,#00b09b,#96c93d)",
                color: "#fff", borderRadius: "18px 18px 4px 18px",
                padding: "10px 16px", maxWidth: "75%", fontSize: 15, fontWeight: 500,
                boxShadow: "0 2px 8px rgba(0,176,155,0.3)",
              }}>{msg.text}</div>
            ) : msg.type === "welcome" || msg.type === "error" ? (
              <div style={{
                background: "rgba(255,255,255,0.1)", backdropFilter: "blur(10px)",
                color: "#fff", borderRadius: "18px 18px 18px 4px",
                padding: "12px 16px", maxWidth: "82%", fontSize: 14,
                border: "1px solid rgba(255,255,255,0.15)",
              }}>{msg.text}</div>
            ) : msg.type === "result" ? (
              <ResultCard data={msg.data} typeColors={typeColors} typeEmoji={typeEmoji} />
            ) : null}
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{
              background: "rgba(255,255,255,0.1)", backdropFilter: "blur(10px)",
              borderRadius: "18px 18px 18px 4px", padding: "14px 20px",
              border: "1px solid rgba(255,255,255,0.15)",
            }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[0,1,2].map(n => (
                  <div key={n} style={{
                    width: 8, height: 8, borderRadius: "50%", background: "#00b09b",
                    animation: `bounce 1s ease-in-out ${n*0.2}s infinite`,
                  }}/>
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input bar */}
      <div style={{
        width: "100%", maxWidth: 520, padding: "12px",
        background: "rgba(0,0,0,0.35)", backdropFilter: "blur(10px)",
        borderTop: "1px solid rgba(255,255,255,0.1)",
      }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Mic */}
          <button onClick={toggleMic} title="Hindi mein bolo" style={{
            width: 46, height: 46, borderRadius: "50%", border: "none", cursor: "pointer", flexShrink: 0,
            background: micBg, fontSize: 20,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: micStatus === "listening" ? "0 0 16px rgba(255,107,107,0.7)" : "none",
            animation: micStatus === "listening" ? "pulse 1s ease-in-out infinite" : "none",
            transition: "all 0.2s",
          }}>
            {micStatus === "listening" ? "🔴" : micStatus === "requesting" ? "⏳" : "🎤"}
          </button>

          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Hindi mein likho... ya 🎤 dabao"
            style={{
              flex: 1, padding: "12px 16px", borderRadius: 24,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.1)",
              color: "#fff", fontSize: 14, outline: "none",
            }}
          />

          <button onClick={() => sendMessage()} disabled={loading || !input.trim()} style={{
            width: 46, height: 46, borderRadius: "50%", border: "none", flexShrink: 0,
            cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            background: loading || !input.trim() ? "rgba(255,255,255,0.2)" : "linear-gradient(135deg,#00b09b,#96c93d)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, transition: "all 0.2s", boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}>➤</button>
        </div>

        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, textAlign: "center", marginTop: 6 }}>
          {micStatus === "listening"
            ? "🔴 Sun raha hoon... Hindi mein bolo"
            : micStatus === "requesting"
            ? "⏳ Mic permission le raha hoon..."
            : "🎤 Mic dabao ya type karo — Enter se bhejo"}
        </div>
      </div>

      <style>{`
        @keyframes bounce { 0%,100%{transform:translateY(0);opacity:0.5} 50%{transform:translateY(-6px);opacity:1} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        input::placeholder { color: rgba(255,255,255,0.4); }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 2px; }
      `}</style>
    </div>
  );
}

// ── Result Card ────────────────────────────────────────────────
function ResultCard({ data, typeColors, typeEmoji }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ maxWidth: "92%", display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Translation bubble */}
      <div style={{
        background: "rgba(255,255,255,0.1)", backdropFilter: "blur(10px)",
        borderRadius: "18px 18px 18px 4px", padding: "14px 16px",
        border: "1px solid rgba(255,255,255,0.15)",
      }}>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, marginBottom: 6 }}>🌐 Translation</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ color: "#fff", fontSize: 16, fontWeight: 600, flex: 1 }}>{data.translation}</div>
          <SpeakButton text={data.translation} label="Suno" />
        </div>
      </div>

      {/* Grammar toggle */}
      <button onClick={() => setExpanded(e => !e)} style={{
        background: "rgba(0,176,155,0.2)", border: "1px solid rgba(0,176,155,0.4)",
        borderRadius: 20, padding: "8px 16px", color: "#00e5cc",
        fontSize: 13, cursor: "pointer",
        display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start",
      }}>
        📚 Grammar dekho {expanded ? "▲" : "▼"}
      </button>

      {expanded && (
        <div style={{
          background: "rgba(0,0,0,0.3)", borderRadius: 16, padding: 14,
          border: "1px solid rgba(255,255,255,0.1)",
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          {data.words?.map((w, i) => (
            <div key={i} style={{
              background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: "10px 12px",
              borderLeft: `3px solid ${typeColors[w.type] || "#888"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>{w.hindi}</span>
                <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>→</span>
                <span style={{ color: "#00e5cc", fontWeight: 600, fontSize: 15 }}>{w.english}</span>
                <SpeakButton text={w.english} small />
                <span style={{
                  marginLeft: "auto",
                  background: typeColors[w.type] || "#888",
                  color: "#fff", borderRadius: 10, padding: "2px 8px", fontSize: 11, fontWeight: 600,
                }}>
                  {typeEmoji[w.type] || "📌"} {w.type}
                </span>
              </div>
              <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, lineHeight: 1.5 }}>
                {w.explanation}
              </div>
            </div>
          ))}

          {data.grammar_tip && (
            <div style={{
              background: "rgba(150,201,61,0.15)", border: "1px solid rgba(150,201,61,0.3)",
              borderRadius: 12, padding: "10px 14px", color: "#c8f07a", fontSize: 13,
            }}>
              💡 <strong>Grammar Tip:</strong> {data.grammar_tip}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {Object.entries(typeColors).map(([type, color]) => (
              <span key={type} style={{
                background: `${color}22`, border: `1px solid ${color}`,
                color, borderRadius: 8, padding: "2px 8px", fontSize: 10,
              }}>
                {typeEmoji[type]} {type}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
