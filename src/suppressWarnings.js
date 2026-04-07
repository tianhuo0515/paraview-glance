/* eslint-disable no-param-reassign, func-names, consistent-return */
/**
 * 抑制开发环境下的冗余警告
 * - Canvas2D willReadFrequently: VTK.js AnnotatedCubeActor 的 canvas 操作
 * - Resetting view-up: VTK 相机方向自动修正
 * - vtkCCSInsertTriangle assertion error: VTK ClipClosedSurface 已知 bug
 * - GenerateSW multiple times: Workbox dev server HMR 导致
 */

// 1. 抑制 Canvas2D willReadFrequently 警告
const _getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function getContext(type, attrs) {
  if (type === '2d' && !attrs) {
    attrs = { willReadFrequently: true };
  } else if (type === '2d') {
    attrs = { ...attrs, willReadFrequently: true };
  }
  return _getContext.call(this, type, attrs);
};

// 2. 抑制 VTK/Workbox 冗余控制台警告
const SUPPRESSED_WARNINGS = [
  'Resetting view-up since view plane normal is parallel',
  'assertion error in vtkCCSInsertTriangle',
  'GenerateSW has been called multiple times',
  'Warnings while compiling',
];

function shouldSuppress(msg) {
  return SUPPRESSED_WARNINGS.some((pattern) => msg.includes(pattern));
}

const _origConsoleWarn = console.warn;
const _origConsoleError = console.error;
/* eslint-disable-next-line no-console */
console.warn = function warn(...args) {
  const msg = args[0] ? String(args[0]) : '';
  if (shouldSuppress(msg)) {
    return;
  }
  return _origConsoleWarn.apply(console, args);
};
/* eslint-disable-next-line no-console */
console.error = function error(...args) {
  const msg = args[0] ? String(args[0]) : '';
  if (shouldSuppress(msg)) {
    return;
  }
  return _origConsoleError.apply(console, args);
};
