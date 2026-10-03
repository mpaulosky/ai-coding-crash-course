import { Link, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/instructor.$courseId.analytics";
import {
  getCourseFunnel,
  getCourseSummary,
  type FunnelStep,
} from "~/services/analyticsService";
import { getCourseById } from "~/services/courseService";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  FunnelChart,
  StatCard,
  StatusBadge,
  formatRate,
  formatRating,
  formatRevenue,
} from "~/components/analytics";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Star,
  TrendingDown,
  Users,
} from "lucide-react";
import { UserRole } from "~/db/schema";

// ─── Course Analytics ───
// One course's figures (matching its row on the overview) and a lesson-by-lesson
// drop-off funnel. All numbers come from analyticsService.

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.summary?.title ?? "Course";
  return [
    { title: `Analytics: ${title} — Cadence` },
    { name: "description", content: `How ${title} is performing` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
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

  const courseId = parseInt(params.courseId, 10);
  if (isNaN(courseId)) {
    throw data("Invalid course ID.", { status: 400 });
  }

  const course = getCourseById(courseId);

  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  if (course.instructorId !== currentUserId) {
    throw data("You can only view analytics for your own courses.", {
      status: 403,
    });
  }

  const summary = getCourseSummary(currentUserId, courseId);

  // Drafts are left out of analytics until they're released
  if (!summary) {
    throw data("Analytics are available once a course is published.", {
      status: 404,
    });
  }

  return { summary, funnel: getCourseFunnel(courseId) };
}

/** Consecutive steps that share a module, in funnel order. */
function groupByModule(steps: FunnelStep[]) {
  const groups: {
    moduleId: number;
    moduleTitle: string;
    steps: FunnelStep[];
  }[] = [];
  for (const step of steps) {
    const last = groups.at(-1);
    if (last?.moduleId === step.moduleId) {
      last.steps.push(step);
    } else {
      groups.push({
        moduleId: step.moduleId,
        moduleTitle: step.moduleTitle,
        steps: [step],
      });
    }
  }
  return groups;
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <Skeleton className="mb-6 h-5 w-72" />
      <div className="mb-8">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="mt-2 h-5 w-24" />
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-9 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="mt-10 h-96 w-full rounded-xl" />
    </div>
  );
}

export default function CourseAnalytics({ loaderData }: Route.ComponentProps) {
  const { summary, funnel } = loaderData;
  const largestDrop = funnel.steps.find(
    (step) => step.lessonId === funnel.largestDropLessonId
  );

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/instructor" className="hover:text-foreground">
          My Courses
        </Link>
        <span className="mx-2">/</span>
        <Link to="/instructor/analytics" className="hover:text-foreground">
          Analytics
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{summary.title}</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{summary.title}</h1>
          <div className="mt-2">
            <StatusBadge status={summary.status} />
          </div>
        </div>
        <Link to={`/instructor/${summary.id}`}>
          <Button variant="outline">Edit course</Button>
        </Link>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Gross revenue"
          value={formatRevenue(summary.revenue)}
          icon={DollarSign}
        />
        <StatCard
          title="Enrollments"
          value={summary.enrollments.toLocaleString()}
          icon={Users}
        />
        <StatCard
          title="Completion rate"
          value={formatRate(summary.completionRate)}
          icon={CheckCircle2}
        />
        <StatCard
          title="Average rating"
          value={formatRating(summary.averageRating, summary.ratingCount)}
          icon={Star}
        />
        <StatCard
          title="Active students (30 days)"
          value={summary.activeStudents.toLocaleString()}
          icon={Activity}
        />
      </div>

      <Card className="mt-10">
        <CardHeader>
          <CardTitle>Lesson drop-off</CardTitle>
          <p className="text-sm text-muted-foreground">
            Students who completed each lesson, as a share of everyone enrolled
          </p>
        </CardHeader>
        <CardContent>
          {funnel.enrolled === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="mb-4 size-12 text-muted-foreground/50" />
              <h2 className="text-lg font-medium">No students yet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The funnel fills in once students enroll.
              </p>
            </div>
          ) : (
            <>
              {largestDrop && (
                <div className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <TrendingDown className="mt-0.5 size-5 shrink-0 text-destructive" />
                  <div className="text-sm">
                    <div className="font-medium">
                      Biggest drop: {largestDrop.lessonTitle}
                    </div>
                    <div className="text-muted-foreground">
                      {largestDrop.moduleTitle} ·{" "}
                      {Math.round(largestDrop.drop ?? 0)} percentage points
                      fewer students than the step before
                    </div>
                  </div>
                </div>
              )}
              {funnel.steps.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This course has no lessons.
                </p>
              ) : (
                <div className="space-y-6">
                  {groupByModule(funnel.steps).map((group) => (
                    <div key={group.moduleId}>
                      <h3 className="mb-2 text-sm font-semibold">
                        {group.moduleTitle}
                      </h3>
                      <FunnelChart
                        steps={group.steps}
                        largestDropLessonId={funnel.largestDropLessonId}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading course analytics.";

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
    } else if (error.status === 404) {
      title = "Not found";
      message =
        typeof error.data === "string"
          ? error.data
          : "The course you're looking for doesn't exist.";
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
          <Link to="/instructor/analytics">
            <Button variant="outline">Back to Analytics</Button>
          </Link>
          <Link to="/">
            <Button>Go Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
