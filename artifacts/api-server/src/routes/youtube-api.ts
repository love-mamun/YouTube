import { Router, type IRouter } from "express";
import { google } from "googleapis";
import { db, videoJobsTable } from "@workspace/db";
import { getYouTubeOAuth2Client } from "../lib/youtube-publisher";
import { startVideoProcessing } from "../lib/video-processor";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /api/youtube/channel-info
router.get("/youtube/channel-info", async (_req, res): Promise<void> => {
  try {
    const auth = await getYouTubeOAuth2Client();
    const yt = google.youtube({ version: "v3", auth });

    const response = await yt.channels.list({
      part: ["snippet", "statistics", "brandingSettings"],
      mine: true,
    });

    const channel = response.data.items?.[0];
    if (!channel) { res.status(404).json({ error: "No channel found for connected account" }); return; }

    const stats = channel.statistics;
    const snippet = channel.snippet;
    const subscriberCount = parseInt(stats?.subscriberCount || "0", 10);
    const viewCount = parseInt(stats?.viewCount || "0", 10);
    const videoCount = parseInt(stats?.videoCount || "0", 10);
    const avgViewsPerVideo = videoCount > 0 ? viewCount / videoCount : 0;

    const subScore = subscriberCount >= 100000 ? 25 : subscriberCount >= 10000 ? 20 : subscriberCount >= 1000 ? 15 : subscriberCount >= 100 ? 10 : 5;
    const viewScore = avgViewsPerVideo >= subscriberCount * 0.5 ? 25 : avgViewsPerVideo >= subscriberCount * 0.2 ? 18 : avgViewsPerVideo >= subscriberCount * 0.1 ? 12 : 6;
    const hasDesc = (snippet?.description || "").length > 50;
    const hasCustomUrl = !!(snippet as Record<string, unknown>)?.customUrl;
    const profileScore = hasDesc && hasCustomUrl ? 25 : hasDesc || hasCustomUrl ? 15 : 5;
    const uploadScore = videoCount >= 50 ? 25 : videoCount >= 20 ? 18 : videoCount >= 10 ? 12 : videoCount >= 5 ? 8 : 4;

    res.json({
      id: channel.id,
      title: snippet?.title,
      description: snippet?.description,
      thumbnailUrl: snippet?.thumbnails?.high?.url || snippet?.thumbnails?.default?.url,
      customUrl: (snippet as Record<string, unknown>)?.customUrl,
      publishedAt: snippet?.publishedAt,
      country: snippet?.country,
      statistics: { subscriberCount, viewCount, videoCount },
      healthScore: Math.min(100, subScore + viewScore + profileScore + uploadScore),
      healthBreakdown: { subscribers: subScore, viewRatio: viewScore, profile: profileScore, uploads: uploadScore },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Failed to fetch channel info");
    res.status(msg.includes("token") || msg.includes("Settings") ? 401 : 500).json({ error: msg });
  }
});

// GET /api/youtube/my-videos
router.get("/youtube/my-videos", async (req, res): Promise<void> => {
  try {
    const auth = await getYouTubeOAuth2Client();
    const yt = google.youtube({ version: "v3", auth });
    const maxResults = Math.min(50, parseInt(String(req.query.maxResults || "25"), 10));
    const pageToken = req.query.pageToken as string | undefined;

    const channelRes = await yt.channels.list({ part: ["contentDetails"], mine: true });
    const uploadsPlaylistId = channelRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) { res.status(404).json({ error: "No uploads playlist found" }); return; }

    const playlistRes = await yt.playlistItems.list({ part: ["snippet", "contentDetails"], playlistId: uploadsPlaylistId, maxResults, pageToken });
    const videoIds = (playlistRes.data.items || []).map((item) => item.contentDetails?.videoId).filter(Boolean) as string[];

    if (videoIds.length === 0) { res.json({ videos: [], nextPageToken: null }); return; }

    const videoRes = await yt.videos.list({ part: ["snippet", "statistics", "contentDetails", "status"], id: videoIds });
    const videos = (videoRes.data.items || []).map((v) => ({
      id: v.id,
      title: v.snippet?.title,
      description: v.snippet?.description,
      thumbnailUrl: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url,
      publishedAt: v.snippet?.publishedAt,
      duration: v.contentDetails?.duration,
      privacyStatus: v.status?.privacyStatus,
      tags: v.snippet?.tags || [],
      categoryId: v.snippet?.categoryId,
      statistics: {
        viewCount: parseInt(v.statistics?.viewCount || "0", 10),
        likeCount: parseInt(v.statistics?.likeCount || "0", 10),
        commentCount: parseInt(v.statistics?.commentCount || "0", 10),
      },
      url: `https://www.youtube.com/watch?v=${v.id}`,
    }));

    res.json({ videos, nextPageToken: playlistRes.data.nextPageToken || null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Failed to fetch my videos");
    res.status(msg.includes("token") ? 401 : 500).json({ error: msg });
  }
});

// GET /api/youtube/video/:videoId/stats
router.get("/youtube/video/:videoId/stats", async (req, res): Promise<void> => {
  try {
    const { videoId } = req.params;
    const auth = await getYouTubeOAuth2Client();
    const yt = google.youtube({ version: "v3", auth });

    const response = await yt.videos.list({ part: ["snippet", "statistics", "contentDetails", "status"], id: [videoId] });
    const video = response.data.items?.[0];
    if (!video) { res.status(404).json({ error: "Video not found" }); return; }

    res.json({
      id: video.id,
      title: video.snippet?.title,
      description: video.snippet?.description,
      tags: video.snippet?.tags || [],
      categoryId: video.snippet?.categoryId,
      privacyStatus: video.status?.privacyStatus,
      duration: video.contentDetails?.duration,
      publishedAt: video.snippet?.publishedAt,
      statistics: {
        viewCount: parseInt(video.statistics?.viewCount || "0", 10),
        likeCount: parseInt(video.statistics?.likeCount || "0", 10),
        commentCount: parseInt(video.statistics?.commentCount || "0", 10),
        favoriteCount: parseInt(video.statistics?.favoriteCount || "0", 10),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /api/youtube/video/:videoId/update-metadata
router.post("/youtube/video/:videoId/update-metadata", async (req, res): Promise<void> => {
  try {
    const { videoId } = req.params;
    const { title, description, tags, categoryId } = req.body as {
      title?: string; description?: string; tags?: string[]; categoryId?: string;
    };

    const auth = await getYouTubeOAuth2Client();
    const yt = google.youtube({ version: "v3", auth });

    const current = await yt.videos.list({ part: ["snippet"], id: [videoId] });
    const currentSnippet = current.data.items?.[0]?.snippet;
    if (!currentSnippet) { res.status(404).json({ error: "Video not found or inaccessible" }); return; }

    const updatedSnippet = {
      ...currentSnippet,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(tags ? { tags } : {}),
      categoryId: categoryId || currentSnippet.categoryId || "22",
    };

    const response = await yt.videos.update({ part: ["snippet"], requestBody: { id: videoId, snippet: updatedSnippet } });
    logger.info({ videoId, title: updatedSnippet.title }, "Video metadata updated on YouTube");
    res.json({ ok: true, video: response.data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Failed to update video metadata");
    res.status(500).json({ error: msg });
  }
});

// GET /api/youtube/trending
router.get("/youtube/trending", async (req, res): Promise<void> => {
  try {
    const auth = await getYouTubeOAuth2Client();
    const yt = google.youtube({ version: "v3", auth });
    const categoryId = String(req.query.categoryId || "0");
    const regionCode = String(req.query.regionCode || "US");
    const maxResults = Math.min(25, parseInt(String(req.query.maxResults || "20"), 10));

    const response = await yt.videos.list({
      part: ["snippet", "statistics", "contentDetails"],
      chart: "mostPopular",
      regionCode,
      ...(categoryId !== "0" ? { videoCategoryId: categoryId } : {}),
      maxResults,
    });

    const videos = (response.data.items || []).map((v) => ({
      id: v.id,
      title: v.snippet?.title,
      channelTitle: v.snippet?.channelTitle,
      thumbnailUrl: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url,
      publishedAt: v.snippet?.publishedAt,
      duration: v.contentDetails?.duration,
      tags: (v.snippet?.tags || []).slice(0, 8),
      statistics: {
        viewCount: parseInt(v.statistics?.viewCount || "0", 10),
        likeCount: parseInt(v.statistics?.likeCount || "0", 10),
        commentCount: parseInt(v.statistics?.commentCount || "0", 10),
      },
      url: `https://www.youtube.com/watch?v=${v.id}`,
    }));

    res.json({ videos });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Failed to fetch trending videos");
    res.status(msg.includes("token") ? 401 : 500).json({ error: msg });
  }
});

// GET /api/youtube/search
router.get("/youtube/search", async (req, res): Promise<void> => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) { res.status(400).json({ error: "Query parameter q is required" }); return; }

    const auth = await getYouTubeOAuth2Client();
    const yt = google.youtube({ version: "v3", auth });
    const maxResults = Math.min(20, parseInt(String(req.query.maxResults || "15"), 10));
    const order = String(req.query.order || "relevance") as "relevance" | "viewCount" | "date" | "rating";

    const searchRes = await yt.search.list({ part: ["snippet"], q, type: ["video"], maxResults, order });
    const videoIds = (searchRes.data.items || []).map((item) => item.id?.videoId).filter(Boolean) as string[];

    if (videoIds.length === 0) { res.json({ videos: [], query: q }); return; }

    const statsRes = await yt.videos.list({ part: ["statistics", "contentDetails"], id: videoIds });
    const statsMap = new Map((statsRes.data.items || []).map((v) => [v.id, v]));

    const videos = (searchRes.data.items || []).map((item) => {
      const vid = statsMap.get(item.id?.videoId || "");
      return {
        id: item.id?.videoId,
        title: item.snippet?.title,
        channelTitle: item.snippet?.channelTitle,
        thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url,
        publishedAt: item.snippet?.publishedAt,
        duration: vid?.contentDetails?.duration,
        statistics: {
          viewCount: parseInt(vid?.statistics?.viewCount || "0", 10),
          likeCount: parseInt(vid?.statistics?.likeCount || "0", 10),
          commentCount: parseInt(vid?.statistics?.commentCount || "0", 10),
        },
        url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
      };
    });

    res.json({ videos, query: q });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "YouTube search failed");
    res.status(msg.includes("token") ? 401 : 500).json({ error: msg });
  }
});

// GET /api/youtube/video/:videoId/comments
router.get("/youtube/video/:videoId/comments", async (req, res): Promise<void> => {
  try {
    const { videoId } = req.params;
    const maxResults = Math.min(50, parseInt(String(req.query.maxResults || "20"), 10));
    const auth = await getYouTubeOAuth2Client();
    const yt = google.youtube({ version: "v3", auth });

    const response = await yt.commentThreads.list({ part: ["snippet"], videoId, maxResults, order: "relevance" });
    const comments = (response.data.items || []).map((item) => {
      const top = item.snippet?.topLevelComment?.snippet;
      return {
        id: item.id,
        commentId: item.snippet?.topLevelComment?.id,
        text: top?.textDisplay,
        authorName: top?.authorDisplayName,
        authorThumbnail: top?.authorProfileImageUrl,
        likeCount: top?.likeCount || 0,
        publishedAt: top?.publishedAt,
        replyCount: item.snippet?.totalReplyCount || 0,
        canReply: item.snippet?.canReply,
      };
    });

    res.json({ comments, total: response.data.pageInfo?.totalResults });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Failed to fetch comments");
    res.status(500).json({ error: msg });
  }
});

// POST /api/youtube/video/:videoId/comment-reply
router.post("/youtube/video/:videoId/comment-reply", async (req, res): Promise<void> => {
  try {
    const { videoId } = req.params;
    const { parentCommentId, text } = req.body as { parentCommentId: string; text: string };
    if (!parentCommentId || !text?.trim()) { res.status(400).json({ error: "parentCommentId and text are required" }); return; }

    const auth = await getYouTubeOAuth2Client();
    const yt = google.youtube({ version: "v3", auth });

    const response = await yt.comments.insert({
      part: ["snippet"],
      requestBody: { snippet: { parentId: parentCommentId, videoId, textOriginal: text.trim() } },
    });

    logger.info({ videoId, parentCommentId }, "Comment reply posted");
    res.json({ ok: true, comment: response.data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /api/youtube/import-video
router.post("/youtube/import-video", async (req, res): Promise<void> => {
  try {
    const { videoId, videoUrl, title } = req.body as { videoId?: string; videoUrl?: string; title?: string };
    const url = videoUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);
    if (!url) { res.status(400).json({ error: "videoId or videoUrl is required" }); return; }

    const [job] = await db
      .insert(videoJobsTable)
      .values({ youtubeUrl: url, originalTitle: title || null, publishMode: "manual", platforms: "youtube", status: "pending", progress: 0 })
      .returning();

    res.status(201).json(job);
    startVideoProcessing(job.id, url).catch((err) => logger.error({ err, jobId: job.id }, "Auto-start failed for imported video"));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// GET /api/youtube/playlists
router.get("/youtube/playlists", async (_req, res): Promise<void> => {
  try {
    const auth = await getYouTubeOAuth2Client();
    const yt = google.youtube({ version: "v3", auth });

    const response = await yt.playlists.list({ part: ["snippet", "contentDetails"], mine: true, maxResults: 50 });
    const playlists = (response.data.items || []).map((p) => ({
      id: p.id,
      title: p.snippet?.title,
      description: p.snippet?.description,
      thumbnailUrl: p.snippet?.thumbnails?.medium?.url,
      itemCount: p.contentDetails?.itemCount || 0,
    }));

    res.json({ playlists });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// POST /api/youtube/video/:videoId/add-to-playlist
router.post("/youtube/video/:videoId/add-to-playlist", async (req, res): Promise<void> => {
  try {
    const { videoId } = req.params;
    const { playlistId } = req.body as { playlistId: string };
    if (!playlistId) { res.status(400).json({ error: "playlistId is required" }); return; }

    const auth = await getYouTubeOAuth2Client();
    const yt = google.youtube({ version: "v3", auth });

    await yt.playlistItems.insert({
      part: ["snippet"],
      requestBody: { snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } },
    });

    logger.info({ videoId, playlistId }, "Video added to playlist");
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// GET /api/youtube/categories
router.get("/youtube/categories", async (req, res): Promise<void> => {
  try {
    const auth = await getYouTubeOAuth2Client();
    const yt = google.youtube({ version: "v3", auth });

    const response = await yt.videoCategories.list({ part: ["snippet"], regionCode: String(req.query.regionCode || "US"), hl: "en" });
    const categories = (response.data.items || [])
      .filter((c) => c.snippet?.assignable)
      .map((c) => ({ id: c.id, title: c.snippet?.title }));

    res.json({ categories });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
