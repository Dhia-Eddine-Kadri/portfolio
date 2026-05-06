// Public frontend configuration. These values are safe to expose in browser code.
(function () {
  var cfg = {
    googleClientId: '345518014023-dsgciaeuvm9nak002avlrpdnikldusuq.apps.googleusercontent.com',
    supabaseUrl: 'https://wprfkjeiawxlcnitsfdr.supabase.co',
    supabaseAnonKey:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndwcmZramVpYXd4bGNuaXRzZmRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMjAyMzUsImV4cCI6MjA4OTc5NjIzNX0.LbJKG8J_jd2oKYAmQg0ycb-LBnQM1ItlseOLMT_24jc',
    paypalSdkUrl:
      'https://www.paypal.com/sdk/js?client-id=AXujeSZkOypAa2RuWUkmO0PX_BNMszy5rH_hvys2fTcwx-6gFCJOW1-ICXRGdDlB6X1BwdmFsy463rFN&vault=true&intent=subscription&currency=EUR',
    ai: {
      model: 'claude-sonnet-4-5',
      maxTokens: 4096,
      pdfCharacterCap: 100000,
      imageMax: 5
    }
  };

  window.StudySphereConfig = Object.assign({}, window.StudySphereConfig || {}, cfg);

  // Backwards-compatible globals used by existing feature files.
  window._GCID = window.StudySphereConfig.googleClientId;
  window._SUPA = window.StudySphereConfig.supabaseUrl;
  window._SAKEY = window.StudySphereConfig.supabaseAnonKey;
})();
