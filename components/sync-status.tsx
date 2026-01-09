'use client';

import { Cloud, CloudOff, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SyncStatus as SyncStatusType } from '@/lib/types';

interface SyncStatusProps {
  status: SyncStatusType;
  onSync?: () => void;
}

export function SyncStatus({ status, onSync }: SyncStatusProps) {
  const { isOnline, isSyncing, lastSyncTime, pendingChanges } = status;

  const formatLastSync = (time: string | null) => {
    if (!time) return 'Never';

    const date = new Date(time);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;

    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      {/* Sync status */}
      {isSyncing ? (
        <div className="flex items-center gap-1">
          <RefreshCw className="h-3 w-3 animate-spin" />
          <span>Syncing</span>
        </div>
      ) : pendingChanges > 0 ? (
        <button
          onClick={onSync}
          className="flex items-center gap-1 hover:text-foreground transition-colors"
          title={`${pendingChanges} pending`}
        >
          <AlertCircle className="h-3 w-3 text-amber-500/80" />
          <span>{pendingChanges} unsaved</span>
        </button>
      ) : (
        <div className="flex items-center gap-1">
          <Check className="h-3 w-3 text-muted-foreground/60" />
          <span>{formatLastSync(lastSyncTime)}</span>
        </div>
      )}

      {/* Online/Offline - minimal indicator */}
      {!isOnline && (
        <div className="flex items-center gap-1 text-amber-500/80">
          <CloudOff className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}
