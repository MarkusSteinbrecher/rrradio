// GoatCounter bootstrap. Loads only on the deployed host so localhost
// dev traffic doesn't pollute stats. Lives in a separate file (not
// inline) so the page can ship a strict CSP — `script-src 'self'`
// covers the bootstrap; `script-src https://gc.zgo.at` covers the
// loaded count.js.
(function () {
  var h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '') return;
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.setAttribute('data-goatcounter', 'https://markussteinbrecher.goatcounter.com/count');
  document.head.appendChild(s);
})();
