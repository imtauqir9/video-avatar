# Tavus CVI — Detailed Reference

A working understanding of the entire Tavus Conversational Video Interface (CVI) approach for this
project: a realtime, lifelike video avatar that looks like the user, is driven by text, and can use
our own LLM. Every section links to the authoritative doc page.

Doc resources worth bookmarking:
- Docs home / CVI overview: https://docs.tavus.io/sections/conversational-video-interface/overview-cvi
- Machine-readable index: https://docs.tavus.io/llms.txt and full export https://docs.tavus.io/llms-full.txt
- OpenAPI spec: https://docs.tavus.io/openapi.yaml
- API reference overview: https://docs.tavus.io/api-reference/overview

---

## 1. TL;DR for this project

- Tavus CVI is an API-first, hosted, realtime "face-to-face" video AI. It manages the whole pipeline
  (perception, STT, turn-taking, LLM, TTS, rendering) and delivers video over WebRTC via Daily.
- Three objects to learn: **Replica** (your cloned face/voice), **Persona** (behavior + pipeline config),
  **Conversation** (a live WebRTC session that joins a replica + persona).
- "Looks like me": create a custom **video-trained Replica** from a single ~60-second clip (Phoenix-4).
- "Powered by my LLM, realtime": configure the Persona's `layers.llm` to point at any
  **OpenAI-compatible streaming (SSE) `/chat/completions` endpoint**. Tavus calls it server-side and
  streams tokens into TTS + rendering, so BYO-LLM and low latency coexist. (Second option: run the LLM
  fully outside Tavus and stream the text in with `conversation.echo`.)
- "Text input": at runtime, send `conversation.respond` (let the persona's LLM answer typed text) or
  `conversation.echo` (replica speaks exact text you supply). Both go over the Daily data channel via
  `sendAppMessage`.
- "API / callbacks": full REST API + `callback_url` webhooks for replica-ready, conversation lifecycle,
  transcripts, recordings, perception analysis.
- Fastest start: `@tavus/cvi-ui` CLI scaffolds a React UI; or just create a conversation and embed the
  `conversation_url` in an iframe.

---

## 2. Architecture: the realtime pipeline and the named models

Source: https://docs.tavus.io/sections/conversational-video-interface/overview-cvi
· https://docs.tavus.io/sections/models · https://docs.tavus.io/sections/conversational-video-interface/persona/overview

CVI runs a tightly integrated, low-latency stack optimized for **utterance-to-utterance** round-trip,
delivered over **WebRTC (powered by Daily)**. A turn flows roughly:

```
user audio/video
  -> Perception (Raven)        visual + vocal-tone understanding (emotion, gaze, screen)
  -> STT                       real-time transcription
  -> Conversational Flow (Sparrow)  turn-taking / interruptibility (when to speak vs listen)
  -> LLM                       generates the reply (Tavus-hosted OR your own)
  -> TTS                       text to speech (Cartesia default / ElevenLabs / Azure)
  -> Replica (Phoenix)         renders the synchronized talking-head video
```

Note: two doc pages list the STT vs Conversational-Flow order slightly differently; functionally STT,
turn detection, and perception run together ahead of the LLM. Not worth worrying about.

Named models:
- **Phoenix** — replica rendering. Generates full-face expressions, micro-movements, emotional shifts
  in real time with identity preservation. Built on a Gaussian-diffusion architecture. Versions:
  **`phoenix-4`** (default, most expressive, supports emotion control) and `phoenix-3`, selectable via
  `model_name` at replica creation.
- **Raven** — perception. Interprets emotion, intent, expression from visual cues + vocal tone; can
  trigger tool calls from what it sees/hears. Model id **`raven-1`** (default), `raven-0` (legacy), `off`.
- **Sparrow** — conversational turn-taking. Understands rhythm, pauses, and timing for natural
  interruptible conversation. Model id **`sparrow-1`** (default); legacy `sparrow-0`, `timebased`.

Hard latency number stated in docs: RAG knowledge-base retrieval ~30 ms. Per-model latencies for
Phoenix/Raven/Sparrow are not published; Tavus markets "world's fastest interface of its kind."

---

## 3. The three core objects

Source: https://docs.tavus.io/api-reference/overview · https://docs.tavus.io/sections/conversational-video-interface/persona/overview

- **Replica** (`replica_id`, e.g. `r90bbd427f71`) — the trained visual+voice avatar. Stock or custom.
- **Persona** (`persona_id`, e.g. `pcb7a34da5fe`) — the agent's identity and configuration: system
  prompt, `pipeline_mode`, `default_replica_id`, the `layers` (perception/stt/conversational_flow/llm/tts),
  attached documents (knowledge base), objectives, and guardrails.
- **Conversation** (`conversation_id` + `conversation_url`) — a live WebRTC (Daily) session that binds a
  replica + persona. Created via the API; you join the returned `conversation_url`.

Defaults: a persona without a replica uses a default replica; a replica without a persona uses the
default Tavus persona.

---

## 4. Pipeline modes

Source: https://docs.tavus.io/sections/conversational-video-interface/quickstart/pipeline-modes

- **`full`** (default, recommended) — the entire multimodal stack; lowest utterance-to-utterance latency
  with Tavus defaults. Use this for our natural, lifelike conversation.
- **`echo`** — streamlined; the app supplies text/audio the replica speaks directly, bypassing most of
  the pipeline. Required for the LiveKit integration. Incompatible with Tavus perception/STT.
- **Integration modes** — LiveKit Agent, Pipecat (Tavus is the avatar/output layer; another framework
  orchestrates).
- **Custom LLM / bring-your-own-logic** — note: a *fully external* response loop "adds latency due to
  external processing." Prefer configuring `layers.llm` with your endpoint inside `full` mode (below) to
  keep the pipeline intact.

---

## 5. Replica: cloning yourself from video (the "looks like me" path)

Sources: https://docs.tavus.io/sections/replica/overview · https://docs.tavus.io/sections/replica/which-training-path
· https://docs.tavus.io/sections/replica/train-with-a-video · https://docs.tavus.io/sections/replica/video-to-replica-quickstart
· https://docs.tavus.io/api-reference/phoenix-replica-model/create-replica · https://docs.tavus.io/sections/replica/replica-faqs

Use **video training** (not image) for the most realistic clone — it captures your appearance, real
voice, expressions, and accurate lip-sync at highest fidelity. Image training is faster but lower
fidelity and uses a generic stock voice. Custom replicas require a Starter/Growth/Enterprise plan.

### Two ways to create it: Portal (no-code) or API

- **Developer Portal (recommended for a one-off).** Sign in at https://platform.tavus.io, go to
  **Replicas -> Create Replica**, or directly https://platform.tavus.io/dev/replicas/create. It's a
  guided flow with upload checks and inline validation, and it hosts the video for you (no presigned
  URL needed). You can **record in-browser** or **upload a pre-recorded file** — uploading a clip filmed
  with a desktop app (QuickTime on Mac, Camera on Windows) gives higher resolution and stability than the
  browser recorder. The consent line is shown to read aloud. Training status appears on the replica's
  page; the `replica_id` is shown when ready.
- **API.** `POST /v2/replicas` with a public/presigned `train_video_url` (below) — use this to automate
  creation; you host the clip yourself.

### Recording spec (read carefully before filming)

One continuous clip, **~60 seconds total = 30s speaking + 30s still**. (This is shorter than HeyGen's
2-minute requirement — do not over-record.)

- Speaking 30s: speak naturally on any topic; enunciate with teeth visible; keep head/body movement
  minimal; no hand gestures or sudden head turns.
- Still 30s: head still, eye contact with camera, lips neutral and closed, no lip-licking or unusual
  mouth shapes, no head tilt.
- Technical: minimum 1080p, minimum 25 FPS, max 750 MB, `.mp4` (H.264 + AAC) or `.webm`. Record with a
  desktop app, not in-browser.
- Framing: camera at eye level; face fills >=25% of frame; sit >=3 ft away (waist-up); head centered.
- Appearance: neck fully visible, clearly separated from clothing; avoid high collars; hair behind
  shoulders; avoid bangs/loose strands.
- Lighting/background: well-lit, simple background, consistent lighting, minimal shadows.

### Consent (required)

Either open the training clip with this verbatim statement, or supply a separate `consent_video_url`:

> "I, [FULL NAME], am currently speaking and consent Tavus to create an AI clone of me by using the
> audio and video samples I provide. I understand that this AI clone can be used to create videos that
> look and sound like me."

(The verbatim wording lives on the Create Replica API reference page.)

### Create Replica API

`POST https://tavusapi.com/v2/replicas` with header `x-api-key`.

```bash
curl --request POST \
  --url https://tavusapi.com/v2/replicas \
  --header 'Content-Type: application/json' \
  --header "x-api-key: $TAVUS_API_KEY" \
  --data '{
    "replica_name": "ed_replica",
    "train_video_url": "https://presigned-s3-url/training.mp4",
    "callback_url": "https://myapp.com/webhook",
    "model_name": "phoenix-4"
  }'
```

Key body fields: `train_video_url` (presigned/public URL valid >=24h; mutually exclusive with
`train_image_url`), `consent_video_url` (optional separate consent clip), `replica_name`,
`callback_url`, `model_name` (`phoenix-4` default / `phoenix-3`), `properties.background_green_screen`.
Image path instead uses `train_image_url` + required `voice_name` (stock voice slug) + optional
`auto_fix_training_image`.

Response: `{ "replica_id": "r...", "status": "started" }`. Training takes ~3-4 hours. Poll
`GET https://tavusapi.com/v2/replicas/{replica_id}` (status `started` -> `completed` / `error`) or wait
for the `callback_url` webhook (`{ replica_id, status: "ready" }` or `status: "error", error_message`).
Failed training does not consume credits.

For prototyping before our replica is ready, use stock replica **`r90bbd427f71`** (Anna). 100+ stock
replicas exist: https://docs.tavus.io/sections/replica/stock-replicas

---

## 6. Persona: configuration and layers

Source: https://docs.tavus.io/api-reference/personas/create-persona · https://docs.tavus.io/sections/conversational-video-interface/persona/overview

`POST https://tavusapi.com/v2/personas`. Top-level fields: `persona_name`, `system_prompt`,
`pipeline_mode` (`full` | `echo`), `default_replica_id`, `document_ids` / `document_tags`,
`objectives_id`, `guardrail_ids`, and `layers`. Response: `{ persona_id, persona_name, created_at }`.

The `layers` object:

```jsonc
"layers": {
  "perception":        { "perception_model": "raven-1", "visual_awareness_queries": [...], "visual_tool_prompt": "...", "visual_tools": [...], "audio_awareness_queries": [...], "audio_tool_prompt": "...", "audio_tools": [...], "perception_analysis_queries": [...] },
  "stt":               { "stt_engine": "tavus-auto", "hotwords": "..." },
  "conversational_flow": { "turn_detection_model": "sparrow-1", "turn_taking_patience": "medium", "replica_interruptibility": "medium", "voice_isolation": "near", "wake_phrase": "...", "idle_engagement": "off" },
  "llm":               { "model": "...", "base_url": "...", "api_key": "...", "speculative_inference": true, "tools": [...], "headers": {}, "extra_body": {}, "default_query": {} },
  "tts":               { "tts_engine": "cartesia", "external_voice_id": "...", "api_key": "...", "tts_model_name": "sonic-3", "tts_emotion_control": true, "voice_settings": {}, "pronunciation_dictionary_id": "..." }
}
```

### LLM layer (key for us)

Doc: https://docs.tavus.io/sections/conversational-video-interface/persona/llm
· tools: https://docs.tavus.io/sections/conversational-video-interface/persona/llm-tool

Tavus-hosted model ids: `tavus-gpt-oss` (recommended default), `tavus-gpt-5.2`,
`tavus-gemini-2.5-flash`, `tavus-gemini-3-flash`, `tavus-claude-haiku-4.5`. (Deprecated: `tavus-gpt-4.1`,
`tavus-gpt-4o`, `tavus-gpt-4o-mini`.)

Bring your own LLM — set in `layers.llm`:
- `base_url` — your endpoint, WITHOUT route extension (Tavus appends `/chat/completions`).
- `api_key`, `model`.
- Must be **OpenAI-compatible and streamable over SSE** on `/chat/completions`.
- `speculative_inference: true` (default) — LLM begins processing before the user finishes speaking;
  improves responsiveness. Works for hosted and custom LLMs.
- Optional: `headers`, `extra_body` (e.g. `temperature`), `default_query` (e.g. Azure `api-version`).
- Prompt budget: best <=5,000 tokens; degrades 15-20k; hard max 32,000 tokens.

```jsonc
"llm": {
  "model": "claude-haiku-4-5",
  "base_url": "https://my-proxy.example.com/v1",   // Tavus appends /chat/completions
  "api_key": "sk-...",
  "speculative_inference": true
}
```

Tool/function calling uses the OpenAI schema (`{ type: "function", function: { name, description,
parameters } }`, all params listed in `required`). Important: **Tavus does not execute tools** — listen
for tool-call events in your frontend and run the logic yourself.

### TTS layer (voice)

Doc: https://docs.tavus.io/sections/conversational-video-interface/persona/tts

Engines (`tts_engine`): `cartesia` (default), `elevenlabs`, `azure`. Set the voice with
`external_voice_id`; `api_key` only needed for private/custom voices (public custom voices work without
a key). `tts_model_name` (e.g. `sonic-3` for Cartesia, `eleven_turbo_v2_5` for ElevenLabs),
`tts_emotion_control` (default true), `voice_settings` (e.g. `{ "speed": 0.9 }`),
`pronunciation_dictionary_id` (ElevenLabs).

To make the avatar sound like us as well as look like us, we can clone our voice in ElevenLabs/Cartesia
and pass its `external_voice_id` (video-trained replicas also carry the voice captured in the clip).

### STT layer

Doc: https://docs.tavus.io/sections/conversational-video-interface/persona/stt — `stt_engine`:
`tavus-auto` (default), `tavus-parakeet` (lowest latency, English/European), `tavus-soniox`,
`tavus-whisper`, `tavus-deepgram-medical`. `hotwords` biases tricky names/terms. (Only relevant once we
add audio input — for text-only input STT is unused.)

### Perception layer (Raven)

Doc: https://docs.tavus.io/sections/conversational-video-interface/persona/perception — `perception_model`
`raven-1` / `raven-0` / `off`. `visual_awareness_queries` and `audio_awareness_queries` run during the
call and feed the LLM as context; `perception_analysis_queries` produce an end-of-call summary.
`visual_tools` / `audio_tools` enable tool calls triggered by what Raven sees/hears (raven-1 only).

### Conversational-flow layer (turn-taking)

Doc: https://docs.tavus.io/sections/conversational-video-interface/persona/conversational-flow —
`turn_detection_model` (`sparrow-1`), `turn_taking_patience` (low/medium/high), `replica_interruptibility`
(low/medium/high), `voice_isolation` (near/off), `wake_phrase`, `idle_engagement` (off/patient/eager).
Note: the greeting is always non-interruptible.

### Stock personas

Doc: https://docs.tavus.io/sections/conversational-video-interface/persona/stock-personas — e.g.
Sales Coach `p1af207b8189`, Customer Support `paaee96e4f87`, Interviewer `pdac61133ac5`,
Sales Development Rep `pcb7a34da5fe`.

---

## 7. Conversation: create / get / end

Sources: https://docs.tavus.io/api-reference/conversations/create-conversation · https://docs.tavus.io/api-reference/conversations/get-conversation
· https://docs.tavus.io/api-reference/conversations/end-conversation · https://docs.tavus.io/sections/conversational-video-interface/conversation/overview

Auth: header `x-api-key`; base URL `https://tavusapi.com`; key from the Developer Portal (server-side
only — never ship it in client code). Billing/concurrency: credits start when the replica begins waiting
in the room; each live session uses one concurrency slot.

**Create** — `POST https://tavusapi.com/v2/conversations`:

```bash
curl --request POST --url https://tavusapi.com/v2/conversations \
  --header 'Content-Type: application/json' --header "x-api-key: $TAVUS_API_KEY" \
  --data '{
    "replica_id": "r90bbd427f71",
    "persona_id": "pcb7a34da5fe",
    "conversation_name": "Talk with Ed",
    "conversational_context": "Extra context appended to the persona.",
    "custom_greeting": "Hey, great to see you.",
    "callback_url": "https://myapp.com/webhook",
    "audio_only": false,
    "memory_stores": ["ed_p123"],
    "document_ids": ["d123"],
    "properties": {
      "max_call_duration": 1800,
      "participant_left_timeout": 60,
      "participant_absent_timeout": 300,
      "enable_recording": false,
      "enable_closed_captions": true,
      "apply_greenscreen": false,
      "language": "english"
    }
  }'
```

Response (200):

```json
{
  "conversation_id": "c123456",
  "conversation_name": "Talk with Ed",
  "conversation_url": "https://tavus.daily.co/c123456",
  "status": "active",
  "callback_url": "https://myapp.com/webhook",
  "created_at": "2026-04-29T12:00:00Z"
}
```

`conversation_url` is the Daily room to join. Other top-level fields: `document_retrieval_strategy`
(`speed`/`balanced`/`quality`), `document_tags`, `test_mode` (replica won't join), `require_auth`
(returns a `meeting_token` for private rooms), `max_participants`.

**Get** — `GET https://tavusapi.com/v2/conversations/{conversation_id}` (optional `?verbose=true`).
**End** — `POST https://tavusapi.com/v2/conversations/{conversation_id}/end` (routine cleanup; frees the
concurrency slot). A destructive **Delete** endpoint also exists.

`400` can mean validation error or "concurrent limit exceeded"; `401` means a bad key. Exact concurrency
limits are not published in the docs (plan-dependent).

---

## 8. Runtime control: driving the avatar with TEXT (the core of our build)

Source: https://docs.tavus.io/sections/conversational-video-interface/interactions-protocols/overview
(event schemas under https://docs.tavus.io/sections/event-schemas/)

Transport: interaction events flow over the **WebRTC data channel (Daily `app-message`)**. Send with
Daily's `call.sendAppMessage(interaction, '*')`; receive via `call.on('app-message', handler)`.

Envelope (always): `{ message_type: "conversation", event_type, conversation_id, properties }`. Tavus
adds `timestamp`, a monotonic `seq`, and `turn_idx` / `inference_id` for correlating a turn's events.

### Events we SEND (interactions)

- **`conversation.respond`** — type text and the persona's LLM answers as if the user said it. This is
  the natural chat-style text-input event. `properties: { text }`. Increments `turn_idx`.
  ```js
  call.sendAppMessage({ message_type:"conversation", event_type:"conversation.respond",
    conversation_id, properties:{ text:"What's the weather like?" } }, '*');
  ```
- **`conversation.echo`** — the replica speaks EXACTLY what you supply (no LLM). This is how we feed our
  OWN LLM's output (or any text) to the avatar. `properties`: `modality` (`text` default | `audio`),
  `text`, `inference_id` (optional; stable for streaming chunks), `done` (set `false` on streamed chunks,
  `true` on the last). For audio: base64 `audio` + `sample_rate` (default 16000), keep `done:false` until
  the final chunk.
  ```js
  call.sendAppMessage({ message_type:"conversation", event_type:"conversation.echo",
    conversation_id, properties:{ modality:"text", text:"Hi, I'm Ed's avatar.", done:true } }, '*');
  ```
- **`conversation.interrupt`** — stop the replica mid-speech. No `properties`.
- **`conversation.append_llm_context`** — append (or seed) conversational context mid-call;
  `properties: { context, job_status? }`.
- **`conversation.overwrite_llm_context`** — replace the conversational context; `properties: { context }`.

### Events we RECEIVE (observable)

`conversation.utterance` (full text per turn: `role`, `speech`, optional Raven `user_audio_analysis` /
`user_visual_analysis`, `interrupted`), `conversation.utterance.streaming` (progressive replica text),
`conversation.replica-started/stopped-speaking`, `conversation.user-started/stopped-speaking`, tool-call
events, perception tool-call / analysis events. Correlate via `seq`, `turn_idx`, `inference_id`.

---

## 9. Bring-your-own-LLM + realtime: the two patterns

This is the crux requirement (realtime is top priority; own LLM preferred). Both keep low latency
because everything streams.

1. **Server-side BYO-LLM (recommended).** Configure the persona `layers.llm` with our OpenAI-compatible
   streaming endpoint (`base_url` + `api_key` + `model`, `speculative_inference: true`). Run the
   conversation in `full` mode. At runtime, drive with `conversation.respond` (or just talk). Tavus calls
   our endpoint server-side and streams tokens straight into TTS + Phoenix — minimal added latency. Keep
   prompts <=5k tokens and use a fast-streaming model (e.g. a Haiku-class model).
2. **Client-side BYO-LLM via echo.** Run our LLM entirely ourselves, stream its tokens, and forward them
   to the replica with `conversation.echo` (`done:false` until the final chunk). Tavus does only TTS +
   rendering. Maximum control over the brain, but we own turn-taking/streaming logic. Use a persona in
   `echo` mode.

Pattern 1 is the default; it's the closest analogue to "ElevenLabs is realtime even with your own LLM."
The "slow and painful" failure mode only happens if we wait for a full completion before sending — so
always stream.

---

## 10. Developer integration: the `@tavus/cvi-ui` CLI, components, embedding

Source: https://docs.tavus.io/sections/conversational-video-interface/component-library/overview
· blocks/components/hooks: .../component-library/blocks · /components · /hooks · server: .../component-library/server
· embedding: https://docs.tavus.io/sections/integrations/embedding-cvi

The "Tavus CLI" is **`@tavus/cvi-ui`** — it copies React components/hooks/styles (and optional server
route) into your project (not a hosted widget). Requires an existing React project.

```bash
npx @tavus/cvi-ui@latest init            # creates cvi-components.json; installs @daily-co/daily-react, @daily-co/daily-js, jotai
npx @tavus/cvi-ui@latest add conversation # the full Conversation video-chat block + components/hooks
npx @tavus/cvi-ui@latest add tavus-api    # backend route + lib/tavus-client.ts (createTavusConversation / endTavusConversation)
# Vite + server runtime variant:
npx @tavus/cvi-ui@latest add tavus-api-vite-ssr   # handleTavusRequest(request): Response
```

- Blocks: `conversation-01` (full UI: video, self-view, chat panel, captions, screen-share, controls),
  `conversation-02` (minimal), `hair-check-01` (pre-call device test). `Conversation` props:
  `conversationUrl`, `onLeave`.
- Wrap the app in `CVIProvider` (Daily context). Components include device/media controls, closed
  captions (`ClosedCaptionsProvider` / `ClosedCaptions` / `ClosedCaptionsButton`), and chat
  (`ChatProvider` / `ChatPanel` / `ChatButton`).
- Hooks: `useCVICall` (`joinCall`/`leaveCall`), `useStartHaircheck`, `useLocalCamera`,
  `useLocalMicrophone`, `useReplicaIDs`, `useRemoteParticipantIDs`, `useObservableEvent` (listen for
  conversation events), `useSendAppMessage` (send interaction events), `useChat`, `useClosedCaption`.
- Server helper (`add tavus-api`): generates `lib/tavus-client.ts` exporting
  `createTavusConversation(params?)` and `endTavusConversation(id)`, both POSTing to a server route that
  forwards params verbatim to `POST /v2/conversations`. Keep `TAVUS_API_KEY` server-side only (do NOT
  prefix with `VITE_`/`NEXT_PUBLIC_`).

Simplest embed (no React): create a conversation, then drop the `conversation_url` into an iframe.

```html
<iframe src="YOUR_CONVERSATION_URL"
  allow="camera; microphone; fullscreen; display-capture; autoplay"
  style="width:100%; height:640px; border:none;"></iframe>
```

For custom UIs, use Daily JS / `@daily-co/daily-js` directly (`DailyIframe.createCallObject()` ->
`call.join({ url: conversation_url })`). Private rooms: append `?t=MEETING_TOKEN` or pass `token`.

### Quickstarts

- API conversation quickstart: https://docs.tavus.io/sections/conversational-video-interface/quickstart/cvi-quickstart
  (minimal: create persona -> create conversation -> open `conversation_url`).
- Build first app (Vite + React TS frontend, Express backend, Daily iframe):
  https://docs.tavus.io/sections/conversational-video-interface/quickstart/build-first-app
- AI prompt for coding agents (paste-in context bundle for Cursor/Copilot):
  https://docs.tavus.io/sections/conversational-video-interface/quickstart/ai-prompt-cvi-quickstart
  (env vars `VITE_TAVUS_API_KEY` / `VITE_REPLICA_ID` / `VITE_PERSONA_ID`).

---

## 11. Other integrations

- **LiveKit Agent** — https://docs.tavus.io/sections/integrations/livekit — Tavus as the avatar layer
  for a LiveKit voice agent. Persona must use `pipeline_mode: "echo"` and `transport_type: "livekit"`.
  Python `livekit-agents[tavus]`, `tavus.AvatarSession`; start the avatar before the agent session with
  `audio_enabled=False`.
- **Pipecat** — https://docs.tavus.io/sections/integrations/pipecat — `TavusTransport` (Tavus joins as a
  participant) or `TavusVideoService` (background video layer after TTS). `pip install
  "pipecat-ai[tavus,daily]"`. Linux/macOS only.

---

## 12. Webhooks & callbacks

Source: https://docs.tavus.io/sections/webhooks-and-callbacks

Pass `callback_url` on conversations, replicas, videos, etc. Payloads carry `message_type`
(`system` | `application`), `event_type`, `conversation_id`, `properties`, `timestamp`.

- System: `system.replica_joined` (replica ready in the room), `system.shutdown` (with
  `shutdown_reason`, e.g. `max_call_duration reached`, `end_conversation_endpoint_hit`).
- Application: `application.transcription_ready` (`properties.transcript[]` with role/content/timestamps
  after the call), `application.recording_ready` (storage bucket/key/uri), `application.recording_copy_failed`,
  `application.perception_analysis` (Raven visual summary; needs `raven-1`).
- Replica training: `{ replica_id, status: "ready" | "error" }`. Video generation has its own completion
  payload. Objectives/guardrails have their own callbacks.

Note: webhook signing/verification and retry policy are NOT documented — don't assume a signature header.

---

## 13. Knowledge base, memories, guardrails, objectives, language

- **Knowledge base (RAG)** — https://docs.tavus.io/sections/conversational-video-interface/knowledge-base
  — `POST /v2/documents` (`document_name`, `document_url`, `callback_url`) returns a `document_id`.
  Formats: pdf/txt/docx/doc/png/jpg/pptx/csv/xlsx. Attach via `document_ids` or `document_tags` on the
  conversation; tune `document_retrieval_strategy` (`speed`/`balanced`/`quality`). Website crawl via a
  `crawl` object (`depth` 1-10, `max_pages` 1-100). English-only currently. Retrieval ~30 ms.
- **Memories** — https://docs.tavus.io/sections/conversational-video-interface/memories — pass
  `memory_stores: ["stable_id"]` on conversation creation; reuse the same id across sessions to persist
  context for a participant. Delete via `DELETE /v2/memories/{store}/{memory_id}`.
- **Guardrails** (API-only): https://docs.tavus.io/api-reference/guardrails/create-guardrails —
  behavioral boundaries. **Objectives** (API-only): https://docs.tavus.io/sections/onboarding-guide/objectives
  — templated goal-driven workflows with completion criteria.
- **Language support** — https://docs.tavus.io/sections/conversational-video-interface/language-support —
  42 languages; set `properties.language` to the full language name (not a code), or `multilingual` for
  auto-detection. Cartesia TTS default with ElevenLabs fallback.

### Conversation customizations (in `properties`)

Docs under https://docs.tavus.io/sections/conversational-video-interface/conversation/customizations/ —
`audio_only` (STT/Perception/TTS stay active; only video is dropped), `max_call_duration` (<=3600),
`participant_left_timeout`, `participant_absent_timeout` (default 300), `enable_closed_captions`,
`apply_greenscreen` (composite a custom background on the frontend via WebGL), private rooms
(`require_auth`).

---

## 14. Latency optimization

Source: https://docs.tavus.io/sections/onboarding-guide/latency-optimization (covers JOIN latency only)

- Add a **Hair Check** so users set up devices while the replica joins in the background; detect
  readiness via Daily's `participant-joined` or the `system.replica_joined` event.
- Add a **network check** with Daily's `testCallQuality()` (streams ~30s, returns good/bad/warning) and
  warn users on poor connections.
- For inference latency, the levers live elsewhere: `speculative_inference: true`, a fast-streaming LLM,
  short prompts (<=5k tokens), and the `full` pipeline (external response loops add latency).

---

## 15. Pricing / plans (verify in dashboard; changes often)

Free tier ~25 live minutes; Starter ~$59/mo; usage-based Growth/Enterprise. Custom replicas require
Starter+. Conversation usage is per live minute; each session consumes a concurrency slot. Our ~$100
exploration budget comfortably covers building a custom replica and prototyping conversations.
Authoritative pricing: https://www.tavus.io and the Developer Portal.

---

## 16. Recommended build path for this project

1. Get an API key (Developer Portal); store as `TAVUS_API_KEY` server-side.
2. Prototype immediately with stock replica `r90bbd427f71` + a stock persona to learn the flow before
   our replica is trained.
3. Record the ~60s clip to spec (section 5) with the consent statement; host at a public URL;
   `POST /v2/replicas`; poll/webhook until `completed`.
4. Optionally clone our voice (ElevenLabs/Cartesia) and note its `external_voice_id`.
5. Create a Persona in `full` mode: our system prompt, `default_replica_id` = our replica, `layers.tts`
   = our voice, and `layers.llm` = our OpenAI-compatible streaming endpoint (pattern 1, section 9) with
   `speculative_inference: true`. Start with `tavus-claude-haiku-4.5` hosted to validate feel, then swap
   in our own endpoint.
6. Create a Conversation; embed `conversation_url` (iframe first, then `@tavus/cvi-ui` for a real UI).
7. Drive it with text via `conversation.respond` (LLM answers) — our "text input initially" requirement.
   Listen for `conversation.utterance` / speaking events. Use `conversation.echo` if we later move the
   LLM fully client-side.
8. Wire `callback_url` to handle `system.replica_joined`, `system.shutdown`, transcripts.

---

## 17. Gotchas / things the docs got specific about

- Tavus video training is ~60s (30 talk + 30 still), NOT 2 minutes. Follow the still-segment rules
  (closed neutral lips, no movement) or training quality suffers.
- BYO-LLM `base_url` must omit the route — Tavus appends `/chat/completions`; the endpoint must stream
  via SSE.
- Tavus does NOT execute tool calls (LLM or perception) — your frontend listens for the event and runs
  the logic.
- Keep `TAVUS_API_KEY` server-side; never prefix with `VITE_`/`NEXT_PUBLIC_`.
- The greeting is always non-interruptible regardless of interruptibility settings.
- Knowledge base is English-only; memories need a stable `memory_stores` id reused across sessions.
- `tavus-llama` does not exist; current hosted models are listed in section 6.
- The `.md` versions of the event-schema pages are empty stubs — read the normal (HTML) URLs for those.
- Webhook signature/verification and retry behavior are undocumented.
