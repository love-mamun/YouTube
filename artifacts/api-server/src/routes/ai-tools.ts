import { Router, type IRouter } from "express";
import { z } from "zod";

const router: IRouter = Router();

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 3000, temperature: 0.9 },
      }),
    }
  );
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned) as T;
}

// ── 1. Smart Script Writer ──────────────────────────────────────────────────
router.post("/ai/script", async (req, res): Promise<void> => {
  const body = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    duration: z.number().optional(),
  }).safeParse(req.body);

  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { title, description, duration = 10 } = body.data;

  const prompt = `You are a professional YouTube scriptwriter. Write a complete, engaging video script.

Video Title: "${title}"
${description ? `Context: ${description}` : ""}
Target Duration: ~${duration} minutes

Return JSON with this structure:
{
  "hook": "First 30 seconds attention-grabbing intro script (speak directly to viewer)",
  "intro": "Brief channel intro + what this video covers (30-60 seconds)",
  "sections": [
    { "title": "Section title", "content": "Full script for this section", "duration": "~X minutes" }
  ],
  "outro": "Call to action, subscribe reminder, next video teaser (30-60 seconds)",
  "totalWords": 1200
}

Make it conversational, energetic, and optimized for viewer retention. Return ONLY valid JSON.`;

  try {
    const raw = await callGemini(prompt);
    const script = parseJson(raw);
    res.json({ success: true, data: script });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Script generation failed" });
  }
});

// ── 2. Multi-Language Translator ────────────────────────────────────────────
router.post("/ai/translate", async (req, res): Promise<void> => {
  const body = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    tags: z.string().optional(),
    languages: z.array(z.string()).min(1).max(6),
  }).safeParse(req.body);

  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { title, description, tags, languages } = body.data;

  const prompt = `You are a multilingual YouTube content expert. Translate and localize this content for each target language/region.

Original Title: "${title}"
${description ? `Original Description: "${description.slice(0, 300)}..."` : ""}
${tags ? `Tags: "${tags}"` : ""}

Target Languages: ${languages.join(", ")}

Return JSON:
{
  "translations": {
    "<language>": {
      "title": "Localized viral title",
      "description": "Localized 2-3 sentence description",
      "tags": "5-10 localized tags comma separated"
    }
  }
}

Return ONLY valid JSON.`;

  try {
    const raw = await callGemini(prompt);
    const result = parseJson(raw);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Translation failed" });
  }
});

// ── 3. Viral Hook Generator ─────────────────────────────────────────────────
router.post("/ai/hooks", async (req, res): Promise<void> => {
  const body = z.object({
    title: z.string().min(1),
    niche: z.string().optional(),
  }).safeParse(req.body);

  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { title, niche } = body.data;

  const prompt = `You are a viral YouTube title expert. Generate 10 different clickbait-style title hooks for this video.

Original Title: "${title}"
${niche ? `Niche: ${niche}` : ""}

Use different psychological triggers: curiosity gap, shock value, FOMO, controversy, numbers, "how-to", story, challenge, etc.

Return JSON:
{
  "hooks": [
    {
      "title": "The hook title",
      "type": "Psychological trigger type",
      "ctr_score": 8.5,
      "reason": "Why this works"
    }
  ]
}

Return ONLY valid JSON. Generate exactly 10 hooks.`;

  try {
    const raw = await callGemini(prompt);
    const result = parseJson(raw);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Hook generation failed" });
  }
});

// ── 4. Comment Reply Bot ────────────────────────────────────────────────────
router.post("/ai/reply", async (req, res): Promise<void> => {
  const body = z.object({
    comment: z.string().min(1),
    videoTitle: z.string().optional(),
    tone: z.enum(["friendly", "professional", "funny", "grateful"]).optional(),
  }).safeParse(req.body);

  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { comment, videoTitle, tone = "friendly" } = body.data;

  const prompt = `You are a YouTube creator replying to audience comments. Generate 3 different reply options.

Video: "${videoTitle || "YouTube video"}"
Comment: "${comment}"
Tone: ${tone}

Return JSON:
{
  "replies": [
    {
      "text": "The reply text",
      "style": "Style label",
      "sentiment": "positive/neutral/engaging"
    }
  ]
}

Max 3 replies. Return ONLY valid JSON.`;

  try {
    const raw = await callGemini(prompt);
    const result = parseJson(raw);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Reply generation failed" });
  }
});

// ── 5. Video Chapter Generator ──────────────────────────────────────────────
router.post("/ai/chapters", async (req, res): Promise<void> => {
  const body = z.object({
    description: z.string().min(1),
    title: z.string().optional(),
    duration: z.number().optional(),
  }).safeParse(req.body);

  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { description, title, duration = 10 } = body.data;

  const prompt = `You are a YouTube video chapter expert. Generate timestamped chapters for this video.

Title: "${title || "Video"}"
Description: "${description.slice(0, 600)}"
Video Duration: ~${duration} minutes

Return JSON:
{
  "chapters": [
    {
      "timestamp": "0:00",
      "title": "Chapter title",
      "description": "1-sentence summary"
    }
  ],
  "youtubeFormat": "0:00 Intro\\n1:30 Chapter 2\\n..."
}

First chapter MUST start at 0:00. Max 10-12 chapters. Return ONLY valid JSON.`;

  try {
    const raw = await callGemini(prompt);
    const result = parseJson(raw);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Chapter generation failed" });
  }
});

// ── 6. Niche & Competitor Analysis ─────────────────────────────────────────
router.post("/ai/niche-analysis", async (req, res): Promise<void> => {
  const body = z.object({
    topic: z.string().min(1),
    targetAudience: z.string().optional(),
  }).safeParse(req.body);

  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { topic, targetAudience } = body.data;

  const prompt = `You are a YouTube niche and SEO strategy expert. Analyze this content niche.

Topic: "${topic}"
${targetAudience ? `Target Audience: ${targetAudience}` : ""}

Return JSON:
{
  "nicheSummary": "2-3 sentence overview",
  "competitionLevel": "Low / Medium / High",
  "audienceSize": "Estimated audience size",
  "trendingAngles": [{ "angle": "Content angle idea", "reason": "Why it works now" }],
  "keywords": [{ "keyword": "phrase", "searchVolume": "High/Medium/Low", "competition": "High/Medium/Low" }],
  "contentGaps": ["Gap 1", "Gap 2"],
  "bestUploadTimes": "e.g. Tuesday-Thursday, 2pm-5pm EST",
  "monetizationPotential": "High/Medium/Low",
  "tips": ["Tip 1", "Tip 2", "Tip 3"]
}

Return ONLY valid JSON.`;

  try {
    const raw = await callGemini(prompt);
    const result = parseJson(raw);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Niche analysis failed" });
  }
});

// ── 7. Thumbnail Text Suggester ─────────────────────────────────────────────
router.post("/ai/thumbnail-text", async (req, res): Promise<void> => {
  const body = z.object({
    title: z.string().min(1),
    niche: z.string().optional(),
    emotion: z.string().optional(),
  }).safeParse(req.body);

  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { title, niche, emotion } = body.data;

  const prompt = `You are a YouTube thumbnail design expert. Suggest the best text overlays for a thumbnail.

Video Title: "${title}"
${niche ? `Niche: ${niche}` : ""}
${emotion ? `Desired Emotion: ${emotion}` : ""}

Return JSON:
{
  "suggestions": [
    {
      "mainText": "BOLD TEXT (2-4 words max)",
      "subText": "smaller supporting text (optional)",
      "style": "Style description",
      "colorScheme": "e.g. Red + White on dark background",
      "emojiAccent": "1-2 relevant emojis",
      "ctrScore": 8.5,
      "reasoning": "Why this thumbnail text will get clicks"
    }
  ],
  "designTips": ["Tip 1", "Tip 2", "Tip 3"],
  "colorPsychology": "Brief note on best colors for this niche"
}

Generate 5 different suggestions. Return ONLY valid JSON.`;

  try {
    const raw = await callGemini(prompt);
    const result = parseJson(raw);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Thumbnail text generation failed" });
  }
});

export default router;
