import { Badge } from "../ui/components/ui/Badge";

export function statusBadge(status: string) {
  const intent =
    status === "running"
      ? "blue"
      : status === "complete" || status === "done"
        ? "green"
        : status === "failed"
          ? "red"
          : "amber";

  return <Badge intent={intent}>{status}</Badge>;
}

export function progressClasses(status: string): string {
  if (status === "failed") return "text-red-600";
  if (status === "complete" || status === "done") return "text-green-600";
  if (status === "running") return "text-blue-600";
  return "text-slate-500";
}
