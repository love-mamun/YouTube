import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <Layout>
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-md border-border bg-card">
          <CardContent className="pt-8 pb-8">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <h1 className="text-2xl font-display font-bold text-foreground">404 — Not Found</h1>
            </div>
            <p className="text-sm text-muted-foreground font-mono mb-6">
              This page doesn't exist. Check the URL or head back to mission control.
            </p>
            <Link href="/" className="text-primary text-sm font-mono hover:underline">
              ← Return to Dashboard
            </Link>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
