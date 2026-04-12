import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import StatusBadge from '@/components/shared/StatusBadge';
import { useImpersonation } from '@/components/shared/ImpersonationContext';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserPlus, Users, AlertCircle, CheckCircle, Loader2, Clock, FileSpreadsheet, Eye, UserX, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from 'date-fns';
import { he } from 'date-fns/locale';
import UserAvatar from '@/components/shared/UserAvatar';
import { canAccessAdminOnly } from '@/lib/rbac';

export default function Representatives() {
  const [user, setUser] = useState(null);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('sales_user');
  const [selectedRep, setSelectedRep] = useState(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [repToDeactivate, setRepToDeactivate] = useState(null);
  const [transferToRep, setTransferToRep] = useState('');
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [oldRepEmail, setOldRepEmail] = useState('');
  const [newRepEmail, setNewRepEmail] = useState('');
  const [transferProgress, setTransferProgress] = useState(null);
  const [transferTaskName, setTransferTaskName] = useState('');
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [importResults, setImportResults] = useState(null);
  const [columnMapping, setColumnMapping] = useState({});
  const [availableColumns, setAvailableColumns] = useState([]);
  const [step, setStep] = useState(1);
  const queryClient = useQueryClient();
  const { startImpersonation, getEffectiveUser } = useImpersonation();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await base44.auth.me();
        setUser(userData);
      } catch (err) {}
    };
    fetchUser();
  }, []);

  const { data: reps = [], isLoading: repsLoading } = useQuery({
    queryKey: ['reps'],
    queryFn: () => base44.entities.User.list(),
  });

  const { data: leadCounters = [] } = useQuery({
    queryKey: ['leadCounters'],
    queryFn: () => base44.entities.LeadCounter.list(),
  });

  const { data: leads = [], isLoading: leadsLoading } = useQuery({
    queryKey: ['leads'],
    queryFn: () => base44.entities.Lead.list(),
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ['quotes'],
    queryFn: () => base44.entities.Quote.list(),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: () => base44.entities.Customer.list(),
  });

  const { data: orders = [] } = useQuery({
    queryKey: ['orders'],
    queryFn: () => base44.entities.Order.list(),
  });

  const inviteUserMutation = useMutation({
    mutationFn: async ({ email, role }) => {
      await base44.users.inviteUser(email, role);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['reps']);
      setShowInviteDialog(false);
      setInviteEmail('');
      setInviteRole('sales_user');
    },
  });

  const updateRepMutation = useMutation({
    mutationFn: ({ repId, data }) => base44.entities.User.update(repId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['reps']);
    },
  });

  const fetchColumnsMutation = useMutation({
    mutationFn: async ({ spreadsheet_id, sheet_name }) => {
      const response = await base44.functions.invoke('fetchSheetsColumns', {
        spreadsheet_id,
        sheet_name,
      });
      return response.data.columns;
    },
    onSuccess: (columns) => {
      setAvailableColumns(columns);
      setStep(2);
    },
  });

  const importUsersMutation = useMutation({
    mutationFn: async ({ spreadsheet_id, sheet_name, column_mapping }) => {
      const response = await base44.functions.invoke('importUsersFromSheets', {
        spreadsheet_id,
        sheet_name,
        column_mapping,
      });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries(['reps']);
      setImportResults(data.results);
      setStep(3);
    },
  });

  const transferRepDataMutation = useMutation({
    mutationFn: async ({ oldEmail, newEmail }) => {
      const response = await base44.functions.invoke('transferRepData', {
        oldEmail,
        newEmail
      });
      return response.data;
    },
    onSuccess: (data) => {
      if (data.taskName) {
        setTransferTaskName(data.taskName);
      }
      queryClient.invalidateQueries(['reps']);
      queryClient.invalidateQueries(['leads']);
      queryClient.invalidateQueries(['quotes']);
      queryClient.invalidateQueries(['customers']);
      queryClient.invalidateQueries(['orders']);
    },
  });

  // Poll for transfer progress
  const { data: progressData } = useQuery({
    queryKey: ['transferProgress', transferTaskName],
    queryFn: async () => {
      if (!transferTaskName) return null;
      const results = await base44.entities.SyncProgress.filter({ task_name: transferTaskName });
      return results[0] || null;
    },
    enabled: !!transferTaskName && !transferProgress?.status?.includes('completed'),
    refetchInterval: 1000,
  });

  useEffect(() => {
    if (progressData) {
      setTransferProgress(progressData);
      if (progressData.status === 'completed') {
        setTimeout(() => {
          setShowTransferDialog(false);
          setOldRepEmail('');
          setNewRepEmail('');
          setTransferProgress(null);
          setTransferTaskName('');
        }, 2000);
      }
    }
  }, [progressData]);

  const deactivateRepMutation = useMutation({
    mutationFn: async ({ repEmail, transferEmail }) => {
      // Transfer all leads
      const repLeads = leads.filter(l => l.rep1 === repEmail || l.rep2 === repEmail);
      for (const lead of repLeads) {
        const updates = {};
        if (lead.rep1 === repEmail) updates.rep1 = transferEmail;
        if (lead.rep2 === repEmail) updates.rep2 = transferEmail;
        await base44.entities.Lead.update(lead.id, updates);
      }

      // Transfer all quotes
      const repQuotes = quotes.filter(q => q.created_by_rep === repEmail);
      for (const quote of repQuotes) {
        await base44.entities.Quote.update(quote.id, { created_by_rep: transferEmail });
      }

      // Transfer all customers
      const repCustomers = customers.filter(c => c.account_manager === repEmail);
      for (const customer of repCustomers) {
        await base44.entities.Customer.update(customer.id, { account_manager: transferEmail });
      }

      // Transfer all orders
      const repOrders = orders.filter(o => o.rep1 === repEmail || o.rep2 === repEmail);
      for (const order of repOrders) {
        const updates = {};
        if (order.rep1 === repEmail) updates.rep1 = transferEmail;
        if (order.rep2 === repEmail) updates.rep2 = transferEmail;
        await base44.entities.Order.update(order.id, updates);
      }

      // Deactivate the rep
      const rep = reps.find(r => r.email === repEmail);
      await base44.entities.User.update(rep.id, { is_active: false });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['reps']);
      queryClient.invalidateQueries(['leads']);
      queryClient.invalidateQueries(['quotes']);
      queryClient.invalidateQueries(['customers']);
      queryClient.invalidateQueries(['orders']);
      setShowDeactivateDialog(false);
      setRepToDeactivate(null);
      setTransferToRep('');
    },
  });

  const handleInvite = (e) => {
    e.preventDefault();
    if (inviteEmail) {
      inviteUserMutation.mutate({ email: inviteEmail, role: inviteRole });
    }
  };

  const handleFetchColumns = (e) => {
    e.preventDefault();
    if (spreadsheetId && sheetName) {
      fetchColumnsMutation.mutate({ 
        spreadsheet_id: spreadsheetId, 
        sheet_name: sheetName 
      });
    }
  };

  const handleImport = (e) => {
    e.preventDefault();
    if (spreadsheetId && sheetName && columnMapping) {
      setImportResults(null);
      importUsersMutation.mutate({ 
        spreadsheet_id: spreadsheetId, 
        sheet_name: sheetName,
        column_mapping: columnMapping
      });
    }
  };

  const resetImport = () => {
    setShowImportDialog(false);
    setSpreadsheetId('');
    setSheetName('');
    setImportResults(null);
    setColumnMapping({});
    setAvailableColumns([]);
    setStep(1);
  };

  const handleImpersonate = (rep) => {
    if (canAccessAdminOnly(getEffectiveUser(user))) {
      startImpersonation(user, rep);
      navigate(createPageUrl('Dashboard'));
    }
  };

  const handleDeactivateClick = (rep) => {
    setRepToDeactivate(rep);
    setShowDeactivateDialog(true);
  };

  const handleDeactivate = (e) => {
    e.preventDefault();
    if (repToDeactivate && transferToRep) {
      deactivateRepMutation.mutate({
        repEmail: repToDeactivate.email,
        transferEmail: transferToRep,
      });
    }
  };

  const handleTransferData = (e) => {
    e.preventDefault();
    if (oldRepEmail && newRepEmail) {
      setTransferProgress({ status: 'in_progress', current_offset: 0 });
      transferRepDataMutation.mutate({
        oldEmail: oldRepEmail,
        newEmail: newRepEmail,
      });
    }
  };

  const getStepLabel = (step) => {
    const labels = {
      initializing: 'מאתחל...',
      leads: 'מעביר לידים',
      salesTasks: 'מעביר משימות מכירה',
      orders: 'מעביר הזמנות',
      quotes: 'מעביר הצעות מחיר',
      customers: 'מעביר לקוחות',
      commissions: 'מעביר עמלות',
      tickets: 'מעביר קריאות שירות',
      callLogs: 'מעביר יומני שיחות',
      completed: 'הושלם!'
    };
    return labels[step] || step;
  };

  const getRepAssignmentCounts = (repEmail) => {
    const leadsCount = leads.filter(l => l.rep1 === repEmail || l.rep2 === repEmail).length;
    const quotesCount = quotes.filter(q => q.created_by_rep === repEmail).length;
    const customersCount = customers.filter(c => c.account_manager === repEmail).length;
    const ordersCount = orders.filter(o => o.rep1 === repEmail || o.rep2 === repEmail).length;
    
    return { leadsCount, quotesCount, customersCount, ordersCount };
  };

  const getRepStats = (repEmail) => {
    // Get stats from LeadCounter entity for accurate counts
    const totalCounter = leadCounters.find(c => c.rep_email === repEmail && c.counter_key === 'total');
    const closedCounter = leadCounters.find(c => c.rep_email === repEmail && c.counter_key === 'deal_closed');
    
    const total = totalCounter?.count || 0;
    const won = closedCounter?.count || 0;
    
    // Calculate active leads (total minus closed)
    const active = total - won;

    return {
      total,
      won,
      active,
      new: 0,
      assigned: 0,
      contacted: 0,
      qualified: 0,
      quote_sent: 0,
      negotiating: 0,
      lost: 0,
    };
  };

  const canImpersonateRep = (rep) => {
    if (!rep) return false;
    if (rep.email === user?.email) return false;
    return rep.role !== 'admin';
  };

  const effectiveUser = getEffectiveUser(user);
  const isAdmin = canAccessAdminOnly(effectiveUser);

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
        <p className="text-muted-foreground">רק מנהלים יכולים לגשת לאזור הנציגים</p>
      </div>
    );
  }

  const activeReps = reps.filter(r => r.is_active !== false);
  const inactiveReps = reps.filter(r => r.is_active === false);
  const availableRepsForTransfer = activeReps.filter(r => r.email !== repToDeactivate?.email);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">ניהול נציגים</h1>
          <p className="text-muted-foreground">נהל את צוות המכירות והזמן נציגים חדשים</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={showTransferDialog} onOpenChange={setShowTransferDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100">
                <RefreshCw className="h-4 w-4 ml-2" />
                העבר נתונים בין נציגים
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>העברת נתונים בין נציגים</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleTransferData} className="space-y-4">
                <div className="space-y-2">
                  <Label>ממייל נציג ישן</Label>
                  <Input
                    type="email"
                    placeholder="danielkingdavid@gmail.com"
                    value={oldRepEmail}
                    onChange={(e) => setOldRepEmail(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    הזן את המייל הישן שממנו תרצה להעביר את הנתונים (גם אם הנציג לא התחבר עדיין)
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>למייל נציג חדש</Label>
                  <Input
                    type="email"
                    placeholder="danielzolai4@gmail.com"
                    value={newRepEmail}
                    onChange={(e) => setNewRepEmail(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    הזן את המייל החדש אליו תרצה להעביר את הנתונים
                  </p>
                </div>
                {!transferProgress || transferProgress.status === 'idle' ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p className="text-sm text-amber-800">
                      פעולה זו תעביר את כל הלידים, משימות המכירה, הצעות המחיר, הלקוחות, ההזמנות, העמלות, הקריאות לשירות ולוגים ממייל הנציג הישן למייל הנציג החדש.
                    </p>
                    <p className="text-sm text-amber-700 mt-2 font-medium">
                      💡 תוכל לסגור את החלון והפעולה תמשיך לרוץ ברקע
                    </p>
                  </div>
                ) : (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-blue-900">
                        {getStepLabel(transferProgress.metadata?.step)}
                      </span>
                      <span className="text-sm font-bold text-blue-700">
                        {transferProgress.current_offset || 0}%
                      </span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-2.5">
                      <div 
                        className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                        style={{ width: `${transferProgress.current_offset || 0}%` }}
                      />
                    </div>
                    {transferProgress.status === 'completed' && (
                      <div className="flex items-center gap-2 text-green-700">
                        <CheckCircle className="h-5 w-5" />
                        <span className="text-sm font-medium">העברת הנתונים הושלמה בהצלחה!</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowTransferDialog(false);
                      setOldRepEmail('');
                      setNewRepEmail('');
                      setTransferProgress(null);
                      setTransferTaskName('');
                    }}
                  >
                    {transferProgress?.status === 'in_progress' ? 'סגור (ממשיך ברקע)' : 'סגור'}
                  </Button>
                  {(!transferProgress || transferProgress.status !== 'in_progress') && (
                    <Button
                      type="submit"
                      disabled={transferRepDataMutation.isPending || !oldRepEmail || !newRepEmail}
                      className="bg-purple-600 hover:bg-purple-700"
                    >
                      {transferRepDataMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                          מעביר...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 ml-2" />
                          העבר נתונים
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <FileSpreadsheet className="h-4 w-4 me-2" />
                ייבא מגוגל שיטס
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>ייבא נציגים מגוגל שיטס</DialogTitle>
              </DialogHeader>
              
              {step === 1 && (
                <form onSubmit={handleFetchColumns} className="space-y-4">
                  <div className="space-y-2">
                    <Label>מזהה הגיליון (Spreadsheet ID)</Label>
                    <Input
                      placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                      value={spreadsheetId}
                      onChange={(e) => setSpreadsheetId(e.target.value)}
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      ניתן למצוא ב-URL של הגיליון, בין /d/ ו-/edit
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>שם הגיליון (Sheet Name)</Label>
                    <Input
                      placeholder="Sheet1"
                      value={sheetName}
                      onChange={(e) => setSheetName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex justify-end gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetImport}
                    >
                      ביטול
                    </Button>
                    <Button
                      type="submit"
                      disabled={fetchColumnsMutation.isPending}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {fetchColumnsMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 me-2 animate-spin" />
                          טוען...
                        </>
                      ) : (
                        'הבא'
                      )}
                    </Button>
                  </div>
                </form>
              )}

              {step === 2 && (
                <form onSubmit={handleImport} className="space-y-4">
                  <p className="text-sm text-muted-foreground">התאם את העמודות מהגיליון לשדות במערכת:</p>
                  
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>אימייל (חובה)</Label>
                      <Select 
                        value={columnMapping.email} 
                        onValueChange={(value) => setColumnMapping({...columnMapping, email: value})}
                        required
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="בחר עמודה" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableColumns.map((col, idx) => (
                            <SelectItem key={idx} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>שם מלא (חובה)</Label>
                      <Select 
                        value={columnMapping.full_name} 
                        onValueChange={(value) => setColumnMapping({...columnMapping, full_name: value})}
                        required
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="בחר עמודה" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableColumns.map((col, idx) => (
                            <SelectItem key={idx} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>תפקיד (אופציונלי)</Label>
                      <Select 
                        value={columnMapping.role} 
                        onValueChange={(value) => setColumnMapping({...columnMapping, role: value})}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="דלג על שדה זה" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableColumns.map((col, idx) => (
                            <SelectItem key={idx} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>טלפון (אופציונלי)</Label>
                      <Select 
                        value={columnMapping.phone} 
                        onValueChange={(value) => setColumnMapping({...columnMapping, phone: value})}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="דלג על שדה זה" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableColumns.map((col, idx) => (
                            <SelectItem key={idx} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>מספר שלוחה (אופציונלי)</Label>
                      <Select 
                        value={columnMapping.voicenter_extension} 
                        onValueChange={(value) => setColumnMapping({...columnMapping, voicenter_extension: value})}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="דלג על שדה זה" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableColumns.map((col, idx) => (
                            <SelectItem key={idx} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>אחוז עמלה (אופציונלי)</Label>
                      <Select 
                        value={columnMapping.commission_rate} 
                        onValueChange={(value) => setColumnMapping({...columnMapping, commission_rate: value})}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="דלג על שדה זה" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableColumns.map((col, idx) => (
                            <SelectItem key={idx} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>פעיל במערכת (אופציונלי)</Label>
                      <Select 
                        value={columnMapping.is_active} 
                        onValueChange={(value) => setColumnMapping({...columnMapping, is_active: value})}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="דלג על שדה זה" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableColumns.map((col, idx) => (
                            <SelectItem key={idx} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStep(1)}
                    >
                      חזור
                    </Button>
                    <Button
                      type="submit"
                      disabled={importUsersMutation.isPending || !columnMapping.email || !columnMapping.full_name}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {importUsersMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 me-2 animate-spin" />
                          מייבא...
                        </>
                      ) : (
                        <>
                          <FileSpreadsheet className="h-4 w-4 me-2" />
                          התחל ייבוא
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              )}

              {step === 3 && importResults && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-green-700">
                    <CheckCircle className="h-5 w-5" />
                    <span className="font-medium">הייבוא הושלם</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-green-50 rounded-lg">
                      <p className="text-sm text-muted-foreground">הצליחו</p>
                      <p className="text-2xl font-bold text-green-700">{importResults.success}</p>
                    </div>
                    <div className="p-4 bg-red-50 rounded-lg">
                      <p className="text-sm text-muted-foreground">נכשלו</p>
                      <p className="text-2xl font-bold text-red-700">{importResults.failed}</p>
                    </div>
                  </div>
                  {importResults.errors.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-red-700">שגיאות:</p>
                      <div className="max-h-40 overflow-y-auto space-y-1 p-3 bg-red-50 rounded-lg">
                        {importResults.errors.map((error, idx) => (
                          <p key={idx} className="text-xs text-red-600">• {error}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  <Button onClick={resetImport} className="w-full">
                    סגור
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
          <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="h-4 w-4 me-2" />
                הזמן נציג חדש
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>הזמן נציג חדש</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleInvite} className="space-y-4">
                <div className="space-y-2">
                  <Label>כתובת אימייל</Label>
                  <Input
                    type="email"
                    placeholder="rep@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>תפקיד</Label>
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">מנהל מערכת (ADMIN)</SelectItem>
                      <SelectItem value="sales_user">נציג מכירות (SALES_USER)</SelectItem>
                      <SelectItem value="factory_user">נציג מפעל (FACTORY_USER)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowInviteDialog(false)}
                  >
                    ביטול
                  </Button>
                  <Button
                    type="submit"
                    disabled={inviteUserMutation.isPending}
                    className=""
                  >
                    {inviteUserMutation.isPending ? (
                      <Loader2 className="h-4 w-4 me-2 animate-spin" />
                    ) : (
                      <UserPlus className="h-4 w-4 me-2" />
                    )}
                    שלח הזמנה
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Statistics Overview */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">נציגים פעילים</p>
                <p className="text-2xl font-bold">{activeReps.length}</p>
              </div>
              <Users className="h-10 w-10 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">נציגים מושבתים</p>
                <p className="text-2xl font-bold">{inactiveReps.length}</p>
              </div>
              <UserX className="h-10 w-10 text-red-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">הוזמנו ולא נכנסו</p>
                <p className="text-2xl font-bold">
                  {activeReps.filter(r => !r.last_login).length}
                </p>
              </div>
              <Clock className="h-10 w-10 text-amber-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Deactivate Dialog */}
      <Dialog open={showDeactivateDialog} onOpenChange={setShowDeactivateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>השבת נציג - {repToDeactivate?.full_name}</DialogTitle>
          </DialogHeader>
          
          {repToDeactivate && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800 font-medium mb-2">
                  נציג זה משויך ל:
                </p>
                <div className="space-y-1 text-sm text-amber-700">
                  {getRepAssignmentCounts(repToDeactivate.email).leadsCount > 0 && (
                    <p>• {getRepAssignmentCounts(repToDeactivate.email).leadsCount} לידים</p>
                  )}
                  {getRepAssignmentCounts(repToDeactivate.email).quotesCount > 0 && (
                    <p>• {getRepAssignmentCounts(repToDeactivate.email).quotesCount} הצעות מחיר</p>
                  )}
                  {getRepAssignmentCounts(repToDeactivate.email).customersCount > 0 && (
                    <p>• {getRepAssignmentCounts(repToDeactivate.email).customersCount} לקוחות</p>
                  )}
                  {getRepAssignmentCounts(repToDeactivate.email).ordersCount > 0 && (
                    <p>• {getRepAssignmentCounts(repToDeactivate.email).ordersCount} הזמנות</p>
                  )}
                </div>
              </div>

              <form onSubmit={handleDeactivate} className="space-y-4">
                <div className="space-y-2">
                  <Label>העבר את הכל לנציג:</Label>
                  <Select value={transferToRep} onValueChange={setTransferToRep} required>
                    <SelectTrigger>
                      <SelectValue placeholder="בחר נציג לקבלת השיוכים" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableRepsForTransfer.map(r => (
                        <SelectItem key={r.id} value={r.email}>
                          {r.full_name} ({r.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-800">
                    <strong>שים לב:</strong> פעולה זו תעביר את כל הלידים, הצעות המחיר, הלקוחות וההזמנות לנציג שנבחר ותשבית את הגישה של הנציג למערכת.
                  </p>
                </div>

                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowDeactivateDialog(false);
                      setRepToDeactivate(null);
                      setTransferToRep('');
                    }}
                  >
                    ביטול
                  </Button>
                  <Button
                    type="submit"
                    disabled={deactivateRepMutation.isPending || !transferToRep}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    {deactivateRepMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 me-2 animate-spin" />
                        משבית...
                      </>
                    ) : (
                      <>
                        <UserX className="h-4 w-4 me-2" />
                        השבת נציג
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Representatives Table */}
      <Card className="border-border shadow-sm rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead className="bg-muted border-b border-border">
              <tr>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 whitespace-nowrap">נציג</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 whitespace-nowrap">תפקיד</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 whitespace-nowrap">מספר שלוחה</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 whitespace-nowrap">טלפון</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 whitespace-nowrap">עמלה (%)</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 whitespace-nowrap">סה"כ לידים</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 whitespace-nowrap">פעילים</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 whitespace-nowrap">נסגרו</th>
                <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 whitespace-nowrap">כניסה אחרונה</th>
                <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 whitespace-nowrap">פעולות</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-border/50">
              {activeReps.map(rep => {
                const stats = getRepStats(rep.email);
                return (
                  <tr key={rep.id} className="hover:bg-muted/50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <UserAvatar user={rep} size="sm" />
                        <div>
                          <div className="font-medium text-sm text-foreground">{rep.full_name}</div>
                          <div className="text-xs text-muted-foreground">{rep.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <Select 
                        value={rep.role || 'user'} 
                        onValueChange={(value) => {
                          updateRepMutation.mutate({
                            repId: rep.id,
                            data: { role: value }
                          });
                        }}
                      >
                        <SelectTrigger className="w-32 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">מנהל</SelectItem>
                          <SelectItem value="user">נציג מכירות</SelectItem>
                          <SelectItem value="factory_user">נציג מפעל</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-3 px-4">
                      <Input
                        value={rep.voicenter_extension || ''}
                        onChange={(e) => {
                          updateRepMutation.mutate({
                            repId: rep.id,
                            data: { voicenter_extension: e.target.value }
                          });
                        }}
                        placeholder="שלוחה"
                        className="text-sm w-24"
                      />
                    </td>
                    <td className="py-3 px-4">
                      <Input
                        value={rep.phone || ''}
                        onChange={(e) => {
                          updateRepMutation.mutate({
                            repId: rep.id,
                            data: { phone: e.target.value }
                          });
                        }}
                        placeholder="טלפון"
                        className="text-sm w-32"
                      />
                    </td>
                    <td className="py-3 px-4">
                      <Input
                        value={rep.commission_rate || ''}
                        onChange={(e) => {
                          updateRepMutation.mutate({
                            repId: rep.id,
                            data: { commission_rate: parseFloat(e.target.value) || 0 }
                          });
                        }}
                        placeholder="%"
                        type="number"
                        min="0"
                        max="100"
                        className="text-sm w-20"
                      />
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-muted text-foreground">
                        {stats.total}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary">
                        {stats.active}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-green-100 text-green-800">
                        {stats.won}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {rep.last_login ? (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>{formatDistanceToNow(new Date(rep.last_login), { addSuffix: true, locale: he })}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/70">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          onClick={() => handleImpersonate(rep)}
                          size="sm"
                          className="bg-amber-500 hover:bg-amber-600 h-8 px-3"
                          disabled={!canImpersonateRep(rep)}
                          title={!canImpersonateRep(rep) ? 'התחזות זמינה רק לנציגי מכירות/מפעל, לא למנהלים' : undefined}
                        >
                          <Eye className="h-3.5 w-3.5 me-1" />
                          התחזה
                        </Button>
                        {rep.email !== user?.email && (
                          <Button
                            onClick={() => handleDeactivateClick(rep)}
                            variant="outline"
                            size="sm"
                            className="text-red-600 border-red-200 hover:bg-red-50 h-8 px-3"
                          >
                            <UserX className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Inactive Reps Section */}
      {inactiveReps.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-foreground">נציגים מושבתים ({inactiveReps.length})</h2>
          <Card className="border-border shadow-sm rounded-xl overflow-hidden opacity-60">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 whitespace-nowrap">נציג</th>
                    <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 whitespace-nowrap">סטטוס</th>
                    <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4 whitespace-nowrap">פעולות</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border/50">
                  {inactiveReps.map(rep => (
                    <tr key={rep.id} className="hover:bg-muted/50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <UserAvatar user={rep} size="sm" />
                          <div>
                            <div className="font-medium text-sm text-muted-foreground">{rep.full_name}</div>
                            <div className="text-xs text-muted-foreground/70">{rep.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status="closed" customLabel="מושבת" className="text-xs" />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Button
                          onClick={() => updateRepMutation.mutate({ repId: rep.id, data: { is_active: true } })}
                          variant="outline"
                          size="sm"
                        >
                          <CheckCircle className="h-4 w-4 me-2" />
                          הפעל מחדש
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
