import { canonicalPath } from './paths.mjs';
import { NativeError } from './bridge.mjs';

export function previewPaths(path, roots) {
  const pdf = canonicalPath(path, { extensions: ['.pdf'], mustBeNew: true, roots });
  const image = canonicalPath(pdf.replace(/\.pdf$/i, '.png'), { extensions: ['.png'], mustBeNew: true, roots });
  return { path: pdf, image_path: image };
}
export function visualPaths(options, roots) {
  const before = previewPaths(options.before_path, roots), after = previewPaths(options.after_path, roots);
  if (new Set([before.path, before.image_path, after.path, after.image_path]).size !== 4) throw new NativeError('PREVIEW_PATH_COLLISION', 'Choose distinct before/after PDF paths (and derived PNG names).');
  return { before, after };
}
