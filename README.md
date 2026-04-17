# Narrify — URL to Video with AI

Narrify turns any news article or web page into a short vertical video (Instagram Reels / TikTok style) using AI.
<img width="1282" height="639" alt="image" src="https://github.com/user-attachments/assets/3264354e-5b74-4c2b-8742-c0486ace4636" />

## How it works

1. You paste a URL into the input field
2. The backend fetches and strips the article text
3. [GPTScript](https://github.com/gptscript-ai/gptscript) orchestrates a multi-step AI pipeline:
   - **GPT-4o** writes a 100-word TL;DR script and splits it into 3 parts
   - **DALL-E 3** generates a vertical b-roll background image (1024×1792) for each part
   - **OpenAI TTS** generates a voiceover audio file for each part
   - **OpenAI Whisper** transcribes each audio file with word-level timestamps
4. **FFmpeg** combines each image + audio into a video segment with animated subtitles
5. The 3 segments are merged into a final `final.mp4`

## Requirements

- [Bun](https://bun.sh) v1.1+
- [Node.js](https://nodejs.org) v20+ (used by GPTScript browser tool)
- An **OpenAI API key** with access to:
  - `gpt-4o`
  - `dall-e-3`
  - `tts-1`
  - `whisper-1`
- Chromium installed via Playwright (for the browser tool, if used):
  ```bash
  npx playwright install chromium
  ```

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/Jack3dApe/Narrify.git
cd Narrify
```

### 2. Install dependencies

```bash
cd backend && bun install
cd ../frontend && bun install
```

### 3. Configure environment

Create `backend/.env`:

```env
OPENAI_API_KEY=sk-...
```

## Running

Open two terminals:

**Terminal 1 — Backend** (port 8080):
```bash
cd backend
bun run index.js
```

**Terminal 2 — Frontend** (port 5173):
```bash
cd frontend
bun run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

## Usage

1. Paste a URL to any news article or web page
2. Click **Create Video**
3. Wait — the pipeline takes 1–3 minutes (image generation + TTS + transcription)
4. The final video plays automatically in the browser when ready

## Project structure

```
Narrify/
├── backend/
│   ├── index.js       # Express server — fetch, GPTScript orchestration, FFmpeg
│   ├── story.gpt      # GPTScript pipeline definition
│   └── stories/       # Generated assets and videos (auto-created)
└── frontend/
    └── src/
        └── App.tsx    # React UI
```

## Notes

- The OpenAI account must be at least **Tier 1** to avoid TPM rate limit errors on large pages
- Generated videos are stored in `backend/stories/<id>/final.mp4` and served statically
- The frontend shows previously generated videos as samples on the home page
