import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Menu, GripVertical } from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { useHiddenMenuItems, applyMenuOrder, NON_HIDEABLE_HREFS } from '@/hooks/useHiddenMenuItems';
import { navigationByRole } from '@/Layout';

// Sidebar menu management (hide + reorder), split into its own module so the
// heavy @hello-pangea/dnd dependency is lazy-loaded only when this tab opens —
// it used to sit in the Settings bundle and slow the whole screen's first load.
export default function MenuManagementTab() {
  const { isMenuItemHidden, setMenuItemHidden, menuOrder, setMenuOrder } = useHiddenMenuItems();
  // The admin sidebar is the full menu — that's what the toggles control.
  // Sorted by the saved drag order so the tab mirrors the live sidebar.
  const menuItems = applyMenuOrder(
    navigationByRole.admin.filter((i) => !NON_HIDEABLE_HREFS.includes(i.href)),
    menuOrder,
  );

  const handleMenuDragEnd = (result) => {
    if (!result.destination || result.source.index === result.destination.index) return;
    const next = Array.from(menuItems);
    const [moved] = next.splice(result.source.index, 1);
    next.splice(result.destination.index, 0, moved);
    setMenuOrder(next.map((i) => i.href));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Menu className="h-5 w-5" />
          ניהול תפריט
        </CardTitle>
        <CardDescription>
          גרור את הידית (☰) כדי לשנות את סדר הפריטים בתפריט הצד, וכבה את המתג כדי
          להסתיר פריט. ההגדרות נשמרות במערכת — הן חלות על כל הדפדפנים והמכשירים
          ולא מתאפסות בעדכון גרסה.
        </CardDescription>
      </CardHeader>
      <CardContent dir="rtl">
        <DragDropContext onDragEnd={handleMenuDragEnd}>
          <Droppable droppableId="menu-items">
            {(dropProvided) => (
              <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="space-y-2">
                {menuItems.map((item, index) => {
                  const ItemIcon = item.icon;
                  const visible = !isMenuItemHidden(item.href);
                  return (
                    <Draggable key={item.href} draggableId={item.href} index={index}>
                      {(dragProvided, snapshot) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          className={`flex items-center justify-between gap-3 rounded-lg border bg-card p-3 ${snapshot.isDragging ? 'shadow-lg ring-1 ring-primary/30' : ''}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              {...dragProvided.dragHandleProps}
                              className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground shrink-0"
                              aria-label="גרור לשינוי הסדר"
                            >
                              <GripVertical className="h-4 w-4" />
                            </span>
                            {ItemIcon && <ItemIcon className={`h-4 w-4 shrink-0 ${visible ? 'text-foreground' : 'text-muted-foreground/40'}`} />}
                            <span className={`text-sm font-medium truncate ${visible ? '' : 'text-muted-foreground line-through'}`}>
                              {item.name}
                            </span>
                          </div>
                          <Switch
                            checked={visible}
                            onCheckedChange={(v) => setMenuItemHidden(item.href, !v)}
                            className="shrink-0"
                          />
                        </div>
                      )}
                    </Draggable>
                  );
                })}
                {dropProvided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </CardContent>
    </Card>
  );
}
