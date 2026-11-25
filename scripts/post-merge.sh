#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push
# Keep yt-dlp on the latest pip release (Nix ships an older frozen version).
# yt-dlp 2026+ uses the android_vr client which bypasses YouTube's SABR streaming
# restrictions and can download all resolutions from 480p up to 4K without needing
# a JS runtime or PO Token.
pip install --user "yt-dlp>=2026.6.9" --quiet
