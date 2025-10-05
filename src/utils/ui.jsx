import React from "react";
import { Badge } from "@/components/ui/badge.jsx";
import { CheckCircle2, Loader2, AlertTriangle, Circle } from "lucide-react";

export const statusBadge = (status) => {
  switch (status) {
    case "running":
      return (
        <Badge variant="info" aria-label="Running">
          Running
        </Badge>
      );
    case "error":
      return (
        <Badge variant="error" aria-label="Error">
          Error
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="success" aria-label="Completed">
          Completed
        </Badge>
      );
    default:
      return null;
  }
};

export const taskStatusIcon = (state) => {
  switch (state) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />;
    case "running":
      return <Loader2 className="h-4 w-4 animate-spin text-info" aria-hidden />;
    case "error":
      return <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />;
    default:
      return <Circle className="h-4 w-4 text-slate-500" aria-hidden />;
  }
};

export const progressClasses = (status) => {
  switch (status) {
    case "running":
      return "bg-info/20 [&>div]:bg-info";
    case "error":
      return "bg-destructive/20 [&>div]:bg-destructive";
    case "completed":
      return "bg-success/20 [&>div]:bg-success";
    default:
      return "bg-muted [&>div]:bg-muted-foreground";
  }
};

export const barColorForState = (state) => {
  switch (state) {
    case "running":
      return "bg-info";
    case "error":
      return "bg-destructive";
    case "completed":
      return "bg-success";
    default:
      return "bg-muted-foreground";
  }
};
