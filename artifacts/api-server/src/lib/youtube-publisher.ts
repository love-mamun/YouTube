import { google } from "googleapis";
import { eq, and } from "drizzle-orm";
import { db, apiTokensTable, publishLogsTable, videoJobsTable, thumbnailsTable, channelsTable } from "@workspace/db";
import { logger } from "./logger";
import { downloadVideoWithResilience } from "./ytdlp-downloader";
import { getConfig } from "./app-config";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { unlink } from "fs/promises";
import * as path from "path";
import * as os from "os";
import { Readable } from "stream";
/** Crop a horizontal video to 9:16 vertical for YouTube Shorts (1080×1920). */
function createShortsVersionLocal(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920:flags=lanczos",
      "-c:v", "libx264", "-b:v", "8M", "-preset", "fast", "-crf", "20",
      "-c:a", "aac", "-b:a", "192k",
      outputPath,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Shorts crop failed (code ${code}): ${stderr.slice(-300)}`));
    });
    proc.on("error", reject);
  });
}

export async function getYouTubeOAuth2Client(channelId?: number | null) {
  let token;

  if (channelId) {
    // Enforce YouTube platform — never pick a non-YouTube channel by ID
    const [ch] = await db
      .select()
      .from(channelsTable)
      .where(and(
        eq(channelsTable.id, channelId),
        eq(channelsTable.platform, "youtube"),
        eq(channelsTable.isActive, true),
      ))
      .limit(1);
    if (ch?.tokenId) {
      [token] = await db
        .select()
        .from(apiTokensTable)
        .where(and(
          eq(apiTokensTable.id, ch.tokenId),
          eq(apiTokensTable.platform, "youtube"),
          eq(apiTokensTable.isActive, true),
        ))
        .limit(1);
    }
  }

  if (!token) {
    const [defaultCh] = await db
      .select()
      .from(channelsTable)
      .where(and(eq(channelsTable.platform, "youtube"), eq(channelsTable.isActive, true), eq(channelsTable.isDefault, true)))
      .limit(1);

    if (defaultCh?.tokenId) {
      [token] = await db
        .select()
        .from(apiTokensTable)
        .where(and(eq(apiTokensTable.id, defaultCh.tokenId), eq(apiTokensTable.isActive, true)))
        .limit(1);
    }

    if (!token) {
      [token] = await db
        .select()
        .from(apiTokensTable)
        .where(and(eq(apiTokensTable.platform, "youtube"), eq(apiTokensTable.isActive, true)))
        .limit(1);
    }
  }

  if (!token) throw new Error("No active YouTube token — connect your channel in Settings first");

  const clientId = await getConfig("YOUTUBE_CLIENT_ID");
  const clientSecret = await getConfig("YOUTUBE_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("YouTube Client ID and Secret are not configured — add them in Settings.");
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken ?? undefined,
  });

  oauth2Client.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await db
        .update(apiTokensTable)
        .set({ accessToken: tokens.access_token })
        .where(eq(apiTokensTable.id, token.id));
    }
  });

  return oauth2Client;
}

async function getYouTubeClient(channelId?: number | null) {
  let token;

  if (channelId) {
    // Enforce YouTube platform — never pick a non-YouTube channel by ID
    const [ch] = await db
      .select()
      .from(channelsTable)
      .where(and(
        eq(channelsTable.id, channelId),
        eq(channelsTable.platform, "youtube"),
        eq(channelsTable.isActive, true),
      ))
      .limit(1);
    if (ch?.tokenId) {
      [token] = await db
        .select()
        .from(apiTokensTable)
        .where(and(
          eq(apiTokensTable.id, ch.tokenId),
          eq(apiTokensTable.platform, "youtube"),
          eq(apiTokensTable.isActive, true),
        ))
        .limit(1);
    }
  }

  if (!token) {
    // Fall back to default channel's token, then any active YouTube token
    const [defaultCh] = await db
      .select()
      .from(channelsTable)
      .where(and(eq(channelsTable.platform, "youtube"), eq(channelsTable.isActive, true), eq(channelsTable.isDefault, true)))
      .limit(1);

    if (defaultCh?.tokenId) {
      [token] = await db
        .select()
        .from(apiTokensTable)
        .where(and(eq(apiTokensTable.id, defaultCh.tokenId), eq(apiTokensTable.isActive, true)))
        .limit(1);
    }

    if (!token) {
      [token] = await db
        .select()
        .from(apiTokensTable)
        .where(and(eq(apiTokensTable.platform, "youtube"), eq(apiTokensTable.isActive, true)))
        .limit(1);
    }
  }

  if (!token) throw new Error("No active YouTube token — connect your channel in Settings first");

  const clientId = await getConfig("YOUTUBE_CLIENT_ID");
  const clientSecret = await getConfig("YOUTUBE_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("YouTube Client ID and Secret are not configured — add them in Settings.");
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);

  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken ?? undefined,
  });

  oauth2Client.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await db
        .update(apiTokensTable)
        .set({ accessToken: tokens.access_token })
        .where(eq(apiTokensTable.id, token.id));
      logger.info({ tokenId: token.id }, "YouTube access token refreshed");
    }
  });

  return google.youtube({ version: "v3", auth: oauth2Client });
}

async function downloadVideoWithYtDlp(videoUrl: string, quality?: string | null): Promise<string> {
  const tmpDir = os.tmpdir();
  const outputPath = path.join(tmpDir, `n3xus_${Date.now()}.mp4`);

  logger.info({ videoUrl, quality }, "Downloading video via shared resilient yt-dlp pipeline for publish");

  await downloadVideoWithResilience({
    url: videoUrl,
    quality: quality ?? null,
    outputPath,
    jobTag: "pub",
  });

  if (existsSync(outputPath)) return outputPath;

  throw new Error("Downloaded file not found after yt-dlp");
}

export interface PublishYouTubeOptions {
  isShorts?: boolean;
  channelId?: number | null;
}

export async function publishToYouTube(
  jobId: number,
  options: PublishYouTubeOptions = {}
): Promise<{ videoId: string; url: string }> {
  const [job] = await db
    .select()
    .from(videoJobsTable)
    .where(eq(videoJobsTable.id, jobId));

  if (!job) throw new Error("Job not found");
  if (!job.youtubeUrl) throw new Error("No source video URL on job");

  const yt = await getYouTubeClient(options.channelId);

  let localPath: string | null = null;
  let usedExistingFile = false;
  // Declared here (outside try) so the finally block can reference it safely.
  let shortsPath: string | null = null;
  try {
    // Prefer the already-downloaded file stored during processing — avoids a
    // duplicate download and ensures the quality the user selected is used.
    if (job.videoPath && existsSync(job.videoPath)) {
      localPath = job.videoPath;
      usedExistingFile = true;
      logger.info({ jobId, localPath, quality: job.quality }, "Using existing video file for upload (skipping re-download)");
    } else {
      if (job.videoPath) {
        logger.warn({ jobId, videoPath: job.videoPath }, "Stored video file missing — falling back to re-download");
      }
      localPath = await downloadVideoWithYtDlp(job.youtubeUrl, job.quality);
    }
    // ── Shorts: auto-crop horizontal video to 9:16 vertical ─────────────────
    // If the file is wider than tall (e.g. 16:9 from a 4K mission), FFmpeg crops
    // the center to portrait format so YouTube Shorts plays correctly.
    if (options.isShorts && localPath) {
      try {
        const { stdout: probeOut } = await spawnAsync("ffprobe", [
          "-v", "quiet", "-print_format", "json", "-show_streams", localPath,
        ], 15_000).catch(() => ({ stdout: "{}", stderr: "" }));
        const probeData = JSON.parse(probeOut) as { streams?: Array<{ codec_type: string; width?: number; height?: number }> };
        const vStream = probeData.streams?.find((s) => s.codec_type === "video");
        const vidW = Number(vStream?.width ?? 0);
        const vidH = Number(vStream?.height ?? 0);

        if (vidW > 0 && vidH > 0 && vidW > vidH) {
          shortsPath = localPath.replace(/\.mp4$/i, "") + "_shorts.mp4";
          logger.info({ jobId, vidW, vidH, shortsPath }, "Horizontal video detected — creating Shorts vertical crop");
          await createShortsVersionLocal(localPath, shortsPath);
          // Switch to vertical version for upload; original is preserved (it belongs to the job)
          localPath = shortsPath;
        }
      } catch (err) {
        logger.warn({ err, jobId }, "Shorts crop failed — uploading original file as-is");
      }
    }

    logger.info({ jobId, localPath, isShorts: options.isShorts, usedExistingFile }, "Video ready, starting YouTube upload");

    const tagsArr = (job.tags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 30);

    // Sanitize title: strip YouTube-invalid chars, use Unicode-safe truncation.
    // For Shorts the suffix " #Shorts" (8 chars) is appended so base must fit
    // within 100 - 8 = 92 chars; regular videos get the full 100.
    const sanitizeTitle = (raw: string, maxChars: number): string => {
      const cleaned = Array.from(
        raw
          .replace(/[<>]/g, "")
          .replace(/[\x00-\x1F]/g, "")
          .trim()
      )
        .slice(0, maxChars)
        .join("")
        .trim();
      return cleaned || "Untitled Video";
    };

    const rawTitle = job.title ?? job.originalTitle ?? "Untitled Video";
    const titleBase = sanitizeTitle(rawTitle, options.isShorts ? 92 : 100);
    const title = options.isShorts ? `${titleBase} #Shorts` : titleBase;

    // Build description: main body + hashtags (clickable in YouTube) + #Shorts tag
    const shortsTag = options.isShorts ? "\n\n#Shorts" : "";
    const hashtagsBlock = job.hashtags ? `\n\n${job.hashtags}` : "";
    const fullDescription = [
      job.description ?? "",
      hashtagsBlock,
      job.tags ? `\n\nTags: ${job.tags}` : "",
      shortsTag,
    ]
      .join("")
      .slice(0, 5000);

    if (options.isShorts && !tagsArr.includes("Shorts")) {
      tagsArr.push("Shorts");
    }

    const { createReadStream } = await import("fs");

    const response = await yt.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title,
          description: fullDescription,
          tags: tagsArr,
          categoryId: "22",
          defaultLanguage: "en",
        },
        status: {
          privacyStatus: "public",
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        mimeType: "video/mp4",
        body: createReadStream(localPath),
      },
    });

    const videoId = response.data.id!;
    const videoUrl = options.isShorts
      ? `https://www.youtube.com/shorts/${videoId}`
      : `https://www.youtube.com/watch?v=${videoId}`;

    logger.info({ jobId, videoId, videoUrl, isShorts: options.isShorts }, "YouTube upload complete");

    // ── Thumbnail upload ─────────────────────────────────────────────────────
    // Resolve the selected thumbnail URL: try selectedThumbnailId first,
    // then the isSelected row, then fallback to job.thumbnailUrl.
    let thumbUrl: string | null = null;
    try {
      if (job.selectedThumbnailId) {
        const [byId] = await db
          .select()
          .from(thumbnailsTable)
          .where(eq(thumbnailsTable.id, job.selectedThumbnailId))
          .limit(1);
        thumbUrl = byId?.imageUrl ?? null;
      }
      if (!thumbUrl) {
        const [selected] = await db
          .select()
          .from(thumbnailsTable)
          .where(and(eq(thumbnailsTable.jobId, job.id), eq(thumbnailsTable.isSelected, true)))
          .limit(1);
        thumbUrl = selected?.imageUrl ?? job.thumbnailUrl ?? null;
      }

      if (thumbUrl) {
        logger.info({ jobId, videoId, thumbUrl }, "Fetching thumbnail image for upload");
        const imgResp = await fetch(thumbUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; N3XUS/1.0)" },
        });
        if (!imgResp.ok) {
          logger.warn({ jobId, videoId, thumbUrl, status: imgResp.status }, "Thumbnail fetch failed — skipping");
        } else {
          // Buffer the full image before upload — avoids stream-consumption
          // issues with the googleapis resumable upload client.
          const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
          const mimeType = imgResp.headers.get("content-type") || "image/jpeg";
          logger.info({ jobId, videoId, bytes: imgBuffer.byteLength, mimeType }, "Uploading thumbnail to YouTube");
          const thumbResult = await yt.thumbnails.set({
            videoId,
            media: {
              mimeType,
              body: Readable.from(imgBuffer),
            },
          });
          logger.info({ jobId, videoId, thumbResult: thumbResult.status }, "Thumbnail uploaded successfully");
        }
      } else {
        logger.warn({ jobId, videoId }, "No thumbnail URL found — skipping thumbnail upload");
      }
    } catch (thumbErr) {
      // Non-fatal: thumbnail upload fails if channel is unverified or image errors.
      // The video is already live; we just log the issue.
      logger.warn({ thumbErr, jobId, videoId }, "Thumbnail upload failed (non-fatal) — channel may need YouTube verification");
    }

    return { videoId, url: videoUrl };
  } finally {
    // Clean up temp Shorts vertical crop (never the original job file)
    if (shortsPath && existsSync(shortsPath)) {
      await unlink(shortsPath).catch(() => {});
    }
    // Only delete the file if we downloaded it ourselves as a temp copy.
    // Never delete the stored job file (job.videoPath) — the user may still need it.
    if (localPath && localPath !== shortsPath && !usedExistingFile && existsSync(localPath)) {
      await unlink(localPath).catch(() => {});
    }
  }
}

export async function updatePublishLog(
  jobId: number,
  platform: string,
  status: "success" | "failed",
  url?: string,
  error?: string
) {
  await db
    .update(publishLogsTable)
    .set({
      status,
      platformUrl: url ?? null,
      errorMessage: error ?? null,
    })
    .where(and(eq(publishLogsTable.jobId, jobId), eq(publishLogsTable.platform, platform)));
}
