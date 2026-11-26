import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDownloadFormatPlan,
  buildExtractorArgsForStrategy,
  rankAndFilterHealthyProxies,
  type ProxyHealthEntry,
} from "./ytdlp-downloader";
import {
  classifyYtDlpError,
  getPublicTemplateEntry,
  parseAndValidateProxyList,
  validateAndNormalizeProxyUrl,
} from "./ytdlp-config";
import {
  buildShortFormVideoFilter,
  jobNeedsFfmpegPipeline,
} from "./video-processor";
import { buildFallbackContent } from "./ai-content";
import {
  extractProxiesFromFeedText,
  hashTriggerToken,
  sampleCandidatesRoundRobin,
  selectTopWorkingProxies,
  validateCustomGithubFeedUrl,
  validateScraperConfigInput,
  verifyTriggerToken,
} from "./proxy-scraper";

test("classifyYtDlpError distinguishes 4K_UNAVAILABLE from BOT_CHECK and COOKIES_EXPIRED", () => {
  const unavailable = classifyYtDlpError(
    "ERROR: [youtube] dOwWobdxIGk: Requested format is not available. Use --list-formats",
    { quality: "4k", usedCookies: true },
  );
  assert.equal(unavailable.code, "4K_UNAVAILABLE");

  const botWithCookies = classifyYtDlpError(
    "ERROR: [youtube] xyz: Sign in to confirm you’re not a bot.",
    { quality: "1080p", usedCookies: true },
  );
  assert.equal(botWithCookies.code, "COOKIES_EXPIRED");

  const botWithoutCookies = classifyYtDlpError(
    "ERROR: [youtube] xyz: Sign in to confirm you’re not a bot.",
    { quality: "1080p", usedCookies: false },
  );
  assert.equal(botWithoutCookies.code, "BOT_CHECK");

  const ejsFail = classifyYtDlpError(
    "WARNING: [youtube] jNQXAC9IVRw: n challenge solving failed ERROR: [youtube] jNQXAC9IVRw: No video formats found!",
    { quality: "1080p", usedCookies: true, usedProxy: true, proxyMaskedHost: "http://***@1.2.3.4:8080" },
  );
  assert.equal(ejsFail.code, "FORMAT_UNAVAILABLE");
  assert.match(ejsFail.formattedMessage, /EJS/i);

  const noFormatsProxy = classifyYtDlpError(
    "ERROR: [youtube] jNQXAC9IVRw: No video formats found!",
    { usedCookies: true, usedProxy: true, proxyMaskedHost: "http://***@1.2.3.4:8080" },
  );
  assert.equal(noFormatsProxy.code, "FORMAT_UNAVAILABLE");
  assert.match(noFormatsProxy.formattedMessage, /proxy/i);
});

test("buildDownloadFormatPlan uses res sorting for 360p-1440p so portrait Shorts keep full resolution", () => {
  for (const [quality, expectedHeight] of [
    ["360p", 360],
    ["480p", 480],
    ["720p", 720],
    ["1080p", 1080],
    ["1440p", 1440],
  ] as const) {
    const plan = buildDownloadFormatPlan({ quality });
    assert.equal(plan.isStrict4K, false);
    assert.deepEqual(plan.sortArgs, ["-S", `res:${expectedHeight}`]);
    assert.deepEqual(plan.formatSelectors, ["bestvideo*+bestaudio/b"]);
  }
});

test("buildDownloadFormatPlan applies codec filter when codec is specified", () => {
  const av1 = buildDownloadFormatPlan({ quality: "1080p", codec: "av1" });
  assert.deepEqual(av1.sortArgs, ["-S", "res:1080"]);
  assert.deepEqual(av1.formatSelectors, ["bestvideo*[vcodec^=av01]+bestaudio/bestvideo*+bestaudio/b"]);

  const vp9 = buildDownloadFormatPlan({ quality: "720p", codec: "vp9" });
  assert.deepEqual(vp9.formatSelectors, ["bestvideo*[vcodec^=vp9]+bestaudio/bestvideo*+bestaudio/b"]);

  const h264 = buildDownloadFormatPlan({ quality: "1080p", codec: "h264" });
  assert.deepEqual(h264.formatSelectors, ["bestvideo*[vcodec^=avc1]+bestaudio/bestvideo*+bestaudio/b"]);
});

test("buildDownloadFormatPlan defaults No-Download metadata fallback to res:1080 with mp4/m4a preference", () => {
  const plan = buildDownloadFormatPlan({ quality: null });
  assert.equal(plan.isStrict4K, false);
  assert.deepEqual(plan.sortArgs, ["-S", "res:1080,ext:mp4:m4a"]);
  assert.deepEqual(plan.formatSelectors, ["bestvideo*+bestaudio/b"]);
});

test("buildDownloadFormatPlan enforces strict 2160p for 4k on both landscape and portrait streams", () => {
  const plan = buildDownloadFormatPlan({ quality: "4k" });
  assert.equal(plan.isStrict4K, true);
  assert.deepEqual(plan.sortArgs, []);
  assert.equal(plan.formatSelectors.length, 1);
  assert.match(plan.formatSelectors[0], /height>=2160/);
  assert.match(plan.formatSelectors[0], /width>=2160/);
  assert.match(plan.formatSelectors[0], /aspect_ratio<1/);

  const h264Plan = buildDownloadFormatPlan({ quality: "4k", codec: "h264" });
  assert.match(h264Plan.formatSelectors[0], /\[vcodec\^=avc1\]/);
  assert.match(h264Plan.formatSelectors[0], /width>=2160/);
});

test("buildExtractorArgsForStrategy omits player_client=default and includes formats=missing_pot when needed", () => {
  assert.deepEqual(
    buildExtractorArgsForStrategy({
      client: "default",
      useCookies: true,
      usePot: false,
      useMissingPotFlag: true,
    }),
    ["--extractor-args", "youtube:formats=missing_pot"],
  );

  assert.deepEqual(
    buildExtractorArgsForStrategy({
      client: "default",
      useCookies: true,
      usePot: true,
      useMissingPotFlag: false,
    }),
    [],
  );

  assert.deepEqual(
    buildExtractorArgsForStrategy({
      client: "web",
      useCookies: true,
      usePot: false,
      useMissingPotFlag: true,
    }),
    ["--extractor-args", "youtube:player_client=web;formats=missing_pot"],
  );

  assert.deepEqual(
    buildExtractorArgsForStrategy({
      client: "android_vr",
      useCookies: false,
      usePot: false,
      useMissingPotFlag: true,
    }),
    ["--extractor-args", "youtube:player_client=android_vr;formats=missing_pot"],
  );
});

test("parseAndValidateProxyList supports bare ip:port,ip:port template, comments, deduplication, and masks credentials", () => {
  const raw = [
    "# Free proxy batch",
    "103.152.112.162:8080,",
    "45.140.143.77:3128",
    "103.152.112.162:8080",
    "socks5://user1:secret@64.137.96.74:6641,",
  ].join("\n");

  const res = parseAndValidateProxyList(raw);
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.deepEqual(res.proxies, [
    "http://103.152.112.162:8080",
    "http://45.140.143.77:3128",
    "socks5://user1:secret@64.137.96.74:6641",
  ]);
  assert.deepEqual(res.maskedList, [
    "http://103.152.112.162:8080",
    "http://45.140.143.77:3128",
    "socks5://***@64.137.96.74:6641",
  ]);
  assert.equal(res.summary, "http://103.152.112.162:8080 (+2 more)");
});

test("validateAndNormalizeProxyUrl and parseAndValidateProxyList reject private/loopback IPs and missing ports", () => {
  assert.equal(validateAndNormalizeProxyUrl("127.0.0.1:8080").ok, false);
  assert.equal(validateAndNormalizeProxyUrl("192.168.1.50:3128").ok, false);
  assert.equal(validateAndNormalizeProxyUrl("[::ffff:127.0.0.1]:8080").ok, false);
  assert.equal(validateAndNormalizeProxyUrl("103.152.112.162").ok, false);

  const mixed = parseAndValidateProxyList("103.152.112.162:8080,\n127.0.0.1:8080");
  assert.equal(mixed.ok, false);
  if (!mixed.ok) {
    assert.match(mixed.error, /Proxy #2/i);
  }
});

test("rankAndFilterHealthyProxies prioritizes lowest latency healthy proxies and demotes cooled-down entries", () => {
  const now = 1_000_000;
  const map = new Map<string, ProxyHealthEntry>([
    ["http://1.1.1.1:8080", { failCount: 0, lastLatencyMs: 650, cooldownUntil: 0 }],
    ["http://2.2.2.2:8080", { failCount: 2, lastLatencyMs: 120, cooldownUntil: now + 60_000 }],
    ["http://3.3.3.3:8080", { failCount: 0, lastLatencyMs: 95, cooldownUntil: 0 }],
    ["http://4.4.4.4:8080", { failCount: 1, lastLatencyMs: 200, cooldownUntil: now - 1 }],
  ]);

  const ranked = rankAndFilterHealthyProxies(
    [
      "http://1.1.1.1:8080",
      "http://2.2.2.2:8080",
      "http://3.3.3.3:8080",
      "http://4.4.4.4:8080",
    ],
    map,
    now
  );

  assert.deepEqual(ranked, [
    "http://3.3.3.3:8080",
    "http://4.4.4.4:8080",
    "http://1.1.1.1:8080",
    "http://2.2.2.2:8080",
  ]);
});

test("getPublicTemplateEntry exposes only unauthenticated http host:port entries and hides credentials", () => {
  assert.equal(getPublicTemplateEntry("http://45.140.143.77:3128"), "45.140.143.77:3128");
  assert.equal(getPublicTemplateEntry("http://user:pass@45.140.143.77:3128"), null);
  assert.equal(getPublicTemplateEntry("socks5://45.140.143.77:1080"), null);
});

test("buildShortFormVideoFilter builds blurred backdrop and safe 9:16 center crop graphs", () => {
  const blur = buildShortFormVideoFilter({
    aspectMode: "vertical_blur",
    quality: "1080p",
    applyCopyrightSuite: false,
  });
  assert.equal(blur.videoFilter, null);
  assert.ok(blur.filterComplex);
  assert.match(blur.filterComplex!, /1080:1920/);
  assert.match(blur.filterComplex!, /gblur=sigma=28/);

  const crop = buildShortFormVideoFilter({
    aspectMode: "vertical_crop",
    quality: "720p",
    applyCopyrightSuite: false,
  });
  assert.equal(crop.filterComplex, null);
  assert.ok(crop.videoFilter);
  assert.match(crop.videoFilter!, /min\(iw\\,ih\*9\/16\)/);
  assert.match(crop.videoFilter!, /scale=1080:1920/);
  assert.doesNotMatch(crop.videoFilter!, /drawtext=/);

  const fourK = buildShortFormVideoFilter({
    aspectMode: "vertical_blur",
    quality: "4k",
    applyCopyrightSuite: true,
    hasLogo: true,
  });
  assert.ok(fourK.filterComplex);
  assert.match(fourK.filterComplex!, /2160:3840/);
  assert.match(fourK.filterComplex!, /\[wm1\]\[wm2\]/);
});

test("jobNeedsFfmpegPipeline activates FFmpeg when short-form transforms or 4k mission are configured", () => {
  assert.equal(jobNeedsFfmpegPipeline({ quality: "720p", missionType: "normal", aspectMode: "source" }), false);
  assert.equal(jobNeedsFfmpegPipeline({ quality: null, missionType: "normal", aspectMode: "vertical_blur" }), false);
  assert.equal(jobNeedsFfmpegPipeline({ quality: "720p", missionType: "normal", aspectMode: "vertical_blur" }), true);
  assert.equal(jobNeedsFfmpegPipeline({ quality: "720p", missionType: "normal", clipStartSecs: 15 }), true);
  assert.equal(jobNeedsFfmpegPipeline({ quality: "720p", missionType: "normal", clipMaxSecs: 59 }), true);
  assert.equal(jobNeedsFfmpegPipeline({ quality: "720p", missionType: "normal", audioNormalize: "loudnorm" }), true);
  assert.equal(jobNeedsFfmpegPipeline({ quality: "4k", missionType: "4k" }), true);
});

test("buildFallbackContent short-form mode produces compact mobile hook and platform hashtags", () => {
  const longOrig = "This Is A Very Long Documentary Video Title About Building Incredible Apps That Definitely Exceeds Mobile Feed Length Limits";
  const res = buildFallbackContent(longOrig, {
    copyStyle: "short",
    platforms: ["youtube-shorts", "facebook"],
  });
  assert.ok(res.title.length <= 65);
  assert.match(res.hashtags, /#Shorts/);
  assert.match(res.hashtags, /#Reels/);
});

test("extractProxiesFromFeedText tags bare ip:port by protocol, deduplicates, and filters private hosts", () => {
  const raw = [
    "# updated list",
    "103.152.112.162:1080",
    "127.0.0.1:1080",
    "192.168.0.10:1080",
    "45.140.143.77:1080 # inline comment",
    "http://8.8.8.8:8080",
    "103.152.112.162:1080",
  ].join("\n");

  const parsed = extractProxiesFromFeedText(raw, "socks5");
  assert.deepEqual(parsed, [
    "socks5://103.152.112.162:1080",
    "socks5://45.140.143.77:1080",
    "http://8.8.8.8:8080",
  ]);
});

test("validateCustomGithubFeedUrl enforces HTTPS GitHub raw/gist allowlist and converts blob URLs", () => {
  const rawOk = validateCustomGithubFeedUrl(
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt"
  );
  assert.equal(rawOk.ok, true);

  const blobOk = validateCustomGithubFeedUrl(
    "https://github.com/TheSpeedX/PROXY-List/blob/master/http.txt"
  );
  assert.equal(blobOk.ok, true);
  if (blobOk.ok) {
    assert.equal(
      blobOk.normalized,
      "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt"
    );
  }

  assert.equal(
    validateCustomGithubFeedUrl("http://raw.githubusercontent.com/a/b/main/p.txt").ok,
    false
  );
  assert.equal(validateCustomGithubFeedUrl("https://evil.example.com/proxies.txt").ok, false);
  assert.equal(validateCustomGithubFeedUrl("http://127.0.0.1:8080/proxies.txt").ok, false);
  assert.equal(
    validateCustomGithubFeedUrl("https://user:pass@raw.githubusercontent.com/a/b/main/p.txt").ok,
    false
  );
});

test("validateScraperConfigInput rejects empty configs and normalizes valid feeds", () => {
  assert.equal(
    validateScraperConfigInput({ enabledFeedIds: [], customUrls: [] }).ok,
    false
  );

  const valid = validateScraperConfigInput({
    enabledFeedIds: ["monosans_http", "unknown_feed_id"],
    customUrls: ["https://gist.githubusercontent.com/user/123/raw/proxies.txt"],
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.deepEqual(valid.config.enabledFeedIds, ["monosans_http"]);
    assert.equal(valid.config.customUrls.length, 1);
  }
});

test("sampleCandidatesRoundRobin balances across feeds and selectTopWorkingProxies caps to fastest 30", () => {
  const sampled = sampleCandidatesRoundRobin(
    [
      ["http://1.1.1.1:80", "http://1.1.1.2:80", "http://1.1.1.3:80"],
      ["socks5://2.2.2.1:1080", "socks5://2.2.2.2:1080"],
    ],
    4
  );
  assert.equal(sampled.length, 4);
  assert.ok(sampled.some((p) => p.startsWith("http://1.1.1.")));
  assert.ok(sampled.some((p) => p.startsWith("socks5://2.2.2.")));

  const mockChecked = Array.from({ length: 40 }, (_, i) => ({
    proxy: `http://45.10.0.${i + 1}:8080`,
    ok: i !== 0 && i !== 5,
    latencyMs: 500 - i * 10,
  }));

  const top = selectTopWorkingProxies(mockChecked, 30);
  assert.equal(top.length, 30);
  assert.ok((top[0].latencyMs ?? 999) <= (top[1].latencyMs ?? 999));
  assert.ok((top[28].latencyMs ?? 999) <= (top[29].latencyMs ?? 999));
});

test("hashTriggerToken and verifyTriggerToken validate secrets securely", () => {
  const secret = "nxpx_test_secret_token_value_123456";
  const hash = hashTriggerToken(secret);
  assert.equal(verifyTriggerToken(secret, hash), true);
  assert.equal(verifyTriggerToken("nxpx_wrong_secret_token_value_123456", hash), false);
  assert.equal(verifyTriggerToken("", hash), false);
});

