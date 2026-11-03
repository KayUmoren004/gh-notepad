"use client";

import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AccountMember {
  login: string;
  avatarUrl: string;
}

/**
 * Who is signed in, and the way out. The sign-out control lives only here, so
 * the sign-out dialog (keep or remove this device's notes) can replace the
 * plain form in one place.
 */
export function AccountMenu({ member, className }: { member: AccountMember; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <Avatar className="size-6">
        <AvatarImage src={member.avatarUrl} alt={member.login} />
        <AvatarFallback className="text-xs">{member.login.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={member.login}>
        {member.login}
      </span>
      <form action="/api/auth/logout" method="post" className="shrink-0">
        <Button type="submit" variant="ghost" size="icon-sm" aria-label="Sign out" title="Sign out" className="text-muted-foreground">
          <LogOut aria-hidden />
        </Button>
      </form>
    </div>
  );
}
