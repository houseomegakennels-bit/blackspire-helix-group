import "server-only";

import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { readAssetBuffer } from "@/lib/book-studio/store";
import type { AssetRecord, VoiceName } from "@/lib/book-studio/types";

const DEFAULT_TEXT_MODEL = process.env.OPENAI_BOOK_TEXT_MODEL?.trim() || "gpt-4.1-mini";
const DEFAULT_IMAGE_MODEL = process.env.OPENAI_BOOK_IMAGE_MODEL?.trim() || "gpt-image-2";
const DEFAULT_TTS_MODEL = process.env.OPENAI_BOOK_TTS_MODEL?.trim() || "gpt-4o-mini-tts";
const MAX_IMAGE_REFERENCES = 8;

type JsonSchema = Record<string, unknown>;

function getApiKey() {
  return process.env.OPENAI_API_KEY?.trim() || "";
}

function getResponseText(payload: Record<string, unknown>) {
  if (typeof payload.output_text === "string") return payload.output_text;

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text =
        (part as { text?: unknown }).text ??
        (part as { output_text?: unknown }).output_text;
      if (typeof text === "string") return text;
    }
  }

  return "";
}

function getOpenAIError(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function toDataUrl(mimeType: string, buffer: Buffer) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function createSilentWav(seconds: number) {
  const sampleRate = 16000;
  const channels = 1;
  const bytesPerSample = 2;
  const frameCount = Math.max(1, Math.ceil(seconds * sampleRate));
  const dataSize = frameCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

function isEffectivelySilentWav(buffer: Buffer) {
  const dataIndex = buffer.indexOf("data", 36, "ascii");
  if (dataIndex < 0 || dataIndex + 8 >= buffer.length) return false;
  const dataStart = dataIndex + 8;
  const dataEnd = Math.min(buffer.length, dataStart + buffer.readUInt32LE(dataIndex + 4));
  let peak = 0;

  for (let offset = dataStart; offset + 1 < dataEnd; offset += 2) {
    const sample = Math.abs(buffer.readInt16LE(offset));
    if (sample > peak) peak = sample;
    if (peak > 64) return false;
  }

  return true;
}

async function safeUnlink(filePath: string) {
  try {
    await unlink(filePath);
  } catch {
    // Temp cleanup should never hide the original generation error.
  }
}

export async function runStructuredPrompt<T>({
  system,
  user,
  schema,
  model = DEFAULT_TEXT_MODEL,
  fallback,
}: {
  system: string;
  user: string;
  schema: JsonSchema;
  model?: string;
  fallback: T;
}) {
  const apiKey = getApiKey();
  if (!apiKey) return fallback;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: system }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: user }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "book_studio_payload",
            strict: true,
            schema,
          },
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) return fallback;
    const payload = (await response.json()) as Record<string, unknown>;
    const text = getResponseText(payload);
    if (!text) return fallback;
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function runVisionStructuredPrompt<T>({
  system,
  user,
  schema,
  image,
  model = DEFAULT_TEXT_MODEL,
  fallback,
}: {
  system: string;
  user: string;
  schema: JsonSchema;
  image: { mimeType: string; buffer: Buffer };
  model?: string;
  fallback: T;
}) {
  const apiKey = getApiKey();
  if (!apiKey) return fallback;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: system }],
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: user },
              {
                type: "input_image",
                image_url: toDataUrl(image.mimeType, image.buffer),
                detail: "high",
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "book_studio_vision_payload",
            strict: true,
            schema,
          },
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) return fallback;
    const payload = (await response.json()) as Record<string, unknown>;
    const text = getResponseText(payload);
    if (!text) return fallback;
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function generateImageBuffer({
  prompt,
  references,
}: {
  prompt: string;
  references: Array<{ mimeType: string; fileName: string; buffer: Buffer }>;
  title: string;
}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("OpenAI image generation is not configured. Add OPENAI_API_KEY in production.");
  }

  const errors: string[] = [];

  try {
    if (references.length) {
      const form = new FormData();
      form.append("model", DEFAULT_IMAGE_MODEL);
      form.append("prompt", prompt);
      form.append("size", "1536x1024");
      form.append("quality", "high");

      for (const reference of references.slice(0, MAX_IMAGE_REFERENCES)) {
        form.append(
          "image[]",
          new Blob([new Uint8Array(reference.buffer)], { type: reference.mimeType }),
          path.basename(reference.fileName),
        );
      }

      const response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(240_000),
      });
      const payload = (await response.json()) as { data?: Array<{ b64_json?: string }> };
      const b64 = payload.data?.[0]?.b64_json;
      if (response.ok && b64) {
        return {
          buffer: Buffer.from(b64, "base64"),
          mimeType: "image/png",
          extension: "png",
        };
      }
      errors.push(getOpenAIError(payload) || `OpenAI image edit failed with status ${response.status}.`);
    }

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_IMAGE_MODEL,
        prompt,
        size: "1536x1024",
        quality: "high",
        output_format: "png",
      }),
      signal: AbortSignal.timeout(240_000),
    });
    const payload = (await response.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = payload.data?.[0]?.b64_json;
    if (response.ok && b64) {
      return {
        buffer: Buffer.from(b64, "base64"),
        mimeType: "image/png",
        extension: "png",
      };
    }
    errors.push(getOpenAIError(payload) || `OpenAI image generation failed with status ${response.status}.`);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "OpenAI image generation request failed.");
  }

  throw new Error(errors.filter(Boolean).join(" ") || "OpenAI image generation failed.");
}

function splitTextForSpeech(text: string, limit = 3900) {
  const segments: string[] = [];
  let current = "";

  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (!sentence) continue;
    if ((current + sentence).length > limit && current) {
      segments.push(current.trim());
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }

  if (current.trim()) segments.push(current.trim());
  return segments.length ? segments : [text.slice(0, limit)];
}

async function probeMediaDurationSeconds(filePath: string) {
  const ffmpegModule = await import("ffmpeg-static");
  const ffmpegPath = ffmpegModule.default;
  const executable = typeof ffmpegPath === "string" ? ffmpegPath : null;
  if (!executable) {
    throw new Error("ffmpeg-static is unavailable in this environment.");
  }

  const stderr = await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, ["-i", filePath, "-f", "null", "-"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let output = "";
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", () => resolve(output));
  });

  const match = stderr.match(/Duration: (\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) throw new Error(`Unable to probe media duration for ${path.basename(filePath)}.`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4]}`);
}

// The video track must cover the full narration or `-shortest` in the mux
// cuts the end of the chapter audio; scene durations are only estimates.
function fitSceneDurationsToAudio(
  sceneAssets: Array<{ path: string; durationSeconds: number }>,
  audioDurationSeconds: number,
) {
  const raw = sceneAssets.map((scene) => Math.max(2, scene.durationSeconds));
  const rawTotal = raw.reduce((sum, value) => sum + value, 0);
  const scale = (audioDurationSeconds + 1) / rawTotal;
  return sceneAssets.map((scene, i) => ({ ...scene, durationSeconds: Math.max(2, raw[i] * scale) }));
}

async function runFfmpeg(args: string[]) {
  const ffmpegModule = await import("ffmpeg-static");
  const ffmpegPath = ffmpegModule.default;
  const executable = typeof ffmpegPath === "string" ? ffmpegPath : null;
  if (!executable) {
    throw new Error("ffmpeg-static is unavailable in this environment.");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

export async function generateSpeechAudio({
  text,
  voice,
  targetPath,
}: {
  text: string;
  voice: VoiceName;
  targetPath: string;
}) {
  const apiKey = getApiKey();
  const estimatedDurationSeconds = Math.max(4, Math.round((text.split(/\s+/).length / 160) * 60));

  if (!apiKey) {
    throw new Error("OpenAI API key is not configured, so scene audio cannot be generated.");
  }

  const chunks = splitTextForSpeech(text);
  const chunkPaths: string[] = [];

  try {
    for (let i = 0; i < chunks.length; i += 1) {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: DEFAULT_TTS_MODEL,
          voice,
          input: chunks[i],
          response_format: "wav",
        }),
        signal: AbortSignal.timeout(240_000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`OpenAI TTS request failed (${response.status}): ${errorText || response.statusText}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (isEffectivelySilentWav(bytes)) {
        throw new Error("OpenAI TTS returned silent audio; no scene audio asset was saved.");
      }
      const chunkPath = targetPath.replace(/\.wav$/i, `.${i}.wav`);
      await writeFile(chunkPath, bytes);
      chunkPaths.push(chunkPath);
    }

    if (chunkPaths.length === 1) {
      const bytes = await readFile(chunkPaths[0]);
      await writeFile(targetPath, bytes);
    } else {
      const concatFile = targetPath.replace(/\.wav$/i, ".concat.txt");
      await writeFile(
        concatFile,
        chunkPaths.map((chunkPath) => `file '${chunkPath.replace(/'/g, "'\\''")}'`).join("\n"),
        "utf8",
      );
      await runFfmpeg([
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatFile,
        "-c",
        "copy",
        targetPath,
      ]);
    }

    return { mimeType: "audio/wav", extension: "wav", durationSeconds: estimatedDurationSeconds };
  } catch (error) {
    await Promise.all(chunkPaths.map((chunkPath) => safeUnlink(chunkPath)));
    await safeUnlink(targetPath);
    throw error;
  }
}

const MOTION_VIDEO_WIDTH = 1280;
const MOTION_VIDEO_HEIGHT = 720;
const MOTION_VIDEO_FPS = 20;
const MOTION_FADE_SECONDS = 0.4;
const MOTION_MAX_ZOOM = 1.08;

function motionVideoEnabled() {
  return (process.env.BOOK_STUDIO_MOTION_VIDEO?.trim().toLowerCase() || "on") !== "off";
}

function kenBurnsExpressions(sceneIndex: number, frameCount: number) {
  const zoomSpan = MOTION_MAX_ZOOM - 1;
  const progress = `(on/${frameCount})`;
  const centerX = "(iw-iw/zoom)/2";
  const centerY = "(ih-ih/zoom)/2";

  switch (sceneIndex % 4) {
    case 0:
      return { zoom: `1+${zoomSpan}*${progress}`, x: centerX, y: centerY };
    case 1:
      return { zoom: `${MOTION_MAX_ZOOM}-${zoomSpan}*${progress}`, x: centerX, y: centerY };
    case 2:
      return { zoom: `${MOTION_MAX_ZOOM}`, x: `(iw-iw/zoom)*${progress}`, y: centerY };
    default:
      return { zoom: `${MOTION_MAX_ZOOM}`, x: centerX, y: `(ih-ih/zoom)*${progress}` };
  }
}

async function renderSceneMotionClip({
  imagePath,
  clipPath,
  durationSeconds,
  sceneIndex,
}: {
  imagePath: string;
  clipPath: string;
  durationSeconds: number;
  sceneIndex: number;
}) {
  const frameCount = Math.max(MOTION_VIDEO_FPS, Math.round(durationSeconds * MOTION_VIDEO_FPS));
  const { zoom, x, y } = kenBurnsExpressions(sceneIndex, frameCount);
  const fadeOutStart = Math.max(0, durationSeconds - MOTION_FADE_SECONDS);
  const filters = [
    `scale=${MOTION_VIDEO_WIDTH * 2}:${MOTION_VIDEO_HEIGHT * 2}:force_original_aspect_ratio=increase`,
    `crop=${MOTION_VIDEO_WIDTH * 2}:${MOTION_VIDEO_HEIGHT * 2}`,
    `zoompan=z='${zoom}':x='${x}':y='${y}':d=${frameCount}:s=${MOTION_VIDEO_WIDTH}x${MOTION_VIDEO_HEIGHT}:fps=${MOTION_VIDEO_FPS}`,
    `fade=t=in:st=0:d=${MOTION_FADE_SECONDS}`,
    `fade=t=out:st=${fadeOutStart.toFixed(2)}:d=${MOTION_FADE_SECONDS}`,
    "format=yuv420p",
  ].join(",");

  await runFfmpeg([
    "-y",
    "-i",
    imagePath,
    "-vf",
    filters,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-b:v",
    "800k",
    "-maxrate",
    "1000k",
    "-bufsize",
    "2000k",
    "-an",
    clipPath,
  ]);
}

async function renderChapterSlideshowFromAssets({
  sceneAssets,
  audioPath,
  outputPath,
}: {
  sceneAssets: Array<{ path: string; durationSeconds: number }>;
  audioPath: string;
  outputPath: string;
}) {
  const concatFile = outputPath.replace(/\.mp4$/i, ".ffconcat");
  const lines = ["ffconcat version 1.0"];

  for (const scene of sceneAssets) {
    const scenePath = scene.path.replace(/\\/g, "/");
    lines.push(`file '${scenePath.replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${Math.max(2, scene.durationSeconds)}`);
  }

  if (sceneAssets.length) {
    const lastPath = sceneAssets[sceneAssets.length - 1].path.replace(/\\/g, "/");
    lines.push(`file '${lastPath.replace(/'/g, "'\\''")}'`);
  }

  await writeFile(concatFile, lines.join("\n"), "utf8");
  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatFile,
    "-i",
    audioPath,
    "-shortest",
    "-vsync",
    "vfr",
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    outputPath,
  ]);
}

async function renderChapterMotionVideoFromAssets({
  sceneAssets,
  audioPath,
  outputPath,
}: {
  sceneAssets: Array<{ path: string; durationSeconds: number }>;
  audioPath: string;
  outputPath: string;
}) {
  const clipPaths: string[] = [];

  try {
    for (let i = 0; i < sceneAssets.length; i += 1) {
      const clipPath = outputPath.replace(/\.mp4$/i, `.clip-${i}.mp4`);
      await renderSceneMotionClip({
        imagePath: sceneAssets[i].path,
        clipPath,
        durationSeconds: Math.max(2, sceneAssets[i].durationSeconds),
        sceneIndex: i,
      });
      clipPaths.push(clipPath);
    }

    const concatFile = outputPath.replace(/\.mp4$/i, ".clips.ffconcat");
    const lines = ["ffconcat version 1.0"];
    for (const clipPath of clipPaths) {
      lines.push(`file '${clipPath.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`);
    }
    await writeFile(concatFile, lines.join("\n"), "utf8");

    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatFile,
      "-i",
      audioPath,
      "-shortest",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      outputPath,
    ]);
  } finally {
    await Promise.all(clipPaths.map((clipPath) => safeUnlink(clipPath)));
  }
}

export async function renderChapterVideoFromAssets({
  sceneAssets,
  audioPath,
  outputPath,
}: {
  sceneAssets: Array<{ path: string; durationSeconds: number }>;
  audioPath: string;
  outputPath: string;
}) {
  if (sceneAssets.length) {
    const audioDurationSeconds = await probeMediaDurationSeconds(audioPath);
    sceneAssets = fitSceneDurationsToAudio(sceneAssets, audioDurationSeconds);
  }

  if (motionVideoEnabled() && sceneAssets.length) {
    try {
      await renderChapterMotionVideoFromAssets({ sceneAssets, audioPath, outputPath });
      return;
    } catch (error) {
      console.error(
        "Motion chapter video failed; falling back to still slideshow.",
        error instanceof Error ? error.message : error,
      );
      await safeUnlink(outputPath);
    }
  }

  await renderChapterSlideshowFromAssets({ sceneAssets, audioPath, outputPath });
}

export async function concatenateAudioAssets({
  assets,
  outputPath,
}: {
  assets: AssetRecord[];
  outputPath: string;
}) {
  if (!assets.length) {
    await writeFile(outputPath, createSilentWav(6));
    return;
  }

  if (assets.length === 1) {
    const bytes = await readAssetBuffer(assets[0].relativePath);
    await writeFile(outputPath, bytes);
    return;
  }

  const concatFile = outputPath.replace(/\.wav$/i, ".concat.txt");
  const stagingDir = outputPath.replace(/\.wav$/i, ".parts");
  await writeFile(concatFile, "", "utf8");
  const stagedPaths: string[] = [];
  for (let i = 0; i < assets.length; i += 1) {
    const stagedPath = `${stagingDir}-${i}.wav`;
    await writeFile(stagedPath, await readAssetBuffer(assets[i].relativePath));
    stagedPaths.push(stagedPath);
  }
  await writeFile(
    concatFile,
    stagedPaths
      .map((assetPath) => `file '${assetPath.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
      .join("\n"),
    "utf8",
  );

  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatFile,
    "-c",
    "copy",
    outputPath,
  ]);
}
