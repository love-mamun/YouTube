import { motion, AnimatePresence } from "framer-motion";
import {
  useListTokens,
  useDeleteToken,
  useListChannels,
  getListTokensQueryKey,
  getListChannelsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect, useRef } from "react";
import {
  Youtube, Facebook, Trash2, Loader2, CheckCircle2, ExternalLink,
  AlertTriangle, Users, Key, Save, Eye, EyeOff,
  ChevronDown, ChevronUp, Plus, Star, RefreshCw, Cookie, Info, ImageIcon, Upload,
  Lock, LogOut, ShieldCheck, Globe, Activity,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { previewNetscapeCookiesClient, type CookieValidationSummary } from "@/lib/ytdlp-errors";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface YouTubeChannel {
  id: number;
  channelId: string | null;
  channelName: string;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  tokenId: number | null;
  isDefault: boolean;
  isActive: boolean;
}

interface CredentialStatus { set: boolean; updatedAt: string | null; }
type CredentialsMap = Record<string, CredentialStatus>;

const CREDENTIAL_FIELDS = [
  { key: "YOUTUBE_CLIENT_ID", label: "YouTube Client ID", hint: "OAuth 2.0 Client ID from Google Cloud Console", icon: <Youtube className="w-4 h-4 text-red-500" />, group: "youtube" },
  { key: "YOUTUBE_CLIENT_SECRET", label: "YouTube Client Secret", hint: "OAuth 2.0 Client Secret from Google Cloud Console", icon: <Youtube className="w-4 h-4 text-red-500" />, group: "youtube", secret: true },
  { key: "FACEBOOK_APP_ID", label: "Facebook App ID", hint: "App ID from Meta for Developers console", icon: <Facebook className="w-4 h-4 text-blue-500" />, group: "facebook" },
  { key: "FACEBOOK_APP_SECRET", label: "Facebook App Secret", hint: "App Secret from Meta for Developers console", icon: <Facebook className="w-4 h-4 text-blue-500" />, group: "facebook", secret: true },
] as const;

function CredentialInput({ field, status, value, onChange }: {
  field: (typeof CREDENTIAL_FIELDS)[number];
  status: CredentialStatus | undefined;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  const isSecret = "secret" in field && field.secret;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-mono text-muted-foreground flex items-center gap-1.5">
          {field.icon}{field.label}
        </Label>
        {status?.set && (
          <span className="text-[10px] font-mono text-green-400 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Saved
            {status.updatedAt && <span className="text-muted-foreground"> · {new Date(status.updatedAt).toLocaleDateString()}</span>}
          </span>
        )}
      </div>
      <div className="relative">
        <Input
          type={isSecret && !show ? "password" : "text"}
          placeholder={status?.set ? "••••••••••••••••" : `Enter ${field.label}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs pr-8 bg-muted/40 border-border/70 focus:border-primary/50"
        />
        {isSecret && (
          <button type="button" onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
            {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{field.hint}</p>
    </div>
  );
}

function ChannelCard({ ch, onSetDefault, onDisconnect, isSettingDefault, isDisconnecting }: {
  ch: YouTubeChannel;
  onSetDefault: () => void;
  onDisconnect: () => void;
  isSettingDefault: boolean;
  isDisconnecting: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`flex flex-col gap-3 sm:flex-row sm:items-center p-4 rounded-lg border transition-all ${
        ch.isDefault ? "border-primary/40 bg-primary/5" : "border-border/50 bg-muted/30"
      }`}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {ch.thumbnailUrl ? (
          <img src={ch.thumbnailUrl} alt={ch.channelName}
            className="w-11 h-11 rounded-full object-cover border-2 border-primary/30 shrink-0" />
        ) : (
          <div className="w-11 h-11 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <Youtube className="w-5 h-5 text-primary" />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">{ch.channelName}</span>
            {ch.isDefault && (
              <Badge className="text-[10px] px-1.5 py-0 bg-primary/20 text-primary border-primary/30 font-mono">
                Default
              </Badge>
            )}
          </div>
          {ch.subscriberCount !== null && (
            <p className="text-xs text-muted-foreground font-mono flex items-center gap-1 mt-0.5">
              <Users className="w-3 h-3" />
              {ch.subscriberCount.toLocaleString()} subscribers
            </p>
          )}
          {ch.channelId && (
            <a href={`https://www.youtube.com/channel/${ch.channelId}`} target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-primary font-mono hover:underline flex items-center gap-1 mt-0.5">
              View channel <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!ch.isDefault && (
          <Button size="sm" variant="outline" onClick={onSetDefault} disabled={isSettingDefault}
            className="text-xs font-mono gap-1.5 h-7">
            {isSettingDefault ? <Loader2 className="w-3 h-3 animate-spin" /> : <Star className="w-3 h-3" />}
            Set Default
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDisconnect} disabled={isDisconnecting}
          className="text-xs font-mono gap-1.5 h-7 text-destructive hover:text-destructive">
          {isDisconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          Remove
        </Button>
      </div>
    </motion.div>
  );
}

export default function Settings() {
  const queryClient = useQueryClient();
  const { data: tokens } = useListTokens({ query: { queryKey: getListTokensQueryKey() } });
  const { data: channels } = useListChannels({ query: { queryKey: getListChannelsQueryKey() } });
  const safeTokens = Array.isArray(tokens) ? tokens : [];
  const safeChannels = Array.isArray(channels) ? channels : [];

  const [ytChannels, setYtChannels] = useState<YouTubeChannel[]>([]);
  const [ytLoading, setYtLoading] = useState(true);
  const [fbPages, setFbPages] = useState<YouTubeChannel[]>([]);
  const [fbLoading, setFbLoading] = useState(true);
  const [fbOauthMsg, setFbOauthMsg] = useState<{ type: "success" | "error" | "no_pages"; text: string } | null>(null);
  const [settingDefault, setSettingDefault] = useState<number | null>(null);
  const [settingFbDefault, setSettingFbDefault] = useState<number | null>(null);
  const [disconnecting, setDisconnecting] = useState<number | null>(null);
  const [disconnectingFb, setDisconnectingFb] = useState<number | null>(null);
  const [credStatus, setCredStatus] = useState<CredentialsMap>({});
  const [credValues, setCredValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showYtSetup, setShowYtSetup] = useState(false);
  const [showFbManual, setShowFbManual] = useState(false);
  const [fbManualToken, setFbManualToken] = useState("");
  const [fbManualPageId, setFbManualPageId] = useState("");
  const [fbManualPageName, setFbManualPageName] = useState("");
  const [fbManualSaving, setFbManualSaving] = useState(false);
  const [fbManualError, setFbManualError] = useState<string | null>(null);
  const [fbManualOk, setFbManualOk] = useState(false);
  const [deletingCredKey, setDeletingCredKey] = useState<string | null>(null);
  const [deleteCredError, setDeleteCredError] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  // YouTube cookies state
  const [cookiesStatus, setCookiesStatus] = useState<{
    set: boolean;
    updatedAt: string | null;
    validation: CookieValidationSummary | null;
  }>({ set: false, updatedAt: null, validation: null });
  const [cookiesText, setCookiesText] = useState("");
  const [cookiesSaving, setCookiesSaving] = useState(false);
  const [cookiesSavedOk, setCookiesSavedOk] = useState(false);
  const [cookiesError, setCookiesError] = useState<string | null>(null);
  const [showCookiesGuide, setShowCookiesGuide] = useState(false);
  const cookiesPreview = previewNetscapeCookiesClient(cookiesText);

  // Download proxy state
  const [proxyStatus, setProxyStatus] = useState<{
    set: boolean;
    maskedHost: string | null;
    updatedAt: string | null;
  }>({ set: false, maskedHost: null, updatedAt: null });
  const [proxyInput, setProxyInput] = useState("");
  const [showProxy, setShowProxy] = useState(false);
  const [proxySaving, setProxySaving] = useState(false);
  const [proxySavedOk, setProxySavedOk] = useState(false);
  const [proxyError, setProxyError] = useState<string | null>(null);

  // Diagnostics probe state
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [diagResult, setDiagResult] = useState<{
    ytDlp: { ok: boolean; version: string | null; error: string | null };
    potServer: { ok: boolean; mode: string; endpoint: string | null };
    proxy: { configured: boolean; maskedHost: string | null; ok: boolean | null; error: string | null };
    storage?: { path: string; persistentConfigured: boolean; totalMB: number | null; availableMB: number | null; usedMB: number | null };
    cookies: { set: boolean; validation: CookieValidationSummary | null };
    probe: {
      attempted: boolean;
      ok: boolean | null;
      maxHeight: number | null;
      has4k: boolean | null;
      clientUsed: string | null;
      errorCode: string | null;
      message: string | null;
    };
  } | null>(null);

  // Watermark logo state
  const [logoSet, setLogoSet] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoOk, setLogoOk] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  // ── Auth gate ─────────────────────────────────────────────────────────────
  const [authed, setAuthed] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authPassword, setAuthPassword] = useState("");
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const authInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${BASE}/api/auth/status`, { credentials: "include" })
      .then((r) => r.json())
      .then((d: { authed: boolean }) => { setAuthed(d.authed); })
      .catch(() => {})
      .finally(() => setAuthChecking(false));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true); setLoginError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: authPassword }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || data.error) { setLoginError(data.error ?? "Incorrect password."); return; }
      setAuthed(true);
      setAuthPassword("");
    } catch { setLoginError("Network error — try again."); }
    finally { setLoginLoading(false); }
  };

  const handleLogout = async () => {
    await fetch(`${BASE}/api/auth/logout`, { method: "POST", credentials: "include" });
    setAuthed(false);
  };

  const deleteToken = useDeleteToken({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTokensQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
      },
    },
  });

  const fetchYtChannels = async () => {
    setYtLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/youtube/channels`);
      if (res.ok) setYtChannels((await res.json()) as YouTubeChannel[]);
    } catch { /* ignore */ } finally { setYtLoading(false); }
  };

  const fetchFbPages = async () => {
    setFbLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/facebook/pages`);
      if (res.ok) setFbPages((await res.json()) as YouTubeChannel[]);
    } catch { /* ignore */ } finally { setFbLoading(false); }
  };

  const fetchCredStatus = async () => {
    try {
      const res = await fetch(`${BASE}/api/settings/credentials`);
      if (res.ok) setCredStatus((await res.json()) as CredentialsMap);
    } catch { /* ignore */ }
  };

  const fetchCookiesStatus = async () => {
    try {
      const res = await fetch(`${BASE}/api/settings/yt-cookies`, { credentials: "include" });
      if (res.ok) {
        setCookiesStatus(
          (await res.json()) as {
            set: boolean;
            updatedAt: string | null;
            validation: CookieValidationSummary | null;
          }
        );
      }
    } catch { /* ignore */ }
  };

  const fetchProxyStatus = async () => {
    try {
      const res = await fetch(`${BASE}/api/settings/yt-proxy`, { credentials: "include" });
      if (res.ok) {
        setProxyStatus(
          (await res.json()) as { set: boolean; maskedHost: string | null; updatedAt: string | null }
        );
      }
    } catch { /* ignore */ }
  };

  const fetchLogoStatus = async () => {
    try {
      const res = await fetch(`${BASE}/api/settings/watermark-logo`);
      if (res.ok) setLogoSet(((await res.json()) as { set: boolean }).set);
    } catch { /* ignore */ }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true); setLogoError(null); setLogoOk(false);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch(`${BASE}/api/settings/watermark-logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: dataUrl }),
      });
      if (!res.ok) { setLogoError(`Upload failed (${res.status})`); return; }
      setLogoOk(true);
      setLogoSet(true);
      setTimeout(() => setLogoOk(false), 4000);
    } catch { setLogoError("Network error."); } finally { setLogoUploading(false); }
  };

  const handleLogoDelete = async () => {
    try {
      await fetch(`${BASE}/api/settings/watermark-logo`, { method: "DELETE" });
      setLogoSet(false);
    } catch { /* ignore */ }
  };

  const handleSaveCookies = async () => {
    if (!cookiesText.trim()) return;
    setCookiesSaving(true); setCookiesError(null); setCookiesSavedOk(false);
    try {
      const res = await fetch(`${BASE}/api/settings/yt-cookies`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: cookiesText }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setCookiesError(data.error ?? `Server error ${res.status}`); return; }
      setCookiesText("");
      setCookiesSavedOk(true);
      setTimeout(() => setCookiesSavedOk(false), 4000);
      await fetchCookiesStatus();
    } catch { setCookiesError("Network error."); } finally { setCookiesSaving(false); }
  };

  const handleDeleteCookies = async () => {
    try {
      await fetch(`${BASE}/api/settings/yt-cookies`, { method: "DELETE", credentials: "include" });
      await fetchCookiesStatus();
    } catch { /* ignore */ }
  };

  const handleSaveProxy = async () => {
    if (!proxyInput.trim()) return;
    setProxySaving(true); setProxyError(null); setProxySavedOk(false);
    try {
      const res = await fetch(`${BASE}/api/settings/yt-proxy`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyUrl: proxyInput }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setProxyError(data.error ?? `Server error ${res.status}`); return; }
      setProxyInput("");
      setProxySavedOk(true);
      setTimeout(() => setProxySavedOk(false), 4000);
      await fetchProxyStatus();
    } catch { setProxyError("Network error."); } finally { setProxySaving(false); }
  };

  const handleDeleteProxy = async () => {
    setProxyError(null);
    try {
      await fetch(`${BASE}/api/settings/yt-proxy`, { method: "DELETE", credentials: "include" });
      await fetchProxyStatus();
    } catch { /* ignore */ }
  };

  const handleRunDiagnostics = async (overrideProxy?: string) => {
    setDiagRunning(true); setDiagError(null);
    try {
      const res = await fetch(`${BASE}/api/settings/yt-diagnostics/test`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proxyUrl: overrideProxy?.trim() || undefined,
          runLiveProbe: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDiagError((data as { error?: string }).error ?? `Diagnostic check failed (${res.status})`);
        return;
      }
      setDiagResult(data);
    } catch {
      setDiagError("Network error running diagnostics.");
    } finally {
      setDiagRunning(false);
    }
  };

  useEffect(() => {
    if (authed) {
      fetchProxyStatus();
      fetchCookiesStatus();
    }
  }, [authed]);

  useEffect(() => {
    fetchYtChannels();
    fetchFbPages();
    fetchCredStatus();
    fetchCookiesStatus();
    fetchLogoStatus();
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("oauth");
    if (oauth === "youtube_connected") {
      window.history.replaceState({}, "", window.location.pathname);
      fetchYtChannels();
      queryClient.invalidateQueries({ queryKey: getListTokensQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
    } else if (oauth === "youtube_error") {
      const reason = params.get("reason");
      window.history.replaceState({}, "", window.location.pathname);
      setOauthError(
        reason
          ? `YouTube connection failed: ${reason}`
          : "YouTube connection failed. Check your Client ID and Secret are correct and the redirect URI is configured in Google Cloud Console.",
      );
    } else if (oauth === "facebook_connected") {
      const pages = params.get("pages");
      window.history.replaceState({}, "", window.location.pathname);
      setFbOauthMsg({ type: "success", text: `Facebook connected — ${pages ?? "1"} page${pages === "1" ? "" : "s"} imported.` });
      fetchFbPages();
      queryClient.invalidateQueries({ queryKey: getListTokensQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
    } else if (oauth === "facebook_error") {
      window.history.replaceState({}, "", window.location.pathname);
      setFbOauthMsg({ type: "error", text: "Facebook connection failed. Check your App ID and Secret are correct and the redirect URI is configured in Meta for Developers." });
    } else if (oauth === "facebook_no_pages") {
      window.history.replaceState({}, "", window.location.pathname);
      setFbOauthMsg({ type: "no_pages", text: "Logged in to Facebook but no managed Pages were found. Make sure you are an admin of at least one Facebook Page." });
    }
  }, [queryClient]);

  const handleSaveCredentials = async () => {
    const nonEmpty = Object.fromEntries(Object.entries(credValues).filter(([, v]) => v.trim() !== ""));
    if (Object.keys(nonEmpty).length === 0) return;
    setSaving(true); setSaveError(null);
    try {
      const res = await fetch(`${BASE}/api/settings/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: nonEmpty }),
      });
      if (!res.ok) { setSaveError(`Server error ${res.status}`); return; }
      setCredValues({}); setSavedOk(true);
      setTimeout(() => setSavedOk(false), 4000);
      await fetchCredStatus();
      await fetchYtChannels();
    } catch { setSaveError("Network error."); } finally { setSaving(false); }
  };

  const handleDeleteCredential = async (key: string) => {
    setDeletingCredKey(key); setDeleteCredError(null);
    try {
      const res = await fetch(`${BASE}/api/settings/credentials/${key}`, { method: "DELETE" });
      if (!res.ok) { setDeleteCredError(`Failed to remove ${key}`); return; }
      await fetchCredStatus(); await fetchYtChannels();
    } catch { setDeleteCredError(`Network error removing ${key}`); } finally { setDeletingCredKey(null); }
  };

  const handleSetDefault = async (id: number) => {
    setSettingDefault(id);
    try {
      await fetch(`${BASE}/api/auth/youtube/channels/${id}/default`, { method: "POST" });
      await fetchYtChannels();
    } finally { setSettingDefault(null); }
  };

  const handleDisconnect = async (id: number) => {
    setDisconnecting(id);
    try {
      await fetch(`${BASE}/api/auth/youtube/channels/${id}`, { method: "DELETE" });
      await fetchYtChannels();
      queryClient.invalidateQueries({ queryKey: getListTokensQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
    } finally { setDisconnecting(null); }
  };

  const handleFbSetDefault = async (id: number) => {
    setSettingFbDefault(id);
    try {
      await fetch(`${BASE}/api/auth/facebook/pages/${id}/default`, { method: "POST" });
      await fetchFbPages();
    } finally { setSettingFbDefault(null); }
  };

  const handleFbDisconnect = async (id: number) => {
    setDisconnectingFb(id);
    try {
      await fetch(`${BASE}/api/auth/facebook/pages/${id}`, { method: "DELETE" });
      await fetchFbPages();
      queryClient.invalidateQueries({ queryKey: getListTokensQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
    } finally { setDisconnectingFb(null); }
  };

  const handleFbManualSave = async () => {
    if (!fbManualToken.trim() || !fbManualPageId.trim() || !fbManualPageName.trim()) return;
    setFbManualSaving(true); setFbManualError(null); setFbManualOk(false);
    try {
      const res = await fetch(`${BASE}/api/auth/facebook/manual-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageToken: fbManualToken, pageId: fbManualPageId, pageName: fbManualPageName }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || data.error) { setFbManualError(data.error ?? `Server error ${res.status}`); return; }
      setFbManualToken(""); setFbManualPageId(""); setFbManualPageName("");
      setFbManualOk(true); setTimeout(() => setFbManualOk(false), 4000);
      setShowFbManual(false);
      await fetchFbPages();
      queryClient.invalidateQueries({ queryKey: getListTokensQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
    } catch { setFbManualError("Network error."); } finally { setFbManualSaving(false); }
  };

  const ytCredsSet = credStatus["YOUTUBE_CLIENT_ID"]?.set && credStatus["YOUTUBE_CLIENT_SECRET"]?.set;
  const hasUnsavedChanges = Object.values(credValues).some((v) => v.trim() !== "");

  // ── Auth checking spinner ──────────────────────────────────────────────────
  if (authChecking) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary opacity-50" />
        </div>
      </Layout>
    );
  }

  // ── Password gate ──────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[70vh]">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="w-full max-w-sm"
          >
            <Card className="p-8 border-border bg-card/90 backdrop-blur-sm space-y-6 shadow-2xl">
              {/* Icon + heading */}
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Lock className="w-7 h-7 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-display font-bold text-foreground">Settings Access</h2>
                  <p className="text-xs text-muted-foreground mt-1 font-mono">Enter your password to continue</p>
                </div>
              </div>

              {/* Form */}
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-mono text-muted-foreground">Password</Label>
                  <div className="relative">
                    <Input
                      ref={authInputRef}
                      type={showAuthPassword ? "text" : "password"}
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      autoFocus
                      className="font-mono text-sm pr-10 bg-muted/40 border-border/70 focus:border-primary/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAuthPassword((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showAuthPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {loginError && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                    className="text-xs text-destructive font-mono flex items-center gap-1.5"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {loginError}
                  </motion.p>
                )}

                <Button type="submit" className="w-full gap-2 font-mono" disabled={loginLoading || !authPassword}>
                  {loginLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  {loginLoading ? "Verifying…" : "Unlock Settings"}
                </Button>
              </form>
            </Card>
          </motion.div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="max-w-2xl space-y-8">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-1 tracking-widest uppercase">
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />System Configuration
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">Settings</h1>
              <p className="text-muted-foreground text-sm mt-1">Configure platform credentials and connect your accounts.</p>
            </div>
            <Button
              size="sm" variant="ghost"
              onClick={handleLogout}
              className="text-xs font-mono gap-1.5 text-muted-foreground hover:text-foreground shrink-0 mt-1"
            >
              <LogOut className="w-3.5 h-3.5" /> Lock
            </Button>
          </div>
        </div>

        {/* ── API Credentials ─────────────────────────────────────────────── */}
        <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Key className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-display font-semibold text-foreground">API Credentials</h2>
              <p className="text-xs text-muted-foreground">Enter your API keys — stored securely in the database.</p>
            </div>
            {Object.values(credStatus).some((s) => s.set) && (
              <span className="text-[10px] font-mono text-green-400 flex items-center gap-1 shrink-0">
                <CheckCircle2 className="w-3 h-3" />
                {Object.values(credStatus).filter((s) => s.set).length} configured
              </span>
            )}
          </div>

          <div className="space-y-5">
            {(["youtube", "facebook"] as const).map((group) => (
              <div key={group} className="space-y-3">
                <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground border-b border-border/50 pb-1">
                  {group === "youtube" ? "YouTube / Google" : "Facebook / Meta"}
                </p>
                {CREDENTIAL_FIELDS.filter((f) => f.group === group).map((field) => (
                  <div key={field.key} className="flex gap-2 items-end">
                    <div className="flex-1">
                      <CredentialInput field={field} status={credStatus[field.key]}
                        value={credValues[field.key] ?? ""}
                        onChange={(v) => setCredValues((prev) => ({ ...prev, [field.key]: v }))} />
                    </div>
                    {credStatus[field.key]?.set && (
                      <Button size="icon" variant="ghost"
                        className="w-7 h-7 mb-5 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => handleDeleteCredential(field.key)}
                        disabled={deletingCredKey === field.key}>
                        {deletingCredKey === field.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {deleteCredError && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{deleteCredError}</span>
            </div>
          )}

          <Button onClick={handleSaveCredentials} disabled={!hasUnsavedChanges || saving} className="w-full font-mono text-xs gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : savedOk ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Save className="w-4 h-4" />}
            {savedOk ? "Credentials saved!" : saving ? "Saving…" : "Save Credentials"}
          </Button>

          {saveError && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{saveError}</span>
            </div>
          )}
          {savedOk && (
            <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-xs text-green-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Credentials saved. You can now connect your accounts below.</span>
            </div>
          )}
        </Card>

        {/* ── Watermark Logo ───────────────────────────────────────────────── */}
        <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-yellow-500/10 flex items-center justify-center shrink-0">
              <ImageIcon className="w-4 h-4 text-yellow-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-display font-semibold text-foreground flex items-center gap-2">
                Watermark Logo
                <Badge className="text-[10px] font-mono bg-yellow-500/10 text-yellow-400 border-yellow-500/20">Amon Style · 2 Corners</Badge>
              </h2>
              <p className="text-xs text-muted-foreground">Logo placed top-right and bottom-left on every 4K Mission video. Black background is removed automatically.</p>
            </div>
            {logoSet && (
              <span className="text-[10px] font-mono text-green-400 flex items-center gap-1 shrink-0">
                <CheckCircle2 className="w-3 h-3" /> Active
              </span>
            )}
          </div>

          {logoSet && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
              <img
                src={`${BASE}/api/assets/watermark-logo.png?t=${Date.now()}`}
                alt="Watermark logo"
                className="w-16 h-16 object-contain rounded-md bg-black/40 border border-border/40 p-1 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-foreground font-semibold">NK NOVAKING ENTERTAINMENT</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Active watermark — applied to all 4K Mission videos</p>
              </div>
              <Button size="sm" variant="ghost" onClick={handleLogoDelete}
                className="text-xs font-mono gap-1 h-7 text-destructive hover:text-destructive px-2 shrink-0">
                <Trash2 className="w-3 h-3" /> Remove
              </Button>
            </div>
          )}

          {logoError && (
            <div className="flex items-center gap-2 text-xs text-destructive font-mono bg-destructive/10 border border-destructive/20 rounded-md p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{logoError}
            </div>
          )}
          {logoOk && (
            <div className="flex items-center gap-2 text-xs text-green-400 font-mono bg-green-500/10 border border-green-500/20 rounded-md p-2.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />Logo saved — will be applied to all future 4K Mission videos.
            </div>
          )}

          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border/60 rounded-lg p-5 cursor-pointer hover:border-yellow-500/40 hover:bg-yellow-500/5 transition-all">
            {logoUploading ? (
              <Loader2 className="w-6 h-6 animate-spin text-yellow-400" />
            ) : (
              <Upload className="w-6 h-6 text-muted-foreground" />
            )}
            <span className="text-xs font-mono text-muted-foreground text-center">
              {logoUploading ? "Processing…" : logoSet ? "Upload new logo to replace" : "Upload your logo (PNG or JPG)"}
            </span>
            <input type="file" accept="image/png,image/jpeg,image/jpg" className="hidden"
              onChange={handleLogoUpload} disabled={logoUploading} />
          </label>
        </Card>

        {/* ── YouTube Download Cookies ─────────────────────────────────────── */}
        <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
              <Cookie className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-display font-semibold text-foreground flex items-center gap-2 flex-wrap">
                YouTube Download Cookies
                <Badge className="text-[10px] font-mono bg-amber-500/10 text-amber-400 border-amber-500/20">Required for 4K Mission</Badge>
              </h2>
              <p className="text-xs text-muted-foreground">Used with the built-in PO Token server to clear YouTube bot verification.</p>
            </div>
            {cookiesStatus.set && (() => {
              const st = cookiesStatus.validation?.status;
              const isHealthy = st === "valid" || !st;
              const isWarn = st === "expiring_soon";
              return (
                <span className={`text-[10px] font-mono flex items-center gap-1 shrink-0 ${
                  isHealthy ? "text-green-400" : isWarn ? "text-amber-400" : "text-destructive"
                }`}>
                  {isHealthy ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                  {st === "valid" ? "Valid" : st === "expiring_soon" ? "Expiring Soon" : st === "expired" ? "Expired" : st === "missing_auth" ? "Missing Auth" : "Active"}
                </span>
              );
            })()}
          </div>

          {cookiesStatus.set && (
            <div className={`p-3 rounded-md border space-y-1.5 ${
              cookiesStatus.validation?.status === "expired" || cookiesStatus.validation?.status === "missing_auth"
                ? "bg-destructive/10 border-destructive/30"
                : cookiesStatus.validation?.status === "expiring_soon"
                ? "bg-amber-500/10 border-amber-500/30"
                : "bg-green-500/5 border-green-500/20"
            }`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-mono text-foreground flex-wrap">
                  {cookiesStatus.validation?.valid !== false ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                  )}
                  <span>
                    {cookiesStatus.validation
                      ? `${cookiesStatus.validation.ytCookieCount} YouTube/Google cookies (${cookiesStatus.validation.foundAuthCookies.length} auth keys)`
                      : "Cookie file saved"}
                  </span>
                  {cookiesStatus.updatedAt && (
                    <span className="text-muted-foreground">· {new Date(cookiesStatus.updatedAt).toLocaleDateString()}</span>
                  )}
                </div>
                <Button size="sm" variant="ghost" onClick={handleDeleteCookies}
                  className="text-xs font-mono gap-1 h-6 text-destructive hover:text-destructive px-2 shrink-0">
                  <Trash2 className="w-3 h-3" /> Remove
                </Button>
              </div>
              {cookiesStatus.validation?.earliestExpiry && (
                <p className="text-[11px] font-mono text-muted-foreground">
                  Earliest auth expiry: {new Date(cookiesStatus.validation.earliestExpiry).toLocaleDateString()}
                  {cookiesStatus.validation.foundAuthCookies.length > 0 && (
                    <> · Keys: {cookiesStatus.validation.foundAuthCookies.slice(0, 5).join(", ")}</>
                  )}
                </p>
              )}
              {cookiesStatus.validation?.warnings.map((w, idx) => (
                <p key={idx} className="text-[11px] font-mono text-amber-400">{w}</p>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-mono text-muted-foreground">Paste Netscape-format cookies (youtube.com)</Label>
            <Textarea
              placeholder={"# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t...\n..."}
              value={cookiesText}
              onChange={(e) => setCookiesText(e.target.value)}
              className="font-mono text-xs bg-muted/40 border-border/70 focus:border-amber-500/50 min-h-[100px] resize-y"
              rows={4}
            />
            {cookiesPreview && (
              <div className={`text-[11px] font-mono px-2.5 py-2 rounded border ${
                cookiesPreview.valid
                  ? "bg-green-500/10 border-green-500/20 text-green-400"
                  : "bg-destructive/10 border-destructive/20 text-destructive"
              }`}>
                {cookiesPreview.valid ? (
                  <span>
                    Preview OK: {cookiesPreview.cookieCount} rows ({cookiesPreview.ytCookieCount} YouTube/Google · auth keys: {cookiesPreview.foundAuthCookies.join(", ")})
                  </span>
                ) : (
                  <span>{cookiesPreview.warnings[0] ?? "Invalid Netscape cookie text."}</span>
                )}
              </div>
            )}
          </div>

          {cookiesError && (
            <div className="flex items-center gap-2 text-xs text-destructive font-mono bg-destructive/10 border border-destructive/20 rounded-md p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{cookiesError}
            </div>
          )}
          {cookiesSavedOk && (
            <div className="flex items-center gap-2 text-xs text-green-400 font-mono bg-green-500/10 border border-green-500/20 rounded-md p-2.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />Cookies validated & saved — downloads will now use them.
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={handleSaveCookies} disabled={!cookiesText.trim() || cookiesSaving}
              className="flex-1 font-mono text-xs gap-2 bg-amber-500/80 hover:bg-amber-500 text-black">
              {cookiesSaving ? <Loader2 className="w-4 h-4 animate-spin" /> :
               cookiesSavedOk ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {cookiesSavedOk ? "Cookies saved!" : cookiesSaving ? "Validating & Saving…" : "Save Cookies"}
            </Button>
            <Button type="button" variant="outline" onClick={() => handleRunDiagnostics()} disabled={diagRunning}
              className="font-mono text-xs gap-2">
              {diagRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
              {diagRunning ? "Testing…" : "Test Download Setup"}
            </Button>
          </div>

          {diagError && (
            <div className="flex items-center gap-2 text-xs text-destructive font-mono bg-destructive/10 border border-destructive/20 rounded-md p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{diagError}
            </div>
          )}

          {diagResult && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2 text-xs font-mono">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="flex items-center justify-between bg-background/50 px-2.5 py-1.5 rounded border border-border/40">
                  <span className="text-muted-foreground">yt-dlp</span>
                  <span className={diagResult.ytDlp.ok ? "text-green-400" : "text-destructive"}>
                    {diagResult.ytDlp.ok ? diagResult.ytDlp.version : "Missing"}
                  </span>
                </div>
                <div className="flex items-center justify-between bg-background/50 px-2.5 py-1.5 rounded border border-border/40">
                  <span className="text-muted-foreground">PO Token Server</span>
                  <span className={diagResult.potServer.ok ? "text-green-400" : "text-amber-400"}>
                    {diagResult.potServer.ok ? `Active (${diagResult.potServer.mode})` : "Not running"}
                  </span>
                </div>
                <div className="flex items-center justify-between bg-background/50 px-2.5 py-1.5 rounded border border-border/40">
                  <span className="text-muted-foreground">Cookies</span>
                  <span className={diagResult.cookies.validation?.valid ? "text-green-400" : "text-amber-400"}>
                    {diagResult.cookies.set ? diagResult.cookies.validation?.status ?? "Saved" : "None"}
                  </span>
                </div>
                <div className="flex items-center justify-between bg-background/50 px-2.5 py-1.5 rounded border border-border/40">
                  <span className="text-muted-foreground">Proxy</span>
                  <span className={
                    !diagResult.proxy.configured
                      ? "text-muted-foreground"
                      : diagResult.proxy.ok
                      ? "text-green-400"
                      : "text-destructive"
                  }>
                    {!diagResult.proxy.configured ? "Direct IP" : diagResult.proxy.ok ? "Reachable" : "Unreachable"}
                  </span>
                </div>
                {diagResult.storage && (
                  <div className="sm:col-span-2 flex items-center justify-between bg-background/50 px-2.5 py-1.5 rounded border border-border/40 gap-2">
                    <span className="text-muted-foreground truncate">
                      Temp Video Storage ({diagResult.storage.persistentConfigured ? "Persistent Disk" : "Ephemeral /tmp"})
                    </span>
                    <span className={
                      diagResult.storage.availableMB !== null && diagResult.storage.availableMB >= 4096
                        ? "text-green-400 shrink-0"
                        : diagResult.storage.availableMB !== null && diagResult.storage.availableMB >= 1500
                        ? "text-amber-400 shrink-0"
                        : "text-destructive shrink-0"
                    }>
                      {diagResult.storage.availableMB !== null
                        ? `${(diagResult.storage.availableMB / 1024).toFixed(2)} GB free`
                        : "Unknown"}
                    </span>
                  </div>
                )}
              </div>
              {diagResult.proxy.error && (
                <p className="text-[11px] text-destructive">Proxy error: {diagResult.proxy.error}</p>
              )}
              {diagResult.probe.attempted && diagResult.probe.message && (
                <div className={`p-2 rounded border text-[11px] ${
                  diagResult.probe.ok
                    ? "bg-green-500/10 border-green-500/20 text-green-400"
                    : "bg-destructive/10 border-destructive/20 text-destructive"
                }`}>
                  {diagResult.probe.message}
                </div>
              )}
            </div>
          )}

          {/* How-to guide */}
          <div>
            <button type="button" onClick={() => setShowCookiesGuide((s) => !s)}
              className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors bg-muted/40 rounded p-3 border border-border/50">
              <span className="font-medium text-foreground flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-amber-400" /> How to export YouTube cookies
              </span>
              {showCookiesGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <AnimatePresence>
              {showCookiesGuide && (
                <motion.ol initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden space-y-2 text-xs text-muted-foreground pt-3 pl-1 list-decimal list-inside">
                  {[
                    <>Install the <strong className="text-foreground">"Get cookies.txt LOCALLY"</strong> Chrome/Firefox extension</>,
                    <>Open <a href="https://www.youtube.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">youtube.com</a> and make sure you are signed in to your Google account</>,
                    "Click the extension icon → Export cookies for youtube.com",
                    "Select Netscape format (default)",
                    "Open the downloaded .txt file, copy all contents",
                    "Paste everything into the text area above and click Save Cookies",
                  ].map((step, i) => <li key={i}>{step}</li>)}
                </motion.ol>
              )}
            </AnimatePresence>
          </div>
        </Card>

        {/* ── Optional Download Proxy ─────────────────────────────────────── */}
        <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
              <Globe className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-display font-semibold text-foreground flex items-center gap-2 flex-wrap">
                Download Proxy
                <Badge className="text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border-cyan-500/20">Optional · Anti-429</Badge>
              </h2>
              <p className="text-xs text-muted-foreground">Route yt-dlp traffic through a residential HTTP or SOCKS5 proxy to bypass shared-IP 429 limits.</p>
            </div>
            {proxyStatus.set && (
              <span className="text-[10px] font-mono text-green-400 flex items-center gap-1 shrink-0">
                <CheckCircle2 className="w-3 h-3" /> Configured
              </span>
            )}
          </div>

          {proxyStatus.set && (
            <div className="flex items-center justify-between p-3 rounded-md bg-cyan-500/5 border border-cyan-500/20 gap-2">
              <div className="text-xs font-mono text-foreground truncate">
                Active proxy: <span className="text-cyan-400">{proxyStatus.maskedHost}</span>
              </div>
              <Button size="sm" variant="ghost" onClick={handleDeleteProxy}
                className="text-xs font-mono gap-1 h-6 text-destructive hover:text-destructive px-2 shrink-0">
                <Trash2 className="w-3 h-3" /> Remove
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-mono text-muted-foreground">
              Proxy URL (http://user:pass@host:port or socks5://user:pass@host:port)
            </Label>
            <div className="relative">
              <Input
                type={showProxy ? "text" : "password"}
                placeholder={proxyStatus.set ? "•••••••••••••••• (enter new proxy URL to replace)" : "http://user:pass@proxy-host:8080"}
                value={proxyInput}
                onChange={(e) => setProxyInput(e.target.value)}
                className="font-mono text-xs pr-8 bg-muted/40 border-border/70 focus:border-cyan-500/50"
              />
              <button
                type="button"
                onClick={() => setShowProxy((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showProxy ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {proxyError && (
            <div className="flex items-center gap-2 text-xs text-destructive font-mono bg-destructive/10 border border-destructive/20 rounded-md p-2.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{proxyError}
            </div>
          )}
          {proxySavedOk && (
            <div className="flex items-center gap-2 text-xs text-green-400 font-mono bg-green-500/10 border border-green-500/20 rounded-md p-2.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />Download proxy saved securely.
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={handleSaveProxy} disabled={!proxyInput.trim() || proxySaving}
              className="flex-1 font-mono text-xs gap-2">
              {proxySaving ? <Loader2 className="w-4 h-4 animate-spin" /> :
               proxySavedOk ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Save className="w-4 h-4" />}
              {proxySavedOk ? "Proxy saved!" : proxySaving ? "Saving…" : "Save Proxy"}
            </Button>
            <Button type="button" variant="outline"
              onClick={() => handleRunDiagnostics(proxyInput || undefined)}
              disabled={diagRunning || (!proxyInput.trim() && !proxyStatus.set)}
              className="font-mono text-xs gap-2">
              {diagRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
              Test Connection
            </Button>
          </div>
        </Card>

        {/* ── YouTube Channels ─────────────────────────────────────────────── */}
        <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-5">
          {oauthError && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1"><span>{oauthError}</span></div>
              <button type="button" onClick={() => setOauthError(null)} className="text-red-400/60 hover:text-red-400">×</button>
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-600 flex items-center justify-center shrink-0">
              <Youtube className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-display font-semibold text-foreground">YouTube Channels</h2>
              <p className="text-xs text-muted-foreground">Connect multiple channels — set one as default for publishing.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {ytLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : ytChannels.length > 0 ? (
                <span className="flex items-center gap-1.5 text-xs font-mono text-green-400">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {ytChannels.length} connected
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                  <AlertTriangle className="w-3.5 h-3.5" /> None connected
                </span>
              )}
            </div>
          </div>

          {!ytCredsSet && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Save your <strong>YouTube Client ID</strong> and <strong>Client Secret</strong> above before connecting.</span>
            </div>
          )}

          {/* Channel list */}
          <div className="space-y-3">
            <AnimatePresence>
              {ytChannels.map((ch) => (
                <ChannelCard key={ch.id} ch={ch}
                  onSetDefault={() => handleSetDefault(ch.id)}
                  onDisconnect={() => handleDisconnect(ch.id)}
                  isSettingDefault={settingDefault === ch.id}
                  isDisconnecting={disconnecting === ch.id} />
              ))}
            </AnimatePresence>
          </div>

          {/* Connect / Add Another */}
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={() => { window.location.href = `${BASE}/api/auth/youtube`; }}
              disabled={!ytCredsSet}
              className="flex-1 gap-2 font-mono text-xs h-9 bg-red-600 hover:bg-red-700 text-white">
              <Plus className="w-3.5 h-3.5" />
              {ytChannels.length === 0 ? "Connect YouTube Channel" : "Connect Another Channel"}
            </Button>
            {ytChannels.length > 0 && (
              <Button variant="ghost" size="sm" onClick={fetchYtChannels}
                className="gap-1.5 font-mono text-xs h-9 text-muted-foreground">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            )}
          </div>

          {/* Setup guide collapsible */}
          {ytChannels.length === 0 && (
            <div>
              <button type="button" onClick={() => setShowYtSetup((s) => !s)}
                className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors bg-muted/40 rounded p-3 border border-border/50">
                <span className="font-medium text-foreground">How to get YouTube credentials</span>
                {showYtSetup ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              <AnimatePresence>
                {showYtSetup && (
                  <motion.ol initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden space-y-2 text-xs text-muted-foreground pt-3 pl-1 list-decimal list-inside">
                    {[
                      <>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">console.cloud.google.com</a> and create a project</>,
                      "Enable the YouTube Data API v3",
                      'Create OAuth 2.0 credentials (type: "Web application")',
                      `Add redirect URI: ${window.location.origin}/api/auth/youtube/callback`,
                      "Copy Client ID and Secret into the fields above and save",
                      "Click Connect YouTube Channel",
                    ].map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </motion.ol>
                )}
              </AnimatePresence>
            </div>
          )}
        </Card>

        {/* ── Facebook Pages ───────────────────────────────────────────────── */}
        <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-5">
          {fbOauthMsg && (
            <div className={`flex items-start gap-2 rounded-lg p-3 text-xs border ${
              fbOauthMsg.type === "success"
                ? "bg-green-500/10 border-green-500/30 text-green-400"
                : "bg-red-500/10 border-red-500/30 text-red-400"
            }`}>
              {fbOauthMsg.type === "success"
                ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
              <div className="flex-1"><span>{fbOauthMsg.text}</span></div>
              <button type="button" onClick={() => setFbOauthMsg(null)} className="opacity-60 hover:opacity-100">×</button>
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <Facebook className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-display font-semibold text-foreground">Facebook Pages</h2>
              <p className="text-xs text-muted-foreground">Connect your Facebook Pages to publish videos via the Graph API.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {fbLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : fbPages.length > 0 ? (
                <span className="flex items-center gap-1.5 text-xs font-mono text-green-400">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {fbPages.length} connected
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                  <AlertTriangle className="w-3.5 h-3.5" /> None connected
                </span>
              )}
            </div>
          </div>

          {!(credStatus["FACEBOOK_APP_ID"]?.set && credStatus["FACEBOOK_APP_SECRET"]?.set) && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Save your <strong>Facebook App ID</strong> and <strong>App Secret</strong> above before connecting.</span>
            </div>
          )}

          {/* Page list */}
          <div className="space-y-3">
            <AnimatePresence>
              {fbPages.map((page) => (
                <motion.div key={page.id} layout
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                  className={`flex flex-col gap-3 sm:flex-row sm:items-center p-4 rounded-lg border transition-all ${
                    page.isDefault ? "border-blue-500/40 bg-blue-500/5" : "border-border/50 bg-muted/30"
                  }`}>
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {page.thumbnailUrl ? (
                      <img src={page.thumbnailUrl} alt={page.channelName}
                        className="w-11 h-11 rounded-full object-cover border-2 border-blue-500/30 shrink-0" />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-blue-600/20 flex items-center justify-center shrink-0">
                        <Facebook className="w-5 h-5 text-blue-400" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground truncate">{page.channelName}</span>
                        {page.isDefault && (
                          <Badge className="text-[10px] px-1.5 py-0 bg-blue-500/20 text-blue-400 border-blue-500/30 font-mono">Default</Badge>
                        )}
                      </div>
                      {page.subscriberCount !== null && (
                        <p className="text-xs text-muted-foreground font-mono flex items-center gap-1 mt-0.5">
                          <Users className="w-3 h-3" />
                          {page.subscriberCount.toLocaleString()} followers
                        </p>
                      )}
                      {page.channelId && (
                        <a href={`https://www.facebook.com/${page.channelId}`} target="_blank" rel="noopener noreferrer"
                          className="text-[11px] text-blue-400 font-mono hover:underline flex items-center gap-1 mt-0.5">
                          View page <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!page.isDefault && (
                      <Button size="sm" variant="outline" onClick={() => handleFbSetDefault(page.id)}
                        disabled={settingFbDefault === page.id}
                        className="text-xs font-mono gap-1.5 h-7">
                        {settingFbDefault === page.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Star className="w-3 h-3" />}
                        Set Default
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => handleFbDisconnect(page.id)}
                      disabled={disconnectingFb === page.id}
                      className="text-xs font-mono gap-1.5 h-7 text-destructive hover:text-destructive">
                      {disconnectingFb === page.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      Remove
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={() => { window.location.href = `${BASE}/api/auth/facebook`; }}
              disabled={!(credStatus["FACEBOOK_APP_ID"]?.set && credStatus["FACEBOOK_APP_SECRET"]?.set)}
              className="flex-1 gap-2 font-mono text-xs h-9 bg-blue-600 hover:bg-blue-700 text-white">
              <Plus className="w-3.5 h-3.5" />
              {fbPages.length === 0 ? "Connect via OAuth" : "Connect Another Page"}
            </Button>
            {fbPages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={fetchFbPages}
                className="gap-1.5 font-mono text-xs h-9 text-muted-foreground">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            )}
          </div>

          {/* ── Manual Page Token (dev-mode workaround) ── */}
          <div>
            <button type="button" onClick={() => { setShowFbManual((s) => !s); setFbManualError(null); }}
              className="w-full flex items-center justify-between text-xs hover:text-foreground transition-colors bg-muted/40 rounded p-3 border border-border/50 text-muted-foreground">
              <span className="font-medium text-foreground flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-blue-400" /> Add Page manually (paste token)
              </span>
              {showFbManual ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <AnimatePresence>
              {showFbManual && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden">
                  <div className="pt-3 space-y-3">
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300 space-y-1">
                      <p className="font-semibold text-blue-200">Generate a Page Access Token from Graph API Explorer:</p>
                      <ol className="list-decimal list-inside space-y-1 text-blue-300/80">
                        <li>Go to <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline underline-offset-2">developers.facebook.com/tools/explorer</a></li>
                        <li>Select your App from the top-right dropdown</li>
                        <li>Click <strong className="text-blue-200">Generate Access Token</strong> → log in and grant permissions</li>
                        <li>Change the user token to a <strong className="text-blue-200">Page token</strong>: click the token type dropdown → select your Page</li>
                        <li>Copy the token and your Page ID (from the Page URL or About section)</li>
                      </ol>
                    </div>
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label className="text-xs font-mono text-muted-foreground">Page Access Token</Label>
                        <Input
                          type="password"
                          placeholder="EAANre0M..."
                          value={fbManualToken}
                          onChange={(e) => setFbManualToken(e.target.value)}
                          className="font-mono text-xs bg-muted/40 border-border/70 focus:border-blue-500/50"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs font-mono text-muted-foreground">Page ID</Label>
                          <Input
                            placeholder="123456789"
                            value={fbManualPageId}
                            onChange={(e) => setFbManualPageId(e.target.value)}
                            className="font-mono text-xs bg-muted/40 border-border/70 focus:border-blue-500/50"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs font-mono text-muted-foreground">Page Name</Label>
                          <Input
                            placeholder="My Business Page"
                            value={fbManualPageName}
                            onChange={(e) => setFbManualPageName(e.target.value)}
                            className="font-mono text-xs bg-muted/40 border-border/70 focus:border-blue-500/50"
                          />
                        </div>
                      </div>
                    </div>
                    {fbManualError && (
                      <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-400">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>{fbManualError}</span>
                      </div>
                    )}
                    {fbManualOk && (
                      <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-xs text-green-400">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Page connected successfully!
                      </div>
                    )}
                    <Button
                      onClick={handleFbManualSave}
                      disabled={!fbManualToken.trim() || !fbManualPageId.trim() || !fbManualPageName.trim() || fbManualSaving}
                      className="w-full font-mono text-xs gap-2 bg-blue-600 hover:bg-blue-700 text-white">
                      {fbManualSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {fbManualSaving ? "Verifying & saving…" : "Save Page Token"}
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {fbPages.length === 0 && (
            <div>
              <button type="button" onClick={() => setShowYtSetup((s) => !s)}
                className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors bg-muted/40 rounded p-3 border border-border/50">
                <span className="font-medium text-foreground flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-blue-400" /> How to set up Facebook OAuth
                </span>
                {showYtSetup ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              <AnimatePresence>
                {showYtSetup && (
                  <motion.ol initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden space-y-2 text-xs text-muted-foreground pt-3 pl-1 list-decimal list-inside">
                    {[
                      <>Go to <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">developers.facebook.com/apps</a> and create an app (type: Business)</>,
                      'Add the "Facebook Login" product and enable "Web OAuth Login"',
                      `Add OAuth redirect URI: ${window.location.origin}/api/auth/facebook/callback`,
                      "Copy your App ID and App Secret into the credential fields above and save",
                      "Click Connect via OAuth — you will be prompted to log in and grant permissions",
                      "All Facebook Pages you manage will be imported automatically",
                    ].map((step, i) => <li key={i}>{step}</li>)}
                  </motion.ol>
                )}
              </AnimatePresence>
            </div>
          )}
        </Card>

        {/* ── Raw tokens table ─────────────────────────────────────────────── */}
        {safeTokens.length > 0 && (
          <Card className="p-4 sm:p-6 border-border bg-card/80 backdrop-blur-sm space-y-4">
            <h2 className="text-sm font-mono uppercase tracking-widest text-muted-foreground">Active Tokens</h2>
            <div className="space-y-2">
              {safeTokens.filter((t) => t.isActive).map((t) => (
                <div key={t.id} className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/50 border border-border/50">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${t.platform === "youtube" ? "bg-red-500" : "bg-blue-500"}`} />
                    <span className="text-xs font-mono text-foreground truncate">{t.label ?? t.platform}</span>
                    <Badge variant="outline" className="text-[10px] font-mono">{t.platform}</Badge>
                  </div>
                  <Button size="icon" variant="ghost" className="w-7 h-7 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteToken.mutate({ id: t.id })}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </motion.div>
    </Layout>
  );
}
