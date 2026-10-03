import { and, countDistinct, eq, gte, inArray, sql } from "drizzle-orm";
import { union } from "drizzle-orm/sqlite-core";
import { db } from "~/db";
import {
  CourseStatus,
  courseRatings,
  courses,
  enrollments,
  LessonProgressStatus,
  lessonProgress,
  lessons,
  modules,
  purchases,
  videoWatchEvents,
} from "~/db/schema";
import { getUnansweredQuestions } from "~/services/commentService";

// ─── Analytics Service ───
// Instructor analytics, computed on demand with SQL aggregates.
// Uses positional parameters (project convention).

// Analytics cover an instructor's published and archived courses. Drafts are
// unreleased work and never contribute.
const INCLUDED_STATUSES = [CourseStatus.Published, CourseStatus.Archived];

function isIncludedCourseOf(instructorId: number) {
  return and(
    eq(courses.instructorId, instructorId),
    inArray(courses.status, INCLUDED_STATUSES)
  );
}

const ACTIVE_WINDOW_DAYS = 30;

/**
 * (student, course) pairs with activity in the last 30 days: a completed lesson
 * or a video watch event. Lesson progress only records a time on completion, so
 * watch events are what catch a student partway through a lesson.
 */
function recentActivity(instructorId: number) {
  const cutoff = new Date(
    Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000
  ).toISOString();

  const completions = db
    .select({ userId: lessonProgress.userId, courseId: courses.id })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(
      and(
        isIncludedCourseOf(instructorId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        gte(lessonProgress.completedAt, cutoff)
      )
    );

  const watches = db
    .select({ userId: videoWatchEvents.userId, courseId: courses.id })
    .from(videoWatchEvents)
    .innerJoin(lessons, eq(videoWatchEvents.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(
      and(
        isIncludedCourseOf(instructorId),
        gte(videoWatchEvents.createdAt, cutoff)
      )
    );

  return union(completions, watches).as("recent_activity");
}

export function getInstructorOverview(instructorId: number) {
  const includedCourses = db
    .select({ total: sql<number>`count(*)` })
    .from(courses)
    .where(isIncludedCourseOf(instructorId))
    .get();

  const revenue = db
    .select({ total: sql<number>`coalesce(sum(${purchases.amountPaid}), 0)` })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(isIncludedCourseOf(instructorId))
    .get();

  const enrollment = db
    .select({
      total: sql<number>`count(*)`,
      completed: sql<number>`count(${enrollments.completedAt})`,
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(isIncludedCourseOf(instructorId))
    .get();

  const activity = recentActivity(instructorId);
  const active = db
    .select({ total: countDistinct(activity.userId) })
    .from(activity)
    .get();

  const totalStudents = enrollment?.total ?? 0;
  const completed = enrollment?.completed ?? 0;

  return {
    includedCourseCount: includedCourses?.total ?? 0,
    grossRevenue: revenue?.total ?? 0,
    totalStudents,
    // Null rather than 0 when nobody is enrolled — there is no rate to report.
    completionRate: totalStudents > 0 ? completed / totalStudents : null,
    activeStudents: active?.total ?? 0,
    // The questions queue owns what "unanswered" means; count what it lists.
    unansweredQuestions: getUnansweredQuestions(instructorId).length,
  };
}

export type CourseBreakdownRow = {
  id: number;
  title: string;
  status: CourseStatus;
  revenue: number;
  enrollments: number;
  completionRate: number | null;
  averageRating: number | null;
  ratingCount: number;
  activeStudents: number;
};

// Each figure is aggregated per course in its own query, then merged — joining
// purchases, enrollments and ratings together would multiply rows.
export function getCourseBreakdown(instructorId: number): CourseBreakdownRow[] {
  const included = isIncludedCourseOf(instructorId);

  const courseRows = db
    .select({ id: courses.id, title: courses.title, status: courses.status })
    .from(courses)
    .where(included)
    .all();

  const revenueByCourse = new Map(
    db
      .select({
        courseId: purchases.courseId,
        total: sql<number>`sum(${purchases.amountPaid})`,
      })
      .from(purchases)
      .innerJoin(courses, eq(purchases.courseId, courses.id))
      .where(included)
      .groupBy(purchases.courseId)
      .all()
      .map((row) => [row.courseId, row.total])
  );

  const enrollmentByCourse = new Map(
    db
      .select({
        courseId: enrollments.courseId,
        total: sql<number>`count(*)`,
        completed: sql<number>`count(${enrollments.completedAt})`,
      })
      .from(enrollments)
      .innerJoin(courses, eq(enrollments.courseId, courses.id))
      .where(included)
      .groupBy(enrollments.courseId)
      .all()
      .map((row) => [row.courseId, row])
  );

  const ratingByCourse = new Map(
    db
      .select({
        courseId: courseRatings.courseId,
        average: sql<number>`avg(${courseRatings.rating})`,
        count: sql<number>`count(*)`,
      })
      .from(courseRatings)
      .innerJoin(courses, eq(courseRatings.courseId, courses.id))
      .where(included)
      .groupBy(courseRatings.courseId)
      .all()
      .map((row) => [row.courseId, row])
  );

  const activity = recentActivity(instructorId);
  const activeByCourse = new Map(
    db
      .select({
        courseId: activity.courseId,
        total: countDistinct(activity.userId),
      })
      .from(activity)
      .groupBy(activity.courseId)
      .all()
      .map((row) => [row.courseId, row.total])
  );

  return courseRows
    .map((course) => {
      const enrollment = enrollmentByCourse.get(course.id);
      const rating = ratingByCourse.get(course.id);
      const enrolled = enrollment?.total ?? 0;

      return {
        ...course,
        revenue: revenueByCourse.get(course.id) ?? 0,
        enrollments: enrolled,
        completionRate: enrolled > 0 ? enrollment!.completed / enrolled : null,
        averageRating: rating?.average ?? null,
        ratingCount: rating?.count ?? 0,
        activeStudents: activeByCourse.get(course.id) ?? 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}
