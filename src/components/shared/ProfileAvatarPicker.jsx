import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { compressImage } from '@/lib/imageCompression';
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Upload, X, Camera } from "lucide-react";
import { toast } from "sonner";

// 40 unique icon options with emoji representations and colors
const ICON_OPTIONS = [
  { id: "bear", emoji: "🐻", bg: "bg-amber-100" },
  { id: "cat", emoji: "🐱", bg: "bg-orange-100" },
  { id: "dog", emoji: "🐶", bg: "bg-yellow-100" },
  { id: "fox", emoji: "🦊", bg: "bg-red-100" },
  { id: "lion", emoji: "🦁", bg: "bg-amber-100" },
  { id: "wolf", emoji: "🐺", bg: "bg-slate-100" },
  { id: "tiger", emoji: "🐯", bg: "bg-orange-100" },
  { id: "panda", emoji: "🐼", bg: "bg-slate-100" },
  { id: "rabbit", emoji: "🐰", bg: "bg-pink-100" },
  { id: "koala", emoji: "🐨", bg: "bg-blue-100" },
  { id: "monkey", emoji: "🐵", bg: "bg-yellow-100" },
  { id: "owl", emoji: "🦉", bg: "bg-amber-100" },
  { id: "eagle", emoji: "🦅", bg: "bg-yellow-100" },
  { id: "penguin", emoji: "🐧", bg: "bg-blue-100" },
  { id: "dolphin", emoji: "🐬", bg: "bg-cyan-100" },
  { id: "whale", emoji: "🐳", bg: "bg-sky-100" },
  { id: "octopus", emoji: "🐙", bg: "bg-rose-100" },
  { id: "butterfly", emoji: "🦋", bg: "bg-violet-100" },
  { id: "bee", emoji: "🐝", bg: "bg-yellow-100" },
  { id: "turtle", emoji: "🐢", bg: "bg-green-100" },
  { id: "star", emoji: "⭐", bg: "bg-yellow-100" },
  { id: "rocket", emoji: "🚀", bg: "bg-violet-100" },
  { id: "fire", emoji: "🔥", bg: "bg-red-100" },
  { id: "diamond", emoji: "💎", bg: "bg-cyan-100" },
  { id: "crown", emoji: "👑", bg: "bg-amber-100" },
  { id: "lightning", emoji: "⚡", bg: "bg-yellow-100" },
  { id: "heart", emoji: "❤️", bg: "bg-red-100" },
  { id: "rainbow", emoji: "🌈", bg: "bg-purple-100" },
  { id: "sun", emoji: "☀️", bg: "bg-amber-100" },
  { id: "moon", emoji: "🌙", bg: "bg-violet-100" },
  { id: "flower", emoji: "🌸", bg: "bg-pink-100" },
  { id: "tree", emoji: "🌳", bg: "bg-green-100" },
  { id: "mountain", emoji: "⛰️", bg: "bg-slate-100" },
  { id: "wave", emoji: "🌊", bg: "bg-blue-100" },
  { id: "snowflake", emoji: "❄️", bg: "bg-sky-100" },
  { id: "music", emoji: "🎵", bg: "bg-purple-100" },
  { id: "paint", emoji: "🎨", bg: "bg-rose-100" },
  { id: "trophy", emoji: "🏆", bg: "bg-yellow-100" },
  { id: "target", emoji: "🎯", bg: "bg-red-100" },
  { id: "globe", emoji: "🌍", bg: "bg-emerald-100" },
];

export function getIconById(iconId) {
  return ICON_OPTIONS.find(i => i.id === iconId);
}

export { ICON_OPTIONS };

export default function ProfileAvatarPicker({ user, onUpdate }) {
  const [isOpen, setIsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const currentIcon = user?.profile_icon ? getIconById(user.profile_icon) : null;
  const initials = user?.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2) || 'U';

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('ניתן להעלות רק קבצי תמונה');
      return;
    }

    setUploading(true);
    const compressed = await compressImage(file, { maxSizeMB: 0.2, maxWidthOrHeight: 400 });
    const { file_url } = await base44.integrations.Core.UploadFile({ file: compressed });
    await base44.auth.updateMe({ profile_image_url: file_url, profile_icon: '' });
    onUpdate?.();
    setUploading(false);
    setIsOpen(false);
    toast.success('תמונת הפרופיל עודכנה');
  };

  const handleIconSelect = async (iconId) => {
    await base44.auth.updateMe({ profile_icon: iconId, profile_image_url: '' });
    onUpdate?.();
    setIsOpen(false);
    toast.success('אייקון הפרופיל עודכן');
  };

  const handleRemoveAvatar = async () => {
    await base44.auth.updateMe({ profile_icon: '', profile_image_url: '' });
    onUpdate?.();
    setIsOpen(false);
    toast.success('תמונת הפרופיל הוסרה');
  };

  return (
    <>
      <div className="relative group cursor-pointer" onClick={() => setIsOpen(true)}>
        <Avatar className="h-16 w-16 ring-2 ring-white shadow-md">
          {user?.profile_image_url ? (
            <AvatarImage src={user.profile_image_url} alt={user.full_name} />
          ) : null}
          <AvatarFallback className="bg-primary/10 text-primary text-xl">
            {currentIcon ? (
              <span className="text-2xl">{currentIcon.emoji}</span>
            ) : initials}
          </AvatarFallback>
        </Avatar>
        <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Camera className="h-5 w-5 text-white" />
        </div>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>בחר תמונת פרופיל</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Upload photo */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                העלה תמונה מהמחשב
              </Button>
            </div>

            {/* Icon gallery */}
            <div>
              <p className="text-sm font-medium text-foreground/80 mb-2">או בחר אייקון:</p>
              <div className="grid grid-cols-8 gap-2 max-h-64 overflow-y-auto p-1">
                {ICON_OPTIONS.map((icon) => (
                  <button
                    key={icon.id}
                    onClick={() => handleIconSelect(icon.id)}
                    className={`h-10 w-10 rounded-lg flex items-center justify-center text-xl transition-all hover:scale-105 hover:shadow-sm ${icon.bg} ${
                      user?.profile_icon === icon.id ? 'ring-1 ring-primary/50 shadow-[0_0_0_1px_rgba(79,70,229,0.2),0_2px_8px_rgba(79,70,229,0.1)] scale-110' : ''
                    }`}
                  >
                    {icon.emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* Remove */}
            {(user?.profile_image_url || user?.profile_icon) && (
              <Button
                variant="ghost"
                className="w-full text-red-500 hover:text-red-700 hover:bg-red-50 gap-2"
                onClick={handleRemoveAvatar}
              >
                <X className="h-4 w-4" />
                הסר תמונת פרופיל
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}