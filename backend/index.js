import express from 'express';
import 'dotenv/config';
import uniqid from 'uniqid';
import fs from 'fs';
import cors from 'cors';
import { GPTScript, RunEventType } from "@gptscript-ai/gptscript";
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from "ffmpeg-static";
import * as path from 'node:path';       

const app = express();
app.use(cors());
app.use(express.static('stories'));

ffmpeg.setFfmpegPath(ffmpegPath);
const g = new GPTScript();

console.log("Server starting...");

app.get('/test', (req, res) => {
  return res.json('test ok');
});

app.get('/create-story', async (req, res) => {
 const url = decodeURIComponent(req.query.url);
  const dir = uniqid();
  const storyDir = path.join(process.cwd(), 'stories', dir); 
  fs.mkdirSync(storyDir, { recursive: true });

  console.log("Story parameters:", { url, dir, storyDir });

  // usamos o próprio url original, mas envolvido em aspas triplas no input
  const opts = {
    input: `--url """${url}""" --dir """${storyDir}"""`,
    disableCache: true,
  };

  try {
    console.log("1. Starting GPTScript run");
    console.log("API key prefix:", process.env.OPENAI_API_KEY?.slice(0, 7) + "...");
    console.log("Options received:", opts);

    const run = await g.run(path.join(process.cwd(), 'story.gpt'), {
      ...opts,
      env: [
        `OPENAI_API_KEY=${process.env.OPENAI_API_KEY}`,
        `GPTSCRIPT_DEBUG=true`,
      ],
    });

    console.log("2. GPTScript run object created");

    run.on(RunEventType.Event, ev => {
  // tipo do evento
  console.log("Event:", ev.type);

    if (ev.tool) {
      console.log("  tool:", ev.tool);
    }
    if (ev.name) {
      console.log("  name:", ev.name);
    }
    if (ev.callId) {
      console.log("  callId:", ev.callId);
    }

    if (ev.error) {
      console.log("  ERROR from event:", ev.error);
    }

    if (ev.type === RunEventType.CallFinish && ev.output) {
      console.log("  OUTPUT:", ev.output);
    }
    });

    console.log("3. Awaiting run.text()");
    const result = await run.text();
    console.log("4. GPTScript finished, result received:", result);

    return res.json(dir);
  } catch (e) {
    console.log("Error during story creation:", e);
    return res.json('error');
  }
});

app.get('/build-video', async (req, res) => {
  console.log("GET /build-video called");
  const id = req.query.id;
  if (!id || id === 'error') {
    console.log("Invalid or missing ID");
    return res.status(400).json('error. missing or invalid id');
  }

  const dir = './stories/' + id;
  if (!fs.existsSync(dir)) {
    console.log("Directory not found:", dir);
    return res.status(404).json('story not found');
  }

  const hasAssets =
    fs.existsSync(dir + '/b-roll-1.png') &&
    fs.existsSync(dir + '/b-roll-2.png') &&
    fs.existsSync(dir + '/b-roll-3.png') &&
    fs.existsSync(dir + '/voiceover-1.mp3') &&
    fs.existsSync(dir + '/voiceover-2.mp3') &&
    fs.existsSync(dir + '/voiceover-3.mp3');

  if (!hasAssets) {
    console.log("Assets not generated for", dir);
    return res.status(400).json('assets not generated');
  }
  console.log("Directory found:", dir);

  if (!fs.existsSync(path.join(dir, '1.png'))) {
    fs.renameSync(path.join(dir, 'b-roll-1.png'), path.join(dir, '1.png'));
    fs.renameSync(path.join(dir, 'b-roll-2.png'), path.join(dir, '2.png'));
    fs.renameSync(path.join(dir, 'b-roll-3.png'), path.join(dir, '3.png'));
    fs.renameSync(path.join(dir, 'voiceover-1.mp3'), path.join(dir, '1.mp3'));
    fs.renameSync(path.join(dir, 'voiceover-2.mp3'), path.join(dir, '2.mp3'));
    fs.renameSync(path.join(dir, 'voiceover-3.mp3'), path.join(dir, '3.mp3'));
    fs.renameSync(path.join(dir, 'voiceover-1.txt'), path.join(dir, 'transcription-1.json'));
    fs.renameSync(path.join(dir, 'voiceover-2.txt'), path.join(dir, 'transcription-2.json'));
    fs.renameSync(path.join(dir, 'voiceover-3.txt'), path.join(dir, 'transcription-3.json'));
    console.log("File rename complete");
  }

  const images = ['1.png', '2.png', '3.png'];
  const audio = ['1.mp3', '2.mp3', '3.mp3'];
  const transcriptions = [
    'transcription-1.json',
    'transcription-2.json',
    'transcription-3.json'
  ];

  console.log("Building individual videos...");

  for (let i = 0; i < images.length; i++) {
    const inputImage = path.join(dir, images[i]);
    const inputAudio = path.join(dir, audio[i]);
    const inputTranscription = path.join(dir, transcriptions[i]);
    const outputVideo = path.join(dir, `output_${i}.mp4`);

    console.log("Reading transcription:", inputTranscription);
    const transcription = JSON.parse(fs.readFileSync(inputTranscription, 'utf8'));
    const words = transcription.words;
    const duration = parseFloat(transcription.duration).toFixed(2);

    console.log("Generating drawtext filter...");
    let drawtextFilter = '';
    words.forEach(wordInfo => {
      const word = wordInfo.word.replace(/'/g, "\\'").replace(/"/g, '\\"');
      const start = parseFloat(wordInfo.start).toFixed(2);
      const end = parseFloat(wordInfo.end).toFixed(2);
      drawtextFilter += `drawtext=text='${word}':fontcolor=white:fontsize=96:borderw=4:bordercolor=black:x=(w-text_w)/2:y=(h*3/4)-text_h:enable='between(t\\,${start}\\,${end})',`;
    });
    drawtextFilter = drawtextFilter.slice(0, -1);

    console.log(`Processing: ${inputImage} and ${inputAudio}`);
    console.log(`Running ffmpeg for segment ${i + 1}`);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(inputImage)
        .loop(duration)
        .input(inputAudio)
        .audioCodec('copy')
        .videoFilter(drawtextFilter)
        .outputOptions('-t', duration)
        .on('error', e => {
          console.error(e);
          reject(e);
        })
        .on('end', resolve)
        .save(outputVideo);
    });

    console.log(`Video segment complete: ${outputVideo}`);
  }

  console.log("Merging all videos...");
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(path.join(dir, 'output_0.mp4'))
      .input(path.join(dir, 'output_1.mp4'))
      .input(path.join(dir, 'output_2.mp4'))
      .on('end', resolve)
      .on('error', reject)
      .mergeToFile(path.join(dir, 'final.mp4'));
  });

  console.log("All videos merged successfully");
  return res.json(`${id}/final.mp4`);
});

app.get('/samples', (req, res) => {
  console.log("GET /samples called");
  const stories = fs.readdirSync('./stories').filter(dir => {
    return dir.match(/^[a-z0-9]{6,}$/) && fs.existsSync(`./stories/${dir}/final.mp4`);
  });
  console.log("Samples found:", stories);
  res.json(stories);
});

app.listen(8080, () => console.log('Listening on port 8080'));
