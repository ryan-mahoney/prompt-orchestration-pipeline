Perfect—let’s strip shadcn and dark mode cleanly and land on plain React + Tailwind v4.

---

# Step-by-step (light-mode only)

## 1) Remove shadcn deps (optional)

If you installed any of these, remove them:

```bash
npm rm class-variance-authority tailwind-merge tailwindcss-animate \
       @radix-ui/react-slot @radix-ui/react-tabs @radix-ui/react-select
# keep lucide-react or any Radix pkg only if YOU still use them directly
```

## 2) Simplify Tailwind config (no tokens, no darkMode)

**`tailwind.config.js`**

```js
export default {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./src/ui/client/index.html"],
  theme: { extend: {} },
  plugins: [],
};
```

## 3) Reset your CSS entry to pure Tailwind + tiny base

**`src/ui/client/index.css`** (replace file contents)

```css
@import "tailwindcss";

/* Minimal base: light mode only */
@layer base {
  html,
  body,
  #root {
    height: 100%;
  }
  body {
    @apply bg-white text-slate-900 antialiased;
  }
  *,
  ::before,
  ::after {
    @apply border-slate-200;
  }
}
```

> Remove any `@plugin "tailwindcss-animate";`, token vars (`--primary`, etc.), and any `@apply bg-background`/`border-border` you may still have.

In **`src/ui/client/main.jsx`**, keep:

```jsx
import "./index.css";
import "./style.css"; // optional; delete if empty
```

## 4) Replace shadcn UI components with plain ones

Keep the same paths so imports don’t break; replace file contents with these minimal versions.

**`src/components/ui/button.jsx`**

```jsx
import React from "react";
export default function Button({
  as: As = "button",
  variant = "solid",
  size = "md",
  className = "",
  ...props
}) {
  const base =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium " +
    "transition-colors focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-slate-400 focus-visible:ring-offset-2 ring-offset-white " +
    "disabled:opacity-50 disabled:pointer-events-none";
  const sizes = { sm: "h-8 px-3", md: "h-9 px-4", lg: "h-10 px-6" };
  const variants = {
    solid: "bg-slate-900 text-white hover:bg-slate-800",
    outline:
      "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
    ghost: "bg-transparent hover:bg-slate-100",
    secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
    destructive: "bg-red-600 text-white hover:bg-red-500",
  };
  const cls = [
    base,
    sizes[size] || sizes.md,
    variants[variant] || variants.solid,
    className,
  ].join(" ");
  return <As className={cls} {...props} />;
}
```

**`src/components/ui/badge.jsx`**

```jsx
import React from "react";
export function Badge({ children, intent = "gray", className = "", ...props }) {
  const intents = {
    gray: "border-slate-300 text-slate-700 bg-slate-100",
    blue: "border-blue-300 text-blue-800 bg-blue-100",
    green: "border-green-300 text-green-800 bg-green-100",
    red: "border-red-300 text-red-800 bg-red-100",
    amber: "border-amber-300 text-amber-900 bg-amber-100",
  };
  const cls = [
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
    intents[intent] || intents.gray,
    className,
  ].join(" ");
  return (
    <span className={cls} {...props}>
      {children}
    </span>
  );
}
```

**`src/components/ui/card.jsx`**

```jsx
import React from "react";
export function Card({ className = "", ...p }) {
  return (
    <div
      className={["rounded-xl border bg-white shadow-sm", className].join(" ")}
      {...p}
    />
  );
}
export function CardHeader({ className = "", ...p }) {
  return <div className={["p-4 border-b", className].join(" ")} {...p} />;
}
export function CardTitle({ className = "", ...p }) {
  return (
    <h3 className={["text-base font-semibold", className].join(" ")} {...p} />
  );
}
export function CardContent({ className = "", ...p }) {
  return <div className={["p-4", className].join(" ")} {...p} />;
}
```

**`src/components/ui/separator.jsx`**

```jsx
import React from "react";
export function Separator({ className = "", ...p }) {
  return (
    <hr className={["my-4 border-slate-200", className].join(" ")} {...p} />
  );
}
```

**`src/components/ui/progress.jsx`**

```jsx
import React from "react";
export function Progress({ value = 0, className = "" }) {
  const pct = Math.max(0, Math.min(100, Number(value)));
  return (
    <div
      className={[
        "h-2 w-full overflow-hidden rounded bg-slate-200",
        className,
      ].join(" ")}
    >
      <div className="h-full bg-blue-600" style={{ width: `${pct}%` }} />
    </div>
  );
}
```

**`src/components/ui/tabs.jsx`** (simple, no Radix)

```jsx
import React, { useState } from "react";
export function Tabs({ defaultValue, children, className = "" }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className={className} data-state={value}>
      {React.Children.map(children, (c) =>
        React.cloneElement(c, { value, setValue })
      )}
    </div>
  );
}
export function TabsList({ children, className = "", value, setValue }) {
  return (
    <div className={["flex gap-2 border-b", className].join(" ")}>
      {React.Children.map(children, (c) =>
        React.cloneElement(c, { value, setValue })
      )}
    </div>
  );
}
export function TabsTrigger({
  value: tab,
  children,
  className = "",
  setValue,
  value,
}) {
  const active = value === tab;
  const cls = [
    "px-3 py-2 text-sm",
    active
      ? "border-b-2 border-slate-900 font-medium"
      : "text-slate-500 hover:text-slate-700",
    className,
  ].join(" ");
  return (
    <button className={cls} onClick={() => setValue(tab)}>
      {children}
    </button>
  );
}
export function TabsContent({ value: tab, value, children, className = "" }) {
  if (value !== tab) return null;
  return <div className={["pt-3", className].join(" ")}>{children}</div>;
}
```

**`src/components/ui/select.jsx`** (native select)

```jsx
import React from "react";
export function Select({ value, onValueChange, children, className = "" }) {
  return (
    <select
      className={[
        "h-9 rounded-md border px-3 text-sm bg-white",
        className,
      ].join(" ")}
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      {children}
    </select>
  );
}
export function SelectItem({ value, children }) {
  return <option value={value}>{children}</option>;
}
export function SelectTrigger({ children, ...p }) {
  return <>{children}</>;
} // keep API compatible
export function SelectContent({ children }) {
  return <>{children}</>;
}
export function SelectValue({ placeholder }) {
  return <>{placeholder}</>;
}
```

## 5) Replace shadcn token classes in your code

Use Tailwind’s built-ins. Quick swaps:

| shadcn token class          | replace with                   |
| --------------------------- | ------------------------------ |
| `bg-primary`                | `bg-slate-900` (or your brand) |
| `text-primary-foreground`   | `text-white`                   |
| `bg-secondary`              | `bg-slate-100`                 |
| `text-secondary-foreground` | `text-slate-900`               |
| `border-border`             | `border-slate-200`             |
| `border-input`              | `border-slate-300`             |
| `bg-background`             | `bg-white`                     |
| `text-foreground`           | `text-slate-900`               |
| `ring-ring`                 | `ring-slate-400`               |
| `ring-offset-background`    | `ring-offset-white`            |

One-liners (macOS `sed`) to cover the common ones—review the diff:

```bash
files=$(git ls-files 'src/**/*.{js,jsx,ts,tsx}')
sed -i '' -E 's/\bbg-primary\b/bg-slate-900/g; s/\btext-primary-foreground\b/text-white/g' $files
sed -i '' -E 's/\bbg-secondary\b/bg-slate-100/g; s/\btext-secondary-foreground\b/text-slate-900/g' $files
sed -i '' -E 's/\bborder-border\b/border-slate-200/g; s/\bborder-input\b/border-slate-300/g' $files
sed -i '' -E 's/\bbg-background\b/bg-white/g; s/\btext-foreground\b/text-slate-900/g' $files
sed -i '' -E 's/\bring-ring\b/ring-slate-400/g; s/\bring-offset-background\b/ring-offset-white/g' $files
```

> Your `Button` base already includes `focus-visible:ring-2 ring-offset-white`, so focus rings will still look good.

## 6) Clean out leftovers

- Delete any shadcn token blocks or `@plugin "tailwindcss-animate"` from your CSS.
- Remove unused helpers (`cva`, `cn`) if present.

## 7) Clean & run

```bash
rm -rf ./src/ui/dist node_modules/.vite
npm run dev
```

### Quick visual check

- Pages should have white background and slate text.
- Buttons render black (slate-900) with white text and a light focus ring.
- Badges, cards, tabs, select, progress look sensible and predictable.

---

If you want a tiny brand color (instead of slate-900), add it in `tailwind.config.js`:

```js
theme: {
  extend: {
    colors: {
      brand: "#0b5cff";
    }
  }
}
```

…and use `bg-brand text-white hover:bg-brand/90` where you had `bg-primary` before.
