cd "$(dirname "$0")/src"
{ cat 1-head.html 2-css.html 3-css.html 4-body.html; echo '<script>"use strict";'; cat 0-i18n.js data.js 6-js.js 7-js.js; echo '</script></body></html>'; } > ../index.html
