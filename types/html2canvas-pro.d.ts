declare module "html2canvas-pro" {
  type Html2CanvasFn = (
    element: HTMLElement,
    options?: Record<string, unknown>
  ) => Promise<HTMLCanvasElement>;

  const html2canvas: Html2CanvasFn;
  export default html2canvas;
}
