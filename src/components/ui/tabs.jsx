import React from "react";
import { cn } from "../../lib/utils";

const Tabs = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("", className)} {...props} />
));
Tabs.displayName = "Tabs";

const TabsList = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "inline-flex h-12 items-center gap-1 border-b border-border bg-background",
      className
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

const TabsTrigger = React.forwardRef(
  ({ className, value, activeValue, onClick, ...props }, ref) => {
    const isActive = value === activeValue;

    return (
      <button
        ref={ref}
        data-state={isActive ? "active" : "inactive"}
        onClick={() => onClick?.(value)}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 relative",
          "border-b-2 border-transparent hover:border-muted-foreground/30 hover:text-foreground",
          "data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:font-semibold",
          "data-[state=inactive]:text-muted-foreground",
          className
        )}
        {...props}
      />
    );
  }
);
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
