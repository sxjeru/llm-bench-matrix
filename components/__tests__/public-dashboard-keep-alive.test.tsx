import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const pathnameState = vi.hoisted(() => ({ value: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.value
}));

vi.mock("@/components/home-benchmark-matrix", () => ({
  HomeBenchmarkMatrix: ({ urlSyncEnabled }: { urlSyncEnabled?: boolean }) => (
    <div data-testid="home-matrix" data-url-sync={String(urlSyncEnabled ?? true)} />
  )
}));

vi.mock("@/components/home-model-scatter", () => ({
  HomeModelScatter: ({ urlSyncEnabled }: { urlSyncEnabled?: boolean }) => (
    <div data-testid="home-scatter" data-url-sync={String(urlSyncEnabled ?? true)} />
  )
}));

import { PublicDashboardKeepAlive } from "@/components/public-dashboard-keep-alive";
import { HOME_PATH, SCATTER_PATH } from "@/lib/public-routes";

describe("PublicDashboardKeepAlive", () => {
  afterEach(() => {
    pathnameState.value = HOME_PATH;
  });

  test("首页先只挂矩阵，散点等到第一次访问再挂", () => {
    const { rerender } = render(
      <PublicDashboardKeepAlive>
        <div data-testid="page-shell">home</div>
      </PublicDashboardKeepAlive>
    );

    expect(screen.getByTestId("page-shell")).toHaveTextContent("home");
    expect(screen.getByTestId("home-matrix")).toBeVisible();
    expect(screen.getByTestId("home-matrix")).toHaveAttribute("data-url-sync", "true");
    expect(screen.queryByTestId("home-scatter")).not.toBeInTheDocument();

    pathnameState.value = SCATTER_PATH;
    rerender(
      <PublicDashboardKeepAlive>
        <div data-testid="page-shell">scatter</div>
      </PublicDashboardKeepAlive>
    );

    expect(screen.getByTestId("home-matrix")).toBeInTheDocument();
    expect(screen.getByTestId("home-matrix")).not.toBeVisible();
    expect(screen.getByTestId("home-matrix")).toHaveAttribute("data-url-sync", "false");
    expect(screen.getByTestId("home-scatter")).toBeVisible();
    expect(screen.getByTestId("home-scatter")).toHaveAttribute("data-url-sync", "true");
  });

  test("从散点落地时先只挂散点，回首页后矩阵才出现并保活", () => {
    pathnameState.value = SCATTER_PATH;

    const { rerender } = render(
      <PublicDashboardKeepAlive>
        <div data-testid="page-shell">scatter</div>
      </PublicDashboardKeepAlive>
    );

    expect(screen.getByTestId("home-scatter")).toBeVisible();
    expect(screen.getByTestId("home-scatter")).toHaveAttribute("data-url-sync", "true");
    expect(screen.queryByTestId("home-matrix")).not.toBeInTheDocument();

    pathnameState.value = HOME_PATH;
    rerender(
      <PublicDashboardKeepAlive>
        <div data-testid="page-shell">home</div>
      </PublicDashboardKeepAlive>
    );

    expect(screen.getByTestId("home-matrix")).toBeVisible();
    expect(screen.getByTestId("home-matrix")).toHaveAttribute("data-url-sync", "true");
    expect(screen.getByTestId("home-scatter")).toBeInTheDocument();
    expect(screen.getByTestId("home-scatter")).not.toBeVisible();
    expect(screen.getByTestId("home-scatter")).toHaveAttribute("data-url-sync", "false");
  });
});
