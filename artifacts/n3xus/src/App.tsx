import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Component, type ErrorInfo, type ReactNode, Suspense, lazy, useEffect } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import NotFound from "@/pages/not-found";

const Dashboard = lazy(() => import("@/pages/dashboard"));
const Jobs = lazy(() => import("@/pages/jobs"));
const JobDetail = lazy(() => import("@/pages/job-detail"));
const NewJob = lazy(() => import("@/pages/new-job"));
const Settings = lazy(() => import("@/pages/settings"));
const Logs = lazy(() => import("@/pages/logs"));
const Channel = lazy(() => import("@/pages/channel"));
const Discover = lazy(() => import("@/pages/discover"));
const FourKMission = lazy(() => import("@/pages/4k-mission"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});

const CHUNK_RELOAD_KEY = "n3xus:chunk-reload-ts";

function triggerSingleChunkReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || "0");
    if (Date.now() - last > 15_000) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
      window.location.reload();
      return true;
    }
  } catch {
    /* ignore storage issues */
  }
  return false;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error?.message || "Unexpected application error" };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    if (/Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk/i.test(error?.message || "")) {
      triggerSingleChunkReload();
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full rounded-lg border border-border bg-card p-6 text-center space-y-4">
            <h2 className="text-lg font-display font-semibold text-foreground">App Update Available</h2>
            <p className="text-xs font-mono text-muted-foreground break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-mono text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
}

function Router() {
  return (
    <AppErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/jobs" component={Jobs} />
          <Route path="/jobs/:id" component={JobDetail} />
          <Route path="/new" component={NewJob} />
          <Route path="/4k-mission" component={FourKMission} />
          <Route path="/channel" component={Channel} />
          <Route path="/discover" component={Discover} />
          <Route path="/settings" component={Settings} />
          <Route path="/logs" component={Logs} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </AppErrorBoundary>
  );
}

function App() {
  useEffect(() => {
    const onPreloadError = (event: Event) => {
      event.preventDefault();
      triggerSingleChunkReload();
    };
    window.addEventListener("vite:preloadError", onPreloadError);
    return () => window.removeEventListener("vite:preloadError", onPreloadError);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
