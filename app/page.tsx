"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";
import {
  FileText,
  Github,
  Cloud,
  Folder,
  Tag,
  Wifi,
  Loader2,
} from "lucide-react";

function LandingContent() {
  const { user, isLoading, login, isAuthenticated } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      router.push("/notes");
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <div className="max-w-2xl mx-auto text-center">
          {/* Logo - minimal, clean */}
          <div className="mb-10 flex items-center justify-center">
            <div className="h-14 w-14 rounded-xl bg-foreground/5 border border-border flex items-center justify-center">
              <FileText className="h-7 w-7 text-foreground/70" />
            </div>
          </div>

          {/* Headline - clean, no gradients */}
          <h1 className="text-3xl sm:text-4xl font-semibold text-foreground mb-4 tracking-tight leading-tight">
            Your notes, synced to GitHub
          </h1>

          <p className="text-base text-muted-foreground mb-10 max-w-md mx-auto leading-relaxed">
            A minimal markdown notepad that stores your notes in your own GitHub
            repository. Write anywhere, own your data forever.
          </p>

          {/* Error message */}
          {error && (
            <div className="mb-8 p-3 bg-destructive/5 border border-destructive/10 rounded-lg text-destructive text-sm">
              {error === "auth_failed" &&
                "Authentication failed. Please try again."}
              {error === "no_code" && "No authorization code received."}
              {error === "token_exchange_failed" &&
                "Failed to complete authentication."}
            </div>
          )}

          {/* CTA Button - subtle, Notion-like */}
          {isLoading ? (
            <div className="h-10 w-44 mx-auto bg-muted animate-pulse rounded-md" />
          ) : (
            <Button
              size="lg"
              onClick={login}
              className="h-10 px-6 text-sm font-medium"
            >
              <Github className="mr-2 h-4 w-4" />
              Continue with GitHub
            </Button>
          )}

          {user && (
            <p className="mt-4 text-sm text-muted-foreground">
              Signed in as {user.name || user.login}
            </p>
          )}
        </div>

        {/* Features Grid - minimal cards */}
        <div className="mt-24 max-w-3xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-4 px-4">
          <FeatureCard
            icon={<Cloud className="h-5 w-5" />}
            title="GitHub Sync"
            description="Stored in your repo"
          />
          <FeatureCard
            icon={<Folder className="h-5 w-5" />}
            title="Organize"
            description="Folders and tags"
          />
          <FeatureCard
            icon={<FileText className="h-5 w-5" />}
            title="Markdown"
            description="Live preview"
          />
          <FeatureCard
            icon={<Wifi className="h-5 w-5" />}
            title="Offline"
            description="Works anywhere"
          />
        </div>
      </main>

      {/* Footer - minimal */}
      <footer className="py-6">
        <div className="max-w-3xl mx-auto px-4 flex items-center justify-center gap-6 text-xs text-muted-foreground">
          <span>
            &copy; {new Date().getFullYear()}{" "}
            <a
              href="https://github.com/KayUmoren004"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Godson Umoren
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="p-4 rounded-lg hover:bg-accent/50 transition-colors">
      <div className="text-muted-foreground mb-2">{icon}</div>
      <h3 className="text-sm font-medium text-foreground mb-0.5">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LandingContent />
    </Suspense>
  );
}
