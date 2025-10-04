import React from "react";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2, AlertTriangle, Circle } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const statusBadge = (status) => {
  switch (status) {
    case "running":
      return (
        <Badge className="bg-blue-500 hover:bg-blue-600" aria-label="Running">
          Running
        </Badge>
      );
    case "error":
      return (
        <Badge className="bg-red-500 hover:bg-red-600" aria-label="Error">
          Error
        </Badge>
      );
    case "completed":
      return (
        <Badge
          className="bg-green-500 hover:bg-green-600"
          aria-label="Completed"
        >
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
      return <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />;
    case "running":
      return (
        <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden />
      );
    case "error":
      return <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />;
  }
};

export const progressClasses = (status) => {
  switch (status) {
    case "running":
      return "bg-blue-50 [&>div]:bg-blue-500";
    case "error":
      return "bg-red-50 [&>div]:bg-red-500";
    case "completed":
      return "bg-green-50 [&>div]:bg-green-500";
    default:
      return "bg-gray-100 [&>div]:bg-gray-500";
  }
};

export const barColorForState = (state) => {
  switch (state) {
    case "running":
      return "bg-blue-500";
    case "error":
      return "bg-red-500";
    case "completed":
      return "bg-green-500";
    default:
      return "bg-gray-300";
  }
};

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
