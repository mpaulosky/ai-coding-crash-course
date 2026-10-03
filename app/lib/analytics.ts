// Analytics ranges live here rather than in analyticsService so that the range
// picker can import them without pulling the database driver into the browser
// bundle.

export const ANALYTICS_RANGES = ["7d", "30d", "90d", "all"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
