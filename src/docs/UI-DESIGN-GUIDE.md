# Altai HQ Inventory Management System
# UI Design Guide v1.0

> Version: 1.0
> Last Updated: 2026-07-29
> Purpose:
> This document defines the official UI/UX design system for the Altai HQ Inventory Management System.
>
> Every screen, component and feature MUST follow this document unless otherwise instructed.

---

# 1. Design Philosophy

The system should feel like a modern enterprise inventory platform.

Design inspiration:

- Shopify Admin
- Linear
- Vercel Dashboard
- Notion
- Stripe Dashboard

The interface should always be:

- Clean
- Minimal
- Spacious
- Easy to scan
- Professional
- Enterprise
- Consistent

Avoid:

❌ Bootstrap appearance

❌ Heavy borders

❌ Crowded forms

❌ Bright colors everywhere

❌ Inconsistent spacing

❌ Too many button styles

❌ Long walls of inputs

Prefer:

✅ White cards

✅ Soft shadows

✅ Lots of whitespace

✅ Rounded corners

✅ Thin borders

✅ Neutral backgrounds

✅ Green as the primary brand color

---

# 2. Brand Colors

## Primary

Primary Green

HEX

```
#2F8F1E
```

Hover

```
#267417
```

Pressed

```
#1F5D13
```

Light Green

```
#EDF7E8
```

---

## Background

Application Background

```
#F4F7F1
```

Card Background

```
#FFFFFF
```

Sidebar Background

```
#FFFFFF
```

Panel Background

```
#FAFBFA
```

---

## Text

Primary

```
#111827
```

Secondary

```
#6B7280
```

Muted

```
#9CA3AF
```

Disabled

```
#CBD5E1
```

---

## Borders

Default

```
#E5E7EB
```

Light

```
#F1F5F9
```

Focus

```
#2F8F1E
```

---

## Status Colors

Success

```
#16A34A
```

Warning

```
#D97706
```

Danger

```
#DC2626
```

Information

```
#2563EB
```

---

# 3. Typography

Primary Font

```
Inter
```

Fallback

```
system-ui
Segoe UI
Roboto
Helvetica Neue
sans-serif
```

---

## Page Title

Font Size

28px

Weight

700

Example

```
Product Manager
```

---

## Card Title

22px

Weight

700

Example

```
Product Details
```

---

## Section Title

16px

Weight

700

Example

```
Variants
```

---

## Field Labels

Font Size

11px

Weight

600

Uppercase

Letter spacing

2px

Color

```
#6B7280
```

Example

```
PRODUCT NAME
```

---

## Input Text

16px

Weight

400

---

## Small Text

13px

Weight

400

---

# 4. Layout

Desktop Container

Maximum Width

```
1600px
```

Page Padding

```
32px
```

Card Padding

```
24px
```

Spacing Between Cards

```
24px
```

Spacing Between Sections

```
32px
```

Spacing Between Inputs

```
20px
```

Spacing Between Labels and Inputs

```
8px
```

---

# 5. Cards

Every functional area should be inside a card.

Card Style

Background

White

Border

```
1px solid #E5E7EB
```

Radius

```
16px
```

Padding

```
24px
```

Shadow

```
0 4px 18px rgba(15,23,42,.05)
```

Hover

```
translateY(-2px)

0 8px 24px rgba(15,23,42,.08)
```

---

# 6. Buttons

Primary Button

Background

```
#2F8F1E
```

Text

White

Height

```
44px
```

Padding

```
0 20px
```

Radius

```
10px
```

Hover

```
#267417
```

---

Secondary Button

Background

White

Border

```
1px solid #D9DED7
```

Text

```
#111827
```

---

Danger Button

Background

White

Border

```
#DC2626
```

Text

```
#DC2626
```

---

Ghost Button

Transparent

No border

Green text

Used for links

---

# 7. Forms

Input Height

```
48px
```

Textarea Height

```
120px
```

Border

```
1px solid #D9DED7
```

Radius

```
10px
```

Placeholder

```
#9CA3AF
```

Focus

Border

```
#2F8F1E
```

Shadow

```
0 0 0 3px rgba(47,143,30,.12)
```

Never use thick borders.

---

# 8. Tables

Header

Uppercase

11px

Letter spacing

2px

Color

```
#9CA3AF
```

Row Height

```
56px
```

Hover

```
#FAFCF9
```

Border Bottom

```
#F1F5F9
```

Actions should always be aligned right.

Numeric columns should always be aligned right.

---

# 9. Sidebar

Width

```
280px
```

Background

White

Menu Height

```
48px
```

Menu Radius

```
12px
```

Active Menu

Background

```
#EDF7E8
```

Text

```
#2F8F1E
```

Inactive Menu

Text

```
#374151
```

Hover

```
#F7FAF5
```

---

# 10. Dashboard

Dashboard cards should have:

- Card title
- Optional description
- Right-aligned actions
- Consistent padding
- Equal card heights where appropriate

Charts should use green as the primary data color.

---

# 11. Product Registration Page

Layout

Two-column layout

```
------------------------------------------------------------
| Product Details              | Next Steps                |
------------------------------------------------------------

Variants

------------------------------------------------------------
| Variant Card                                        Copy  |
------------------------------------------------------------
| Attribute Name      Attribute Value                     X |
| + Add Attribute                                        |
|----------------------------------------------------------|
| Price              SKU                                 |
| Color              Barcode                            |
|----------------------------------------------------------|
| Remarks                                               |
------------------------------------------------------------

                 Save Draft     Register Product
```

Do not display all fields in one long form.

Group fields logically.

---

# 12. Variants

Each variant should be displayed as an independent card.

Each card contains:

- Variant Name
- Copy Button
- Delete Button
- Attributes
- Price
- SKU
- Barcode
- Color
- Remarks

---

# 13. Empty States

Instead of blank pages.

Show

Icon

Title

Description

Primary Action

Example

```
No Products Yet

Create your first product to begin inventory tracking.

[ Register Product ]
```

---

# 14. Icons

Use only one icon family.

Preferred

Tabler Icons

Do not mix icon libraries.

Icon Size

20px

---

# 15. Animations

Use subtle animations.

Transition

150ms ease

Card Hover

```
translateY(-2px)
```

Buttons

Opacity

95%

Input Focus

200ms

Do not use large animations.

---

# 16. Responsive Rules

Desktop

1200px+

Tablet

768px–1199px

Mobile

Below 768px

Cards stack vertically.

Sidebar becomes collapsible.

Tables become horizontally scrollable.

---

# 17. Accessibility

Minimum font size

13px

Minimum button height

44px

Contrast ratio

WCAG AA

Keyboard accessible

Visible focus state

---

# 18. Design Rules

Every page MUST:

✅ Use cards

✅ Use consistent spacing

✅ Keep forms grouped

✅ Use whitespace generously

✅ Use green only for primary actions

✅ Use red only for destructive actions

✅ Use soft shadows

✅ Use thin borders

✅ Use rounded corners

✅ Keep action buttons bottom-right

✅ Keep page headers consistent

Never:

❌ Mix different button styles

❌ Change spacing randomly

❌ Use different border radius values

❌ Add unnecessary colors

❌ Crowd multiple inputs together

❌ Mix typography styles

---

# 19. AI Development Rules

When modifying the project:

DO NOT

- Change business logic
- Change API requests
- Change backend behavior
- Change database structure
- Rename API fields
- Remove existing functionality

ONLY improve

- CSS
- Layout
- Typography
- Spacing
- Card hierarchy
- Component consistency
- User experience
- Accessibility

Every UI change must comply with this document.

If a design decision is unclear:

1. Follow this guide.
2. Reuse existing components.
3. Prefer consistency over creativity.
4. Maintain the Altai visual identity.

This document is the single source of truth for all future UI development.