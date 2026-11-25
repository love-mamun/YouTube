import { eq, and } from "drizzle-orm";
import { db, apiTokensTable, channelsTable, videoJobsTable } from "@workspace/db";
import { logger } from "./logger";
import { existsSync, statSync } from "fs";
import { createReadStream } from "fs";

const FB_VIDEO_API = "https://graph-video.facebook.com/v19.0";
const FB_API = "https://graph.facebook.com/v19.0";
const CHUNK_SIZE = 50 * 1024 * 1024; // 50 MB chunks for resumable upload

async function getFacebookPageToken(channelId?: number | null): Promise<{ token: string; pageId: string; pageName: string }> {
  let channel = null;

  if (channelId) {
    const [ch] = await db
      .select()
      .from(channelsTable)
      .where(and(eq(channelsTable.id, channelId), eq(channelsTable.isActive, true)))
      .limit(1);
    channel = ch ?? null;
  }

  if (!channel) {
    const [def] = await db
      .select()
      .from(channelsTable)
      .where(and(eq(channelsTable.platform, "facebook"), eq(channelsTable.isActive, true), eq(channelsTable.isDefault, true)))
      .limit(1);
    channel = def ?? null;
  }

  if (!channel) {
    const [any] = await db
      .select()
      .from(channelsTable)
      .where(and(eq(channelsTable.platform, "facebook"), eq(channelsTable.isActive, true)))
      .limit(1);
    channel = any ?? null;
  }

  if (!channel) throw new Error("No Facebook page connected — go to Settings and connect a Facebook Page first.");
  if (!channel.tokenId) throw new Error("Facebook page has no token — reconnect the page in Settings.");

  const [token] = await db
    .select()
    .from(apiTokensTable)
    .where(and(eq(apiTokensTable.id, channel.tokenId), eq(apiTokensTable.isActive, true)))
    .limit(1);

  if (!token) throw new Error("Facebook page access token not found — reconnect the page in Settings.");

  return { token: token.accessToken, pageId: channel.channelId!, pageName: channel.channelName };
}

/**
 * Upload a small video file (< 1 GB) in a single multipart POST.
 */
async function uploadSmall(
  pageId: string,
  pageToken: string,
  filePath: string,
  title: string,
  description: string
): Promise<string> {
  const { readFile } = await import("fs/promises");

  logger.info({ pageId, filePath }, "Facebook single-part video upload starting");

  const fileBuffer = await readFile(filePath);
  const form = new globalThis.FormData();
  form.append("access_token", pageToken);
  form.append("title", title.slice(0, 255));
  form.append("description", description.slice(0, 10000));
  form.append("published", "true");
  form.append("source", new globalThis.Blob([fileBuffer], { type: "video/mp4" }), "video.mp4");

  const res = await fetch(`${FB_VIDEO_API}/${pageId}/videos`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Facebook upload failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("Facebook upload response missing video ID");
  return data.id;
}

/**
 * Upload a large video file using Facebook's resumable (chunked) upload protocol.
 */
async function uploadResumable(
  pageId: string,
  pageToken: string,
  filePath: string,
  fileSize: number,
  title: string,
  description: string
): Promise<string> {
  const { open } = await import("fs/promises");

  logger.info({ pageId, filePath, fileSize }, "Facebook resumable video upload starting");

  // Phase 1: start
  const startForm = new globalThis.FormData();
  startForm.append("access_token", pageToken);
  startForm.append("upload_phase", "start");
  startForm.append("file_size", String(fileSize));

  const startRes = await fetch(`${FB_VIDEO_API}/${pageId}/videos`, { method: "POST", body: startForm });
  if (!startRes.ok) throw new Error(`Facebook upload start failed: ${await startRes.text()}`);
  const startData = (await startRes.json()) as { upload_session_id: string; start_offset: string; end_offset: string };
  const { upload_session_id } = startData;
  let startOffset = parseInt(startData.start_offset, 10);

  logger.info({ upload_session_id, startOffset }, "Facebook upload session started");

  // Phase 2: transfer chunks — read one chunk at a time to keep memory bounded
  const fh = await open(filePath, "r");
  try {
    while (startOffset < fileSize) {
      const chunkSize = Math.min(CHUNK_SIZE, fileSize - startOffset);
      const chunkBuf = Buffer.allocUnsafe(chunkSize);
      await fh.read(chunkBuf, 0, chunkSize, startOffset);

      const chunkForm = new globalThis.FormData();
      chunkForm.append("access_token", pageToken);
      chunkForm.append("upload_phase", "transfer");
      chunkForm.append("upload_session_id", upload_session_id);
      chunkForm.append("start_offset", String(startOffset));
      chunkForm.append("video_file_chunk", new globalThis.Blob([chunkBuf], { type: "video/mp4" }), "chunk.mp4");

      const chunkRes = await fetch(`${FB_VIDEO_API}/${pageId}/videos`, { method: "POST", body: chunkForm });
      if (!chunkRes.ok) throw new Error(`Facebook chunk upload failed at offset ${startOffset}: ${await chunkRes.text()}`);
      const chunkData = (await chunkRes.json()) as { start_offset: string; end_offset: string };
      startOffset = parseInt(chunkData.start_offset, 10);

      const pct = Math.floor((startOffset / fileSize) * 100);
      logger.info({ upload_session_id, pct }, "Facebook upload chunk transferred");
    }
  } finally {
    await fh.close();
  }

  // Phase 3: finish with metadata
  const finishForm = new globalThis.FormData();
  finishForm.append("access_token", pageToken);
  finishForm.append("upload_phase", "finish");
  finishForm.append("upload_session_id", upload_session_id);
  finishForm.append("title", title.slice(0, 255));
  finishForm.append("description", description.slice(0, 10000));
  finishForm.append("published", "true");

  const finishRes = await fetch(`${FB_VIDEO_API}/${pageId}/videos`, { method: "POST", body: finishForm });
  if (!finishRes.ok) throw new Error(`Facebook upload finish failed: ${await finishRes.text()}`);
  const finishData = (await finishRes.json()) as { success?: boolean; video_id?: string };

  if (!finishData.success && !finishData.video_id) {
    throw new Error(`Facebook upload finish returned unexpected response: ${JSON.stringify(finishData)}`);
  }

  // Get the actual video ID from the upload session
  const idRes = await fetch(`${FB_API}/${pageId}/videos?upload_session_id=${upload_session_id}&access_token=${pageToken}`);
  const idData = (await idRes.json()) as { data?: Array<{ id: string }> };
  return idData.data?.[0]?.id ?? finishData.video_id ?? upload_session_id;
}

export async function publishToFacebook(jobId: number): Promise<{ videoId: string; url: string }> {
  const [job] = await db
    .select()
    .from(videoJobsTable)
    .where(eq(videoJobsTable.id, jobId));

  if (!job) throw new Error("Job not found");

  const { token: pageToken, pageId, pageName } = await getFacebookPageToken();

  const title = (job.title ?? job.originalTitle ?? "Untitled Video").slice(0, 255);
  const hashtagsBlock = job.hashtags ? `\n\n${job.hashtags}` : "";
  const tagsLine = job.tags ? `\n\nTags: ${job.tags}` : "";
  const description = `${job.description ?? ""}${hashtagsBlock}${tagsLine}`.slice(0, 10000);

  // Decide which file to upload
  let filePath: string | null = null;
  if (job.videoPath && existsSync(job.videoPath)) {
    filePath = job.videoPath;
    logger.info({ jobId, filePath }, "Using existing video file for Facebook upload");
  } else {
    throw new Error("No downloaded video file found for this job. Download the video first before publishing to Facebook.");
  }

  const fileSize = statSync(filePath).size;
  // Facebook's non-resumable endpoint rejects payloads over ~100 MB.
  // Use chunked resumable upload for anything over 25 MB to stay safe.
  const RESUMABLE_THRESHOLD = 25 * 1024 * 1024; // 25 MB

  let videoId: string;
  if (fileSize < RESUMABLE_THRESHOLD) {
    videoId = await uploadSmall(pageId, pageToken, filePath, title, description);
  } else {
    videoId = await uploadResumable(pageId, pageToken, filePath, fileSize, title, description);
  }

  const url = `https://www.facebook.com/${pageId}/videos/${videoId}`;
  logger.info({ jobId, videoId, url, pageName }, "Facebook video upload complete");

  return { videoId, url };
}
