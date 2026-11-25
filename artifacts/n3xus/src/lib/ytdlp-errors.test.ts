import test from "node:test";
import assert from "node:assert/strict";
import { parseJobErrorDiagnostic, previewNetscapeCookiesClient } from "./ytdlp-errors";

test("parseJobErrorDiagnostic handles explicit bracketed codes including multiline text", () => {
  const diag = parseJobErrorDiagnostic(
    "[BOT_CHECK] Line 1\nERROR: Sign in to confirm you're not a bot\nLine 3",
  );
  assert.equal(diag.code, "BOT_CHECK");
  assert.equal(diag.showSettingsLink, true);
  assert.match(diag.summary, /Line 1/);
  assert.match(diag.summary, /Line 3/);
});

test("parseJobErrorDiagnostic classifies unbracketed error messages accurately", () => {
  assert.equal(parseJobErrorDiagnostic("HTTP Error 429: Too Many Requests").code, "RATE_LIMITED_429");
  assert.equal(parseJobErrorDiagnostic("The provided YouTube cookies are no longer valid").code, "COOKIES_EXPIRED");
  assert.equal(parseJobErrorDiagnostic("Sign in to confirm you're not a bot").code, "BOT_CHECK");
  assert.equal(parseJobErrorDiagnostic("2160p stream not available for this video").code, "4K_UNAVAILABLE");
  assert.equal(parseJobErrorDiagnostic("ENOSPC: no space left on device").code, "DISK_FULL");
  assert.equal(parseJobErrorDiagnostic("TransportError('timed out')").code, "STREAM_STALLED");
});

test("parseJobErrorDiagnostic never throws on malformed or nullish runtime inputs", () => {
  const diag = parseJobErrorDiagnostic(null as unknown as string);
  assert.equal(diag.code, "YTDLP_ERROR");
  assert.equal(diag.summary, "");
});

test("previewNetscapeCookiesClient returns null on empty or non-string input and parses valid Netscape rows", () => {
  assert.equal(previewNetscapeCookiesClient(""), null);
  assert.equal(previewNetscapeCookiesClient(undefined as unknown as string), null);

  const futureExpiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 60;
  const sample = [
    "# Netscape HTTP Cookie File",
    `.youtube.com\tTRUE\t/\tTRUE\t${futureExpiry}\tSID\tabc`,
    `.youtube.com\tTRUE\t/\tTRUE\t${futureExpiry}\t__Secure-1PSID\tdef`,
    `#HttpOnly_.google.com\tTRUE\t/\tTRUE\t${futureExpiry}\tLOGIN_INFO\tghi`,
  ].join("\n");

  const result = previewNetscapeCookiesClient(sample);
  assert.ok(result);
  assert.equal(result.valid, true);
  assert.equal(result.status, "valid");
  assert.equal(result.ytCookieCount, 3);
  assert.ok(result.foundAuthCookies.includes("SID"));
});
