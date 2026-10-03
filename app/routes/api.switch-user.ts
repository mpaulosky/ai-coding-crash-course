import { redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.switch-user";
import { setCurrentUserId, defaultLandingPath } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { parseFormData } from "~/lib/validation";

const switchUserSchema = z.object({
  userId: z.coerce.number().int().positive("Invalid user ID"),
});

export async function action({ request, url }: Route.ActionArgs) {
  const formData = await request.formData();
  const parsed = parseFormData(formData, switchUserSchema);

  if (!parsed.success) {
    throw new Response("Invalid user ID", { status: 400 });
  }

  const cookie = await setCurrentUserId(request, parsed.data.userId);

  const redirectTo =
    url.searchParams.get("redirectTo") ??
    defaultLandingPath(getUserById(parsed.data.userId)?.role, "/");

  return redirect(redirectTo, {
    headers: { "Set-Cookie": cookie },
  });
}
