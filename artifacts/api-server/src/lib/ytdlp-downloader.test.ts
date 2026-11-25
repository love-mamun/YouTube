import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDownloadFormatPlan,
  buildExtractorArgsForStrategy,
} from "./ytdlp-downloader";
import { classifyYtDlpError } from "./ytdlp-config";

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
