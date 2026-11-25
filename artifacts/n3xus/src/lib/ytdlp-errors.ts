export interface CookieValidationSummary {
  valid: boolean;
  status: "valid" | "expiring_soon" | "expired" | "missing_auth" | "not_youtube" | "invalid_format";
  cookieCount: number;
  ytCookieCount: number;
  malformedLines: number;
  foundAuthCookies: string[];
  missingRecommended: string[];
  expiredCount: number;
  earliestExpiry: string | null;
  warnings: string[];
}

export interface ParsedJobDiagnostic {
  code: string;
  title: string;
  summary: string;
  tips: string[];
  showSettingsLink: boolean;
}

export function previewNetscapeCookiesClient(raw: string): CookieValidationSummary | null {
  if (!raw.trim()) return null;

  const CORE_SESSION = ["SID", "__Secure-1PSID", "__Secure-3PSID", "SAPISID", "LOGIN_INFO"];
  const RECOMMENDED = [
    "SID",
    "HSID",
    "SSID",
    "APISID",
    "SAPISID",
    "LOGIN_INFO",
    "__Secure-1PSID",
    "__Secure-3PSID",
  ];

  const lines = raw.split(/\r?\n/);
  let cookieCount = 0;
  let ytCookieCount = 0;
  let malformedLines = 0;
  let expiredAuthCount = 0;
  let expiringSoonAuthCount = 0;
  let validCoreSessionCount = 0;
  let earliestExpirySecs: number | null = null;
  const foundAuthSet = new Set<string>();
  const nowSecs = Math.floor(Date.now() / 1000);
  const sevenDaysSecs = 7 * 24 * 60 * 60;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#") && !trimmed.startsWith("#HttpOnly_")) continue;

    const cleanLine = trimmed.startsWith("#HttpOnly_")
      ? trimmed.slice("#HttpOnly_".length)
      : trimmed;

    const parts = cleanLine.split("\t");
    if (parts.length < 7) {
      malformedLines++;
      continue;
    }

    const domain = parts[0].trim().toLowerCase();
    const flag = parts[1].trim().toUpperCase();
    const expiryRaw = Number(parts[4].trim());
    const name = parts[5].trim();

    if (!domain || (flag !== "TRUE" && flag !== "FALSE") || Number.isNaN(expiryRaw) || !name) {
      malformedLines++;
      continue;
    }

    cookieCount++;
    const isYtOrGoogle =
      domain.endsWith("youtube.com") ||
      domain === "youtube.com" ||
      domain.endsWith("google.com") ||
      domain === "google.com";
    if (isYtOrGoogle) ytCookieCount++;

    if (RECOMMENDED.includes(name) && isYtOrGoogle) {
      foundAuthSet.add(name);
      const isCore = CORE_SESSION.includes(name);
      if (expiryRaw > 0) {
        if (expiryRaw <= nowSecs) {
          if (isCore) expiredAuthCount++;
        } else {
          if (isCore) validCoreSessionCount++;
          if (earliestExpirySecs === null || expiryRaw < earliestExpirySecs) {
            earliestExpirySecs = expiryRaw;
          }
          if (expiryRaw - nowSecs <= sevenDaysSecs) expiringSoonAuthCount++;
        }
      } else if (isCore) {
        validCoreSessionCount++;
      }
    }
  }

  const foundAuthCookies = Array.from(foundAuthSet);
  const missingRecommended = RECOMMENDED.filter((c) => !foundAuthSet.has(c));
  const corePresentCount = CORE_SESSION.filter((c) => foundAuthSet.has(c)).length;

  const warnings: string[] = [];
  let status: CookieValidationSummary["status"] = "valid";
  if (cookieCount === 0) {
    status = "invalid_format";
    warnings.push("No valid Netscape tab-separated rows detected.");
  } else if (ytCookieCount === 0) {
    status = "not_youtube";
    warnings.push("No youtube.com or google.com cookies found in this paste.");
  } else if (corePresentCount === 0) {
    status = "missing_auth";
    warnings.push("Missing YouTube sign-in session cookies (SID, __Secure-1PSID, SAPISID, LOGIN_INFO).");
  } else if (validCoreSessionCount === 0 && expiredAuthCount > 0) {
    status = "expired";
    warnings.push("Session cookies appear expired. Re-export from an active YouTube tab.");
  } else if (expiringSoonAuthCount > 0 || expiredAuthCount > 0) {
    status = "expiring_soon";
    warnings.push("Some auth cookies are expired or expire within 7 days.");
  }

  return {
    valid: status === "valid" || status === "expiring_soon",
    status,
    cookieCount,
    ytCookieCount,
    malformedLines,
    foundAuthCookies,
    missingRecommended,
    expiredCount: expiredAuthCount,
    earliestExpiry: earliestExpirySecs ? new Date(earliestExpirySecs * 1000).toISOString() : null,
    warnings,
  };
}

export function parseJobErrorDiagnostic(errorMessage: string): ParsedJobDiagnostic {
  const msg = errorMessage.trim();
  const codeMatch = msg.match(/^\[([A-Z0-9_]+)\]\s*(.*)$/s);
  const explicitCode = codeMatch?.[1] ?? "";
  const cleanMsg = codeMatch?.[2] ?? msg;

  const code =
    explicitCode ||
    (/429|Too Many Requests/i.test(msg)
      ? "RATE_LIMITED_429"
      : /cookies are no longer valid/i.test(msg)
      ? "COOKIES_EXPIRED"
      : /not a bot/i.test(msg)
      ? "BOT_CHECK"
      : /2160p|4K/i.test(msg) && /not available|aborted/i.test(msg)
      ? "4K_UNAVAILABLE"
      : /proxy/i.test(msg)
      ? "PROXY_ERROR"
      : /stalled|timed out/i.test(msg)
      ? "STREAM_STALLED"
      : "YTDLP_ERROR");

  switch (code) {
    case "RATE_LIMITED_429":
      return {
        code,
        title: "YouTube Rate Limit (HTTP 429)",
        summary: cleanMsg,
        tips: [
          "YouTube temporarily throttled this server IP due to shared cloud hosting traffic.",
          "Wait 5–15 minutes before retrying, or add a residential HTTP/SOCKS5 proxy in Settings.",
          "Ensure fresh signed-in Netscape cookies are uploaded and verified in Settings.",
        ],
        showSettingsLink: true,
      };
    case "COOKIES_EXPIRED":
      return {
        code,
        title: "YouTube Cookies Expired or Flagged",
        summary: cleanMsg,
        tips: [
          "Re-export Netscape cookies from an incognito/active browser tab signed into YouTube, then paste into Settings.",
          "If bot checks persist immediately with fresh cookies, pair cookies with a residential proxy in Settings.",
        ],
        showSettingsLink: true,
      };
    case "BOT_CHECK":
      return {
        code,
        title: "YouTube Bot Verification Required",
        summary: cleanMsg,
        tips: [
          "Upload valid signed-in Netscape YouTube cookies in Settings.",
          "Run 'Test Download Setup' in Settings to confirm the PO Token server is responding.",
          "Add an optional residential proxy in Settings if Render's shared IP is blocked.",
        ],
        showSettingsLink: true,
      };
    case "4K_UNAVAILABLE":
      return {
        code,
        title: "Strict 4K (2160p) Unavailable",
        summary: cleanMsg,
        tips: [
          "This mission is set to fail strictly if a native 2160p stream cannot be retrieved (no silent downgrade).",
          "Check Settings → 'Test Download Setup' to confirm cookies, PO Token server, and proxy allow 4K formats.",
          "Verify on YouTube that the source video itself actually has a 2160p (4K) option, or switch mission quality to 1080p/1440p.",
        ],
        showSettingsLink: true,
      };
    case "PROXY_ERROR":
      return {
        code,
        title: "Download Proxy Connection Failed",
        summary: cleanMsg,
        tips: [
          "Verify proxy host, port, username, and password in Settings → Download Proxy.",
          "Click 'Test Connection' in Settings or remove the proxy to test direct server downloads.",
        ],
        showSettingsLink: true,
      };
    case "POT_UNAVAILABLE":
      return {
        code,
        title: "PO Token Provider Issue",
        summary: cleanMsg,
        tips: [
          "The local bgutil PO Token service may still be starting or unavailable.",
          "Open Settings and run 'Test Download Setup' to verify PO Token Server status.",
        ],
        showSettingsLink: true,
      };
    case "STREAM_STALLED":
      return {
        code,
        title: "Download Stalled / Timed Out",
        summary: cleanMsg,
        tips: [
          "YouTube's media stream stopped transferring data or timed out on the server connection.",
          "Click Retry Mission (or Publish Now if the error happened during No-Download publish).",
          "For 4K missions, ensure a stable proxy or fresh Netscape cookies in Settings if Render's IP is throttled.",
        ],
        showSettingsLink: true,
      };
    case "UPLOAD_TIMEOUT":
      return {
        code,
        title: "Platform Upload Stalled",
        summary: cleanMsg,
        tips: [
          "Uploading the video stream to YouTube/Facebook stalled with no progress for 2 minutes.",
          "Click Publish Now to retry the upload cleanly without re-creating the mission.",
          "Check Settings to verify your target YouTube/Facebook channel token is still valid.",
        ],
        showSettingsLink: true,
      };
    case "PUBLISH_INTERRUPTED":
      return {
        code,
        title: "Publishing Interrupted by Restart",
        summary: cleanMsg,
        tips: [
          "The server restarted while this mission was preparing or uploading the video.",
          "Your approved metadata and edits are preserved — click Publish Now to resume.",
        ],
        showSettingsLink: false,
      };
    case "CANCELLED":
      return {
        code,
        title: "Mission Stopped",
        summary: cleanMsg,
        tips: [
          "Execution was cancelled by user request and active transfers were stopped.",
          "Use Retry Mission or Publish Now whenever you are ready to run it again.",
        ],
        showSettingsLink: false,
      };
    default:
      return {
        code,
        title: "Download / Processing Error",
        summary: cleanMsg,
        tips: [
          "Inspect the message above and verify cookies, PO Token server, and optional proxy in Settings if the error came from yt-dlp.",
        ],
        showSettingsLink: /yt-dlp|cookie|youtube|format/i.test(msg),
      };
  }
}
