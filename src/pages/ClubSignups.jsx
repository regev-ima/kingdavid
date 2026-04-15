import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import DataTable from '@/components/shared/DataTable';
import FilterBar from '@/components/shared/FilterBar';
import KPICard from '@/components/shared/KPICard';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { Crown, UserCheck, PhoneCall, UserX, Users } from "lucide-react";
import { format } from '@/lib/safe-date-fns';
import useEffectiveCurrentUser from '@/hooks/use-effective-current-user';
import { isAdmin } from '@/lib/rbac';

const STATUS_LABELS = {
  new: 'חדש',
  contacted: 'נוצר קשר',
  member: 'חבר מועדון',
  unsubscribed: 'הוסר',
};

const STATUS_BADGE_CLASS = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-amber-100 text-amber-700',
  member: 'bg-emerald-100 text-emerald-700',
  unsubscribed: 'bg-gray-100 text-gray-600',
};

const SOURCE_LABELS = {
  website: 'אתר',
  manual: 'ידני',
  import: 'ייבוא',
};

const filterOptions = [
  {
    key: 'status',
    label: 'סטטוס',
    options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
  },
];

export default function ClubSignups() {
  const { effectiveUser, isLoading: isLoadingUser } = useEffectiveCurrentUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState('all');
  const [filters, setFilters] = useState({ search: '', status: 'all' });

  const canAccess = isAdmin(effectiveUser);

  const { data: signups = [], isLoading } = useQuery({
    queryKey: ['club_signups'],
    queryFn: () => base44.entities.ClubSignup.list('-created_at', 500),
    staleTime: 60000,
    enabled: canAccess,
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }) => base44.entities.ClubSignup.update(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['club_signups'] });
      toast({ title: 'הסטטוס עודכן' });
    },
    onError: (err) => {
      toast({
        title: 'שגיאה בעדכון הסטטוס',
        description: err?.message || '',
        variant: 'destructive',
      });
    },
  });

  let filtered = signups;
  if (activeTab !== 'all') {
    filtered = filtered.filter((s) => s.status === activeTab);
  }
  if (filters.status && filters.status !== 'all') {
    filtered = filtered.filter((s) => s.status === filters.status);
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    filtered = filtered.filter((s) =>
      s.full_name?.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q) ||
      s.phone?.includes(filters.search) ||
      s.city?.toLowerCase().includes(q)
    );
  }

  const counts = {
    new: signups.filter((s) => s.status === 'new').length,
    contacted: signups.filter((s) => s.status === 'contacted').length,
    member: signups.filter((s) => s.status === 'member').length,
    unsubscribed: signups.filter((s) => s.status === 'unsubscribed').length,
  };

  const columns = [
    {
      header: 'שם מלא',
      render: (row) => <span className="font-medium text-foreground">{row.full_name}</span>,
    },
    {
      header: 'טלפון',
      render: (row) => <span dir="ltr" className="text-sm">{row.phone}</span>,
    },
    {
      header: 'אימייל',
      render: (row) => <span className="text-sm" dir="ltr">{row.email}</span>,
    },
    {
      header: 'עיר',
      render: (row) => row.city || <span className="text-muted-foreground">-</span>,
    },
    {
      header: 'מקור',
      render: (row) => (
        <span className="text-sm">{SOURCE_LABELS[row.source] || row.source || '-'}</span>
      ),
    },
    {
      header: 'סטטוס',
      render: (row) => (
        <Select
          value={row.status}
          onValueChange={(value) => updateStatusMutation.mutate({ id: row.id, status: value })}
          disabled={updateStatusMutation.isPending}
        >
          <SelectTrigger
            className={`h-8 w-36 text-xs font-medium border-0 ${STATUS_BADGE_CLASS[row.status] || 'bg-gray-100 text-gray-600'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <SelectValue>{STATUS_LABELS[row.status] || row.status}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      header: 'נרשם בתאריך',
      render: (row) => {
        if (!row.created_at) return <span className="text-muted-foreground">-</span>;
        try {
          return (
            <div className="text-sm text-muted-foreground">
              <div>{format(new Date(row.created_at), 'dd/MM/yyyy')}</div>
              <div className="text-xs">{format(new Date(row.created_at), 'HH:mm')}</div>
            </div>
          );
        } catch {
          return <span className="text-muted-foreground">-</span>;
        }
      },
    },
  ];

  if (isLoadingUser) {
    return <div className="text-center py-12">טוען...</div>;
  }

  if (!canAccess) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">אין לך הרשאה לגשת להצטרפויות למועדון</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
            <Crown className="h-6 w-6 text-amber-500" />
            הצטרפויות למועדון
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            לידים שנרשמו למועדון KING DAVID דרך האתר
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="חדשים"
          value={counts.new}
          icon={Users}
          color="blue"
          onClick={() => setActiveTab('new')}
        />
        <KPICard
          title="נוצר קשר"
          value={counts.contacted}
          icon={PhoneCall}
          color="amber"
          onClick={() => setActiveTab('contacted')}
        />
        <KPICard
          title="חברי מועדון"
          value={counts.member}
          icon={UserCheck}
          color="emerald"
          onClick={() => setActiveTab('member')}
        />
        <KPICard
          title="הוסרו"
          value={counts.unsubscribed}
          icon={UserX}
          color="gray"
          onClick={() => setActiveTab('unsubscribed')}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-col sm:flex-row bg-card border h-auto gap-1 p-1.5 rounded-lg shadow-card">
          <TabsTrigger value="all" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            הכל ({signups.length})
          </TabsTrigger>
          <TabsTrigger value="new" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            חדשים ({counts.new})
          </TabsTrigger>
          <TabsTrigger value="contacted" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            נוצר קשר ({counts.contacted})
          </TabsTrigger>
          <TabsTrigger value="member" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            חברי מועדון ({counts.member})
          </TabsTrigger>
          <TabsTrigger value="unsubscribed" className="w-full sm:w-auto text-sm h-9 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            הוסרו ({counts.unsubscribed})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <FilterBar
        filters={filterOptions}
        values={filters}
        onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
        onClear={() => setFilters({ search: '', status: 'all' })}
        searchPlaceholder="חפש לפי שם, טלפון, אימייל או עיר..."
      />

      <DataTable
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        emptyMessage="לא נמצאו הצטרפויות למועדון"
      />
    </div>
  );
}
