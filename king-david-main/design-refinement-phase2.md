# 🎯 Design Refinement Prompt - Phase 2
## "Make it Feel Fresh, Modern, Clean & Smart"

---

## ⚠️ CRITICAL REMINDER
**DO NOT CHANGE ANY FUNCTIONALITY** - Only visual styling changes.

---

## 🔍 ISSUES IDENTIFIED FROM SCREENSHOTS

After reviewing all screens, here are the specific problems that need fixing:

---

## 1️⃣ SELECTED STATE BORDERS - TOO CLUNKY

**Problem:** Selected cards/options have thick, heavy blue borders that look dated and "boxy"

**Where it appears:**
- Quote wizard: תוספות להובלה cards (delivery add-ons)
- Product selector: category cards, size cards
- Task modal: task type grid, status pills
- Any selectable option throughout the app

**Current:** `border: 2px solid #3B82F6` (thick, harsh)

**Fix - Make it subtle and elegant:**

```css
/* BEFORE: Heavy border */
.selected-card {
  border: 2px solid #3B82F6;
}

/* AFTER: Subtle, sophisticated selection */
.selected-card {
  border: 1px solid rgba(99, 102, 241, 0.5);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(99, 102, 241, 0.03) 100%);
  box-shadow: 
    0 0 0 1px rgba(99, 102, 241, 0.2),
    0 2px 8px rgba(99, 102, 241, 0.1);
}

/* Add a subtle inner glow instead of heavy border */
.selected-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.4), rgba(99, 102, 241, 0.1));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  pointer-events: none;
}

/* Checkmark indicator instead of just border */
.selected-card::after {
  content: '✓';
  position: absolute;
  top: 8px;
  left: 8px; /* RTL: right: 8px */
  width: 20px;
  height: 20px;
  background: var(--primary-500);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}
```

---

## 2️⃣ BUTTON INCONSISTENCY - NO UNIFIED LANGUAGE

**Problem:** Buttons have different colors with no clear hierarchy:
- Blue buttons (primary)
- Green buttons (WhatsApp? Success?)
- Yellow/Orange buttons (Warning? CTA?)
- Red outline buttons (Delete)
- Ghost buttons (Secondary)

**Current State (Chaotic):**
- "צור הצעת מחיר" = Pink/Red gradient
- "העבר ללקוח" = Yellow/Orange
- "WhatsApp" = Green
- "תעד שיחה" = Yellow
- "התקשר" = Blue outline
- "שמור שינויים" = Solid blue
- "המשך" = Blue gradient

**Fix - Clear Button Hierarchy:**

```css
/* ============================================
   BUTTON SYSTEM - 4 LEVELS ONLY
   ============================================ */

/* LEVEL 1: Primary Action (ONE per screen) */
.btn-primary {
  background: linear-gradient(180deg, #4F46E5 0%, #4338CA 100%);
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05), 0 4px 12px rgba(79, 70, 229, 0.25);
  transition: all 0.2s ease;
}
.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(79, 70, 229, 0.35);
}

/* LEVEL 2: Secondary Actions */
.btn-secondary {
  background: white;
  color: #374151;
  border: 1px solid #E5E7EB;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.2s ease;
}
.btn-secondary:hover {
  background: #F9FAFB;
  border-color: #D1D5DB;
}

/* LEVEL 3: Ghost/Tertiary Actions */
.btn-ghost {
  background: transparent;
  color: #6B7280;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.2s ease;
}
.btn-ghost:hover {
  background: #F3F4F6;
  color: #374151;
}

/* LEVEL 4: Danger/Destructive */
.btn-danger {
  background: white;
  color: #DC2626;
  border: 1px solid #FEE2E2;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 500;
}
.btn-danger:hover {
  background: #FEF2F2;
  border-color: #FECACA;
}

/* ============================================
   SPECIAL BUTTONS (Communication)
   Same style, different icons
   ============================================ */

.btn-communication {
  /* Use secondary style base */
  background: white;
  color: #374151;
  border: 1px solid #E5E7EB;
  padding: 10px 16px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* Icon colors only - not full button colors */
.btn-communication .icon-whatsapp { color: #25D366; }
.btn-communication .icon-phone { color: #3B82F6; }
.btn-communication .icon-email { color: #6B7280; }

/* DO NOT make entire button green/yellow/etc */
```

**Action Button Bar Redesign:**

```css
/* Current: Random colored buttons in a row */
/* New: Clean, organized action bar */

.action-bar {
  display: flex;
  gap: 8px;
  padding: 16px 0;
  border-bottom: 1px solid #F3F4F6;
  margin-bottom: 24px;
}

/* Primary action stands out */
.action-bar .btn-primary {
  /* As defined above */
}

/* Communication buttons grouped */
.action-bar .communication-group {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: #F9FAFB;
  border-radius: 10px;
}

.action-bar .communication-group button {
  background: transparent;
  border: none;
  padding: 8px 12px;
  border-radius: 6px;
  color: #6B7280;
  display: flex;
  align-items: center;
  gap: 6px;
}

.action-bar .communication-group button:hover {
  background: white;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
```

---

## 3️⃣ STEPPER (WIZARD STEPS) - TOO BASIC

**Problem:** The numbered steps in the quote wizard look generic

**Current:** Basic circles with numbers, simple lines between

**Fix - Modern Stepper:**

```css
.stepper {
  display: flex;
  justify-content: center;
  gap: 0;
  margin-bottom: 32px;
}

.step {
  display: flex;
  align-items: center;
}

.step-indicator {
  width: 40px;
  height: 40px;
  border-radius: 12px; /* Rounded square, not circle */
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.3s ease;
}

/* Completed step */
.step.completed .step-indicator {
  background: linear-gradient(135deg, #10B981 0%, #059669 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

.step.completed .step-indicator::after {
  content: '✓';
}

/* Current step */
.step.current .step-indicator {
  background: linear-gradient(135deg, #4F46E5 0%, #4338CA 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
  transform: scale(1.1);
}

/* Upcoming step */
.step.upcoming .step-indicator {
  background: #F3F4F6;
  color: #9CA3AF;
  border: 2px dashed #E5E7EB;
}

/* Connector line */
.step-connector {
  width: 60px;
  height: 2px;
  background: #E5E7EB;
  margin: 0 8px;
}

.step.completed + .step-connector {
  background: linear-gradient(90deg, #10B981 0%, #E5E7EB 100%);
}

/* Step label */
.step-label {
  position: absolute;
  top: 100%;
  margin-top: 8px;
  font-size: 12px;
  color: #6B7280;
  white-space: nowrap;
}

.step.current .step-label {
  color: #4F46E5;
  font-weight: 600;
}
```

---

## 4️⃣ CARDS & CONTAINERS - NEED REFINEMENT

**Problem:** Cards feel heavy, inconsistent padding, borders too visible

**Fix - Lighter, More Elegant Cards:**

```css
/* Base card */
.card {
  background: white;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 4px 12px rgba(0, 0, 0, 0.02);
  padding: 20px;
  transition: all 0.2s ease;
}

.card:hover {
  border-color: rgba(0, 0, 0, 0.08);
  box-shadow: 
    0 2px 4px rgba(0, 0, 0, 0.04),
    0 8px 24px rgba(0, 0, 0, 0.06);
}

/* Section headers inside cards */
.card-header {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-header::before {
  content: '';
  width: 3px;
  height: 16px;
  background: linear-gradient(180deg, #4F46E5 0%, #818CF8 100%);
  border-radius: 2px;
}

/* Selectable option cards (like delivery options) */
.option-card {
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.option-card:hover {
  border-color: #D1D5DB;
  background: #FAFAFA;
}

.option-card.selected {
  border-color: transparent;
  background: linear-gradient(white, white) padding-box,
              linear-gradient(135deg, #4F46E5, #818CF8) border-box;
  border: 1px solid transparent;
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.15);
}

/* Price inside option card */
.option-card .price {
  font-size: 18px;
  font-weight: 700;
  color: #4F46E5;
  margin-top: 8px;
}
```

---

## 5️⃣ MODALS - NEED POLISH

**Problem:** Modals feel cramped, tabs inside look basic

**Fix:**

```css
/* Modal backdrop */
.modal-backdrop {
  background: rgba(17, 24, 39, 0.6);
  backdrop-filter: blur(4px);
}

/* Modal container */
.modal {
  background: white;
  border-radius: 16px;
  box-shadow: 
    0 25px 50px -12px rgba(0, 0, 0, 0.25),
    0 0 0 1px rgba(0, 0, 0, 0.05);
  max-width: 560px;
  width: 100%;
  max-height: 85vh;
  overflow: hidden;
  animation: modalEnter 0.2s ease-out;
}

@keyframes modalEnter {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

/* Modal header */
.modal-header {
  padding: 20px 24px;
  border-bottom: 1px solid #F3F4F6;
}

.modal-title {
  font-size: 18px;
  font-weight: 600;
  color: #111827;
}

/* Modal body */
.modal-body {
  padding: 24px;
  overflow-y: auto;
}

/* Modal footer */
.modal-footer {
  padding: 16px 24px;
  border-top: 1px solid #F3F4F6;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #FAFAFA;
}

/* Close button */
.modal-close {
  position: absolute;
  top: 16px;
  left: 16px; /* RTL */
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: #9CA3AF;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close:hover {
  background: #F3F4F6;
  color: #6B7280;
}
```

---

## 6️⃣ TABS - REFINE THE STYLE

**Problem:** Tabs look okay but could be more refined

**Fix - Subtle Underline Style:**

```css
.tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid #E5E7EB;
  margin-bottom: 24px;
}

.tab {
  padding: 12px 20px;
  font-size: 14px;
  font-weight: 500;
  color: #6B7280;
  border: none;
  background: transparent;
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
}

.tab:hover {
  color: #374151;
}

.tab.active {
  color: #4F46E5;
}

.tab.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #4F46E5 0%, #818CF8 100%);
  border-radius: 2px 2px 0 0;
}

/* OR: Pill style tabs (alternative) */
.tabs-pill {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: #F3F4F6;
  border-radius: 10px;
}

.tab-pill {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: #6B7280;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-pill.active {
  background: white;
  color: #111827;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
```

---

## 7️⃣ FORM INPUTS - CONSISTENCY

**Problem:** Inputs look okay but need slight refinement

**Fix:**

```css
.input, .select, .textarea {
  width: 100%;
  padding: 10px 14px;
  font-size: 14px;
  color: #111827;
  background: white;
  border: 1px solid #E5E7EB;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.input:hover, .select:hover {
  border-color: #D1D5DB;
}

.input:focus, .select:focus {
  outline: none;
  border-color: #4F46E5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
}

.input::placeholder {
  color: #9CA3AF;
}

/* Label */
.label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 6px;
}

/* Input with icon */
.input-with-icon {
  position: relative;
}

.input-with-icon input {
  padding-right: 40px; /* RTL: padding-left */
}

.input-with-icon .icon {
  position: absolute;
  right: 12px; /* RTL: left */
  top: 50%;
  transform: translateY(-50%);
  color: #9CA3AF;
}
```

---

## 8️⃣ STATUS PILLS/BADGES - MAKE THEM POP (subtly)

**Problem:** Status badges are okay but could be more refined

**Fix:**

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  white-space: nowrap;
}

/* Status dot before text */
.badge::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

/* New Lead */
.badge-new {
  background: #EFF6FF;
  color: #1D4ED8;
}
.badge-new::before {
  background: #3B82F6;
}

/* Waiting/Pending */
.badge-pending {
  background: #FEF3C7;
  color: #B45309;
}
.badge-pending::before {
  background: #F59E0B;
  animation: pulse 2s infinite;
}

/* Done/Complete */
.badge-done {
  background: #D1FAE5;
  color: #065F46;
}
.badge-done::before {
  background: #10B981;
}

/* Cancelled */
.badge-cancelled {
  background: #F3F4F6;
  color: #6B7280;
}
.badge-cancelled::before {
  background: #9CA3AF;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

---

## 9️⃣ GRID SELECTORS (Task Types, Categories)

**Problem:** Icon grid for task types looks cramped and clunky when selected

**Fix:**

```css
.icon-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.icon-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px 12px;
  background: #FAFAFA;
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-option:hover {
  background: #F3F4F6;
}

.icon-option .icon {
  font-size: 20px;
  color: #6B7280;
  margin-bottom: 8px;
  transition: all 0.2s ease;
}

.icon-option .label {
  font-size: 12px;
  color: #6B7280;
  text-align: center;
}

/* Selected state - SUBTLE */
.icon-option.selected {
  background: linear-gradient(135deg, rgba(79, 70, 229, 0.08) 0%, rgba(79, 70, 229, 0.04) 100%);
  border-color: rgba(79, 70, 229, 0.3);
}

.icon-option.selected .icon {
  color: #4F46E5;
}

.icon-option.selected .label {
  color: #4338CA;
  font-weight: 500;
}
```

---

## 🔟 QUICK TIME BUTTONS (+1, +2, etc.)

**Problem:** Quick add buttons look disconnected

**Fix:**

```css
.quick-time-buttons {
  display: flex;
  gap: 6px;
}

.quick-time-btn {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: #6B7280;
  background: #F3F4F6;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.quick-time-btn:hover {
  background: #E5E7EB;
  color: #374151;
}

.quick-time-btn:active {
  transform: scale(0.95);
}
```

---

## 📋 SUMMARY - GLOBAL CHANGES NEEDED

1. **Replace all thick selection borders** with subtle gradients + soft shadows
2. **Unify button colors** - Remove rainbow, use 4-level hierarchy
3. **Refine the stepper** - Rounded squares, better states
4. **Lighten cards** - Less border, more subtle shadows
5. **Polish modals** - Better spacing, backdrop blur, animation
6. **Clean up tabs** - Underline or refined pills
7. **Consistent inputs** - Same style everywhere
8. **Better badges** - Status dots, refined colors
9. **Fix icon grids** - Subtle selection, proper spacing
10. **Quick buttons** - Grouped, consistent styling

---

## 🎨 DESIGN TOKENS TO UPDATE

```css
:root {
  /* Primary - Single color, consistent usage */
  --primary-50: #EEF2FF;
  --primary-100: #E0E7FF;
  --primary-200: #C7D2FE;
  --primary-500: #4F46E5;
  --primary-600: #4338CA;
  --primary-700: #3730A3;
  
  /* Neutrals - Warm gray */
  --gray-50: #FAFAFA;
  --gray-100: #F3F4F6;
  --gray-200: #E5E7EB;
  --gray-300: #D1D5DB;
  --gray-400: #9CA3AF;
  --gray-500: #6B7280;
  --gray-600: #4B5563;
  --gray-700: #374151;
  --gray-800: #1F2937;
  --gray-900: #111827;
  
  /* Semantic */
  --success: #10B981;
  --warning: #F59E0B;
  --danger: #EF4444;
  --info: #3B82F6;
  
  /* Shadows */
  --shadow-xs: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.05), 0 2px 4px rgba(0,0,0,0.04);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.04);
  --shadow-primary: 0 4px 14px rgba(79, 70, 229, 0.25);
  
  /* Borders */
  --border-subtle: 1px solid rgba(0,0,0,0.06);
  --border-default: 1px solid #E5E7EB;
  
  /* Radius */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
}
```

---

## ✅ EXECUTION ORDER

1. Update design tokens globally
2. Fix selection states (borders → subtle gradients)
3. Unify all buttons
4. Refine cards and containers
5. Polish modals
6. Update tabs
7. Fix icon grids
8. Refine inputs
9. Update badges
10. Final sweep for consistency

---

**Remember: ONLY visual changes. Do not touch any functionality.**

Start scanning the files and make these changes systematically.
