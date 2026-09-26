(function () {
  'use strict';

  // 在应用 JS 起来之前先把主题类挂到 <html> 上，避免深色模式下打开页面先白屏一闪。
  // cookie 名、默认值和判定逻辑必须与 src/context/theme-provider.tsx 保持一致，
  // 由 src/context/theme-provider.test.tsx 里的用例守着。
  var COOKIE_NAME = 'vite-ui-theme';

  var stored = null;
  var parts = ('; ' + document.cookie).split('; ' + COOKIE_NAME + '=');
  if (parts.length === 2) {
    stored = parts.pop().split(';').shift();
  }

  var isDark = stored === 'dark' || stored === 'light'
    ? stored === 'dark'
    : Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

  document.documentElement.classList.add(isDark ? 'dark' : 'light');
}());
