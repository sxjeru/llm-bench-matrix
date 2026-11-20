import { handleDashboardRequest } from "./handler";
import { withApiLogging } from "@/lib/api-logging";

export function GET(request: Request) {
  return withApiLogging(request, "api.public.dashboard", () => handleDashboardRequest(request));
}
