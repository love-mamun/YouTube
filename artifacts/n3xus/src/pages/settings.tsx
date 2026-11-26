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
import { useState, useEffect, useRef } from "react";
import {
  Youtube,
  Facebook,
  Trash2,
  Loader2,
  CheckCircle2,
  ExternalLink,
  AlertTriangle,
  Users,
  Key,
  Save,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Plus,
  Star,
  RefreshCw,
  Cookie,
  Info,
  ImageIcon,
  Upload,
  Lock,
  LogOut,
  ShieldCheck,
  Globe,
  Activity,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  previewNetscapeCookiesClient,
  previewProxyListClient,
  type CookieValidationSummary,
} from "@/lib/ytdlp-errors";

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

interface CredentialStatus {
  set: boolean;
  updatedAt: string | null;
}
type CredentialsMap = Record<string, CredentialStatus>;

const CREDENTIAL_FIELDS = [
  {
    key: "YOUTUBE_CLIENT_ID",
    label: "YouTube Client ID",
    hint: "OAuth 2.0 Client ID from Google Cloud Console",
    icon: <Youtube className="w-4 h-4 text-red-500" />,
    group: "youtube",
  },
  {
    key: "YOUTUBE_CLIENT_SECRET",
    label: "YouTube Client Secret",
    hint: "OAuth 2.0 Client Secret from Google Cloud Console",
    icon: <Youtube className="w-4 h-4 text-red-500" />,
    group: "youtube",
    secret: true,
  },
  {
    key: "FACEBOOK_APP_ID",
    label: "Facebook App ID",
    hint: "App ID from Meta for Developers console",
    icon: <Facebook className="w-4 h-4 text-blue-500" />,
    group: "facebook",
  },
  {
    key: "FACEBOOK_APP_SECRET",
    label: "Facebook App Secret",
    hint: "App Secret from Meta for Developers console",
    icon: <Facebook className="w-4 h-4 text-blue-500" />,
    group: "facebook",
    secret: true,
  },
] as const;

function CredentialInput({
  field,
  status,
  value,
  onChange,
}: {
  field: (typeof CREDENTIAL_FIELDS)[number];
  status: CredentialStatus | undefined;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  const isSecret = "secret" in field && field.secret;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          {field.icon}
          {field.label}
        </Label>
        {status?.set && (
          <span className="text-xs font-mono text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Saved
            {status.updatedAt && (
              <span className="text-muted-foreground tabular-nums">
                · {new Date(status.updatedAt).toLocaleDateString()}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="relative">
        <Input
          type={isSecret && !show ? "password" : "text"}
          placeholder={
            status?.set ? "••••••••••••••••" : `Enter ${field.label}`
          }
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs pr-10 bg-muted/50 border-border focus:border-primary min-h-[44px] h-11"
        />
        {isSecret && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide secret" : "Show secret"}
            className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[38px] min-h-[38px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            {show ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{field.hint}</p>
    </div>
  );
}

function AccountRow({
  ch,
  platform,
  onSetDefault,
  onDisconnect,
  isSettingDefault,
  isDisconnecting,
}: {
  ch: YouTubeChannel;
  platform: "youtube" | "facebook";
  onSetDefault: () => void;
  onDisconnect: () => void;
  isSettingDefault: boolean;
  isDisconnecting: boolean;
}) {
  const isYt = platform === "youtube";
  return (
    <div className="py-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {ch.thumbnailUrl ? (
          <img
            src={ch.thumbnailUrl}
            alt={ch.channelName}
            className="w-10 h-10 rounded-full object-cover border border-border shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
            {isYt ? (
              <Youtube className="w-5 h-5 text-red-500" />
            ) : (
              <Facebook className="w-5 h-5 text-blue-500" />
            )}
          </div>
        )}

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground truncate">
              {ch.channelName}
            </span>
            {ch.isDefault && (
              <span className="text-xs font-mono text-primary">· Default</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground font-mono mt-0.5">
            {ch.subscriberCount !== null && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Users className="w-3 h-3" />
                {ch.subscriberCount.toLocaleString()}{" "}
                {isYt ? "subscribers" : "followers"}
              </span>
            )}
            {ch.channelId && (
              <a
                href={
                  isYt
                    ? `https://www.youtube.com/channel/${ch.channelId}`
                    : `https://www.facebook.com/${ch.channelId}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Open {isYt ? "channel" : "page"}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {!ch.isDefault && (
          <Button
            size="sm"
            variant="outline"
            onClick={onSetDefault}
            disabled={isSettingDefault}
            className="text-xs font-medium gap-1.5 min-h-[40px] border-border bg-muted/40 hover:bg-muted"
          >
            {isSettingDefault ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Star className="w-3.5 h-3.5" />
            )}
            Set Default
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={onDisconnect}
          disabled={isDisconnecting}
          className="text-xs font-medium gap-1.5 min-h-[40px] text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          {isDisconnecting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" />
          )}
          Remove
        </Button>
      </div>
    </div>
  );
}

export default function Settings() {
  const [authed, setAuthed] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const { data: tokens } = useListTokens({
    query: { queryKey: getListTokensQueryKey(), enabled: authed },
  });
  useListChannels({
    query: { queryKey: getListChannelsQueryKey(), enabled: authed },
  });
  const safeTokens = Array.isArray(tokens) ? tokens : [];

  const [ytChannels, setYtChannels] = useState<YouTubeChannel[]>([]);
  const [ytLoading, setYtLoading] = useState(true);
  const [fbPages, setFbPages] = useState<YouTubeChannel[]>([]);
  const [fbLoading, setFbLoading] = useState(true);
  const [fbOauthMsg, setFbOauthMsg] = useState<{
    type: "success" | "error" | "no_pages";
    text: string;
  } | null>(null);
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
  const [showFbSetup, setShowFbSetup] = useState(false);
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
    count: number;
    maskedHost: string | null;
    maskedProxies: string[];
    updatedAt: string | null;
  }>({ set: false, count: 0, maskedHost: null, maskedProxies: [], updatedAt: null });
  const [proxyInput, setProxyInput] = useState("");
  const [maskProxyInput, setMaskProxyInput] = useState(false);
  const [proxySaving, setProxySaving] = useState(false);
  const [proxySavedOk, setProxySavedOk] = useState(false);
  const [proxyError, setProxyError] = useState<string | null>(null);
  const proxyPreview = previewProxyListClient(proxyInput);

  // Diagnostics probe state
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [diagResult, setDiagResult] = useState<{
    ytDlp: { ok: boolean; version: string | null; error: string | null };
    potServer: { ok: boolean; mode: string; endpoint: string | null };
    proxy: {
      configured: boolean;
      count?: number;
      reachableCount?: number;
      maskedHost: string | null;
      proxies?: Array<{ maskedHost: string; ok: boolean; error: string | null }>;
      ok: boolean | null;
      error: string | null;
    };
    storage?: {
      path: string;
      persistentConfigured: boolean;
      totalMB: number | null;
      availableMB: number | null;
      usedMB: number | null;
    };
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

  const queryClient = useQueryClient();

  // Auth gate
  const [authPassword, setAuthPassword] = useState("");
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const authInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${BASE}/api/auth/status`, { credentials: "include" })
      .then((r) => r.json())
      .then((d: { authed: boolean }) => {
        setAuthed(d.authed);
      })
      .catch(() => {})
      .finally(() => setAuthChecking(false));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: authPassword }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.error) {
        setLoginError(data.error ?? "Incorrect password.");
        return;
      }
      setAuthed(true);
      setAuthPassword("");
    } catch {
      setLoginError("Network error — try again.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch(`${BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
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
    } catch {
      /* ignore */
    } finally {
      setYtLoading(false);
    }
  };

  const fetchFbPages = async () => {
    setFbLoading(true);
    try {
      const res = await fetch(`${BASE}/api/auth/facebook/pages`);
      if (res.ok) setFbPages((await res.json()) as YouTubeChannel[]);
    } catch {
      /* ignore */
    } finally {
      setFbLoading(false);
    }
  };

  const fetchCredStatus = async () => {
    try {
      const res = await fetch(`${BASE}/api/settings/credentials`);
      if (res.ok) setCredStatus((await res.json()) as CredentialsMap);
    } catch {
      /* ignore */
    }
  };

  const fetchCookiesStatus = async () => {
    try {
      const res = await fetch(`${BASE}/api/settings/yt-cookies`, {
        credentials: "include",
      });
      if (res.ok) {
        setCookiesStatus(
          (await res.json()) as {
            set: boolean;
            updatedAt: string | null;
            validation: CookieValidationSummary | null;
          }
        );
      }
    } catch {
      /* ignore */
    }
  };

  const fetchProxyStatus = async () => {
    try {
      const res = await fetch(`${BASE}/api/settings/yt-proxy`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = (await res.json()) as {
          set: boolean;
          count?: number;
          maskedHost: string | null;
          maskedProxies?: string[];
          updatedAt: string | null;
        };
        setProxyStatus({
          set: Boolean(data.set),
          count: data.count ?? (data.set ? 1 : 0),
          maskedHost: data.maskedHost ?? null,
          maskedProxies: Array.isArray(data.maskedProxies)
            ? data.maskedProxies
            : data.maskedHost
            ? [data.maskedHost]
            : [],
          updatedAt: data.updatedAt ?? null,
        });
      }
    } catch {
      /* ignore */
    }
  };

  const fetchLogoStatus = async () => {
    try {
      const res = await fetch(`${BASE}/api/settings/watermark-logo`);
      if (res.ok) setLogoSet(((await res.json()) as { set: boolean }).set);
    } catch {
      /* ignore */
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    setLogoError(null);
    setLogoOk(false);
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
      if (!res.ok) {
        setLogoError(`Upload failed (${res.status})`);
        return;
      }
      setLogoOk(true);
      setLogoSet(true);
      setTimeout(() => setLogoOk(false), 4000);
    } catch {
      setLogoError("Network error.");
    } finally {
      setLogoUploading(false);
    }
  };

  const handleLogoDelete = async () => {
    try {
      await fetch(`${BASE}/api/settings/watermark-logo`, { method: "DELETE" });
      setLogoSet(false);
    } catch {
      /* ignore */
    }
  };

  const handleSaveCookies = async () => {
    if (!cookiesText.trim()) return;
    setCookiesSaving(true);
    setCookiesError(null);
    setCookiesSavedOk(false);
    try {
      const res = await fetch(`${BASE}/api/settings/yt-cookies`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookies: cookiesText }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setCookiesError(data.error ?? `Server error ${res.status}`);
        return;
      }
      setCookiesText("");
      setCookiesSavedOk(true);
      setTimeout(() => setCookiesSavedOk(false), 4000);
      await fetchCookiesStatus();
    } catch {
      setCookiesError("Network error.");
    } finally {
      setCookiesSaving(false);
    }
  };

  const handleDeleteCookies = async () => {
    try {
      await fetch(`${BASE}/api/settings/yt-cookies`, {
        method: "DELETE",
        credentials: "include",
      });
      await fetchCookiesStatus();
    } catch {
      /* ignore */
    }
  };

  const handleSaveProxy = async () => {
    if (!proxyInput.trim()) return;
    setProxySaving(true);
    setProxyError(null);
    setProxySavedOk(false);
    try {
      const res = await fetch(`${BASE}/api/settings/yt-proxy`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyUrl: proxyInput }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setProxyError(data.error ?? `Server error ${res.status}`);
        return;
      }
      setProxyInput("");
      setProxySavedOk(true);
      setTimeout(() => setProxySavedOk(false), 4000);
      await fetchProxyStatus();
    } catch {
      setProxyError("Network error.");
    } finally {
      setProxySaving(false);
    }
  };

  const handleDeleteProxy = async () => {
    setProxyError(null);
    try {
      await fetch(`${BASE}/api/settings/yt-proxy`, {
        method: "DELETE",
        credentials: "include",
      });
      await fetchProxyStatus();
    } catch {
      /* ignore */
    }
  };

  const handleRunDiagnostics = async (overrideProxy?: string) => {
    setDiagRunning(true);
    setDiagError(null);
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
        setDiagError(
          (data as { error?: string }).error ??
            `Diagnostic check failed (${res.status})`
        );
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
    if (!authed) return;
    fetchYtChannels();
    fetchFbPages();
    fetchCredStatus();
    fetchCookiesStatus();
    fetchProxyStatus();
    fetchLogoStatus();
  }, [authed]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauth = params.get("oauth");
    if (oauth === "youtube_connected") {
      window.history.replaceState({}, "", window.location.pathname);
      if (authed) fetchYtChannels();
      queryClient.invalidateQueries({ queryKey: getListTokensQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
    } else if (oauth === "youtube_error") {
      const reason = params.get("reason");
      window.history.replaceState({}, "", window.location.pathname);
      setOauthError(
        reason
          ? `YouTube connection failed: ${reason}`
          : "YouTube connection failed. Check your Client ID and Secret are correct and the redirect URI is configured in Google Cloud Console."
      );
    } else if (oauth === "facebook_connected") {
      const pages = params.get("pages");
      window.history.replaceState({}, "", window.location.pathname);
      setFbOauthMsg({
        type: "success",
        text: `Facebook connected — ${pages ?? "1"} page${pages === "1" ? "" : "s"} imported.`,
      });
      if (authed) fetchFbPages();
      queryClient.invalidateQueries({ queryKey: getListTokensQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
    } else if (oauth === "facebook_error") {
      window.history.replaceState({}, "", window.location.pathname);
      setFbOauthMsg({
        type: "error",
        text: "Facebook connection failed. Check your App ID and Secret are correct and the redirect URI is configured in Meta for Developers.",
      });
    } else if (oauth === "facebook_no_pages") {
      window.history.replaceState({}, "", window.location.pathname);
      setFbOauthMsg({
        type: "no_pages",
        text: "Logged in to Facebook but no managed Pages were found. Make sure you are an admin of at least one Facebook Page.",
      });
    }
  }, [queryClient, authed]);

  const handleSaveCredentials = async () => {
    const nonEmpty = Object.fromEntries(
      Object.entries(credValues).filter(([, v]) => v.trim() !== "")
    );
    if (Object.keys(nonEmpty).length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${BASE}/api/settings/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: nonEmpty }),
      });
      if (!res.ok) {
        setSaveError(`Server error ${res.status}`);
        return;
      }
      setCredValues({});
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 4000);
      await fetchCredStatus();
      await fetchYtChannels();
    } catch {
      setSaveError("Network error.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCredential = async (key: string) => {
    setDeletingCredKey(key);
    setDeleteCredError(null);
    try {
      const res = await fetch(`${BASE}/api/settings/credentials/${key}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setDeleteCredError(`Failed to remove ${key}`);
        return;
      }
      await fetchCredStatus();
      await fetchYtChannels();
    } catch {
      setDeleteCredError(`Network error removing ${key}`);
    } finally {
      setDeletingCredKey(null);
    }
  };

  const handleSetDefault = async (id: number) => {
    setSettingDefault(id);
    try {
      await fetch(`${BASE}/api/auth/youtube/channels/${id}/default`, {
        method: "POST",
      });
      await fetchYtChannels();
    } finally {
      setSettingDefault(null);
    }
  };

  const handleDisconnect = async (id: number) => {
    setDisconnecting(id);
    try {
      await fetch(`${BASE}/api/auth/youtube/channels/${id}`, {
        method: "DELETE",
      });
      await fetchYtChannels();
      queryClient.invalidateQueries({ queryKey: getListTokensQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
    } finally {
      setDisconnecting(null);
    }
  };

  const handleFbSetDefault = async (id: number) => {
    setSettingFbDefault(id);
    try {
      await fetch(`${BASE}/api/auth/facebook/pages/${id}/default`, {
        method: "POST",
      });
      await fetchFbPages();
    } finally {
      setSettingFbDefault(null);
    }
  };

  const handleFbDisconnect = async (id: number) => {
    setDisconnectingFb(id);
    try {
      await fetch(`${BASE}/api/auth/facebook/pages/${id}`, {
        method: "DELETE",
      });
      await fetchFbPages();
      queryClient.invalidateQueries({ queryKey: getListTokensQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
    } finally {
      setDisconnectingFb(null);
    }
  };

  const handleFbManualSave = async () => {
    if (
      !fbManualToken.trim() ||
      !fbManualPageId.trim() ||
      !fbManualPageName.trim()
    )
      return;
    setFbManualSaving(true);
    setFbManualError(null);
    setFbManualOk(false);
    try {
      const res = await fetch(`${BASE}/api/auth/facebook/manual-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageToken: fbManualToken,
          pageId: fbManualPageId,
          pageName: fbManualPageName,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.error) {
        setFbManualError(data.error ?? `Server error ${res.status}`);
        return;
      }
      setFbManualToken("");
      setFbManualPageId("");
      setFbManualPageName("");
      setFbManualOk(true);
      setTimeout(() => setFbManualOk(false), 4000);
      setShowFbManual(false);
      await fetchFbPages();
      queryClient.invalidateQueries({ queryKey: getListTokensQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
    } catch {
      setFbManualError("Network error.");
    } finally {
      setFbManualSaving(false);
    }
  };

  const ytCredsSet =
    credStatus["YOUTUBE_CLIENT_ID"]?.set &&
    credStatus["YOUTUBE_CLIENT_SECRET"]?.set;
  const fbCredsSet =
    credStatus["FACEBOOK_APP_ID"]?.set &&
    credStatus["FACEBOOK_APP_SECRET"]?.set;
  const hasUnsavedChanges = Object.values(credValues).some(
    (v) => v.trim() !== ""
  );

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (authChecking) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary opacity-60" />
        </div>
      </Layout>
    );
  }

  if (!authed) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[70vh]">
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-sm"
          >
            <Card className="p-6 sm:p-8 border-border bg-card space-y-6">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-12 h-12 rounded-xl bg-primary/12 border border-primary/25 flex items-center justify-center">
                  <Lock className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-display font-semibold text-foreground">
                    Settings Access
                  </h1>
                  <p className="text-xs text-muted-foreground mt-1">
                    Enter your studio password to manage credentials and diagnostics.
                  </p>
                </div>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Password
                  </Label>
                  <div className="relative">
                    <Input
                      ref={authInputRef}
                      type={showAuthPassword ? "text" : "password"}
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      autoFocus
                      className="font-mono text-sm pr-11 bg-muted/50 border-border focus:border-primary min-h-[44px] h-11"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAuthPassword((s) => !s)}
                      aria-label={
                        showAuthPassword ? "Hide password" : "Show password"
                      }
                      className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[38px] min-h-[38px] flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showAuthPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {loginError && (
                  <p className="text-xs text-red-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />{" "}
                    {loginError}
                  </p>
                )}

                <Button
                  type="submit"
                  className="w-full gap-2 font-medium min-h-[44px] h-11 bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={loginLoading || !authPassword}
                >
                  {loginLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-4 h-4" />
                  )}
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
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="max-w-3xl space-y-6"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-semibold tracking-tight text-foreground">
              Settings
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage download diagnostics, YouTube cookies, residential proxies, and connected publishing channels.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleLogout}
            className="text-xs font-medium gap-1.5 min-h-[40px] border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" /> Lock
          </Button>
        </div>

        {/* Section Jump Navigation */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {[
            { id: "section-cookies", label: "Diagnostics & Cookies" },
            { id: "section-proxy", label: "Proxy" },
            { id: "section-channels", label: "Channels & Pages" },
            { id: "section-credentials", label: "API Keys & Brand" },
          ].map((sec) => (
            <button
              key={sec.id}
              type="button"
              onClick={() => scrollToSection(sec.id)}
              className="px-3.5 min-h-[38px] rounded-lg border border-border bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors whitespace-nowrap shrink-0"
            >
              {sec.label}
            </button>
          ))}
        </div>

        {/* ── Diagnostics & YouTube Download Cookies ─────────────────────── */}
        <Card
          id="section-cookies"
          className="p-4 sm:p-6 border-border bg-card space-y-5 scroll-mt-20"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/12 flex items-center justify-center shrink-0 mt-0.5">
                <Cookie className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-display font-semibold text-foreground">
                  Download Diagnostics & YouTube Cookies
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Verify yt-dlp extraction capabilities and keep Netscape cookies fresh to clear YouTube bot verification.
                </p>
              </div>
            </div>

            {cookiesStatus.set &&
              (() => {
                const st = cookiesStatus.validation?.status;
                const isHealthy = st === "valid" || !st;
                const isWarn = st === "expiring_soon";
                return (
                  <span
                    className={`text-xs font-mono flex items-center gap-1 shrink-0 ${
                      isHealthy
                        ? "text-emerald-400"
                        : isWarn
                        ? "text-amber-400"
                        : "text-red-400"
                    }`}
                  >
                    {isHealthy ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    )}
                    {st === "valid"
                      ? "Valid"
                      : st === "expiring_soon"
                      ? "Expiring Soon"
                      : st === "expired"
                      ? "Expired"
                      : st === "missing_auth"
                      ? "Missing Auth"
                      : "Active"}
                  </span>
                );
              })()}
          </div>

          {/* Saved Cookie Health Summary */}
          {cookiesStatus.set && (
            <div
              className={`p-3.5 rounded-lg border space-y-1.5 ${
                cookiesStatus.validation?.status === "expired" ||
                cookiesStatus.validation?.status === "missing_auth"
                  ? "bg-red-500/8 border-red-500/30"
                  : cookiesStatus.validation?.status === "expiring_soon"
                  ? "bg-amber-500/8 border-amber-500/30"
                  : "bg-emerald-500/8 border-emerald-500/25"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-mono text-foreground flex-wrap">
                  {cookiesStatus.validation?.valid !== false ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <span>
                    {cookiesStatus.validation
                      ? `${cookiesStatus.validation.ytCookieCount ?? 0} YouTube/Google cookies (${(cookiesStatus.validation.foundAuthCookies ?? []).length} auth keys)`
                      : "Cookie file saved"}
                  </span>
                  {cookiesStatus.updatedAt && (
                    <span className="text-muted-foreground tabular-nums">
                      · Updated{" "}
                      {new Date(cookiesStatus.updatedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDeleteCookies}
                  className="text-xs font-medium gap-1 min-h-[36px] text-destructive hover:text-destructive hover:bg-destructive/10 px-2.5 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </Button>
              </div>

              {cookiesStatus.validation?.earliestExpiry && (
                <p className="text-xs font-mono text-muted-foreground tabular-nums">
                  Earliest auth expiry:{" "}
                  {new Date(
                    cookiesStatus.validation.earliestExpiry
                  ).toLocaleDateString()}
                  {(cookiesStatus.validation.foundAuthCookies ?? []).length >
                    0 && (
                    <>
                      {" "}
                      · Keys:{" "}
                      {(cookiesStatus.validation.foundAuthCookies ?? [])
                        .slice(0, 5)
                        .join(", ")}
                    </>
                  )}
                </p>
              )}

              {(cookiesStatus.validation?.warnings ?? []).map((w, idx) => (
                <p key={idx} className="text-xs font-mono text-amber-400">
                  {w}
                </p>
              ))}
            </div>
          )}

          {/* Cookie Paste Input */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground">
              Paste Netscape-format cookies (youtube.com)
            </Label>
            <Textarea
              placeholder={
                "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t...\n..."
              }
              value={cookiesText}
              onChange={(e) => setCookiesText(e.target.value)}
              className="font-mono text-xs bg-muted/50 border-border focus:border-primary min-h-[108px] resize-y"
              rows={4}
            />
            {cookiesPreview && (
              <div
                className={`text-xs font-mono px-3 py-2 rounded-lg border ${
                  cookiesPreview.valid
                    ? "bg-emerald-500/8 border-emerald-500/25 text-emerald-300"
                    : "bg-red-500/8 border-red-500/25 text-red-300"
                }`}
              >
                {cookiesPreview.valid ? (
                  <span>
                    Valid Netscape format: {cookiesPreview.cookieCount} rows (
                    {cookiesPreview.ytCookieCount} YouTube/Google · auth keys:{" "}
                    {cookiesPreview.foundAuthCookies.join(", ")})
                  </span>
                ) : (
                  <span>
                    {cookiesPreview.warnings[0] ??
                      "Invalid Netscape cookie text."}
                  </span>
                )}
              </div>
            )}
          </div>

          {cookiesError && (
            <div className="flex items-center gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/25 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{cookiesError}</span>
            </div>
          )}

          {cookiesSavedOk && (
            <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-lg p-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Cookies validated and saved.</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5">
            <Button
              onClick={handleSaveCookies}
              disabled={!cookiesText.trim() || cookiesSaving}
              className="flex-1 font-medium text-sm gap-2 min-h-[44px] h-11 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {cookiesSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : cookiesSavedOk ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {cookiesSavedOk
                ? "Cookies Saved"
                : cookiesSaving
                ? "Validating & Saving…"
                : "Save Cookies"}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => handleRunDiagnostics()}
              disabled={diagRunning}
              className="font-medium text-sm gap-2 min-h-[44px] h-11 border-border bg-muted/40 hover:bg-muted"
            >
              {diagRunning ? (
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
              ) : (
                <Activity className="w-4 h-4 text-primary" />
              )}
              {diagRunning ? "Testing Setup…" : "Test Download Setup"}
            </Button>
          </div>

          {diagError && (
            <div className="flex items-center gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/25 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{diagError}</span>
            </div>
          )}

          {/* Download Capabilities Matrix */}
          {diagResult && (
            <div className="rounded-lg border border-border bg-muted/25 overflow-hidden">
              <div className="divide-y divide-border text-xs font-mono">
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-muted-foreground">yt-dlp Engine</span>
                  <span
                    className={`tabular-nums ${
                      diagResult.ytDlp.ok ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {diagResult.ytDlp.ok ? diagResult.ytDlp.version : "Missing"}
                  </span>
                </div>
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-muted-foreground">PO Token Server</span>
                  <span
                    className={
                      diagResult.potServer.ok
                        ? "text-emerald-400"
                        : "text-amber-400"
                    }
                  >
                    {diagResult.potServer.ok
                      ? `Active (${diagResult.potServer.mode})`
                      : "Not running"}
                  </span>
                </div>
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-muted-foreground">Cookies</span>
                  <span
                    className={
                      diagResult.cookies.validation?.valid
                        ? "text-emerald-400"
                        : "text-amber-400"
                    }
                  >
                    {diagResult.cookies.set
                      ? diagResult.cookies.validation?.status ?? "Saved"
                      : "None"}
                  </span>
                </div>
                <div className="flex items-center justify-between px-3.5 py-2.5">
                  <span className="text-muted-foreground">Proxy Pool</span>
                  <span
                    className={`tabular-nums ${
                      !diagResult.proxy.configured
                        ? "text-muted-foreground"
                        : diagResult.proxy.ok
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    {!diagResult.proxy.configured
                      ? "Direct IP"
                      : typeof diagResult.proxy.count === "number" &&
                        diagResult.proxy.count > 1
                      ? `${diagResult.proxy.reachableCount ?? 0}/${diagResult.proxy.count} reachable`
                      : diagResult.proxy.ok
                      ? "Reachable"
                      : "Unreachable"}
                  </span>
                </div>
                {diagResult.storage && (
                  <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                    <span className="text-muted-foreground truncate">
                      Temp Video Storage (
                      {diagResult.storage.persistentConfigured
                        ? "Persistent Disk"
                        : "Ephemeral /tmp"}
                      )
                    </span>
                    <span
                      className={`tabular-nums shrink-0 ${
                        diagResult.storage.availableMB !== null &&
                        diagResult.storage.availableMB >= 4096
                          ? "text-emerald-400"
                          : diagResult.storage.availableMB !== null &&
                            diagResult.storage.availableMB >= 1500
                          ? "text-amber-400"
                          : "text-red-400"
                      }`}
                    >
                      {diagResult.storage.availableMB !== null
                        ? `${(diagResult.storage.availableMB / 1024).toFixed(2)} GB free`
                        : "Unknown"}
                    </span>
                  </div>
                )}
              </div>

              {(diagResult.proxy.error ||
                (diagResult.proxy.proxies && diagResult.proxy.proxies.length > 0) ||
                (diagResult.probe.attempted && diagResult.probe.message)) && (
                <div className="border-t border-border p-3 space-y-2 text-xs">
                  {diagResult.proxy.proxies && diagResult.proxy.proxies.length > 0 && (
                    <div className="rounded-md border border-border bg-card/60 divide-y divide-border font-mono">
                      {diagResult.proxy.proxies.slice(0, 8).map((item, idx) => (
                        <div
                          key={`${item.maskedHost}-${idx}`}
                          className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                        >
                          <span className="text-foreground truncate">{item.maskedHost}</span>
                          <span
                            className={`shrink-0 ${
                              item.ok ? "text-emerald-400" : "text-red-400"
                            }`}
                          >
                            {item.ok ? "Reachable" : item.error ?? "Failed"}
                          </span>
                        </div>
                      ))}
                      {diagResult.proxy.proxies.length > 8 && (
                        <div className="px-2.5 py-1 text-muted-foreground tabular-nums">
                          +{diagResult.proxy.proxies.length - 8} more proxies checked
                        </div>
                      )}
                    </div>
                  )}
                  {diagResult.proxy.error && (
                    <p className="text-red-300 font-mono">
                      Proxy error: {diagResult.proxy.error}
                    </p>
                  )}
                  {diagResult.probe.attempted && diagResult.probe.message && (
                    <div
                      className={`p-2.5 rounded-md font-mono break-words ${
                        diagResult.probe.ok
                          ? "bg-emerald-500/10 text-emerald-300"
                          : "bg-red-500/10 text-red-300"
                      }`}
                    >
                      {diagResult.probe.message}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Export Cookies Guide */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowCookiesGuide((s) => !s)}
              className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors bg-muted/40 rounded-lg px-3.5 min-h-[44px]"
            >
              <span className="font-medium text-foreground flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" /> How to export YouTube
                cookies
              </span>
              {showCookiesGuide ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
            <AnimatePresence>
              {showCookiesGuide && (
                <motion.ol
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden space-y-2 text-xs text-muted-foreground pt-3 pl-1 list-decimal list-inside"
                >
                  {[
                    <>
                      Install the{" "}
                      <strong className="text-foreground">
                        "Get cookies.txt LOCALLY"
                      </strong>{" "}
                      Chrome/Firefox extension
                    </>,
                    <>
                      Open{" "}
                      <a
                        href="https://www.youtube.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        youtube.com
                      </a>{" "}
                      and make sure you are signed in to your Google account
                    </>,
                    "Click the extension icon → Export cookies for youtube.com",
                    "Select Netscape format (default)",
                    "Open the downloaded .txt file and copy all contents",
                    "Paste everything into the text area above and click Save Cookies",
                  ].map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </motion.ol>
              )}
            </AnimatePresence>
          </div>
        </Card>

        {/* ── Download Multi-Proxy Pool ──────────────────────────────────── */}
        <Card
          id="section-proxy"
          className="p-4 sm:p-6 border-border bg-card space-y-4 scroll-mt-20"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/12 flex items-center justify-center shrink-0 mt-0.5">
                <Globe className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-display font-semibold text-foreground">
                  Download Multi-Proxy Pool{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    · Optional
                  </span>
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Paste one or more free <span className="font-mono text-foreground">ip:port</span> proxies or full HTTP/SOCKS5 URLs. Dead proxies are skipped automatically and working ones rotate on failure.
                </p>
              </div>
            </div>

            {proxyStatus.set && (
              <span className="text-xs font-mono tabular-nums text-emerald-400 flex items-center gap-1 shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" />{" "}
                {proxyStatus.count > 1
                  ? `${proxyStatus.count} proxies`
                  : "Configured"}
              </span>
            )}
          </div>

          {proxyStatus.set && (
            <div className="rounded-lg bg-muted/35 border border-border overflow-hidden">
              <div className="flex items-center justify-between px-3.5 py-2.5 gap-2">
                <div className="text-xs font-mono text-foreground truncate tabular-nums">
                  {proxyStatus.count > 1
                    ? `Active pool (${proxyStatus.count} proxies)`
                    : "Active proxy"}{" "}
                  {proxyStatus.updatedAt && (
                    <span className="text-muted-foreground">
                      · Updated{" "}
                      {new Date(proxyStatus.updatedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDeleteProxy}
                  className="text-xs font-medium gap-1 min-h-[36px] text-destructive hover:text-destructive hover:bg-destructive/10 px-2.5 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />{" "}
                  {proxyStatus.count > 1 ? "Remove All" : "Remove"}
                </Button>
              </div>
              {proxyStatus.maskedProxies.length > 0 && (
                <div className="border-t border-border divide-y divide-border max-h-40 overflow-y-auto">
                  {proxyStatus.maskedProxies.map((host, idx) => (
                    <div
                      key={`${host}-${idx}`}
                      className="flex items-center justify-between px-3.5 py-1.5 text-xs font-mono"
                    >
                      <span className="text-primary truncate">{host}</span>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        #{idx + 1}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Proxy List (template: ip:port, ip:port)
              </Label>
              <button
                type="button"
                onClick={() => setMaskProxyInput((m) => !m)}
                className="text-xs font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
              >
                {maskProxyInput ? (
                  <>
                    <Eye className="w-3.5 h-3.5" /> Show text
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5" /> Mask input
                  </>
                )}
              </button>
            </div>

            <Textarea
              placeholder={"ip:port,\nip:port"}
              value={proxyInput}
              onChange={(e) => setProxyInput(e.target.value)}
              rows={4}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              className={`font-mono text-xs bg-muted/50 border-border focus:border-primary min-h-[104px] resize-y ${
                maskProxyInput ? "[-webkit-text-security:disc]" : ""
              }`}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Bare <span className="font-mono text-foreground">ip:port</span> entries automatically use{" "}
                <span className="font-mono text-foreground">http://</span> (comma or newline separated).
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                Template: ip:port, ip:port
              </span>
            </div>

            {proxyPreview && (
              <div
                className={`text-xs font-mono px-3 py-2 rounded-lg border ${
                  proxyPreview.invalidCount === 0
                    ? "bg-emerald-500/8 border-emerald-500/25 text-emerald-300"
                    : "bg-red-500/8 border-red-500/25 text-red-300"
                }`}
              >
                {proxyPreview.invalidCount === 0 ? (
                  <span className="tabular-nums">
                    {proxyPreview.validCount}{" "}
                    {proxyPreview.validCount === 1 ? "proxy" : "proxies"} ready to save (
                    {proxyPreview.entries
                      .slice(0, 3)
                      .map((e) => e.raw)
                      .join(", ")}
                    {proxyPreview.validCount > 3
                      ? `, +${proxyPreview.validCount - 3} more`
                      : ""}
                    )
                  </span>
                ) : (
                  <span>
                    {proxyPreview.firstError ??
                      "One or more proxy entries look invalid."}
                  </span>
                )}
              </div>
            )}
          </div>

          {proxyError && (
            <div className="flex items-center gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/25 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{proxyError}</span>
            </div>
          )}

          {proxySavedOk && (
            <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-lg p-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Proxy pool validated and saved.</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5">
            <Button
              onClick={handleSaveProxy}
              disabled={
                !proxyInput.trim() ||
                proxySaving ||
                (proxyPreview !== null &&
                  (proxyPreview.invalidCount > 0 || proxyPreview.validCount === 0))
              }
              className="flex-1 font-medium text-sm gap-2 min-h-[44px] h-11 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {proxySaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : proxySavedOk ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {proxySavedOk
                ? "Proxy Pool Saved"
                : proxySaving
                ? "Saving…"
                : proxyPreview && proxyPreview.validCount > 1
                ? `Save ${proxyPreview.validCount} Proxies`
                : "Save Proxy Pool"}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => handleRunDiagnostics(proxyInput || undefined)}
              disabled={diagRunning || (!proxyInput.trim() && !proxyStatus.set)}
              className="font-medium text-sm gap-2 min-h-[44px] h-11 border-border bg-muted/40 hover:bg-muted"
            >
              {diagRunning ? (
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
              ) : (
                <Activity className="w-4 h-4 text-primary" />
              )}
              Test Proxy Pool
            </Button>
          </div>
        </Card>

        {/* ── Connected Channels & Pages ─────────────────────────────────── */}
        <div id="section-channels" className="space-y-5 scroll-mt-20">
          {/* YouTube Channels */}
          <Card className="p-4 sm:p-6 border-border bg-card space-y-4">
            {oauthError && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 rounded-lg p-3 text-xs text-red-300">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span className="flex-1">{oauthError}</span>
                <button
                  type="button"
                  onClick={() => setOauthError(null)}
                  className="text-red-300/70 hover:text-red-200 px-1"
                >
                  ×
                </button>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-red-600/15 flex items-center justify-center shrink-0">
                  <Youtube className="w-4 h-4 text-red-500" />
                </div>
                <div>
                  <h2 className="text-base font-display font-semibold text-foreground">
                    YouTube Channels
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Connect channels and pick a default destination.
                  </p>
                </div>
              </div>

              <div className="shrink-0">
                {ytLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : ytChannels.length > 0 ? (
                  <span className="flex items-center gap-1.5 text-xs font-mono tabular-nums text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />{" "}
                    {ytChannels.length} connected
                  </span>
                ) : (
                  <span className="text-xs font-mono text-muted-foreground">
                    None connected
                  </span>
                )}
              </div>
            </div>

            {!ytCredsSet && (
              <div className="bg-amber-500/8 border border-amber-500/25 rounded-lg p-3 text-xs text-amber-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  Save your <strong>YouTube Client ID</strong> and{" "}
                  <strong>Client Secret</strong> below before connecting.
                </span>
              </div>
            )}

            {ytChannels.length > 0 && (
              <div className="divide-y divide-border border-t border-b border-border">
                {ytChannels.map((ch) => (
                  <AccountRow
                    key={ch.id}
                    ch={ch}
                    platform="youtube"
                    onSetDefault={() => handleSetDefault(ch.id)}
                    onDisconnect={() => handleDisconnect(ch.id)}
                    isSettingDefault={settingDefault === ch.id}
                    isDisconnecting={disconnecting === ch.id}
                  />
                ))}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2.5">
              <Button
                onClick={() => {
                  window.location.href = `${BASE}/api/auth/youtube`;
                }}
                disabled={!ytCredsSet}
                className="flex-1 gap-2 font-medium text-sm min-h-[44px] h-11 bg-red-600 hover:bg-red-700 text-white"
              >
                <Plus className="w-4 h-4" />
                {ytChannels.length === 0
                  ? "Connect YouTube Channel"
                  : "Connect Another Channel"}
              </Button>
              {ytChannels.length > 0 && (
                <Button
                  variant="outline"
                  onClick={fetchYtChannels}
                  className="gap-1.5 font-medium text-sm min-h-[44px] h-11 border-border bg-muted/40 hover:bg-muted"
                >
                  <RefreshCw className="w-4 h-4" /> Refresh
                </Button>
              )}
            </div>

            {ytChannels.length === 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowYtSetup((s) => !s)}
                  className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors bg-muted/40 rounded-lg px-3.5 min-h-[44px]"
                >
                  <span className="font-medium text-foreground">
                    How to set up YouTube OAuth credentials
                  </span>
                  {showYtSetup ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                <AnimatePresence>
                  {showYtSetup && (
                    <motion.ol
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden space-y-2 text-xs text-muted-foreground pt-3 pl-1 list-decimal list-inside"
                    >
                      {[
                        <>
                          Go to{" "}
                          <a
                            href="https://console.cloud.google.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            console.cloud.google.com
                          </a>{" "}
                          and create a project
                        </>,
                        "Enable the YouTube Data API v3",
                        'Create OAuth 2.0 credentials (type: "Web application")',
                        `Add redirect URI: ${window.location.origin}/api/auth/youtube/callback`,
                        "Copy Client ID and Secret into API Credentials below and save",
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

          {/* Facebook Pages */}
          <Card className="p-4 sm:p-6 border-border bg-card space-y-4">
            {fbOauthMsg && (
              <div
                className={`flex items-start gap-2 rounded-lg p-3 text-xs border ${
                  fbOauthMsg.type === "success"
                    ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
                    : "bg-red-500/10 border-red-500/25 text-red-300"
                }`}
              >
                {fbOauthMsg.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                )}
                <span className="flex-1">{fbOauthMsg.text}</span>
                <button
                  type="button"
                  onClick={() => setFbOauthMsg(null)}
                  className="opacity-70 hover:opacity-100 px-1"
                >
                  ×
                </button>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-600/15 flex items-center justify-center shrink-0">
                  <Facebook className="w-4 h-4 text-blue-500" />
                </div>
                <div>
                  <h2 className="text-base font-display font-semibold text-foreground">
                    Facebook Pages
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Connect Pages to publish videos via the Graph API.
                  </p>
                </div>
              </div>

              <div className="shrink-0">
                {fbLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : fbPages.length > 0 ? (
                  <span className="flex items-center gap-1.5 text-xs font-mono tabular-nums text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> {fbPages.length}{" "}
                    connected
                  </span>
                ) : (
                  <span className="text-xs font-mono text-muted-foreground">
                    None connected
                  </span>
                )}
              </div>
            </div>

            {!fbCredsSet && (
              <div className="bg-amber-500/8 border border-amber-500/25 rounded-lg p-3 text-xs text-amber-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  Save your <strong>Facebook App ID</strong> and{" "}
                  <strong>App Secret</strong> below before connecting via OAuth.
                </span>
              </div>
            )}

            {fbPages.length > 0 && (
              <div className="divide-y divide-border border-t border-b border-border">
                {fbPages.map((page) => (
                  <AccountRow
                    key={page.id}
                    ch={page}
                    platform="facebook"
                    onSetDefault={() => handleFbSetDefault(page.id)}
                    onDisconnect={() => handleFbDisconnect(page.id)}
                    isSettingDefault={settingFbDefault === page.id}
                    isDisconnecting={disconnectingFb === page.id}
                  />
                ))}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2.5">
              <Button
                onClick={() => {
                  window.location.href = `${BASE}/api/auth/facebook`;
                }}
                disabled={!fbCredsSet}
                className="flex-1 gap-2 font-medium text-sm min-h-[44px] h-11 bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Plus className="w-4 h-4" />
                {fbPages.length === 0
                  ? "Connect via OAuth"
                  : "Connect Another Page"}
              </Button>
              {fbPages.length > 0 && (
                <Button
                  variant="outline"
                  onClick={fetchFbPages}
                  className="gap-1.5 font-medium text-sm min-h-[44px] h-11 border-border bg-muted/40 hover:bg-muted"
                >
                  <RefreshCw className="w-4 h-4" /> Refresh
                </Button>
              )}
            </div>

            {/* Manual Page Token */}
            <div>
              <button
                type="button"
                onClick={() => {
                  setShowFbManual((s) => !s);
                  setFbManualError(null);
                }}
                className="w-full flex items-center justify-between text-xs hover:text-foreground transition-colors bg-muted/40 rounded-lg px-3.5 min-h-[44px] text-muted-foreground"
              >
                <span className="font-medium text-foreground flex items-center gap-2">
                  <Key className="w-4 h-4 text-blue-400" /> Add Page manually
                  (paste token)
                </span>
                {showFbManual ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              <AnimatePresence>
                {showFbManual && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-3 space-y-3">
                      <div className="bg-muted/40 rounded-lg p-3.5 text-xs text-muted-foreground space-y-1.5">
                        <p className="font-medium text-foreground">
                          Generate a Page Access Token from Graph API Explorer:
                        </p>
                        <ol className="list-decimal list-inside space-y-1">
                          <li>
                            Go to{" "}
                            <a
                              href="https://developers.facebook.com/tools/explorer"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              developers.facebook.com/tools/explorer
                            </a>
                          </li>
                          <li>
                            Select your App from the top-right dropdown
                          </li>
                          <li>
                            Click{" "}
                            <strong className="text-foreground">
                              Generate Access Token
                            </strong>{" "}
                            and grant permissions
                          </li>
                          <li>
                            Switch the token dropdown to your{" "}
                            <strong className="text-foreground">Page</strong>{" "}
                            and copy the token &amp; Page ID
                          </li>
                        </ol>
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-muted-foreground">
                            Page Access Token
                          </Label>
                          <Input
                            type="password"
                            placeholder="EAANre0M..."
                            value={fbManualToken}
                            onChange={(e) => setFbManualToken(e.target.value)}
                            className="font-mono text-xs bg-muted/50 border-border focus:border-primary min-h-[44px] h-11"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs font-medium text-muted-foreground">
                              Page ID
                            </Label>
                            <Input
                              placeholder="123456789"
                              value={fbManualPageId}
                              onChange={(e) =>
                                setFbManualPageId(e.target.value)
                              }
                              className="font-mono text-xs bg-muted/50 border-border focus:border-primary min-h-[44px] h-11"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-medium text-muted-foreground">
                              Page Name
                            </Label>
                            <Input
                              placeholder="My Business Page"
                              value={fbManualPageName}
                              onChange={(e) =>
                                setFbManualPageName(e.target.value)
                              }
                              className="font-mono text-xs bg-muted/50 border-border focus:border-primary min-h-[44px] h-11"
                            />
                          </div>
                        </div>
                      </div>

                      {fbManualError && (
                        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 rounded-lg p-3 text-xs text-red-300">
                          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                          <span>{fbManualError}</span>
                        </div>
                      )}
                      {fbManualOk && (
                        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/25 rounded-lg p-3 text-xs text-emerald-300">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />{" "}
                          Page connected successfully.
                        </div>
                      )}

                      <Button
                        onClick={handleFbManualSave}
                        disabled={
                          !fbManualToken.trim() ||
                          !fbManualPageId.trim() ||
                          !fbManualPageName.trim() ||
                          fbManualSaving
                        }
                        className="w-full font-medium text-sm gap-2 min-h-[44px] h-11 bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        {fbManualSaving ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        {fbManualSaving
                          ? "Verifying & saving…"
                          : "Save Page Token"}
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {fbPages.length === 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowFbSetup((s) => !s)}
                  className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors bg-muted/40 rounded-lg px-3.5 min-h-[44px]"
                >
                  <span className="font-medium text-foreground flex items-center gap-2">
                    <Info className="w-4 h-4 text-blue-400" /> How to set up
                    Facebook OAuth
                  </span>
                  {showFbSetup ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                <AnimatePresence>
                  {showFbSetup && (
                    <motion.ol
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden space-y-2 text-xs text-muted-foreground pt-3 pl-1 list-decimal list-inside"
                    >
                      {[
                        <>
                          Go to{" "}
                          <a
                            href="https://developers.facebook.com/apps"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            developers.facebook.com/apps
                          </a>{" "}
                          and create an app (type: Business)
                        </>,
                        'Add the "Facebook Login" product and enable "Web OAuth Login"',
                        `Add OAuth redirect URI: ${window.location.origin}/api/auth/facebook/callback`,
                        "Copy your App ID and App Secret into API Credentials below and save",
                        "Click Connect via OAuth and grant permissions",
                        "Managed Facebook Pages will be imported automatically",
                      ].map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </motion.ol>
                  )}
                </AnimatePresence>
              </div>
            )}
          </Card>
        </div>

        {/* ── API Credentials & Brand Watermark ──────────────────────────── */}
        <div id="section-credentials" className="space-y-5 scroll-mt-20">
          {/* API Credentials */}
          <Card className="p-4 sm:p-6 border-border bg-card space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/12 flex items-center justify-center shrink-0">
                  <Key className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-base font-display font-semibold text-foreground">
                    API Credentials
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Enter your OAuth app keys — stored securely in the database.
                  </p>
                </div>
              </div>
              {Object.values(credStatus).some((s) => s.set) && (
                <span className="text-xs font-mono tabular-nums text-emerald-400 flex items-center gap-1 shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {Object.values(credStatus).filter((s) => s.set).length}{" "}
                  configured
                </span>
              )}
            </div>

            <div className="space-y-5">
              {(["youtube", "facebook"] as const).map((group) => (
                <div key={group} className="space-y-3.5">
                  <p className="text-xs font-medium text-muted-foreground border-b border-border pb-1.5">
                    {group === "youtube"
                      ? "YouTube / Google Cloud"
                      : "Facebook / Meta"}
                  </p>
                  {CREDENTIAL_FIELDS.filter((f) => f.group === group).map(
                    (field) => (
                      <div key={field.key} className="flex gap-2 items-end">
                        <div className="flex-1 min-w-0">
                          <CredentialInput
                            field={field}
                            status={credStatus[field.key]}
                            value={credValues[field.key] ?? ""}
                            onChange={(v) =>
                              setCredValues((prev) => ({
                                ...prev,
                                [field.key]: v,
                              }))
                            }
                          />
                        </div>
                        {credStatus[field.key]?.set && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Delete ${field.label}`}
                            className="w-11 h-11 mb-5 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => handleDeleteCredential(field.key)}
                            disabled={deletingCredKey === field.key}
                          >
                            {deletingCredKey === field.key ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    )
                  )}
                </div>
              ))}
            </div>

            {deleteCredError && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 rounded-lg p-3 text-xs text-red-300">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{deleteCredError}</span>
              </div>
            )}

            <Button
              onClick={handleSaveCredentials}
              disabled={!hasUnsavedChanges || saving}
              className="w-full font-medium text-sm gap-2 min-h-[44px] h-11 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : savedOk ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {savedOk
                ? "Credentials Saved"
                : saving
                ? "Saving…"
                : "Save Credentials"}
            </Button>

            {saveError && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 rounded-lg p-3 text-xs text-red-300">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{saveError}</span>
              </div>
            )}
            {savedOk && (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/25 rounded-lg p-3 text-xs text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  Credentials saved. You can now connect your accounts above.
                </span>
              </div>
            )}
          </Card>

          {/* Watermark Logo */}
          <Card className="p-4 sm:p-6 border-border bg-card space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/12 flex items-center justify-center shrink-0">
                  <ImageIcon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-base font-display font-semibold text-foreground">
                    Watermark Logo{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      · 2-Corner Overlay
                    </span>
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Placed top-right and bottom-left on 4K Studio videos with black backgrounds keyed out automatically.
                  </p>
                </div>
              </div>
              {logoSet && (
                <span className="text-xs font-mono text-emerald-400 flex items-center gap-1 shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Active
                </span>
              )}
            </div>

            {logoSet && (
              <div className="flex items-center gap-3 p-3.5 rounded-lg bg-muted/40 border border-border">
                <img
                  src={`${BASE}/api/assets/watermark-logo.png?t=${Date.now()}`}
                  alt="Watermark logo"
                  className="w-14 h-14 object-contain rounded-md bg-black/50 p-1 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-foreground font-semibold">
                    Custom Brand Watermark
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Applied to all 4K Studio renders
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleLogoDelete}
                  className="text-xs font-medium gap-1 min-h-[40px] text-destructive hover:text-destructive hover:bg-destructive/10 px-3 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </Button>
              </div>
            )}

            {logoError && (
              <div className="flex items-center gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/25 rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                {logoError}
              </div>
            )}
            {logoOk && (
              <div className="flex items-center gap-2 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-lg p-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                Logo saved for future 4K Studio renders.
              </div>
            )}

            <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-border rounded-lg p-5 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors min-h-[100px]">
              {logoUploading ? (
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              ) : (
                <Upload className="w-5 h-5 text-muted-foreground" />
              )}
              <span className="text-xs font-medium text-muted-foreground text-center">
                {logoUploading
                  ? "Processing…"
                  : logoSet
                  ? "Upload new logo to replace (PNG or JPG)"
                  : "Upload your watermark logo (PNG or JPG)"}
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                className="hidden"
                onChange={handleLogoUpload}
                disabled={logoUploading}
              />
            </label>
          </Card>

          {/* Active Tokens */}
          {safeTokens.length > 0 && (
            <Card className="p-4 sm:p-6 border-border bg-card space-y-3">
              <h2 className="text-base font-display font-semibold text-foreground">
                Active OAuth Tokens
              </h2>
              <div className="divide-y divide-border border-t border-border">
                {safeTokens
                  .filter((t) => t.isActive)
                  .map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between py-3 gap-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {t.platform === "youtube" ? (
                          <Youtube className="w-4 h-4 text-red-500 shrink-0" />
                        ) : (
                          <Facebook className="w-4 h-4 text-blue-500 shrink-0" />
                        )}
                        <span className="text-sm font-medium text-foreground truncate">
                          {t.label ?? t.platform}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground capitalize">
                          · {t.platform}
                        </span>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove token ${t.label ?? t.id}`}
                        className="w-10 h-10 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => deleteToken.mutate({ id: t.id })}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
              </div>
            </Card>
          )}
        </div>
      </motion.div>
    </Layout>
  );
}
