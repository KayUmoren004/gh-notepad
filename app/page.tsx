'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth-provider';
import { FileText, Github, Cloud, Folder, Tag, Wifi, Loader2 } from 'lucide-react';

function LandingContent() {
  const { user, isLoading, login, isAuthenticated } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      router.push('/notes');
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <div className="max-w-3xl mx-auto text-center">
          {/* Logo */}
          <div className="mb-8 flex items-center justify-center">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <FileText className="h-8 w-8 text-white" />
            </div>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground mb-4 tracking-tight">
            Your notes,{' '}
            <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
              synced to GitHub
            </span>
          </h1>

          <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
            A beautiful markdown notepad that stores your notes in your own GitHub repository.
            Write anywhere, sync everywhere, own your data forever.
          </p>

          {/* Error message */}
          {error && (
            <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
              {error === 'auth_failed' && 'Authentication failed. Please try again.'}
              {error === 'no_code' && 'No authorization code received.'}
              {error === 'token_exchange_failed' && 'Failed to complete authentication.'}
            </div>
          )}

          {/* CTA Button */}
          {isLoading ? (
            <div className="h-12 w-48 mx-auto bg-muted animate-pulse rounded-lg" />
          ) : (
            <Button
              size="lg"
              onClick={login}
              className="h-12 px-8 text-base font-medium bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-lg shadow-indigo-500/25"
            >
              <Github className="mr-2 h-5 w-5" />
              Sign in with GitHub
            </Button>
          )}

          {user && (
            <p className="mt-4 text-sm text-muted-foreground">
              Signed in as {user.name || user.login}
            </p>
          )}
        </div>

        {/* Features Grid */}
        <div className="mt-20 max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 px-4">
          <FeatureCard
            icon={<Cloud className="h-6 w-6" />}
            title="GitHub Sync"
            description="Notes stored as files in your own repository"
          />
          <FeatureCard
            icon={<Folder className="h-6 w-6" />}
            title="Organize"
            description="Keep notes tidy with folders and tags"
          />
          <FeatureCard
            icon={<FileText className="h-6 w-6" />}
            title="Markdown"
            description="Rich formatting with live preview"
          />
          <FeatureCard
            icon={<Wifi className="h-6 w-6" />}
            title="Offline First"
            description="Works without internet, syncs when online"
          />
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 border-t border-border">
        <div className="max-w-4xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <p>Built with Next.js and GitHub API</p>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              GitHub
            </a>
          </div>
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
    <div className="p-5 rounded-xl bg-card border border-border hover:border-muted-foreground/25 transition-colors">
      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-3">
        {icon}
      </div>
      <h3 className="font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <LandingContent />
    </Suspense>
  );
}
