/* ═══════════════════════════════════
   SUPABASE JS — Client data layer & realtime sync
   Works on GitHub Pages (static hosting, no server required)
═══════════════════════════════════ */

(function () {
  'use strict';

  let supabase = null;
  let ready = false;
  let channels = [];
  let refreshCallback = null;

  function getConfig() {
    if (typeof window === 'undefined') return null;
    return window.SUPABASE_CONFIG || null;
  }

  function isConfigured() {
    const cfg = getConfig();
    return cfg && cfg.url && cfg.url !== 'YOUR_SUPABASE_PROJECT_URL' &&
           cfg.anonKey && cfg.anonKey !== 'YOUR_SUPABASE_ANON_KEY';
  }

  function init() {
    if (!isConfigured()) {
      console.warn('[Supabase] supabase-config.js not configured.');
      return false;
    }
    if (typeof supabaseJs === 'undefined' && typeof window.supabase === 'undefined') {
      console.warn('[Supabase] @supabase/supabase-js SDK not loaded.');
      return false;
    }
    try {
      const { createClient } = window.supabase || supabaseJs;
      const cfg = getConfig();
      supabase = createClient(cfg.url, cfg.anonKey, {
        realtime: { params: { eventsPerSecond: 10 } }
      });
      ready = true;
      console.log('[Supabase] Client initialized.');
      return true;
    } catch (e) {
      console.error('[Supabase] Init error:', e.message);
      return false;
    }
  }

  // ── Realtime Subscriptions ──

  function subscribeAll(callback) {
    refreshCallback = callback;
    if (!ready || !supabase) return;
    unsubscribeAll();

    const tables = ['employees', 'attendance', 'attendance_logs', 'leave_requests', 'announcements',
                    'departments', 'notifications', 'archived_employees', 'admin'];
    let debounceTimer = null;

    tables.forEach(table => {
      const channel = supabase
        .channel('ems-' + table)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: table },
          (payload) => {
            console.log('[Supabase] Realtime:', table, payload.eventType);
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              if (refreshCallback) refreshCallback({ table, event: payload.eventType });
            }, 300);
          }
        )
        .subscribe();
      channels.push(channel);
    });
  }

  function subscribeToAttendance(callback) {
    if (!ready || !supabase) return null;
    const channel = supabase
      .channel('ems-attendance-live')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'attendance' },
        (payload) => {
          console.log('[Supabase] Attendance live update:', payload.eventType);
          if (callback) callback(payload);
        }
      )
      .subscribe();
    channels.push(channel);
    return channel;
  }

  function unsubscribeAll() {
    channels.forEach(ch => supabase?.removeChannel(ch));
    channels = [];
  }

  // ── Data Fetching Helpers ──

  async function getAll(table, orderBy) {
    if (!ready || !supabase) return [];
    let query = supabase.from(table).select('*');
    if (orderBy) query = query.order(orderBy, { ascending: false });
    const { data, error } = await query;
    if (error) { console.error('[Supabase] getAll error:', table, error.message); return []; }
    return data || [];
  }

  async function getById(table, column, value) {
    if (!ready || !supabase) return null;
    const { data, error } = await supabase.from(table).select('*').eq(column, value).single();
    if (error) { return null; }
    return data;
  }

  async function getByFilter(table, filters) {
    if (!ready || !supabase) return [];
    let query = supabase.from(table).select('*');
    for (const [key, val] of Object.entries(filters)) {
      query = query.eq(key, val);
    }
    const { data, error } = await query;
    if (error) { console.error('[Supabase] getByFilter error:', table, error.message); return []; }
    return data || [];
  }

  async function insert(table, record) {
    if (!ready || !supabase) return null;
    const { data, error } = await supabase.from(table).insert(record).select();
    if (error) { console.error('[Supabase] insert error:', table, error.message); return null; }
    return data?.[0] || record;
  }

  async function upsert(table, record, onConflict) {
    if (!ready || !supabase) return null;
    let query = supabase.from(table).upsert(record, { onConflict });
    const { data, error } = await query.select();
    if (error) { console.error('[Supabase] upsert error:', table, error.message); return null; }
    return data?.[0] || record;
  }

  async function update(table, column, value, updates) {
    if (!ready || !supabase) return false;
    const { error } = await supabase.from(table).update(updates).eq(column, value);
    if (error) { console.error('[Supabase] update error:', table, error.message); return false; }
    return true;
  }

  async function remove(table, column, value) {
    if (!ready || !supabase) return false;
    const { error } = await supabase.from(table).delete().eq(column, value);
    if (error) { console.error('[Supabase] delete error:', table, error.message); return false; }
    return true;
  }

  async function rawQuery(queryStr) {
    if (!ready || !supabase) return null;
    const { data, error } = await supabase.rpc('exec_sql', { query: queryStr }).single();
    if (error) { console.error('[Supabase] rawQuery error:', error.message); return null; }
    return data;
  }

  // ── Public API ──

  const api = {
    init,
    isReady: () => ready,
    isConfigured,
    subscribeAll,
    subscribeToAttendance,
    unsubscribeAll,
    getAll,
    getById,
    getByFilter,
    insert,
    upsert,
    update,
    remove,
    get supabase() { return supabase; }
  };

  window.SupabaseDB = api;

  // Node.js export for local-logger.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initSupabase: init, supabaseClient: () => supabase };
  }
})();
