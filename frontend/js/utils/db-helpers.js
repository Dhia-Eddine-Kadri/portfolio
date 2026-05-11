// Shared Supabase helpers — exposed on window._ssDb for IIFE feature scripts.
(function () {
  function _supaHeaders() {
    var token = window._sbToken || '';
    var key = window._SAKEY || '';
    return { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': 'Bearer ' + token };
  }
  function _supaUrl() { return (window._SUPA || '').replace(/\/$/, ''); }
  function _userId() {
    try {
      var p = (window._sbToken || '').split('.')[1];
      return JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))).sub || null;
    } catch (e) { return null; }
  }
  window._ssDb = { supaHeaders: _supaHeaders, supaUrl: _supaUrl, userId: _userId };
})();
