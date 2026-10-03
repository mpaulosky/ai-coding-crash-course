import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { CourseStatus } from "~/db/schema";
import { formatPrice } from "~/lib/utils";
import type { FunnelStep, TrendPoint } from "~/services/analyticsService";

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

/** A YYYY-MM-DD bucket start as a short label, e.g. "Jun 9" or "Jun 2026". */
function formatBucket(bucketStart: string, monthly: boolean) {
  return new Date(`${bucketStart}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    ...(monthly ? { year: "numeric" } : { day: "numeric" }),
  });
}

/** Revenue as bars against the left axis, new enrollments as a line on the right. */
export function TrendChart({
  points,
  monthly,
}: {
  points: TrendPoint[];
  monthly: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={points} margin={{ top: 8, right: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="bucketStart"
          tickFormatter={(value: string) => formatBucket(value, monthly)}
          tick={{ fontSize: 12 }}
          minTickGap={16}
        />
        <YAxis
          yAxisId="revenue"
          tickFormatter={(cents: number) => `$${Math.round(cents / 100)}`}
          tick={{ fontSize: 12 }}
        />
        <YAxis
          yAxisId="enrollments"
          orientation="right"
          allowDecimals={false}
          tick={{ fontSize: 12 }}
        />
        <Tooltip
          labelFormatter={(value) => formatBucket(String(value), monthly)}
          formatter={(value, name) =>
            name === "Revenue" ? formatRevenue(Number(value)) : value
          }
        />
        <Legend />
        <Bar
          yAxisId="revenue"
          dataKey="revenue"
          name="Revenue"
          fill="var(--color-chart-2)"
          radius={[4, 4, 0, 0]}
        />
        <Line
          yAxisId="enrollments"
          dataKey="enrollments"
          name="New enrollments"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          dot={false}
          type="monotone"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function formatStep(step: FunnelStep) {
  const percent = `${Math.round(step.percent ?? 0)}%`;
  const drop = Math.round(step.drop ?? 0);
  return `${step.completed} (${percent})${drop > 0 ? ` · −${drop} pts` : ""}`;
}

/**
 * One module's lessons as horizontal bars of the share of enrolled students who
 * completed each. The lesson with the largest drop is drawn in the alert color.
 */
export function FunnelChart({
  steps,
  largestDropLessonId,
}: {
  steps: FunnelStep[];
  largestDropLessonId: number | null;
}) {
  return (
    <ResponsiveContainer width="100%" height={steps.length * 44 + 16}>
      <BarChart
        data={steps}
        layout="vertical"
        margin={{ top: 0, right: 160, left: 8, bottom: 0 }}
      >
        <XAxis type="number" domain={[0, 100]} hide />
        <YAxis
          type="category"
          dataKey="lessonTitle"
          width={220}
          tick={{ fontSize: 13 }}
          tickLine={false}
          axisLine={false}
        />
        <Bar dataKey="percent" radius={[0, 4, 4, 0]} barSize={24}>
          {steps.map((step) => (
            <Cell
              key={step.lessonId}
              fill={
                step.lessonId === largestDropLessonId
                  ? "var(--color-destructive)"
                  : "var(--color-chart-2)"
              }
            />
          ))}
          <LabelList
            dataKey="lessonId"
            position="right"
            fontSize={12}
            formatter={(lessonId) => {
              const step = steps.find((s) => s.lessonId === lessonId);
              return step ? formatStep(step) : "";
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
