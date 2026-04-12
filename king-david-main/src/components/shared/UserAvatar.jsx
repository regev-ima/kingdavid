import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getIconById } from "./ProfileAvatarPicker";

export default function UserAvatar({ user, size = "md", className = "" }) {
  const sizeClasses = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-16 w-16 text-xl",
  };

  const iconSizes = {
    sm: "text-base",
    md: "text-lg",
    lg: "text-2xl",
  };

  const initials = user?.full_name
    ? user.full_name.split(' ').map(n => n[0]).join('').slice(0, 2)
    : 'U';

  const currentIcon = user?.profile_icon ? getIconById(user.profile_icon) : null;

  const colors = [
    'bg-indigo-50 text-indigo-700',
    'bg-violet-50 text-violet-700',
    'bg-emerald-50 text-emerald-700',
    'bg-amber-50 text-amber-700',
    'bg-rose-50 text-rose-700',
  ];
  const colorIndex = user?.full_name ? user.full_name.charCodeAt(0) % colors.length : 0;

  return (
    <Avatar className={`${sizeClasses[size]} ${className}`}>
      {user?.profile_image_url ? (
        <AvatarImage src={user.profile_image_url} alt={user?.full_name} />
      ) : null}
      <AvatarFallback className={`font-semibold ${currentIcon ? currentIcon.bg : colors[colorIndex]}`}>
        {currentIcon ? (
          <span className={iconSizes[size]}>{currentIcon.emoji}</span>
        ) : initials}
      </AvatarFallback>
    </Avatar>
  );
}