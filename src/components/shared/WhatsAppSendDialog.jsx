import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, MessageCircle, AlertCircle } from 'lucide-react';

// Small status popup for "send via WhatsApp". The owning page drives `state`:
//   { status: 'preparing' }            — building the PDF link
//   { status: 'ready', url }           — message ready; user clicks to open WA
//   { status: 'error', msg }           — something failed
//
// Why a modal: (1) it gives instant feedback while the (slow) PDF is prepared,
// (2) its overlay masks the brief page reflow the html2canvas render causes,
// and (3) opening WhatsApp from the button here is a fresh user click, so the
// browser doesn't pop-up-block it (window.open right after an await does).
export default function WhatsAppSendDialog({ state, onClose }) {
  return (
    <Dialog open={!!state} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center">שליחה ב-WhatsApp</DialogTitle>
        </DialogHeader>

        {state?.status === 'preparing' && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="font-medium">מכין את ההודעה…</p>
            <p className="text-xs text-muted-foreground">יוצר את המסמך ומכין קישור — רגע אחד</p>
          </div>
        )}

        {state?.status === 'ready' && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
              <MessageCircle className="h-6 w-6 text-green-600" />
            </div>
            <p className="font-medium">ההודעה מוכנה לשליחה</p>
            <Button
              onClick={() => { window.open(state.url, '_blank', 'noopener'); onClose(); }}
              className="gap-2 bg-green-600 hover:bg-green-700 w-full"
            >
              <MessageCircle className="h-4 w-4" />
              פתח את WhatsApp
            </Button>
          </div>
        )}

        {state?.status === 'error' && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <p className="font-medium">הכנת ההודעה נכשלה</p>
            <p className="text-xs text-muted-foreground">{state.msg}</p>
            <Button variant="outline" onClick={onClose} className="w-full">סגור</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
