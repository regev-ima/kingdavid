import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/api/supabaseClient';
import { Loader2, Play } from 'lucide-react';

// Voicenter exposes recording URLs over HTTP only, so the browser blocks them
// as Mixed Content when the app is served over HTTPS. We fetch them through
// the streamRecording edge function (authenticated) and play a blob URL.
export default function RecordingPlayer({ callLogId, hasRecording, autoLoad = false }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);

  const handleLoad = useCallback(async () => {
    if (!hasRecording || !callLogId) return;
    setLoading((current) => {
      if (current) return current;
      return true;
    });
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const resp = await fetch(
        `${supabaseUrl}/functions/v1/streamRecording?id=${encodeURIComponent(callLogId)}`,
        {
          headers: {
            Authorization: `Bearer ${session?.access_token ?? ''}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        },
      );
      if (!resp.ok) {
        let detail = '';
        try {
          const data = await resp.json();
          detail = data?.error || data?.upstreamBodyPreview || '';
        } catch {
          // ignore
        }
        throw new Error(detail ? `${resp.status}: ${detail}` : `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
      setTimeout(() => audioRef.current?.play().catch(() => {}), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה');
    } finally {
      setLoading(false);
    }
  }, [callLogId, hasRecording]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  useEffect(() => {
    if (autoLoad && hasRecording && !blobUrl && !loading) {
      handleLoad();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, hasRecording, callLogId]);

  if (!hasRecording) {
    return <span className="text-muted-foreground/70 text-xs">אין הקלטה</span>;
  }

  if (blobUrl) {
    return <audio ref={audioRef} controls src={blobUrl} className="h-8 w-48" />;
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-8"
      onClick={handleLoad}
      disabled={loading}
      title={error || undefined}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Play className="h-3.5 w-3.5 me-1" />
      )}
      {loading ? 'טוען...' : error ? 'נסה שוב' : 'נגן הקלטה'}
    </Button>
  );
}
