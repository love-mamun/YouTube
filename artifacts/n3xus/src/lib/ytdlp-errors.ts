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

export interface ProxyPreviewEntry {
  raw: string;
  normalized: string | null;
  valid: boolean;
  error: string | null;
}

export interface ProxyPreviewSummary {
  total: number;
  validCount: number;
  invalidCount: number;
  entries: ProxyPreviewEntry[];
  firstError: string | null;
}

function isDisallowedClientProxyHost(hostname: string): boolean {
  let host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  if (host.startsWith("::ffff:")) {
    const tail = host.slice("::ffff:".length);
    const hexMatch = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1], 16);
      const lo = parseInt(hexMatch[2], 16);
      host = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    } else {
      host = tail;
    }
  }
  if (
    host === "localhost" ||
    host === "::1" ||
    host === "::" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }
  return false;
}

const ALLOWED_PROXY_SCHEMES = new Set(["http:", "https:", "socks4:", "socks4a:", "socks5:", "socks5h:"]);

export function previewProxyListClient(raw: string): ProxyPreviewSummary | null {
  if (typeof raw !== "string" || !raw.trim()) return null;

  const rawTokens: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const cleanedLine = line.trim();
    if (!cleanedLine || cleanedLine.startsWith("#")) continue;
    for (const part of cleanedLine.split(/[,;\s]+/)) {
      const token = part.trim();
      if (token) rawTokens.push(token);
    }
  }

  if (rawTokens.length === 0) return null;

  const seen = new Set<string>();
  const entries: ProxyPreviewEntry[] = [];
  let validCount = 0;
  let invalidCount = 0;
  let firstError: string | null = null;

  for (const token of rawTokens) {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(token) ? token : `http://${token}`;
    let parsed: URL;
    try {
      parsed = new URL(withScheme);
    } catch {
      const err = `Invalid proxy "${token}". Expected ip:port (e.g. 103.152.112.162:8080).`;
      entries.push({ raw: token, normalized: null, valid: false, error: err });
      invalidCount++;
      if (!firstError) firstError = err;
      continue;
    }

    if (!ALLOWED_PROXY_SCHEMES.has(parsed.protocol)) {
      const err = `Unsupported scheme "${parsed.protocol}". Use ip:port, http://, https://, socks5://, or socks4://.`;
      entries.push({ raw: token, normalized: null, valid: false, error: err });
      invalidCount++;
      if (!firstError) firstError = err;
      continue;
    }

    if (!parsed.hostname || isDisallowedClientProxyHost(parsed.hostname)) {
      const err = `Blocked local/private proxy host "${parsed.hostname || token}".`;
      entries.push({ raw: token, normalized: null, valid: false, error: err });
      invalidCount++;
      if (!firstError) firstError = err;
      continue;
    }

    const portNum = Number(parsed.port);
    if (!parsed.port || Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
      const err = `Missing or invalid port on "${token}". Expected ip:port (port 1-65535).`;
      entries.push({ raw: token, normalized: null, valid: false, error: err });
      invalidCount++;
      if (!firstError) firstError = err;
      continue;
    }

    const normalized = parsed.toString().replace(/\/+$/, "");
    if (!seen.has(normalized)) {
      seen.add(normalized);
      entries.push({ raw: token, normalized, valid: true, error: null });
      validCount++;
    }
  }

  return {
    total: entries.length,
    validCount,
    invalidCount,
    entries,
    firstError,
  };
}

export function previewNetscapeCookiesClient(raw: string): CookieValidationSummary | null {
  if (typeof raw !== "string" || !raw.trim()) return null;

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
  const msg = typeof errorMessage === "string" ? errorMessage.trim() : String(errorMessage ?? "").trim();
  const codeMatch = msg.match(/^\[([A-Z0-9_]+)\]\s*([\s\S]*)$/);
  const explicitCode = codeMatch?.[1] ?? "";
  const cleanMsg = codeMatch?.[2] ?? msg;

  const code =
    explicitCode ||
    (/429|Too Many Requests/i.test(msg)
      ? "RATE_LIMITED_429"
      : /cookies are no longer valid/i.test(msg)
      ? "COOKIES_EXPIRED"
      : /not a bot|do-i-pass-cookies-to-yt-dlp|exporting-youtube-cookies/i.test(msg)
      ? "BOT_CHECK"
      : /2160p|4K/i.test(msg) && /not available|aborted/i.test(msg)
      ? "4K_UNAVAILABLE"
      : /ENOSPC|No space left on device|disk full/i.test(msg)
      ? "DISK_FULL"
      : /proxy/i.test(msg)
      ? "PROXY_ERROR"
      : /stalled|timed out|TransportError/i.test(msg)
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
    case "FORMAT_UNAVAILABLE":
      return {
        code,
        title: "No Playable Video Formats Found",
        summary: cleanMsg,
        tips: [
          "YouTube returned no playable stream URLs for this client/session (common when cookies + proxy trigger SABR-only mode or JS challenge solving is blocked).",
          "In Settings, run 'Test Download Setup' — if your proxy is active, try temporarily removing the proxy or switching to another IP, and ensure fresh signed-in Netscape cookies are saved.",
        ],
        showSettingsLink: true,
      };
    case "PROXY_ERROR":
      return {
        code,
        title: "Download Proxy Connection Failed / Timed Out",
        summary: cleanMsg,
        tips: [
          "Verify proxy host, port, username, and password in Settings → Download Proxy.",
          "If the proxy timed out contacting YouTube, click 'Remove' in Settings to test direct server downloads or switch to a faster proxy.",
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
    case "DISK_FULL":
      return {
        code,
        title: "Insufficient Temporary Storage Space",
        summary: cleanMsg,
        tips: [
          "Render free/default /tmp ephemeral storage fills up quickly with 1–2 GB videos (merging video+audio temporarily requires ~2x the file size).",
          "Run one large job at a time (published files are automatically deleted immediately after upload completes).",
          "For reliable 2 GB+ downloads on Render, attach a Render Disk (5–10 GB) and set the VIDEO_STORE_DIR env var to the mounted disk path.",
        ],
        showSettingsLink: true,
      };
    case "STREAM_STALLED":
      return {
        code,
        title: "Download Stalled / Timed Out",
        summary: cleanMsg,
        tips: [
          "YouTube's API or media stream timed out on the server connection.",
          "Run 'Test Download Setup' in Settings to verify whether YouTube API & your proxy (if configured) respond cleanly.",
          "Click Retry Mission (or Publish Now if the error happened during No-Download publish).",
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
