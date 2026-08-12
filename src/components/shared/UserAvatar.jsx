import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useRepIdentities } from "@/hooks/useRepIdentities";

export default function UserAvatar({ user, size = "md", className = "" }) {
  const sizeClasses = {
    xs: "h-6 w-6 text-[10px]",
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-16 w-16 text-xl",
  };

  const iconSizes = {
    xs: "text-sm",
    sm: "text-base",
    md: "text-lg",
    lg: "text-2xl",
  };

  const initials = user?.full_name
    ? user.full_name.split(' ').map(n => n[0]).join('').slice(0, 2)
    : 'U';

  // The rep's assigned colour + icon — unique across the team, so the same
  // person looks the same on every screen and no two people look alike. A rep
  // who uploaded a real photo keeps it; a photo is already unmistakably theirs.
  const { identityFor } = useRepIdentities();
  const identity = identityFor(user);

  return (
    <Avatar className={`${sizeClasses[size] || sizeClasses.md} ${className}`}>
      {user?.profile_image_url ? (
        <AvatarImage src={user.profile_image_url} alt={user?.full_name} />
      ) : null}
      <AvatarFallback className={`font-semibold ${identity.chip}`}>
        {identity.emoji ? (
          <span className={iconSizes[size] || iconSizes.md}>{identity.emoji}</span>
        ) : initials}
      </AvatarFallback>
    </Avatar>
  );
}
