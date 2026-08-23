import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const JOB_ID = process.env.JOB_ID || 'render';
const BUNDLE_PATH = process.env.BUNDLE_PATH || `render-jobs/${JOB_ID}/bundle.json`;

function log(...a) { console.log(...a); }

function download(url, dest) {
  try {
    execFileSync('curl', ['-sL', '--fail', '-o', dest, url], { stdio: 'pipe' });
    return true;
  } catch (e) {
    log(`  ! download failed: ${url}`);
    return false;
  }
}

function buildSegment(scene, assets, workdir, out, fast) {
  const dur = Math.max(1, Math.round((scene.end_sec || 0) - (scene.start_sec || 0)));
  const W = 1280, H = 720;
  const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  const preset = 'ultrafast';
  const crf = fast ? 28 : 26;

  const vf = [`scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`];
  if (scene.on_screen_text) {
    const textFile = join(workdir, `text_${scene.index}.txt`);
    writeFileSync(textFile, scene.on_screen_text);
    vf.push(`drawtext=fontfile=${font}:textfile=${textFile}:fontsize=40:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-text_w)/2:y=h-text_h-60`);
  }
  if (scene.transition === 'fade') {
    vf.push('fade=t=in:st=0:d=0.3', `fade=t=out:st=${Math.max(0, dur - 0.3)}:d=0.3`);
  }
  const vfArg = vf.join(',');

  const clip = assets.clips[scene.index];
  const still = assets.stills[scene.index];
  let args;
  if (clip && existsSync(clip)) {
    args = ['-i', clip, '-t', String(dur), '-vf', vfArg, '-r', '30', '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-an', out];
  } else if (still && existsSync(still)) {
    args = ['-loop', '1', '-i', still, '-t', String(dur), '-vf', vfArg, '-r', '30', '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-an', out];
  } else {
    args = ['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=${dur}`, '-vf', vfArg, '-r', '30', '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-an', out];
  }
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
}

function runRender(bundle, workdir, fast) {
  const segDir = join(workdir, 'segments');
  mkdirSync(segDir, { recursive: true });

  const assets = { stills: {}, clips: {} };
  for (const s of (bundle.stills || [])) {
    const p = join(workdir, `still_${s.scene_index}.jpg`);
    if (download(s.url, p)) assets.stills[s.scene_index] = p;
  }
  for (const c of (bundle.hero_clips || [])) {
    const p = join(workdir, `clip_${c.scene_index}.mp4`);
    if (download(c.url, p)) assets.clips[c.scene_index] = p;
  }
  const audioSegs = [];
  for (const v of (bundle.voiceover_segments || [])) {
    const p = join(workdir, `audio_${v.index}.mp3`);
    if (download(v.url, p)) audioSegs.push(p);
  }

  const segFiles = [];
  for (const sc of (bundle.scenes || [])) {
    const out = join(segDir, `seg_${String(sc.index).padStart(3, '0')}.mp4`);
    buildSegment(sc, assets, workdir, out, fast);
    segFiles.push(out);
  }

  const listPath = join(workdir, 'video_list.txt');
  writeFileSync(listPath, segFiles.map((f) => `file '${f}'`).join('\n'));
  const videoPath = join(workdir, 'video.mp4');
  execFileSync('ffmpeg', ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', videoPath], { stdio: 'inherit' });

  let finalPath = videoPath;
  if (audioSegs.length) {
    const aList = join(workdir, 'audio_list.txt');
    writeFileSync(aList, audioSegs.map((f) => `file '${f}'`).join('\n'));
    const audioPath = join(workdir, 'audio.m4a');
    execFileSync('ffmpeg', ['-f', 'concat', '-safe', '0', '-i', aList, '-c:a', 'aac', audioPath], { stdio: 'inherit' });
    finalPath = join(workdir, 'final.mp4');
    execFileSync('ffmpeg', ['-i', videoPath, '-i', audioPath, '-c', 'copy', '-shortest', finalPath], { stdio: 'inherit' });
  }
  return finalPath;
}

function main() {
  log(`Rendering job ${JOB_ID} from ${BUNDLE_PATH}`);
  const bundle = JSON.parse(readFileSync(BUNDLE_PATH, 'utf8'));
  const workdir = join(tmpdir(), `render_${JOB_ID}`);
  mkdirSync(workdir, { recursive: true });

  let finalPath;
  try {
    finalPath = runRender(bundle, workdir, false);
  } catch (e) {
    log(`First render failed: ${e.message} — retrying with optimized FFmpeg settings…`);
    try {
      finalPath = runRender(bundle, workdir, true);
    } catch (e2) {
      log(`Retry also failed: ${e2.message}`);
      process.exit(1);
    }
  }

  execFileSync('cp', [finalPath, 'final.mp4'], { stdio: 'inherit' });
  log('RENDER_OK final.mp4');
}

main();
