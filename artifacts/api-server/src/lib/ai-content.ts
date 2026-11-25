import { GoogleGenAI } from "@google/genai";
import { logger } from "./logger";

interface AiContentResult {
  title: string;
  description: string;
  tags: string;
  hashtags: string;
}

function getGeminiClient(): GoogleGenAI {
  const integrationKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  const integrationBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

  if (integrationKey && integrationBase) {
    return new GoogleGenAI({
      apiKey: integrationKey,
      httpOptions: {
        apiVersion: "",
        baseUrl: integrationBase,
      },
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    return new GoogleGenAI({ apiKey });
  }

  throw new Error("No Gemini API key configured. Set GEMINI_API_KEY in Secrets.");
}

async function callGemini(prompt: string): Promise<string> {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { maxOutputTokens: 4096, temperature: 0.9 },
  });
  return response.text ?? "";
}

/** Strip characters YouTube's API won't accept and enforce max length. */
function sanitizeYouTubeTitle(raw: string, maxLen = 100): string {
  return Array.from(
    raw
      .replace(/[<>]/g, "")        // YouTube API rejects angle brackets
      .replace(/[\x00-\x1F]/g, "") // strip control / null bytes
      .trim()
  )
    .slice(0, maxLen)
    .join("")
    .trim();
}

export async function generateAiContent(
  originalTitle: string,
  description?: string,
  feedback?: string,
  originalTags?: string
): Promise<AiContentResult> {
  const feedbackSection = feedback?.trim()
    ? `\n\nRevision instruction from the user: "${feedback.trim()}"\nApply this feedback precisely while keeping SEO quality high.`
    : "";

  const originalTagsSection = originalTags?.trim()
    ? `\nOriginal video tags (use these as a base and expand upon them): "${originalTags.trim()}"`
    : "";

  const prompt = `You are an elite YouTube growth strategist and SEO specialist. Given a video title, generate maximum-impact content optimized for discovery, watch time, and viral growth.

Original video title: "${originalTitle}"
${description ? `Original description: "${description}"` : ""}${originalTagsSection}${feedbackSection}

Generate the following in JSON format:
{
  "title": "A powerful, click-worthy, SEO-optimized YouTube title. STRICT RULES: EXACTLY 95-100 characters (use every character — pad with strong keywords if needed), plain ASCII text only (no emoji, no special symbols, no angle brackets), must be compelling and curiosity-driven",
  "description": "A premium long-form SEO description of 700-1000 words. Structure it as follows: (1) Hook paragraph — 2-3 sentences that grab attention and describe the video value. (2) What You Will Learn — bullet list of 8-10 key takeaways. (3) Detailed Content Overview — 3-4 paragraphs expanding on the video topic with rich keywords naturally woven in. (4) Timestamps section — placeholder like '00:00 Introduction\\n02:30 Main Topic\\n05:00 Key Points\\n10:00 Deep Dive\\n15:00 Conclusion'. (5) About the Channel — 2 sentences. (6) Call to Action — subscribe, like, comment, share. (7) Keywords section — list 20 relevant keyword phrases. (8) Social links placeholder. End with 20 relevant hashtags.",
  "tags": "40-50 comma-separated SEO tags covering the main topic, related subtopics, audience intent keywords, trending search terms, long-tail keywords, and niche-specific phrases. Include a mix of high-volume and low-competition keywords.",
  "hashtags": "20-25 trending hashtags starting with # separated by spaces, mix of broad and niche-specific tags"
}

Return ONLY valid JSON, no other text.`;

  try {
    const raw = await callGemini(prompt);
    const cleaned = raw
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned) as AiContentResult;
    const title = sanitizeYouTubeTitle(parsed.title || originalTitle);
    return {
      title: title || sanitizeYouTubeTitle(originalTitle) || "Untitled Video",
      description: parsed.description || "",
      tags: parsed.tags || "",
      hashtags: parsed.hashtags || "",
    };
  } catch (err) {
    logger.warn({ err, originalTitle }, "Gemini generation failed, using fallback");
    const keywords = originalTitle
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 10)
      .join(", ");
    const fallbackTitle = sanitizeYouTubeTitle(originalTitle);
    return {
      title: fallbackTitle || "Untitled Video",
      description: `Watch this incredible video and discover everything about ${keywords}. This is a must-watch for anyone interested in ${keywords}.\n\nIn this video you will learn:\n- Key insights about ${keywords}\n- Expert tips and strategies\n- Step-by-step guidance\n- Real-world examples\n- Actionable takeaways\n\nTimestamps:\n00:00 Introduction\n02:30 Main Topic\n05:00 Key Points\n10:00 Deep Dive\n15:00 Conclusion\n\nDon't forget to LIKE, COMMENT and SUBSCRIBE for more amazing content!\n\nKeywords: ${keywords}, trending, viral, must watch, 2025, tutorial, guide, tips, how to, best, top, ultimate`,
      tags: `${keywords}, trending, viral, must watch, 2025, youtube, video, tutorial, guide, tips, how to, best, top, ultimate, explained, review, complete guide, step by step, beginners, advanced, expert, professional, high quality, 4k, hd`,
      hashtags: `#viral #trending #youtube #mustwatch #2025 #subscribe #tutorial #guide #tips #howto #best #top #ultimate #explained #review #4k #hd #content #learn #grow`,
    };
  }
}
