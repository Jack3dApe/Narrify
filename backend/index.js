import express from 'express';
import 'dotenv/config';
import uniqid from 'uniqid';
import fs from 'fs';
import cors from 'cors';
import { spawn } from 'node:child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import * as path from 'node:path';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GPTSCRIPT_BIN = path.join(__dirname, 'node_modules/.bin/gptscript');
const STORY_GPT = path.join(__dirname, 'story.gpt');

// ─── fetch + strip HTML ───────────────────────────────────────────────────────

async function fetchArticleText(url) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? httpsGet : httpGet;
    get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchArticleText(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const text = data
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 12000);
        resolve(text);
      });
    }).on('error', reject);
  });
}

// ─── run gptscript as child process ──────────────────────────────────────────

function runGptScript(articleFile, storyDir) {
  return new Promise((resolve, reject) => {
    console.log('[GPT] Spawning gptscript...');
    console.log('[GPT] Script:', STORY_GPT);
    console.log('[GPT] articleFile:', articleFile);
    console.log('[GPT] storyDir:', storyDir);

    const proc = spawn(GPTSCRIPT_BIN, [
      '--disable-tui',
      '--credential-override', `sys.openai:OPENAI_API_KEY=${process.env.OPENAI_API_KEY}`,
      STORY_GPT,
      '--articleFile', articleFile,
      '--dir', storyDir,
    ], {
      env: { ...process.env },
    });

    proc.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        // tag lines by what they mention
        if (/image.gen|imageGen|dall.e/i.test(line)) {
          console.log(`[IMAGE] ${line}`);
        } else if (/text2speech|tts/i.test(line)) {
          console.log(`[TTS]   ${line}`);
        } else if (/speech2text|whisper|transcri/i.test(line)) {
          console.log(`[STT]   ${line}`);
        } else if (/download/i.test(line)) {
          console.log(`[DL]    ${line}`);
        } else if (/write/i.test(line)) {
          console.log(`[WRITE] ${line}`);
        } else if (/error|Error/i.test(line)) {
          console.log(`[ERR]   ${line}`);
        } else {
          console.log(`[GPT]   ${line}`);
        }
      }
    });

    proc.stderr.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        console.log(`[GPT-STDERR] ${line}`);
      }
    });

    proc.on('error', (err) => {
      console.error('[GPT] Failed to spawn process:', err.message);
      reject(err);
    });

    proc.on('close', (code) => {
      console.log(`[GPT] Process exited with code ${code}`);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`gptscript exited with code ${code}`));
      }
    });
  });
}

// ─── express app ─────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.static('stories'));
ffmpeg.setFfmpegPath(ffmpegPath);

app.get('/test', (_req, res) => res.json('test ok'));

// ─── create story ─────────────────────────────────────────────────────────────

app.get('/create-story', async (req, res) => {
  const url = decodeURIComponent(req.query.url);
  const dir = uniqid();
  const storyDir = path.join(__dirname, 'stories', dir);
  fs.mkdirSync(storyDir, { recursive: true });

  console.log('\n=== CREATE STORY ===');
  console.log('URL:', url);
  console.log('Dir:', storyDir);

  try {
    // 1. fetch article
    console.log('[FETCH] Fetching article text...');
    const articleText = await fetchArticleText(url);
    const articleFile = path.join(storyDir, 'article.txt');
    fs.writeFileSync(articleFile, articleText, 'utf8');
    console.log(`[FETCH] Done — ${articleText.length} chars saved to ${articleFile}`);

    // 2. run gptscript pipeline
    await runGptScript(articleFile, storyDir);

    // 3. verify assets exist
    const expected = [
      'b-roll-1.png', 'b-roll-2.png', 'b-roll-3.png',
      'voiceover-1.mp3', 'voiceover-2.mp3', 'voiceover-3.mp3',
      'voiceover-1.txt', 'voiceover-2.txt', 'voiceover-3.txt',
    ];
    const missing = expected.filter(f => !fs.existsSync(path.join(storyDir, f)));
    if (missing.length > 0) {
      console.error('[ASSETS] Missing files:', missing);
      return res.json('error');
    }
    console.log('[ASSETS] All assets present');
    return res.json(dir);

  } catch (e) {
    console.error('[ERROR] create-story failed:', e.message);
    return res.json('error');
  }
});

// ─── build video ──────────────────────────────────────────────────────────────

app.get('/build-video', async (req, res) => {
  const id = req.query.id;
  console.log('\n=== BUILD VIDEO ===', id);

  if (!id || id === 'error') return res.status(400).json('error: missing id');

  const dir = path.join(__dirname, 'stories', id);
  if (!fs.existsSync(dir)) return res.status(404).json('error: story not found');

  try {
    // rename assets to numbered convention
    if (!fs.existsSync(path.join(dir, '1.png'))) {
      for (let i = 1; i <= 3; i++) {
        fs.renameSync(path.join(dir, `b-roll-${i}.png`),    path.join(dir, `${i}.png`));
        fs.renameSync(path.join(dir, `voiceover-${i}.mp3`), path.join(dir, `${i}.mp3`));
        fs.renameSync(path.join(dir, `voiceover-${i}.txt`), path.join(dir, `transcription-${i}.json`));
      }
      console.log('[VIDEO] Assets renamed');
    }

    // build one video segment per image+audio pair
    for (let i = 0; i < 3; i++) {
      const imgPath   = path.join(dir, `${i + 1}.png`);
      const audioPath = path.join(dir, `${i + 1}.mp3`);
      const jsonPath  = path.join(dir, `transcription-${i + 1}.json`);
      const outPath   = path.join(dir, `output_${i}.mp4`);

      console.log(`[VIDEO] Building segment ${i + 1}...`);

      const transcription = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const words    = transcription.words || [];
      const duration = parseFloat(transcription.duration).toFixed(2);

      let drawtextFilter = words.map(w => {
        const word  = w.word.replace(/'/g, "\\'").replace(/"/g, '\\"');
        const start = parseFloat(w.start).toFixed(2);
        const end   = parseFloat(w.end).toFixed(2);
        return `drawtext=text='${word}':fontcolor=white:fontsize=96:borderw=4:bordercolor=black:x=(w-text_w)/2:y=(h*3/4)-text_h:enable='between(t\\,${start}\\,${end})'`;
      }).join(',');

      await new Promise((resolve, reject) => {
        const cmd = ffmpeg()
          .input(imgPath).loop(duration)
          .input(audioPath)
          .audioCodec('copy')
          .outputOptions('-t', duration);
        if (drawtextFilter) cmd.videoFilter(drawtextFilter);
        cmd
          .on('start', c => console.log(`[FFMPEG] ${c.slice(0, 80)}...`))
          .on('error', reject)
          .on('end', () => { console.log(`[VIDEO] Segment ${i + 1} done`); resolve(); })
          .save(outPath);
      });
    }

    // merge segments
    console.log('[VIDEO] Merging segments...');
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(path.join(dir, 'output_0.mp4'))
        .input(path.join(dir, 'output_1.mp4'))
        .input(path.join(dir, 'output_2.mp4'))
        .on('error', reject)
        .on('end', () => { console.log('[VIDEO] Merge complete'); resolve(); })
        .mergeToFile(path.join(dir, 'final.mp4'));
    });

    return res.json(`${id}/final.mp4`);

  } catch (e) {
    console.error('[ERROR] build-video failed:', e.message);
    return res.status(500).json('error');
  }
});

// ─── samples ──────────────────────────────────────────────────────────────────

app.get('/samples', (_req, res) => {
  const storiesDir = path.join(__dirname, 'stories');
  if (!fs.existsSync(storiesDir)) return res.json([]);
  const stories = fs.readdirSync(storiesDir).filter(d =>
    /^[a-z0-9]{6,}$/.test(d) && fs.existsSync(path.join(storiesDir, d, 'final.mp4'))
  );
  console.log('[SAMPLES]', stories);
  res.json(stories);
});

app.listen(8080, () => console.log('Listening on port 8080'));
