import { Link, useLocation } from "wouter";
import {
  Activity,
  Settings,
  ListVideo,
  PlusSquare,
  LayoutDashboard,
  Menu,
  X,
  Youtube,
  Telescope,
  MonitorPlay,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { SpaceBackground } from "./space-background";

interface LayoutProps {
  children: React.ReactNode;
}

const primaryNavItems = [
  { href: "/", label: "Dashboard", shortLabel: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "All Jobs", shortLabel: "Jobs", icon: ListVideo },
  { href: "/new", label: "New Mission", shortLabel: "New", icon: PlusSquare },
  { href: "/4k-mission", label: "4K Studio", shortLabel: "4K", icon: MonitorPlay },
];

const workspaceNavItems = [
  { href: "/channel", label: "Channel Hub", icon: Youtube },
  { href: "/discover", label: "Discover", icon: Telescope },
  { href: "/logs", label: "Activity Logs", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

const allNavItems = [...primaryNavItems, ...workspaceNavItems];

const mobileBottomTabs = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: ListVideo },
  { href: "/new", label: "New", icon: PlusSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLink({
  href,
  label,
  icon: Icon,
  isActive,
  onClick,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  isActive: boolean;
  onClick?: () => void;
}) {
  return (
    <Link href={href}>
      <div
        onClick={onClick}
        className={cn(
          "flex items-center gap-3 px-3 min-h-[44px] lg:min-h-[38px] rounded-lg transition-colors duration-150 cursor-pointer text-sm font-medium whitespace-nowrap",
          isActive
            ? "bg-primary/12 text-primary"
            : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        )}
      >
        <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
        <span className="truncate">{label}</span>
      </div>
    </Link>
  );
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  useEffect(() => {
    if (mobileOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const isActive = (href: string) =>
    location === href || (href !== "/" && location.startsWith(href));

  const SidebarContent = () => (
    <>
      <div className="h-16 flex items-center px-6 border-b border-border/80">
        <Link href="/">
          <span className="font-display font-bold text-lg tracking-tight text-foreground whitespace-nowrap shrink-0 cursor-pointer">
            N3XUS
          </span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto py-5 px-3 space-y-6">
        <div className="space-y-1">
          <p className="px-3 pb-1 text-[11px] font-medium text-muted-foreground/75">
            Pipeline
          </p>
          {primaryNavItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              isActive={isActive(item.href)}
              onClick={() => setMobileOpen(false)}
            />
          ))}
        </div>

        <div className="space-y-1">
          <p className="px-3 pb-1 text-[11px] font-medium text-muted-foreground/75">
            Workspace
          </p>
          {workspaceNavItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              isActive={isActive(item.href)}
              onClick={() => setMobileOpen(false)}
            />
          ))}
        </div>
      </nav>
    </>
  );

  const currentTitle =
    allNavItems.find((item) => isActive(item.href))?.label ?? "Studio";

  return (
    <div className="min-h-screen flex w-full bg-background selection:bg-primary/25">
      <SpaceBackground />

      {/* Desktop Fixed Studio Sidebar (256px) */}
      <aside className="hidden lg:flex w-64 border-r border-border bg-card/90 backdrop-blur-sm flex-col fixed inset-y-0 left-0 z-30">
        <SidebarContent />
      </aside>

      {/* Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/65 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Slide-Out Drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 bg-card border-r border-border flex flex-col transition-transform duration-200 ease-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="absolute top-2.5 right-2.5">
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <SidebarContent />
      </aside>

      <main className="relative z-10 flex-1 lg:pl-64 flex flex-col min-h-screen min-w-0">
        {/* Compact 52px Mobile Header */}
        <header className="lg:hidden sticky top-0 z-20 flex items-center justify-between h-[52px] px-2 border-b border-border bg-card/92 backdrop-blur-md">
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <Link href="/">
              <span className="font-display font-bold text-base tracking-tight text-foreground whitespace-nowrap shrink-0 cursor-pointer">
                N3XUS
              </span>
            </Link>
            <span className="text-border mx-1.5 select-none">/</span>
            <span className="text-xs font-medium text-muted-foreground truncate">
              {currentTitle}
            </span>
          </div>

          <Link href="/new">
            <div className="min-h-[44px] px-3 flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 whitespace-nowrap shrink-0 cursor-pointer">
              <Plus className="w-4 h-4" />
              <span>New</span>
            </div>
          </Link>
        </header>

        {/* Main Studio Viewport */}
        <div className="flex-1 p-4 pb-24 sm:p-6 sm:pb-24 lg:p-8 lg:pb-10">
          <div className="max-w-6xl mx-auto w-full">
            {children}
          </div>
        </div>

        {/* Fixed 4-Tab Mobile Bottom Navigation Bar (60px, unclipped labels) */}
        <nav
          aria-label="Mobile navigation"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-card/95 backdrop-blur-md"
        >
          <div className="grid grid-cols-4 h-[60px] items-center px-1">
            {mobileBottomTabs.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 min-h-[48px] rounded-lg transition-colors cursor-pointer px-1",
                      active
                        ? "text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    <span className="text-[11px] font-medium leading-none whitespace-nowrap">
                      {item.label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </nav>
      </main>
    </div>
  );
}
