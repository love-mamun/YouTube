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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { SpaceBackground } from "./space-background";

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "All Jobs", icon: ListVideo },
  { href: "/new", label: "New Mission", icon: PlusSquare },
  { href: "/4k-mission", label: "4K Mission", icon: MonitorPlay },
  { href: "/channel", label: "Channel Hub", icon: Youtube },
  { href: "/discover", label: "Discover", icon: Telescope },
  { href: "/logs", label: "Telemetry Logs", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLink({ href, label, icon: Icon, isActive, onClick }: {
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
          "flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200 cursor-pointer font-medium text-sm",
          isActive
            ? "bg-accent text-accent-foreground shadow-[inset_2px_0_0_0_hsl(var(--primary))]"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
        {label}
      </div>
    </Link>
  );
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { setMobileOpen(false); }, [location]);

  useEffect(() => {
    if (mobileOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const isActive = (href: string) =>
    location === href || (href !== "/" && location.startsWith(href));

  const SidebarContent = () => (
    <>
      <div className="h-16 flex items-center px-6 border-b border-border">
        <div className="flex items-center gap-2 text-primary font-display font-bold text-xl tracking-wider">
          <div className="w-4 h-4 bg-primary rounded-sm animate-pulse" />
          N3XUS
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.href}
            {...item}
            isActive={isActive(item.href)}
            onClick={() => setMobileOpen(false)}
          />
        ))}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="px-3 py-2 text-xs font-mono text-muted-foreground/50 tracking-widest uppercase">
          N3XUS v1.0
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex w-full bg-background selection:bg-primary/30">
      <SpaceBackground />

      <aside className="hidden lg:flex w-64 border-r border-border bg-card flex-col fixed inset-y-0 left-0 z-30">
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-72 bg-card border-r border-border flex flex-col transition-transform duration-300 ease-in-out lg:hidden",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="absolute top-3 right-3">
          <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <SidebarContent />
      </aside>

      <main className="flex-1 lg:pl-64 flex flex-col min-h-screen">
        <header className="lg:hidden sticky top-0 z-20 flex items-center gap-3 h-14 px-4 border-b border-border bg-card/95 backdrop-blur-sm">
          <button onClick={() => setMobileOpen(true)} className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors -ml-1">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 text-primary font-display font-bold text-lg tracking-wider">
            <div className="w-3 h-3 bg-primary rounded-sm animate-pulse" />
            N3XUS
          </div>
        </header>

        <div className="flex-1 p-4 pb-24 sm:p-6 sm:pb-24 lg:p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>

        <nav className="lg:hidden sticky bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur-sm">
          <div className="flex items-center justify-around px-2 py-1">
            {[navItems[0], navItems[1], navItems[2], navItems[3], navItems[7]].map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <div className={cn(
                    "flex flex-col items-center gap-1 px-2 py-2 rounded-lg transition-colors min-w-[48px]",
                    active ? "text-primary" : "text-muted-foreground"
                  )}>
                    <Icon className="w-5 h-5" />
                    <span className="text-[10px] font-medium leading-none truncate max-w-[48px] text-center">
                      {item.label === "New Mission" ? "New" :
                       item.label === "4K Mission" ? "4K" :
                       item.label === "Telemetry Logs" ? "Logs" :
                       item.label === "All Jobs" ? "Jobs" :
                       item.label === "Channel Hub" ? "Channel" :
                       item.label}
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
