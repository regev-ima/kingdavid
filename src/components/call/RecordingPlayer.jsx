import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Headphones, Play } from 'lucide-react';

// Voicenter recordings live behind their cPanel, which authenticates the
// listener via a browser session cookie on cpanel.voicenter.co.il. A
// server-side proxy can't carry that cookie, so we just open the URL inside
// an iframe (or new tab) and let the browser handle the session.
export default function RecordingPlayer({ recordingUrl, hasRecording }) {
  const [open, setOpen] = useState(false);

  if (!hasRecording || !recordingUrl) {
    return <span className="text-muted-foreground/70 text-xs">אין הקלטה</span>;
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        onClick={() => setOpen(true)}
      >
        <Play className="h-3.5 w-3.5 me-1" />
        נגן הקלטה
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[760px]" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Headphones className="h-5 w-5 text-primary" />
              הקלטת שיחה
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <div className="bg-gradient-to-br from-primary/5 to-purple-50/50 rounded-lg p-4">
              <iframe
                src={recordingUrl}
                className="w-full h-[300px] border-0 rounded-lg"
                title="הקלטת שיחה"
                allow="autoplay"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-3 text-center">
              ההקלטה מתנגנת מ-VoiceCenter
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
