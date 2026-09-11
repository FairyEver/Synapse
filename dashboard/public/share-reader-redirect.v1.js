(function () {
  'use strict';

  var pathname = window.location.pathname;
  var isShareRoot = /^\/share\/[^/]+$/.test(pathname);
  var isShareItem = /^\/share\/[^/]+\/items\/[^/]+$/.test(pathname);
  if (!isShareRoot && !isShareItem) return;

  var css = window.CSS;
  var supportsFullSharePage = Boolean(
    window.Promise &&
    window.fetch &&
    window.AbortController &&
    window.ResizeObserver &&
    window.URL &&
    window.URLSearchParams &&
    window.crypto &&
    window.crypto.getRandomValues &&
    css &&
    css.supports &&
    css.registerProperty &&
    css.supports('color', 'oklch(50% 0 0)') &&
    css.supports('color', 'color-mix(in oklab, black, white)')
  );

  if (!supportsFullSharePage) {
    window.location.replace(pathname + '/reader' + window.location.search + window.location.hash);
  }
}());
