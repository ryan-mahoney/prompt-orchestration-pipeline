# Button Design Standards

This document defines the standardized usage of buttons throughout the Prompt Orchestration Pipeline UI, ensuring consistency, accessibility, and adherence to the Steel Terminal theme.

## Design Principles

1. **Consistency**: All buttons of the same type look and behave identically
2. **Clarity**: Button copy clearly communicates action
3. **Accessibility**: Buttons meet WCAG AA standards and support keyboard navigation
4. **Theme Compliance**: Buttons use Steel Terminal semantic colors, not hardcoded values
5. **Visual Hierarchy**: Button variants establish clear action priority
6. **Component Uniformity**: Always use the custom Button component from `src/components/ui/button.jsx`, not Radix UI's Button directly

## Visual Hierarchy

Button hierarchy establishes visual priority and guides users through actions.

### Primary Actions (CTAs)

Use for the most important action in a view. These are the actions you want users to take most often.

**Variant:** `solid`  
**Size:** `md` (standard)  
**Examples:**

- "Add Task" (PipelineTypeDetail page header)
- "Add a Pipeline Type" (PipelineList page header)
- "Upload Seed" (Layout header)
- "Send" (TaskCreationSidebar)
- "Create" (Dialog confirmations)

**Styling:** Indigo background (#4f46e5), white text, clear active state

### Secondary Actions

Use for supporting actions that are important but less critical than primary actions.

**Variant:** `soft` or `outline`  
**Size:** `md` or `sm`  
**Examples:**

- "Cancel" (Dialog actions)
- "Close" (Modal dismissals)
- "Rescan" (Refresh actions)

**Styling:** Light slate background (10% opacity) or bordered, lower visual weight

### Destructive Actions

Use for actions that have negative consequences or are irreversible.

**Variant:** `destructive`  
**Size:** `md` or `sm`  
**Examples:**

- "Stop" (Running job actions)
- "Delete" (Resource removal)
- "Remove" (Item deletion)

**Styling:** Red background (#dc2626), white text, clear danger indication

### Minimal Actions

Use for subtle, inline actions or icon-only controls.

**Variant:** `ghost`  
**Size:** `sm`  
**Examples:**

- Chevron navigation (table rows)
- Copy to clipboard
- Edit icons

**Styling:** Transparent background, visible on hover

## Button Component

Use the `Button` component from `src/components/ui/button.jsx` for all buttons. Do not use raw `<button>` tags with Tailwind classes unless absolutely necessary.

```jsx
import { Button } from "./components/ui/button.jsx";

<Button variant="solid" size="md" onClick={handleAction}>
  Action Label
</Button>;
```

## Button Variants

### Solid (Primary)

Use for the primary action in a view or form.

**When to use:**

- Form submission (Create, Save, Submit)
- Primary navigation actions
- Most important action in a group

**Copy pattern:** `"[Verb] [Resource]"`

```jsx
<Button variant="solid" size="md">Create Pipeline</Button>
<Button variant="solid" size="md">Save Changes</Button>
<Button variant="solid" size="md">Add Task</Button>
```

### Soft (Secondary)

Use for secondary actions that are less important than the primary action.

**When to use:**

- Alternative actions
- Less emphasized options
- Grouped with solid buttons

**Copy pattern:** Same as solid, but lower visual priority

```jsx
<Button variant="soft" size="md">Draft</Button>
<Button variant="soft" size="md">Preview</Button>
```

### Outline (Tertiary)

Use for actions that need visibility but aren't primary.

**When to use:**

- Cancel actions
- Close dialogs
- Back/previous navigation
- Secondary form actions

**Copy pattern:** `"Cancel"`, `"Close"`, `"Back"`

```jsx
<Button variant="outline" size="md" onClick={onCancel}>
  Cancel
</Button>
<Button variant="outline" size="md" onClick={onClose}>
  Close
</Button>
```

### Ghost (Minimal)

Use for subtle actions or inline controls.

**When to use:**

- Inline actions (edit, copy, delete icons)
- Toolbar buttons
- Actions within cards/panels
- Low-priority options

```jsx
<Button variant="ghost" size="sm" aria-label="Copy">
  <CopyIcon />
</Button>
<Button variant="ghost" size="md">Edit</Button>
```

### Destructive (Danger)

Use for actions that have destructive consequences.

**When to use:**

- Delete resources
- Remove items
- Cancel operations
- Irreversible changes

**Copy pattern:** `"Delete [Resource]"`, `"Remove [Item]"`

```jsx
<Button variant="destructive" size="md">Delete Pipeline</Button>
<Button variant="destructive" size="md">Remove Task</Button>
```

## Button Sizes

### Small (`size="sm"`) - Compact

Use for:

- Inline actions within text or cards
- Toolbar buttons
- Icon-only buttons

**Padding:** `px-3 py-1`  
**Text size:** `text-sm`

```jsx
<Button variant="ghost" size="sm" aria-label="Copy">
  <CopyIcon />
</Button>
```

### Medium (`size="md"`) - Default

Use for:

- Form buttons
- Dialog actions
- Navigation buttons
- Most primary/secondary actions

**Padding:** `px-4 py-2`  
**Text size:** `text-base` (default)

```jsx
<Button variant="solid" size="md">
  Create Pipeline
</Button>
```

### Large (`size="lg"`) - Prominent

Use for:

- Hero section CTAs
- Important standalone actions
- Marketing calls-to-action

**Padding:** `px-6 py-3`  
**Text size:** `text-lg`

```jsx
<Button variant="solid" size="lg">
  Get Started
</Button>
```

## Copy Guidelines

### Wording Rules

1. **Use imperative mood:** "Create Pipeline" not "Creating Pipeline"
2. **Remove articles:** "Add Task" not "Add a Task"
3. **Be specific but concise:** "Create Pipeline" not "Add a New Pipeline Type"
4. **Use consistent terminology:** Match the terminology used in the UI

### Common Action Patterns

| Action        | Copy                             | Example                      |
| ------------- | -------------------------------- | ---------------------------- |
| Create new    | "Create [Resource]"              | Create Pipeline, Create Task |
| Add existing  | "Add [Resource]"                 | Add Task, Add Member         |
| Save changes  | "Save" or "Save Changes"         | Save, Save Changes           |
| Cancel action | "Cancel"                         | Cancel                       |
| Close dialog  | "Close"                          | Close                        |
| Delete        | "Delete [Resource]"              | Delete Pipeline, Delete Task |
| Edit          | "Edit [Resource]" or just "Edit" | Edit Pipeline, Edit          |
| Copy          | Icon with aria-label "Copy"      |                              |
| Retry         | "Retry" or "Try Again"           | Retry                        |
| Submit        | "Submit"                         | Submit                       |

### Dialog Titles vs Button Labels

Dialog titles describe the context, buttons describe the action.

| Dialog Title        | Button Labels      |
| ------------------- | ------------------ |
| "Add Pipeline Type" | "Cancel", "Create" |
| "Task Assistant"    | "Send", "Close"    |
| "Delete Pipeline"   | "Cancel", "Delete" |

**Note:** Dialog title "Add a Pipeline Type" should be "Add Pipeline Type" (remove article).

## Layout Patterns

### Dialog Actions

Primary action (solid) on the right, secondary (outline) on the left.

```jsx
<div className="flex gap-3 mt-auto pt-4">
  <Button variant="outline" size="md" onClick={onCancel}>
    Cancel
  </Button>
  <Button variant="solid" size="md" onClick={onSubmit} disabled={submitting}>
    {submitting ? "Creating..." : "Create"}
  </Button>
</div>
```

### Form Actions

Same pattern as dialog actions.

### Inline Actions

Use ghost or soft variants with small size.

```jsx
<div className="flex items-center gap-2">
  <Text>Pipeline Name</Text>
  <Button variant="ghost" size="sm" aria-label="Edit">
    <EditIcon />
  </Button>
</div>
```

## Icon-Only Buttons

When using icon-only buttons:

1. Always provide `aria-label` for screen readers
2. Use `size="sm"` for compactness
3. Use `variant="ghost"` to reduce visual weight
4. Add tooltips for sighted users when helpful

```jsx
<Button
  variant="ghost"
  size="sm"
  aria-label="Copy to clipboard"
  onClick={handleCopy}
>
  <CopyIcon />
</Button>
```

## Loading States

For buttons that trigger async operations:

1. Disable the button during loading
2. Update the label to indicate progress
3. Show loading indicator if available

```jsx
<Button variant="solid" size="md" disabled={loading} onClick={handleSubmit}>
  {loading ? "Creating..." : "Create"}
</Button>
```

## Accessibility Requirements

All buttons must:

1. **Have visible focus states** - Use the Button component's built-in focus styles
2. **Have sufficient color contrast** - At least 4.5:1 for text
3. **Include aria-labels** - For icon-only buttons
4. **Support keyboard navigation** - Use `tabindex="0"` where appropriate
5. **Have clear action labels** - Avoid vague text like "OK" or "Submit" when specific

## Theme Integration

All button variants use Steel Terminal semantic colors defined in CSS variables:

- `--primary` - Primary actions (#4f46e5 - indigo-600)
- `--primary-foreground` - Text on primary buttons (white)
- `--primary-hover` - Hover state for primary (#4338ca - indigo-700)
- `--destructive` - Destructive actions (#dc2626 - red-600)
- `--destructive-foreground` - Text on destructive buttons (white)
- `--secondary` - Secondary/outline buttons (#f8fafc - slate-50)
- `--secondary-foreground` - Text on secondary buttons (#312e81 - indigo-950)
- `--muted-foreground` - Muted text (#6366f1 - indigo-500)
- `--ring` - Focus ring color (#4f46e5 - indigo-600)

Never use hardcoded colors like `bg-blue-600` or `bg-red-600`. The Button component handles theme colors automatically using CSS variables with HSL syntax.

### Color Rationale

The primary color is `indigo-600` (#4f46e5), a vibrant indigo that:

- Provides clear visual distinction as an active state (vs. grayish inactive appearance)
- Offers excellent contrast with light backgrounds
- Maintains professional appearance while being clearly interactive
- Aligns with modern design standards while honoring Steel Terminal's technical aesthetic
- Maintains accessibility (WCAG AA compliant with 4.8:1 contrast ratio)

### Customizing Colors

To adjust button colors, modify the CSS variables in `src/ui/client/index.css`:

```css
:root {
  /* Change primary to a different shade */
  --primary: 215deg 16% 38%; /* Adjust lightness for lighter/darker */
  --primary-hover: 215deg 16% 28%; /* Match hue, adjust lightness */
}
```

See also: `docs/theme.md` for complete theme documentation.

## Migration Checklist

When migrating existing buttons:

- [ ] Replace raw `<button>` with `Button` component
- [ ] Choose appropriate variant based on action priority
- [ ] Choose appropriate size based on context
- [ ] Update copy to follow guidelines
- [ ] Add `aria-label` for icon-only buttons
- [ ] Remove hardcoded Tailwind color classes
- [ ] Test in both light and dark modes
- [ ] Test keyboard navigation
- [ ] Verify focus states are visible

## Examples

### Creating a New Resource

```jsx
<Dialog.Root>
  <Dialog.Trigger>
    <Button variant="solid" size="md">
      Create Pipeline
    </Button>
  </Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Title>Add Pipeline Type</Dialog.Title>
    {/* Form fields */}
    <div className="flex gap-3 mt-4">
      <Button variant="outline" size="md" onClick={onCancel}>
        Cancel
      </Button>
      <Button variant="solid" size="md" onClick={onSubmit}>
        Create
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
```

### Inline Copy Action

```jsx
<div className="relative group">
  <code className="bg-gray-100 px-2 py-1 rounded">{content}</code>
  <Button
    variant="ghost"
    size="sm"
    className="absolute top-0 right-0 opacity-0 group-hover:opacity-100"
    aria-label="Copy to clipboard"
    onClick={handleCopy}
  >
    <CopyIcon />
  </Button>
</div>
```

### Form with Actions

```jsx
<form onSubmit={handleSubmit}>
  <label>
    Name
    <input type="text" value={name} onChange={handleChange} />
  </label>
  <label>
    Description
    <textarea value={description} onChange={handleChange} />
  </label>
  <div className="flex gap-3 mt-6">
    <Button variant="outline" size="md" type="button" onClick={onCancel}>
      Cancel
    </Button>
    <Button variant="solid" size="md" type="submit" disabled={submitting}>
      {submitting ? "Saving..." : "Save"}
    </Button>
  </div>
</form>
```

## Anti-Patterns

### Don't Do This

```jsx
// ❌ Hardcoded colors
<button className="bg-blue-600 text-white rounded px-4 py-2">
  Create
</button>

// ❌ Inconsistent wording
<button>Add a Pipeline Type</button>

// ❌ Missing aria-label on icon-only button
<button onClick={handleCopy}>
  <CopyIcon />
</button>

// ❌ Raw button instead of Button component
<button onClick={onCancel}>Cancel</button>
```

### Do This Instead

```jsx
// ✅ Use Button component with theme colors
<Button variant="solid" size="md">Create</Button>

// ✅ Consistent, concise wording
<Button variant="solid" size="md">Add Pipeline Type</Button>

// ✅ Include aria-label
<Button
  variant="ghost"
  size="sm"
  aria-label="Copy to clipboard"
  onClick={handleCopy}
>
  <CopyIcon />
</Button>

// ✅ Use Button component
<Button variant="outline" size="md" onClick={onCancel}>
  Cancel
</Button>
```
