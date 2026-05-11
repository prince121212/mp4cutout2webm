import express from "express";
import multer from "multer";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const app = express();
const port = Number(process.env.PORT || 3000);
const rootDir = resolve(".");
const publicDir = join(rootDir, "public");
const uploadDir = join(rootDir, "uploads");
const tempDir = join(rootDir, "temp");
const outputDir = join(rootDir, "outputs");

for (const dir of [uploadDir, tempDir, outputDir]) {
  mkdirSync(dir, { recursive: true });
}

const jobs = new Map();
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename(_req, file, cb) {
      const ext = extname(file.originalname) || ".mp4";
      cb(null, `${Date.now()}-${randomUUID()}${ext}`);
    }
  }),
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024
  }
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));
app.use("/temp", express.static(tempDir));
app.use("/outputs", express.static(outputDir));
app.get("/", (_req, res) => {
  res.sendFile(join(publicDir, "index.html"));
});

function runFfmpeg(args, { onProgress } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("ffmpeg", args);
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onProgress?.(text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stderr });
      } else {
        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      }
    });
  });
}

function ffprobeJson(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-of", "json", ...args]);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `ffprobe exited with code ${code}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function cleanHexColor(color) {
  const normalized = String(color || "#21c72c").trim();
  const match = normalized.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) {
    throw new Error("Invalid key color. Use a 6-digit hex color.");
  }
  return `0x${match[1].toLowerCase()}`;
}

function numberInRange(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function buildFilter(params, preview = false) {
  const keyColor = cleanHexColor(params.keyColor);
  const similarity = numberInRange(params.similarity, 0.001, 1, 0.18);
  const blend = numberInRange(params.blend, 0, 1, 0.03);
  const despillMix = numberInRange(params.despillMix, 0, 1, 0.25);
  const despillExpand = numberInRange(params.despillExpand, 0, 1, 0.15);
  const outputFormat = preview ? "rgba" : "yuva420p";

  return [
    "format=rgba",
    `colorkey=${keyColor}:${similarity}:${blend}`,
    `despill=green:mix=${despillMix}:expand=${despillExpand}`,
    `format=${outputFormat}`
  ].join(",");
}

function parseProgress(text, duration) {
  const timeMatches = [...text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = timeMatches.at(-1);
  if (!last || !duration) return null;
  const seconds = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
  return Math.max(0, Math.min(100, (seconds / duration) * 100));
}

function previewFrameSpecs(id, duration) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return [
    {
      key: "first",
      label: "first",
      timestamp: 0,
      path: join(tempDir, `${id}-first.png`)
    },
    {
      key: "middle",
      label: "middle",
      timestamp: safeDuration > 0 ? safeDuration / 2 : 0,
      path: join(tempDir, `${id}-middle.png`)
    },
    {
      key: "last",
      label: "last",
      timestamp: safeDuration > 0 ? Math.max(0, safeDuration - 0.08) : 0,
      path: join(tempDir, `${id}-last.png`)
    }
  ];
}

async function extractFrame(videoPath, framePath, timestamp) {
  const args = ["-y"];
  if (timestamp > 0) {
    args.push("-ss", String(timestamp));
  }
  args.push("-i", videoPath, "-frames:v", "1", framePath);
  await runFfmpeg(args);
}

app.post("/api/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No video file uploaded." });
      return;
    }

    const id = randomUUID();
    const videoPath = req.file.path;
    const metadata = await ffprobeJson([
      "-show_entries",
      "format=duration:stream=width,height,r_frame_rate",
      "-select_streams",
      "v:0",
      videoPath
    ]);

    const duration = Number(metadata.format?.duration || 0);
    const stream = metadata.streams?.[0] || {};
    const frameSpecs = previewFrameSpecs(id, duration);

    for (const frame of frameSpecs) {
      await extractFrame(videoPath, frame.path, frame.timestamp);
    }

    jobs.set(id, {
      id,
      originalName: req.file.originalname,
      videoPath,
      previewFrames: Object.fromEntries(frameSpecs.map((frame) => [frame.key, frame.path])),
      duration,
      width: stream.width,
      height: stream.height,
      progress: 0,
      status: "ready",
      outputPath: null,
      error: null
    });

    res.json({
      id,
      originalName: req.file.originalname,
      frameUrls: Object.fromEntries(
        frameSpecs.map((frame) => [frame.key, `/temp/${basename(frame.path)}?t=${Date.now()}`])
      ),
      duration,
      width: stream.width,
      height: stream.height
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/preview", async (req, res) => {
  try {
    const job = jobs.get(req.body.id);
    if (!job) {
      res.status(404).json({ error: "Video job not found." });
      return;
    }

    const frameKey = ["first", "middle", "last"].includes(req.body.frameKey) ? req.body.frameKey : "first";
    const sourceFrame = job.previewFrames?.[frameKey] || job.previewFrames?.first;
    const previewPath = join(tempDir, `${job.id}-${frameKey}-preview.png`);
    const filter = buildFilter(req.body, true);
    await runFfmpeg(["-y", "-i", sourceFrame, "-vf", filter, "-frames:v", "1", previewPath]);

    res.json({
      previewUrl: `/temp/${basename(previewPath)}?t=${Date.now()}`,
      frameKey,
      filter
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/export", async (req, res) => {
  try {
    const job = jobs.get(req.body.id);
    if (!job) {
      res.status(404).json({ error: "Video job not found." });
      return;
    }

    const crf = Math.round(numberInRange(req.body.crf, 18, 45, 28));
    const outputName = `${basename(job.originalName, extname(job.originalName))}-transparent-${Date.now()}.webm`;
    const outputPath = join(outputDir, outputName);
    const filter = buildFilter(req.body, false);

    job.status = "exporting";
    job.progress = 0;
    job.outputPath = outputPath;
    job.error = null;

    runFfmpeg(
      [
        "-y",
        "-i",
        job.videoPath,
        "-filter_complex",
        `[0:v]${filter}[v]`,
        "-map",
        "[v]",
        "-map",
        "0:a?",
        "-c:v",
        "libvpx-vp9",
        "-crf",
        String(crf),
        "-b:v",
        "0",
        "-pix_fmt",
        "yuva420p",
        "-c:a",
        "libopus",
        "-metadata:s:v:0",
        "alpha_mode=1",
        outputPath
      ],
      {
        onProgress(text) {
          const progress = parseProgress(text, job.duration);
          if (progress !== null) {
            job.progress = progress;
          }
        }
      }
    )
      .then(() => {
        job.status = "done";
        job.progress = 100;
      })
      .catch((error) => {
        job.status = "error";
        job.error = error.message;
      });

    res.json({ status: "exporting" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/job/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Video job not found." });
    return;
  }

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    outputUrl: job.status === "done" && job.outputPath ? `/outputs/${basename(job.outputPath)}` : null,
    outputPath: job.status === "done" && job.outputPath ? job.outputPath : null,
    outputSize: job.status === "done" && job.outputPath && existsSync(job.outputPath) ? statSync(job.outputPath).size : null
  });
});

app.get("/api/download/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job?.outputPath || !existsSync(job.outputPath)) {
    res.status(404).json({ error: "Output file not found." });
    return;
  }

  res.setHeader("Content-Type", "video/webm");
  res.setHeader("Content-Disposition", `attachment; filename="${basename(job.outputPath)}"`);
  createReadStream(job.outputPath).pipe(res);
});

app.listen(port, () => {
  console.log(`Green Screen WebM Tool running at http://localhost:${port}`);
});
