import { cn } from "@/lib/utils";
import {
  SEVERITY_LABELS,
  TYPE_LABELS,
  statusLabel,
  type SeverityValue,
  type StatusValue,
  type TypeValue,
} from "@/lib/constants";
import type { Category } from "@/types/feedback";

// 状态/类型/影响程度徽章（01 §3.4 样式：圆角胶囊、12px、对比度 ≥4.5:1）

const STATUS_STYLES: Record<StatusValue, string> = {
  submitted: "bg-slate-200 text-slate-700",
  "in-progress": "bg-blue-100 text-blue-800",
  replied: "bg-green-100 text-green-800",
  resolved: "bg-green-700 text-white",
  wontfix: "bg-orange-100 text-orange-800",
  duplicate: "bg-sky-100 text-sky-800",
  hidden: "bg-slate-200 text-slate-500",
};

export function StatusBadge({
  status,
  category,
  className,
}: {
  status: StatusValue;
  category: Category;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
        className
      )}
    >
      {statusLabel(status, category)}
    </span>
  );
}

export function TypeBadge({
  type,
  className,
}: {
  type: TypeValue;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600",
        className
      )}
    >
      {TYPE_LABELS[type]}
    </span>
  );
}

export function SeverityBadge({
  severity,
  className,
}: {
  severity: SeverityValue;
  className?: string;
}) {
  const styles: Record<SeverityValue, string> = {
    blocker: "bg-red-100 text-red-800",
    normal: "bg-orange-100 text-orange-800",
    low: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        styles[severity],
        className
      )}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}
