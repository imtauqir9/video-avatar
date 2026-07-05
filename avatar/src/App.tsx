import { useCallback, useEffect, useRef, useState } from "react";
import Daily, { type DailyCall } from "@daily-co/daily-js";
import { createConversation, endConversation } from "./api";

type Status = "idle" | "connecting" | "live" | "error";
type Mode = "text" | "voice" | "video";
type Line = { role: "you" | "avatar"; text: string };

const STATUS_LABEL: Record<Status, string> = {
  idle: "Ready",
  connecting: "Connecting",
  live: "Live",
  error: "Error",
};

const MODES: { id: Mode; title: string; desc: string; color: string }[] = [
  { id: "text", title: "Type", desc: "Text in, video out. No mic or camera.", color: "amber" },
  { id: "voice", title: "Talk", desc: "Speak with your mic — it listens and replies.", color: "blue" },
  { id: "video", title: "Face to face", desc: "Mic + camera, so it can see and hear you.", color: "purple" },
];

export default function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [mode, setMode] = useState<Mode>("text");
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState("");
  const [micId, setMicId] = useState("");
  const [error, setError] = useState("");
  const [caption, setCaption] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");

  const callRef = useRef<DailyCall | null>(null);
  const conversationIdRef = useRef("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const selfVideoRef = useRef<HTMLVideoElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const cleanup = useCallback((resetStatus = true) => {
    const id = conversationIdRef.current;
    conversationIdRef.current = "";
    if (id) endConversation(id);

    const call = callRef.current;
    callRef.current = null;
    if (call) {
      // leave fully before destroying; sequencing avoids a "use after destroy" race
      call.leave().catch(() => {}).finally(() => {
        call.destroy().catch(() => {});
      });
    }
    for (const ref of [videoRef, audioRef, selfVideoRef]) {
      if (ref.current) ref.current.srcObject = null;
    }
    setCameras([]);
    setMics([]);
    setCamId("");
    setMicId("");
    if (resetStatus) setStatus("idle");
  }, []);

  const refreshDevices = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    try {
      const { devices } = await call.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput" && d.deviceId);
      const ins = devices.filter((d) => d.kind === "audioinput" && d.deviceId);
      setCameras(cams);
      setMics(ins);
      const current: any = await call.getInputDevices();
      setCamId(current?.camera?.deviceId || cams[0]?.deviceId || "");
      setMicId(current?.mic?.deviceId || ins[0]?.deviceId || "");
    } catch {
      // device enumeration can fail before permission is granted; ignore
    }
  }, []);

  const selectCamera = useCallback(async (id: string) => {
    const call = callRef.current;
    if (!call) return;
    await call.setInputDevicesAsync({ videoDeviceId: id });
    setCamId(id);
  }, []);

  const selectMic = useCallback(async (id: string) => {
    const call = callRef.current;
    if (!call) return;
    await call.setInputDevicesAsync({ audioDeviceId: id });
    setMicId(id);
  }, []);

  const start = useCallback(
    async (chosen: Mode) => {
      setError("");
      setCaption("");
      setLines([]);
      setMode(chosen);
      setStatus("connecting");

      const wantAudio = chosen !== "text";
      const wantVideo = chosen === "video";
      try {
        // Create the conversation first. If this fetch fails there's no Daily object yet to tear
        // down, so the next attempt starts clean (this is what caused the "use after destroy").
        const { conversation_url, conversation_id } = await createConversation();

        const call = Daily.createCallObject({
          audioSource: wantAudio, // false => no device acquired, no permission prompt
          videoSource: wantVideo,
          subscribeToTracksAutomatically: true,
        });
        callRef.current = call;

        call.on("track-started", (ev: any) => {
          const track = ev?.track;
          if (!track) return;
          if (ev.participant?.local) {
            if (track.kind === "video" && selfVideoRef.current) {
              selfVideoRef.current.srcObject = new MediaStream([track]);
            }
            return;
          }
          if (track.kind === "video" && videoRef.current) {
            videoRef.current.srcObject = new MediaStream([track]);
            setStatus("live");
          }
          if (track.kind === "audio" && audioRef.current) {
            audioRef.current.srcObject = new MediaStream([track]);
          }
        });

        call.on("track-stopped", (ev: any) => {
          if (ev?.participant?.local && ev?.track?.kind === "video" && selfVideoRef.current) {
            selfVideoRef.current.srcObject = null;
          }
        });

        call.on("app-message", (ev: any) => {
          const d = ev?.data;
          if (d?.event_type !== "conversation.utterance") return;
          const role = d.properties?.role;
          const text = String(d.properties?.speech || "");
          if (!text) return;
          if (role === "replica") {
            setCaption(text);
            setLines((prev) => [...prev, { role: "avatar", text }]);
          } else if (role === "user") {
            // spoken input shows up here; dedupe against text we already added on send
            setLines((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "you" && last.text === text) return prev;
              return [...prev, { role: "you", text }];
            });
          }
        });

        call.on("left-meeting", () => cleanup());
        call.on("available-devices-updated", () => refreshDevices());

        conversationIdRef.current = conversation_id;
        await call.join({ url: conversation_url });
        setMicOn(wantAudio);
        setCamOn(wantVideo);
        if (wantAudio || wantVideo) await refreshDevices();
      } catch (e: any) {
        cleanup(false);
        setError(e?.message || String(e));
        setStatus("error");
      }
    },
    [cleanup, refreshDevices],
  );

  const toggleMic = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const next = !micOn;
    call.setLocalAudio(next);
    setMicOn(next);
  }, [micOn]);

  const toggleCam = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const next = !camOn;
    call.setLocalVideo(next);
    setCamOn(next);
  }, [camOn]);

  const send = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      const call = callRef.current;
      if (!text || !call) return;
      call.sendAppMessage(
        {
          message_type: "conversation",
          event_type: "conversation.respond",
          conversation_id: conversationIdRef.current,
          properties: { text },
        },
        "*",
      );
      setLines((prev) => [...prev, { role: "you", text }]);
      setInput("");
    },
    [input],
  );

  const showSession = status === "connecting" || status === "live";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">Avatar</span>
        </div>
        <div className={`status status--${status}`}>
          <span className="dot" />
          {STATUS_LABEL[status]}
          {showSession && <span className="mode-tag">{mode}</span>}
        </div>
      </header>

      <main className="main">
        {!showSession ? (
          <section className="hero">
            <h1 className="hero-title">
              Talk to your <span className="grad">video avatar</span>
            </h1>
            <p className="hero-sub">Pick how you'd like to talk to it.</p>
            <div className="modes">
              {MODES.map((m) => (
                <button key={m.id} className={`mode-card mode-card--${m.color}`} onClick={() => start(m.id)}>
                  <span className="mode-title">{m.title}</span>
                  <span className="mode-desc">{m.desc}</span>
                </button>
              ))}
            </div>
            {error && <p className="error">{error}</p>}
          </section>
        ) : (
          <div className="live">
            <div className="session">
              <div className="stage">
                <video ref={videoRef} className="video" autoPlay playsInline muted />
                {status === "connecting" && <div className="overlay">Connecting…</div>}
                {mode === "video" && (
                  <video ref={selfVideoRef} className="selfview" autoPlay playsInline muted />
                )}
                {caption && <div className="caption">{caption}</div>}
              </div>
              <aside className="transcript" ref={transcriptRef}>
                {lines.length === 0 ? (
                  <p className="hint">
                    {mode === "text"
                      ? "Type a question below to start the conversation."
                      : "Say hello, or type a question below."}
                  </p>
                ) : (
                  lines.map((l, i) => (
                    <div key={i} className={`bubble bubble--${l.role}`}>
                      <span className="who">{l.role}</span>
                      {l.text}
                    </div>
                  ))
                )}
              </aside>
            </div>

            <div className="controls">
              {mode !== "text" && (
                <div className="device">
                  <button
                    className={`btn btn-toggle ${micOn ? "on" : "off"}`}
                    type="button"
                    onClick={toggleMic}
                  >
                    {micOn ? "Mic on" : "Mic off"}
                  </button>
                  {mics.length > 0 && (
                    <select
                      className="device-select"
                      value={micId}
                      onChange={(e) => selectMic(e.target.value)}
                      title="Microphone"
                    >
                      {mics.map((d, i) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Mic ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              {mode === "video" && (
                <div className="device">
                  <button
                    className={`btn btn-toggle ${camOn ? "on" : "off"}`}
                    type="button"
                    onClick={toggleCam}
                  >
                    {camOn ? "Camera on" : "Camera off"}
                  </button>
                  {cameras.length > 0 && (
                    <select
                      className="device-select"
                      value={camId}
                      onChange={(e) => selectCamera(e.target.value)}
                      title="Camera"
                    >
                      {cameras.map((d, i) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Camera ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              <form className="composer" onSubmit={send}>
                <input
                  className="composer-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask me anything…"
                  autoFocus
                />
                <button className="btn btn-send" type="submit">
                  Send
                </button>
              </form>
              <button className="btn btn-ghost" type="button" onClick={() => cleanup()}>
                End
              </button>
            </div>
          </div>
        )}
      </main>

      <audio ref={audioRef} autoPlay />
    </div>
  );
}
