import React from "react";
import { Badge } from "../components/ui/badge.jsx";
import { CheckCircle2, Loader2, AlertTriangle, Circle } from "lucide-react";
import { TaskState } from "../config/statuses.js";

export const statusBadge = (status) => {
  switch (status) {
    case TaskState.RUNNING:
      return (
        <Badge intent="blue" aria-label="Running">
          Running
        </Badge>
      );
    case TaskState.FAILED:
      return (
        <Badge intent="red" aria-label="Failed">
          Failed
        </Badge>
      );
    case TaskState.DONE:
      return (
        <Badge intent="green" aria-label="Completed">
          Completed
        </Badge>
      );
    case TaskState.PENDING:
      return (
        <Badge intent="gray" aria-label="Pending">
          Pending
        </Badge>
      );
    default:
      return null;
  }
};

export const taskStatusIcon = (state) => {
  switch (state) {
    case TaskState.DONE:
      return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />;
    case TaskState.RUNNING:
      return <Loader2 className="h-4 w-4 animate-spin text-info" aria-hidden />;
    case TaskState.FAILED:
      return <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />;
    default:
      return <Circle className="h-4 w-4 text-slate-500" aria-hidden />;
  }
};

export const progressClasses = (status) => {
  switch (status) {
    case TaskState.RUNNING:
      return "bg-info/20 [&>div]:bg-info";
    case TaskState.FAILED:
      return "bg-destructive/20 [&>div]:bg-destructive";
    case TaskState.DONE:
      return "bg-success/20 [&>div]:bg-success";
    default:
      return "bg-muted [&>div]:bg-muted-foreground";
  }
};

export const barColorForState = (state) => {
  switch (state) {
    case TaskState.RUNNING:
      return "bg-info";
    case TaskState.FAILED:
      return "bg-destructive";
    case TaskState.DONE:
      return "bg-success";
    default:
      return "bg-muted-foreground";
  }
};
