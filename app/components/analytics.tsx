import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { CourseStatus } from "~/db/schema";
import { formatPrice } from "~/lib/utils";

// ─── Analytics Display ───
// Cards and formatters shared by the instructor analytics pages.

/** Revenue in cents as money. Unlike a price, zero revenue is "$0.00", not "Free". */
export function formatRevenue(cents: number) {
  return cents === 0 ? "$0.00" : formatPrice(cents);
}

/** A 0–1 rate as a whole percentage, or "No data" when there is no rate. */
export function formatRate(rate: number | null) {
  return rate === null ? "No data" : `${Math.round(rate * 100)}%`;
}

export function formatRating(average: number | null, count: number) {
  if (average === null) return "No ratings";
  return `${average.toFixed(1)} ★ (${count})`;
}

export function StatCard({
  title,
  value,
  icon: Icon,
  footer,
}: {
  title: string;
  value: string;
  icon: LucideIcon;
  footer?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        {footer && <div className="mt-1 text-sm">{footer}</div>}
      </CardContent>
    </Card>
  );
}

export function StatusBadge({ status }: { status: CourseStatus }) {
  const style =
    status === CourseStatus.Published
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      : status === CourseStatus.Archived
        ? "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400"
        : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${style}`}
    >
      {status}
    </span>
  );
}
