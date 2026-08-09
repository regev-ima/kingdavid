# פופאפ הליד — גרסה 6 (עבודה שלא הושלמה)

מוקאפ מאושר: `design-previews/lead-modal-v6-strip.html`

## מה כבר קיים ב-main

- **המוקאפ** — מאושר על ידי המשתמש, כולל החלפת העמודות (פרטי שיווק מימין, משימה הבאה משמאל).
- **`LeadUnifiedTimeline`** — קיבל `collapsible`: ציר אופקי של 3 האירועים האחרונים + "הצג הכל".
  אף אחד עדיין לא מעביר את הפרופ, כלומר אפס שינוי ויזואלי בפרודקשן.

## למה הניסיון הראשון נכשל

הרכבתי את כל הלייאאוט ישירות לתוך `src/pages/LeadDetails.jsx` (1,700 שורות) בעזרת סקריפט.
נוצר חוסר איזון אחד ב-JSX, esbuild דיווח רק "Unexpected end of file" בסוף הקובץ,
וביסקציה על JSX לא עוזרת כי כל חיתוך באמצע אלמנט מייצר את אותה שגיאה. הקובץ הוחזר למצבו.

## הדרך הנכונה

להוציא את הלייאאוט ל**קובץ רכיב חדש** — `src/components/lead/LeadOverview.jsx` —
שמקבל את כל מה שהוא צריך כפרופס, ואז שינוי קטן ב-`LeadDetails` שמרנדר אותו.
קובץ חדש נבדק בפני עצמו (`npx esbuild <file> --outfile=/dev/null --loader:.jsx=jsx`),
כך שכל שגיאה מתגלה מיד ובמקום הנכון.

פרופס שהרכיב צריך: `lead, isModal, onClose, users, salesReps, isAdmin, canEdit,
isEditing, setIsEditing, handleSave, formData, setFormData, updateLeadMutation,
sourceLabel, arrivedAtLabel, repeatEnquiryOrdinal, hasCustomerDetails, quotes,
serviceTickets, openServiceTicketsCount, linkedOrderIds, workbenchState, tasks,
leadId, openLastTask, requestAddTask, handleClickToCall, handleQuickAssignRep1,
handleWorkbenchAction, setShowQuoteDialog, setShowOrderDialog,
setShowAddCommunication, convertToCustomerMutation, setEditingTask,
setShowEditTaskDialog`.

## אימות

הרנדר נבדק מול נתונים מדומים בדפדפן — ראה את ההרנס שתואר בהיסטוריית ה-PRים:
`vite` עם alias של `@/api/base44Client` לקובץ mock, ו-Playwright לצילום.

---

## טיוטת הלייאאוט (JSX) — גוף הרכיב

```jsx
    <div className={isModal ? 'flex flex-col min-h-0 overflow-hidden bg-background' : 'space-y-4'}>

      {/* ===== HEADER =====
          Identity on the right, the phone in the middle, edit + overflow on
          the left. In popup mode it's flex-shrink-0 so it never scrolls, and
          pe-16 clears the dialog's own close-X. */}
      <div className={
        'flex items-center gap-3 flex-wrap' +
        (isModal ? ' flex-shrink-0 px-5 pt-4 pb-3 pe-16 border-b border-border bg-background' : '')
      }>
        {isModal ? (
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-lg flex-shrink-0" onClick={onClose} title="חזרה">
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Link to={createPageUrl('Leads')}>
            <Button variant="outline" size="icon" className="h-10 w-10 rounded-lg flex-shrink-0">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        )}

        <span className="h-11 w-11 rounded-full bg-primary/10 text-primary grid place-items-center text-lg font-bold flex-shrink-0" aria-hidden="true">
          {(lead.full_name || '?').trim().charAt(0)}
        </span>
        <h1 className="text-2xl font-extrabold tracking-tight truncate">{lead.full_name}</h1>
        <RepeatEnquiryBadge ordinal={repeatEnquiryOrdinal} />

        {lead.phone ? (
          <span className="ms-auto inline-flex items-center gap-2 text-[15px] tabular-nums">
            <button
              type="button"
              onClick={handleCopyPhone}
              title="העתק מספר"
              className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {phoneCopied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            </button>
            <span dir="ltr">{lead.phone}</span>
          </span>
        ) : null}

        <span className={`flex items-center gap-2 flex-shrink-0${lead.phone ? '' : ' ms-auto'}`}>
          {canEdit ? (
            <Button
              variant={isEditing ? 'default' : 'outline'}
              onClick={() => (isEditing ? handleSave() : setIsEditing(true))}
              disabled={updateLeadMutation.isPending}
              className="h-10 rounded-lg"
            >
              {updateLeadMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEditing ? (
                <><Save className="h-4 w-4 me-2" />שמור</>
              ) : (
                <><Pencil className="h-4 w-4 me-2" />ערוך ליד</>
              )}
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-10 w-10 rounded-lg">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" dir="rtl">
              <DropdownMenuItem onClick={() => setShowAddCommunication(true)}>
                <MessageCircle className="h-3.5 w-3.5 me-2" />
                הוסף תקשורת
              </DropdownMenuItem>
              {lead.status !== 'won' ? (
                <DropdownMenuItem
                  onClick={() => convertToCustomerMutation.mutate()}
                  disabled={convertToCustomerMutation.isPending}
                >
                  <Crown className="h-3.5 w-3.5 me-2" />
                  המר ללקוח
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      {/* ===== SCROLLABLE BODY ===== */}
      <div className={isModal ? 'flex-auto min-h-0 overflow-y-auto p-5 space-y-4' : 'space-y-4 min-w-0'}>

        {/* Cross-rep view/serve banner */}
        {!canEdit && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-4 py-2.5 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>
              {lead.rep1 ? (
                <>ליד זה משויך ל<span className="font-semibold">{getRepDisplayName(lead.rep1, users)}</span> — מצב טיפול. אפשר לראות פרטים והיסטוריה ולטפל בלקוח; הבעלות על הליד לא משתנה.</>
              ) : (
                <>ליד לא משויך — אפשר לראות פרטים והיסטוריה ולטפל בלקוח.</>
              )}
            </span>
          </div>
        )}

        {/* ===== FACTS STRIP =====
            The five things you check before doing anything: what state the
            lead is in, where it came from, when it landed, and who owns it.
            One row, one card, dividers between cells. */}
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 rounded-xl border border-border bg-card shadow-card m-0">
          {[
            {
              key: 'status',
              label: 'סטטוס',
              node: canEdit ? (
                <button
                  type="button"
                  onClick={openLastTask}
                  title="הסטטוס משתנה דרך משימה — לחץ לפתיחת המשימה האחרונה"
                  className="rounded-md hover:opacity-80 transition-opacity"
                >
                  <StatusBadge status={lead.status} />
                </button>
              ) : <StatusBadge status={lead.status} />,
            },
            {
              key: 'source',
              label: 'מקור הגעה',
              node: (
                <>
                  <SourceIcon source={lead.source} className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{sourceLabel || '—'}</span>
                </>
              ),
            },
            {
              key: 'arrived',
              label: 'תאריך כניסה',
              node: (
                <>
                  <CalendarDays className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
                  <span className="truncate tabular-nums">{arrivedAtLabel || '—'}</span>
                </>
              ),
            },
            {
              key: 'rep1',
              label: 'נציג אחראי',
              node: <RepFact email={lead.rep1} users={users} />,
            },
            {
              key: 'rep2',
              label: 'נציג שני',
              node: <RepFact email={lead.rep2} users={users} />,
            },
          ].map((cell, index) => (
            <div
              key={cell.key}
              className={`px-3 py-3 text-center min-w-0${index > 0 ? ' border-s border-border/70' : ''}`}
            >
              <dt className="text-xs text-muted-foreground/80 mb-1.5">{cell.label}</dt>
              <dd className="m-0 flex items-center justify-center gap-1.5 text-sm font-medium min-w-0">
                {cell.node}
              </dd>
            </div>
          ))}
        </dl>

        {/* Pending rep — the integration named someone but the lead is still
            unassigned. Its own line, so the facts strip keeps its height. */}
        {!lead.rep1 && lead.pending_rep_email && !isEditing && (
          <div className="flex items-center gap-2 flex-wrap rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <span className="text-xs font-medium text-amber-700 flex-shrink-0">נציג ממתין לשיוך:</span>
            <span className="text-sm text-amber-900 min-w-0 truncate flex-1">
              {salesReps.find((r) => r.email === lead.pending_rep_email)?.full_name || lead.pending_rep_email}
            </span>
            {isAdmin && (
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 h-7 text-xs flex-shrink-0"
                onClick={() => handleQuickAssignRep1(lead.pending_rep_email)}
                disabled={updateLeadMutation.isPending}
              >
                שייך נציג זה כראשי
              </Button>
            )}
          </div>
        )}

        {/* ===== ACTIONS ===== six equal columns filling the width */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <Button
            onClick={() => handleClickToCall(lead.phone)}
            disabled={!lead.phone}
            className="h-11 rounded-xl justify-center"
          >
            <Phone className="h-4 w-4 me-2" />
            חיוג
          </Button>
          <LeadWhatsAppChatButton
            phone={lead.phone}
            name={lead.full_name}
            className="h-11 rounded-xl justify-center w-full"
          />
          <Button variant="outline" onClick={requestAddTask} className="h-11 rounded-xl justify-center">
            <CheckSquare className="h-4 w-4 me-2 text-primary" />
            משימה חדשה
          </Button>
          <Button variant="outline" onClick={() => setShowQuoteDialog(true)} className="h-11 rounded-xl justify-center">
            <FileText className="h-4 w-4 me-2 text-primary" />
            הצעה חדשה
          </Button>
          <Button variant="outline" onClick={() => setShowOrderDialog(true)} className="h-11 rounded-xl justify-center">
            <CalendarDays className="h-4 w-4 me-2 text-primary" />
            הזמנה חדשה
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11 rounded-xl justify-center">
                <ChevronDown className="h-4 w-4 me-2 text-primary" />
                עוד פעולות
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" dir="rtl">
              <DropdownMenuItem onClick={() => setShowAddCommunication(true)}>
                <MessageCircle className="h-3.5 w-3.5 me-2" />
                הוסף תקשורת
              </DropdownMenuItem>
              {lead.status !== 'won' ? (
                <DropdownMenuItem
                  onClick={() => convertToCustomerMutation.mutate()}
                  disabled={convertToCustomerMutation.isPending}
                >
                  <Crown className="h-3.5 w-3.5 me-2" />
                  המר ללקוח
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Other enquiries from the same person — above the fold, because a
            rep has to know they're calling someone who contacted us before. */}
        <OtherEnquiriesCard lead={lead} />

        {/* ===== MARKETING (right) + NEXT TASK (left) ===== */}
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <Card className="rounded-xl border-border shadow-card overflow-hidden">
            <CardHeader className="py-3.5">
              <CardTitle className="text-[15px] font-bold flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                פרטי שיווק
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-4">
              {(() => {
                const rows = [
                  { k: 'UTM Source', v: lead.utm_source || sourceLabel },
                  { k: 'UTM Medium', v: lead.utm_medium },
                  { k: 'UTM Campaign', v: lead.utm_campaign || lead.facebook_campaign_name },
                  { k: 'UTM Content', v: lead.utm_content || lead.facebook_ad_name },
                  { k: 'UTM Term', v: lead.utm_term || lead.facebook_adset_name },
                ].filter((r) => String(r.v || '').trim() !== '');
                if (rows.length === 0) {
                  return <p className="text-sm text-muted-foreground py-2">אין מידע שיווקי לליד הזה.</p>;
                }
                return (
                  <ul className="m-0 p-0 list-none">
                    {rows.map((row, i) => (
                      <li
                        key={row.k}
                        className={`flex items-center justify-between gap-4 py-3 text-sm${i > 0 ? ' border-t border-border/60' : ''}`}
                      >
                        <span className="text-[13px] text-muted-foreground/80 flex-shrink-0">{row.k}</span>
                        <span className="min-w-0 truncate" title={row.v}>{row.v}</span>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </CardContent>
          </Card>

          <Card className="rounded-xl border-border shadow-card overflow-hidden">
            <CardHeader className="py-3.5">
              <CardTitle className="text-[15px] font-bold flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-primary" />
                משימה הבאה
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-4">
              <NextTaskPanel
                item={workbenchState?.nowQueue?.[0] || null}
                users={users}
                onOpen={(item) => handleWorkbenchAction(item, 'open_task')}
                onComplete={(item) => handleWorkbenchAction(item, 'complete_task')}
                onCreate={requestAddTask}
              />
            </CardContent>
          </Card>
        </div>

        {/* ===== ACTIVITY ===== collapsed to the last three, expandable */}
        <LeadUnifiedTimeline
          collapsible
          className="max-h-[560px]"
          leadId={leadId}
          tasks={tasks}
          users={users}
          onOpenTask={(task) => { setEditingTask(task); setShowEditTaskDialog(true); }}
        />

        {/* ===== SECONDARY SECTIONS =====
            Quotes, service and the customer's own fields aren't part of the
            main layout any more, but they still hold real data — so they sit
            here as collapsed sections instead of disappearing. */}
        <div className="space-y-2">
          <CollapsibleSection title="הצעות מחיר" icon={FileText} count={quotes.length}>
            {quotes.length === 0 ? (
              <div className="flex items-center justify-between gap-3 text-sm py-1">
                <span className="text-muted-foreground">אין הצעות מחיר לליד זה.</span>
                <Button size="sm" variant="outline" onClick={() => setShowQuoteDialog(true)}>
                  <FileText className="h-3.5 w-3.5 me-1" />
                  צור הצעה
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {quotes.map((quote) => (
                  <Link
                    key={quote.id}
                    to={createPageUrl('QuoteDetails') + `?id=${quote.id}`}
                    className="flex items-center justify-between gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <span className="font-medium text-sm">#{quote.quote_number}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-sm font-bold text-primary">₪{quote.total?.toLocaleString()}</span>
                      <StatusBadge status={quote.status} />
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            id="lead-service-section"
            title="שירות"
            icon={Headphones}
            count={serviceTickets.length}
            countTone={openServiceTicketsCount > 0 ? 'bg-amber-500 text-white' : undefined}
          >
            {linkedOrderIds.length === 0 ? (
              <p className="text-sm text-muted-foreground py-1">
                ללקוח אין הזמנות פעילות, ולכן אין נתיב לפתיחת קריאת שירות מכאן. קריאת שירות נפתחת תמיד מתוך הזמנה קיימת.
              </p>
            ) : serviceTickets.length === 0 ? (
              <p className="text-sm text-muted-foreground py-1">אין קריאות שירות פתוחות או היסטוריות עבור ההזמנות של הלקוח.</p>
            ) : (
              <div className="space-y-2">
                {[...serviceTickets]
                  .sort((a, b) => {
                    const aOpen = !['resolved', 'closed'].includes(String(a.status || '').toLowerCase());
                    const bOpen = !['resolved', 'closed'].includes(String(b.status || '').toLowerCase());
                    if (aOpen !== bOpen) return aOpen ? -1 : 1;
                    return new Date(b.updated_date || b.created_date || 0) - new Date(a.updated_date || a.created_date || 0);
                  })
                  .map((ticket) => {
                    const isOpen = !['resolved', 'closed'].includes(String(ticket.status || '').toLowerCase());
                    return (
                      <Link
                        key={ticket.id}
                        to={createPageUrl('TicketDetails') + `?id=${ticket.id}`}
                        className={`block border rounded-lg p-3 transition-colors ${isOpen ? 'border-amber-200 bg-amber-50/40 hover:bg-amber-50' : 'border-border hover:bg-muted/40'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold">#{ticket.ticket_number || ticket.id?.slice(0, 6)}</span>
                          <StatusBadge status={ticket.status} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 truncate">{ticket.subject || 'פניית שירות'}</p>
                      </Link>
                    );
                  })}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="פרטי לקוח" icon={User} defaultOpen={isEditing}>
            {isEditing ? (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">שם ושם משפחה</Label>
                  <Input value={formData.full_name || ''} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">טלפון</Label>
                  <Input value={formData.phone || ''} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">טלפון נוסף</Label>
                  <Input value={formData.phone_2 || ''} onChange={(e) => setFormData({ ...formData, phone_2: e.target.value })} className="h-9" dir="ltr" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">אימייל</Label>
                  <Input type="email" value={formData.email || ''} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">עיר</Label>
                  <Input value={formData.city || ''} onChange={(e) => setFormData({ ...formData, city: e.target.value })} className="h-9" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">כתובת</Label>
                <AddressAutocomplete
                  value={formData.address || ''}
                  onChange={(value, details) => {
                    setFormData((prev) => ({
                      ...prev,
                      address: value,
                      ...(details?.city ? { city: details.city } : {}),
                    }));
                  }}
                  className="h-9"
                  placeholder="התחל להקליד..."
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">סטטוס</Label>
                  <Select value={formData.status || ''} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LEAD_STATUS_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <StatusOptionRow status={opt.value} label={opt.label} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">מקור</Label>
                  <Select value={formData.source || ''} onValueChange={(value) => setFormData({ ...formData, source: value })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LEAD_SOURCE_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">הערות</Label>
                <Textarea value={formData.notes || ''} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} />
              </div>
            </div>
            ) : (
              <dl className="divide-y divide-border/30 m-0">
                {[
                  { label: 'טלפון נוסף', value: lead.phone_2, icon: Phone },
                  { label: 'אימייל', value: lead.email, icon: Mail },
                  { label: 'עיר', value: lead.city, icon: MapPin },
                  { label: 'כתובת', value: lead.address, icon: Home },
                  { label: 'טופס מקור', value: lead.source_form, icon: FileText },
                  { label: 'נושא הפנייה', value: lead.subject, icon: MessageSquare },
                  { label: 'הערות', value: lead.notes, whitespace: 'pre-wrap', icon: StickyNote },
                ]
                  .filter((row) => row.value)
                  .map((row) => {
                    const Icon = row.icon;
                    return (
                      <div key={row.label} className="flex items-baseline gap-3 py-2.5">
                        <dt className="flex items-center gap-1.5 text-xs text-muted-foreground/80 w-28 flex-shrink-0">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                          <span>{row.label}</span>
                        </dt>
                        <dd className={`text-sm min-w-0 flex-1 m-0 ${row.whitespace === 'pre-wrap' ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
                          {row.value}
                        </dd>
                      </div>
                    );
                  })}
                {!hasCustomerDetails ? (
                  <p className="text-sm text-muted-foreground py-2 m-0">אין פרטים נוספים ללקוח הזה.</p>
                ) : null}
                {Array.isArray(lead.tags) && lead.tags.length > 0 ? (
                  <div className="flex items-baseline gap-3 py-2.5">
                    <dt className="flex items-center gap-1.5 text-xs text-muted-foreground/80 w-28 flex-shrink-0">
                      <Tag className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
                      <span>תגיות</span>
                    </dt>
                    <dd className="flex flex-wrap gap-1.5 min-w-0 flex-1 m-0">
                      {lead.tags.map((tag) => (
                        <span key={tag} className="inline-flex items-center rounded-md bg-indigo-100 text-indigo-800 text-[11px] font-medium px-1.5 py-0.5">
                          #{tag}
                        </span>
                      ))}
                    </dd>
                  </div>
                ) : null}
              </dl>
            )}
          </CollapsibleSection>
        </div>

      </div>{/* end of body wrapper */}
```

## טיוטת רכיבי העזר

```jsx

// ── Small pieces the lead screen composes from ─────────────────────────────

// Source icon. Google and Facebook get their own marks because "where did
// this lead come from" is the first thing a rep reads, and a brand mark is
// faster than a word; everything else falls back to a neutral globe.
function SourceIcon({ source, className = '' }) {
  const key = String(source || '').toLowerCase();
  if (key.startsWith('google')) {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M21.6 12.2c0-.6-.1-1.2-.2-1.8H12v3.5h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.2Z" />
        <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
        <path fill="#FBBC05" d="M6.4 14a6 6 0 0 1 0-3.8V7.6H3.1a10 10 0 0 0 0 9L6.4 14Z" />
        <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.6l3.3 2.6C7.2 7.6 9.4 5.9 12 5.9Z" />
      </svg>
    );
  }
  if (key.startsWith('facebook') || key.startsWith('instagram')) {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#1877F2" d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z" />
      </svg>
    );
  }
  return <Globe className={`${className} text-muted-foreground/60`} />;
}

// A rep slot in the facts strip: the person's name, or a plain dash when the
// slot is empty. Kept dumb on purpose — assigning happens in "ערוך ליד".
function RepFact({ email, users }) {
  if (!email) return <span className="text-muted-foreground/60">—</span>;
  return (
    <>
      <User className="h-4 w-4 text-muted-foreground/60 flex-shrink-0" />
      <span className="truncate">{getRepDisplayName(email, users) || email}</span>
    </>
  );
}

// The lead's next open task. `summary` is the only free-text field a task
// has, and CompleteTaskDialog appends notes to it as extra lines — so the
// first line is the headline and the rest is what the mockup calls "הערות".
function NextTaskPanel({ item, users, onOpen, onComplete, onCreate }) {
  if (!item) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-4 py-4">
        <span className="text-sm text-muted-foreground">אין משימות פתוחות לליד הזה.</span>
        <Button size="sm" variant="outline" className="gap-1" onClick={onCreate}>
          <Plus className="h-3.5 w-3.5" />
          משימה חדשה
        </Button>
      </div>
    );
  }

  const task = item.entity || {};
  const lines = String(task.summary || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const headline = lines[0] || ALL_TASK_TYPE_LABELS[task.task_type] || 'משימה';
  const notes = lines.slice(1).join('\n');
  const due = task.due_date ? new Date(task.due_date) : null;
  const repName = task.rep1 ? (getRepDisplayName(task.rep1, users) || task.rep1) : '';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item); } }}
      className="rounded-xl bg-muted/50 p-4 cursor-pointer hover:bg-muted transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-[15px] font-bold m-0 min-w-0">{headline}</h4>
        {notes ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/70 flex-shrink-0">
            <MessageSquare className="h-3.5 w-3.5" />
            הערות
          </span>
        ) : null}
      </div>
      {notes ? <p className="text-[13.5px] text-muted-foreground mt-2 mb-0 whitespace-pre-wrap">{notes}</p> : null}

      <div className="flex items-center gap-2.5 flex-wrap mt-4 text-[13px] text-muted-foreground tabular-nums">
        {repName ? <span>{repName}</span> : null}
        {repName && due ? <span className="text-border">|</span> : null}
        {due ? (
          <span className="inline-flex items-center gap-1.5">
            {formatInTimeZone(due, 'Asia/Jerusalem', 'HH:mm')}
            <Clock className="h-3.5 w-3.5" />
          </span>
        ) : null}
        {due ? (
          <span className="inline-flex items-center gap-1.5">
            {formatInTimeZone(due, 'Asia/Jerusalem', 'dd/MM/yyyy')}
            <CalendarDays className="h-3.5 w-3.5" />
          </span>
        ) : (
          <span>ללא תאריך יעד</span>
        )}
      </div>

      <div className="flex mt-4">
        <Button
          size="sm"
          variant="outline"
          className="ms-auto gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
          onClick={(e) => { e.stopPropagation(); onComplete(item); }}
        >
          <Check className="h-3.5 w-3.5" />
          סמן כבוצע
        </Button>
      </div>
    </div>
  );
}

// A section that isn't part of the main layout but still holds real data —
// quotes, service, the customer's own fields. Closed by default so the screen
// stays the length the design intends, one click from the content.
function CollapsibleSection({ id, title, icon: Icon, count, countTone, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);
  return (
    <div id={id} className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-start hover:bg-muted/40 transition-colors"
      >
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">{title}</span>
        {count != null ? (
          <span className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-[18px] h-[18px] text-[10px] font-bold leading-none ${countTone || 'bg-muted-foreground/15 text-muted-foreground'}`}>
            {count}
          </span>
        ) : null}
        <ChevronDown className={`h-4 w-4 text-muted-foreground ms-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? <div className="px-4 pb-4 border-t border-border/60 pt-3">{children}</div> : null}
    </div>
  );
}
```
