import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Suspense, lazy } from "react";
import { Loader2 } from "lucide-react";
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

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
}

function Router() {
  return (
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
  );
}

function App() {
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
