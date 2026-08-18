export const HOME_PATH = "/";
export const SCATTER_PATH = "/scatter";

export function isHomePath(pathname: string): boolean {
  return pathname === HOME_PATH;
}

export function isScatterPath(pathname: string): boolean {
  return pathname === SCATTER_PATH || pathname.startsWith(`${SCATTER_PATH}/`);
}
