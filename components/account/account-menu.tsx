"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { SignOutButton } from "./sign-out-button";

export interface AccountMember {
  id: number;
  login: string;
  avatarUrl: string;
}

/** Who is signed in, and the way out: the sign-out button with its keep-or-remove dialog. */
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
      <div className="-mr-1 shrink-0 text-muted-foreground">
        <SignOutButton account={{ id: member.id, login: member.login }} />
      </div>
    </div>
  );
}
