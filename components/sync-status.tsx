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
    if (!time) return 'Never synced';

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
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {/* Online/Offline indicator */}
      <div
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-full',
          isOnline ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500'
        )}
      >
        {isOnline ? (
          <Cloud className="h-3 w-3" />
        ) : (
          <CloudOff className="h-3 w-3" />
        )}
        <span>{isOnline ? 'Online' : 'Offline'}</span>
      </div>

      {/* Sync status */}
      {isSyncing ? (
        <div className="flex items-center gap-1.5 text-primary">
          <RefreshCw className="h-3 w-3 animate-spin" />
          <span>Syncing...</span>
        </div>
      ) : pendingChanges > 0 ? (
        <button
          onClick={onSync}
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          title={`${pendingChanges} pending change${pendingChanges > 1 ? 's' : ''}`}
        >
          <AlertCircle className="h-3 w-3 text-amber-500" />
          <span>{pendingChanges} unsaved</span>
        </button>
      ) : (
        <div className="flex items-center gap-1.5">
          <Check className="h-3 w-3 text-green-500" />
          <span>Saved {formatLastSync(lastSyncTime)}</span>
        </div>
      )}
    </div>
  );
}
