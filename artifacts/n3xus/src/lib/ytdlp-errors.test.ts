import test from "node:test";
import assert from "node:assert/strict";
import {
  parseJobErrorDiagnostic,
  previewNetscapeCookiesClient,
  previewProxyListClient,
} from "./ytdlp-errors";

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

test("previewProxyListClient parses comma/newline ip:port template and flags invalid/private hosts", () => {
  assert.equal(previewProxyListClient(""), null);

  const okRes = previewProxyListClient("103.152.112.162:8080,\n45.140.143.77:3128,\n103.152.112.162:8080");
  assert.ok(okRes);
  assert.equal(okRes.validCount, 2);
  assert.equal(okRes.invalidCount, 0);
  assert.equal(okRes.entries[0]?.normalized, "http://103.152.112.162:8080");

  const badRes = previewProxyListClient("103.152.112.162:8080,\n127.0.0.1:8080,\n99.99.99.99");
  assert.ok(badRes);
  assert.equal(badRes.validCount, 1);
  assert.equal(badRes.invalidCount, 2);
  assert.ok(badRes.firstError);
});
