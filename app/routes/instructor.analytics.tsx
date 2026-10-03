import {
  Link,
  data,
  isRouteErrorResponse,
  useSearchParams,
} from "react-router";
import type { Route } from "./+types/instructor.analytics";
import {
  getCourseBreakdown,
  getInstructorOverview,
  getRevenueInRange,
  getRevenueTrend,
} from "~/services/analyticsService";
import { ANALYTICS_RANGES, type AnalyticsRange } from "~/lib/analytics";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  DollarSign,
  MessageCircleQuestionMark,
  Plus,
  Activity,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  StatCard,
  StatusBadge,
  TrendChart,
  formatRate,
  formatRating,
  formatRevenue,
} from "~/components/analytics";
import { UserRole } from "~/db/schema";

// ─── Instructor Analytics Overview ───
// The instructor's landing page: all-time headline figures across their
// published and archived courses. All numbers come from analyticsService.

export function meta() {
  return [
    { title: "Analytics — Cadence" },
    { name: "description", content: "How your courses are performing" },
  ];
}

const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

const DEFAULT_RANGE: AnalyticsRange = "30d";

function parseRange(value: string | null): AnalyticsRange {
  return ANALYTICS_RANGES.find((range) => range === value) ?? DEFAULT_RANGE;
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to view your analytics.", {
      status: 401,
    });
  }

  const user = getUserById(currentUserId);

  if (!user || user.role !== UserRole.Instructor) {
    throw data("Only instructors can access this page.", {
      status: 403,
    });
  }

  const range = parseRange(new URL(request.url).searchParams.get("range"));

  return {
    range,
    overview: getInstructorOverview(currentUserId),
    breakdown: getCourseBreakdown(currentUserId),
    revenueInRange: getRevenueInRange(currentUserId, range),
    trend: getRevenueTrend(currentUserId, range),
  };
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="mb-6 h-5 w-48" />
      <div className="mb-8">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="mt-2 h-5 w-72" />
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-9 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-10 mb-4 flex items-center justify-between">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-9 w-80" />
      </div>
      <Skeleton className="h-[372px] w-full rounded-xl" />
      <Skeleton className="mt-10 h-64 w-full rounded-xl" />
    </div>
  );
}

export default function InstructorAnalytics({
  loaderData,
}: Route.ComponentProps) {
  const { range, overview, breakdown, revenueInRange, trend } = loaderData;
  const [, setSearchParams] = useSearchParams();

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Analytics</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Analytics</h1>
        <p className="mt-1 text-muted-foreground">
          How your courses are performing
        </p>
      </div>

      {overview.includedCourseCount === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BarChart3 className="mb-4 size-12 text-muted-foreground/50" />
          <h2 className="text-lg font-medium">No analytics yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Publish a course to start seeing revenue, students and completions.
          </p>
          <Link to="/instructor/new" className="mt-4">
            <Button>
              <Plus className="mr-2 size-4" />
              Create Course
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            title="Gross revenue"
            value={formatRevenue(overview.grossRevenue)}
            icon={DollarSign}
          />
          <StatCard
            title="Total students"
            value={overview.totalStudents.toLocaleString()}
            icon={Users}
          />
          <StatCard
            title="Completion rate"
            value={formatRate(overview.completionRate)}
            icon={CheckCircle2}
          />
          <StatCard
            title="Active students (30 days)"
            value={overview.activeStudents.toLocaleString()}
            icon={Activity}
          />
          <StatCard
            title="Unanswered questions"
            value={overview.unansweredQuestions.toLocaleString()}
            icon={MessageCircleQuestionMark}
            footer={
              <Link
                to="/instructor/questions"
                className="text-primary hover:underline"
              >
                View questions
              </Link>
            }
          />
        </div>
      )}

      {overview.includedCourseCount > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">Trends</h2>
            <Tabs
              value={range}
              onValueChange={(value) =>
                setSearchParams({ range: value }, { preventScrollReset: true })
              }
            >
              <TabsList>
                {ANALYTICS_RANGES.map((option) => (
                  <TabsTrigger key={option} value={option}>
                    {RANGE_LABELS[option]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="grid gap-6 lg:grid-cols-4">
            <StatCard
              title="Revenue in range"
              value={formatRevenue(revenueInRange)}
              icon={TrendingUp}
              footer={
                <span className="text-muted-foreground">
                  {RANGE_LABELS[range]}
                </span>
              }
            />
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Revenue and new enrollments</CardTitle>
              </CardHeader>
              <CardContent>
                <TrendChart points={trend} monthly={range === "all"} />
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {breakdown.length > 0 && (
        <Card className="mt-10">
          <CardHeader>
            <CardTitle>Courses</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {[
                      "Course",
                      "Status",
                      "Revenue",
                      "Enrollments",
                      "Completion",
                      "Rating",
                      "Active (30d)",
                    ].map((heading) => (
                      <th
                        key={heading}
                        className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((course) => (
                    <tr
                      key={course.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-3 font-medium">
                        <Link
                          to={`/instructor/${course.id}/analytics`}
                          className="hover:underline"
                        >
                          {course.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={course.status} />
                      </td>
                      <td className="px-4 py-3">
                        {formatRevenue(course.revenue)}
                      </td>
                      <td className="px-4 py-3">
                        {course.enrollments.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {formatRate(course.completionRate)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatRating(course.averageRating, course.ratingCount)}
                      </td>
                      <td className="px-4 py-3">
                        {course.activeStudents.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading your analytics.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else if (error.status === 403) {
      title = "Access denied";
      message =
        typeof error.data === "string"
          ? error.data
          : "You don't have permission to access this page.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/courses">
            <Button variant="outline">Browse Courses</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
