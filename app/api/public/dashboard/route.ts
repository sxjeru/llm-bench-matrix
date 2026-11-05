import { handleDashboardRequest } from "./handler";

export function GET(request: Request) {
  return handleDashboardRequest(request);
}
