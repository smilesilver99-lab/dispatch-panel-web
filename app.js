/* =============================================================
   DESPACHO WEB – Panel de Administración
   app.js – Datos, lógica y renderizado
   ============================================================= */

// =============================================================
// DATOS
// =============================================================

// Drivers list used for filters / display — start empty, will be populated from Supabase
let CAMIONEROS = [];

// Drivers loaded from Supabase `drivers` table (id, name)
let DRIVERS = [];

// Brokers loaded from Supabase `brokers` table
let BROKERS = [];

// Cities loaded from Supabase `cities` table
let CITIES = [];

// Application loads list (initially empty). Real data will be loaded from Supabase.
let CARGAS = [];

// Loading flags for remote loads
let isLoadingLoads = false;
let loadsFetched = false;
let navigationRefreshToken = 0;

// =============================================================
// ESTADO DE LA APP
// =============================================================

let currentView = "dashboard";
let filtered = [...CARGAS];
let currentUploadCargaId = null;
let currentUploadTipo = null;
let openModalCargaId = null;
// Currently open driver being edited in the Edit Driver modal
let openDriverEditId = null;
let docPreviewScale = 1;
let docPreviewRotation = 0;
let docPreviewBlobUrl = null;
let docPreviewOffsetX = 0;
let docPreviewOffsetY = 0;
let docPreviewDragging = false;
let docPreviewDragStartX = 0;
let docPreviewDragStartY = 0;
let selectedEstado = "";
let pendingDocDelete = null;

// Pagination state
let pagination = {
  rowsPerPage: 40,
  currentPage: 1
};

// Date range filter state
let dateRangeState = {
  start: null, // ISO yyyy-mm-dd
  end: null,
  visibleMonth: new Date()
};

// Multi-select filter state for STATUS and STATE
const STATUS_FILTER_OPTIONS = ['Pending', 'Confirmed', 'Completed', 'Delayed', 'Canceled'];
const STATE_FILTER_OPTIONS = ['Awaiting', 'Picked up', 'In Transit', 'Delivered', 'Waiting for new rate', 'Invoice uploaded', 'Paid'];
window.filterStatusSelected = [];
window.filterStateSelected = [];
window.filterDriverSelected = [];

function getFilterSelectionArray(type) {
  if (type === 'status') return window.filterStatusSelected;
  if (type === 'state') return window.filterStateSelected;
  if (type === 'driver') return window.filterDriverSelected;
  return null;
}

function getFilterDefaultLabel(type) {
  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  if (type === 'status') return isMobile ? 'Status' : 'Select Status';
  if (type === 'state') return isMobile ? 'State' : 'Select State';
  if (type === 'driver') return isMobile ? 'Drivers' : 'Select Drivers';
  return 'Select';
}

function refreshFilterDropdownLabels() {
  updateDropdownLabel('status');
  updateDropdownLabel('state');
  updateDropdownLabel('driver');
}

function toggleMultiDropdown(type, ev) {
  try { if (ev) ev.stopPropagation(); } catch(e){}
  const menu = document.getElementById(`filter-${type}-menu`);
  const toggleBtn = document.getElementById(`filter-${type}-toggle`);
  if (!menu) return;
  const isHidden = menu.classList.contains('hidden');
  closeAllMultiDropdowns();
  if (isHidden) {
    menu.classList.remove('hidden');
    if (toggleBtn) toggleBtn.classList.add('open');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
    // focus first checkbox for accessibility
    const firstCb = menu.querySelector('input[type="checkbox"]');
    if (firstCb) firstCb.focus();
  } else {
    menu.classList.add('hidden');
    if (toggleBtn) toggleBtn.classList.remove('open');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
  }
}

function closeAllMultiDropdowns() {
  document.querySelectorAll('.multi-dropdown-menu').forEach(m => m.classList.add('hidden'));
  document.querySelectorAll('.multi-dropdown-toggle').forEach(b => { b.classList.remove('open'); b.setAttribute('aria-expanded','false'); });
}

function onFilterCheckboxChange(type, checkbox) {
  const val = checkbox.value;
  const arr = getFilterSelectionArray(type);
  if (!arr) return;
  if (checkbox.checked) {
    if (!arr.includes(val)) arr.push(val);
  } else {
    const idx = arr.indexOf(val); if (idx !== -1) arr.splice(idx, 1);
  }
  updateDropdownLabel(type);
  applyFilters();
}

function updateDropdownLabel(type) {
  const arr = getFilterSelectionArray(type);
  const btn = document.getElementById(`filter-${type}-toggle`);
  if (!btn || !arr) return;
  if (!arr || arr.length === 0) {
    btn.textContent = getFilterDefaultLabel(type);
    return;
  }

  let labels = arr.slice();
  if (type === 'driver') {
    const byId = new Map((CAMIONEROS || []).map((d) => [String(d.id), String(d.nombre || d.id)]));
    labels = arr.map((id) => byId.get(String(id)) || String(id));
  }

  if (labels.length <= 2) {
    btn.textContent = labels.join(', ');
    return;
  }
  btn.textContent = `${arr.length} selected`;
}

// =============================================================
// INICIALIZACIÓN
// =============================================================

// Supabase configuration (provided)
const SUPABASE_URL = "https://tfnvqtwacotyltnpbkoa.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmbnZxdHdhY290eWx0bnBia29hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNjQ1OTcsImV4cCI6MjA4OTY0MDU5N30.ngrE5yGjNrnPymH08t0aL8DLCzZvPyQRuy_CWnlBgM0"; // anon public key (safer for frontend)
const LOAD_DOCS_BASE_URL = "https://tfnvqtwacotyltnpbkoa.supabase.co/storage/v1/object/public/load_documents/";

// Initialize Supabase client (UMD exposes `supabase` namespace)
let supabaseClient = null;
try {
  if (typeof supabase !== 'undefined' && supabase.createClient) {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
} catch (e) {
  console.warn('Supabase client init failed', e);
}

// Equipment canonical codes and aliases mapping
const EQUIPMENT_CANONICAL = {
  SB: 'Straight Box Truck',
  V:  'Van',
  FB: 'Flatbed',
  PO: 'Power Only',
  RE: 'Reefer',
  SD: 'Step Deck',
  SP: 'Sprinter Van'
};
const EQUIPMENT_ALIASES = {
  'ST': 'SB', 'STB': 'SB', 'SB': 'SB',
  'VAN': 'V', 'V': 'V',
  'FLATBED': 'FB', 'FB': 'FB', 'FL': 'FB',
  'POWERONLY': 'PO', 'PO': 'PO',
  'REEFER': 'RE', 'RF': 'RE', 'R': 'RE', 'RE': 'RE',
  'STEPDECK': 'SD', 'STEP': 'SD', 'SD': 'SD',
  'SPRINTER': 'SP', 'SP': 'SP', 'SV': 'SP'
};
function canonicalEquipmentCode(val) {
  if (!val) return '';
  const up = String(val).trim().toUpperCase();
  if (EQUIPMENT_CANONICAL[up]) return up;
  if (EQUIPMENT_ALIASES[up]) return EQUIPMENT_ALIASES[up];
  // try to match full label
  for (const [code, label] of Object.entries(EQUIPMENT_CANONICAL)) {
    if (label.toUpperCase() === up) return code;
  }
  return up;
}
function equipmentLabelFromCode(code) {
  if (!code) return '';
  return EQUIPMENT_CANONICAL[code] || code;
}

// Normalize capacity types to select values 'full' or 'partial'
function normalizeCapacityType(v) {
  if (!v) return '';
  const s = String(v).trim().toLowerCase();
  if (!s) return '';
  const fullSet = ['full', 'full load', 'full_load', 'full-load', 'f', 'complete', 'ftl', 'complete load'];
  const partialSet = ['partial', 'part', 'p', 'partial load', 'partial_load', 'partial-load', 'ltl', 'less than truckload'];
  if (fullSet.includes(s)) return 'full';
  if (partialSet.includes(s)) return 'partial';
  if (s === 'full' || s === 'partial') return s;
  return '';
}

document.addEventListener("DOMContentLoaded", init);

async function init() {
  setHeaderDate();
  populateCamioneroFilter();
  setupNavigation();
  restoreSidebarState();
  window.addEventListener('resize', syncSidebarWithViewport);
  initDateRangePicker();
  // initialize multi-select dropdowns labels and outside-click closer
  try { refreshFilterDropdownLabels(); } catch (e) {}
  document.addEventListener('click', () => { closeAllMultiDropdowns(); });
  // Attempt to load remote data; show loading state until fetch completes
  isLoadingLoads = true;
  loadsFetched = false;
  renderCargas();
  await loadRemoteData();
  await loadDrivers();
  isLoadingLoads = false;
  loadsFetched = true;
  renderDashboard();
}

async function loadRemoteData() {
  if (!supabaseClient) {
    // No Supabase client available — keep loads empty and update UI
    CARGAS.length = 0;
    CAMIONEROS.length = 0;
    populateCamioneroFilter();
    console.warn('Supabase client not initialized; skipping remote load.');
    return;
  }
  console.log('Cargando datos desde Supabase...');
  try {
    // Fetch current and past loads from Supabase and map to app schema
    // Use paginated fetch to avoid server-side 1000-row limits
    async function fetchAllFrom(table) {
      const limit = 1000;
      let from = 0;
      const all = [];
      while (true) {
        const to = from + limit - 1;
        const { data, error } = await supabaseClient.from(table).select('*').range(from, to);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < limit) break;
        from += limit;
      }
      return all;
    }

    const [loadsData, pastData] = await Promise.all([
      fetchAllFrom('loads_data'),
      fetchAllFrom('past_loads_data'),
    ]);

    const combined = [];
    if (Array.isArray(loadsData)) combined.push(...loadsData);
    if (Array.isArray(pastData))  combined.push(...pastData);

    if (combined.length > 0) {
      CARGAS.length = 0;
      combined.forEach((row, _idx) => {
          // Prefer explicit origin/destination columns when present. Fallback to parsing `origen`/`destino` strings.
          const [parsedOrigCity, parsedOrigState] = splitCityState(row.origen || '');
          const [parsedDestCity, parsedDestState] = splitCityState(row.destino || '');
          const originCityVal = row.origin_city || parsedOrigCity || '';
          const originStateVal = row.origin_state || parsedOrigState || '';
          const destCityVal = row.dest_city || parsedDestCity || '';
          const destStateVal = row.dest_state || parsedDestState || '';

          // detect / generate stable id for the load (prefer common id fields from different schemas)
          let detectedId = row.load_id || row.loadId || row.loadid || row.id || row.ID || row.load_number || row.load_number_str || null;
          const genId = `sup-${_idx + 1}`;
          const finalId = detectedId || genId;
          const mapped = {
            // Use detected id when available otherwise a generated unique id
            id: String(finalId),
            // preserve original DB load_id when available (may be stored under several names)
            load_id: row.load_id || row.loadId || row.loadid || row.load_number || row.load_number_str || row.ID || row.id || null,
            cliente: row.company_name || row.broker || '',
            broker_mc: row.broker_mc || '',
            // normalized origin/destination display + explicit origin/destination fields
            origen: originCityVal ? `${originCityVal}${originStateVal ? ', ' + originStateVal : ''}` : (row.origen || ''),
            destino: destCityVal ? `${destCityVal}${destStateVal ? ', ' + destStateVal : ''}` : (row.destino || ''),
            origin_city: originCityVal || null,
            origin_state: originStateVal || null,
            dest_city: destCityVal || null,
            dest_state: destStateVal || null,
            driver: row.driver || null,
            camionero_id: row.driver_id || null,
            estado: row.status || row.load_status || row.estado || 'Pending',
            // pickup fields
            pick_up_date: row.pick_up_date || row.pickup_date || row.fecha_recogida || '',
            pick_up_date_db: row.pick_up_date || '',
            pick_up_time: row.pick_up_time || row.pickup_time || '',
            // expected pickup / delivery times (various possible column names)
            pick_up_expected_time: row.expected_pick_up || row.expected_pickup || row.pickup_expected_time || row.pick_up_expected_time || row.pick_up_expected || null,
            delivery_expected_time: row.expected_delivery || row.expecteddelivery || row.expected_delivery_time || row.delivery_expected_time || row.delivery_expected || null,
            availability: row.availability || row.availability_window || row.availability_range || null,
            fecha_recogida: row.pick_up_date || row.pickup_date || row.fecha_recogida || '',
            fecha_entrega: row.delivery_date || row.fecha_entrega || '',
            delivery_date: row.delivery_date || row.fecha_entrega || '',
            delivery_date_db: row.delivery_date || '',
            delivery_time: row.delivery_time || row.delivery_time_col || row.delivery_time || '',
            // weight / length / pallets (map common column names, prefer max_* when available)
            max_weight_lbs: row.max_weight_lbs || row.max_weight || row.weight_lbs || row.weight || row.peso || null,
            weight: (row.max_weight_lbs || row.max_weight || row.weight || row.peso || ''),
            max_length_ft: row.max_length_ft || row.length_ft || row.length || null,
            length_ft: (row.max_length_ft || row.length_ft || row.length || ''),
            pallets: row.pallets || row.pallet_count || row.num_pallets || null,
            tipo: row.load_type || row.tipo || '',
            documentos: row.documents || row.documentos || [],
            other_doc: row.other_doc || null,
              rate_usd: row.rate_usd || row.rate || null,
            net_price: row.net_price ?? null,
            commission: row['commission_ %'] ?? row['commission_%'] ?? row.commission ?? row.commision ?? row.commission_pct ?? row.commission_percentage ?? null,
            estimated_rpm: row.estimated_rpm || row.est_rpm || row.rpm_estimated || null,
            capacity: normalizeCapacityType(row.capacity_type || row.capacity || row.capacity_type_code || row.capacityType || null),
            trip_miles: row.trip_miles || row.miles || row.distance || null,
            stops: row.stops || null,
            notas: row.notes || row.notas || '',
            comments: row.comments || row.comment || '',
            origin_deadhead: row.origin_deadhead || row.orig_deadhead || row.deadhead_origin || null,
            dest_deadhead: row.dest_deadhead || row.destination_deadhead || row.deadhead_dest || null,
            contact_email: row.contact_email || row.email || null,
            contact_phone: row.contact_phone || row.phone || null,
              contact_phone_ext: row.contact_phone_ext || row.phone_ext || null,
            // invoice / BOL / custom load state
            invoice_number: row.invoice || row.invoice_number || row.invoice_no || row.invoiceId || null,
            bol_number: row.BOL || row.bol || row.bol_number || row.bill_of_lading || row.bill_of_lading_number || null,
            load_state: row.state || row.load_state || row.load_stage || row.stage || null,
              equipment_type: row.equipment_type || row.eq_type || row.equipment_code || row.equipment || row.trailer_type || row.trailer_code || null,
            // upload URLs (may exist in different column names across datasets)
            rate_conf_url: row.rate_conf_url || row.rate_conf || row.rate_confirmation_url || row.rate_url || row.rate_conf_link || null,
            // preserve any document-driver IDs if present in source tables
            rate_drive_id: row.rate_drive_id || row.rate_driver_id || row.rate_doc_id || row.rate_id || row.rate_drive || row.rate_driveid || null,
            bol_drive_id: row.bol_drive_id || row.bol_driver_id || row.bol_doc_id || row.bol_id || row.bol_drive || row.bol_driveid || null,
            // file ids that might reference stored files in Supabase (used for webhook processing)
            file_id: row.file_id || row.fileid || row.archivo_id || row.document_id || row.documento_id || row.fileId || null,
            rate_file_id: row.rate_file_id || row.rate_file || null,
            bol_file_id: row.bol_file_id || row.bol_file || null,
            bol_url: row.bol_url || row.bill_of_lading_url || row.bol_link || row.bol_file_url || null,
          };
        // Normalize status to English keywords
        if (mapped.estado) mapped.estado = normalizeEstado(mapped.estado);
        // Normalize equipment codes to canonical and label
        if (mapped.equipment_type) {
          mapped.equipment_type = canonicalEquipmentCode(mapped.equipment_type);
          mapped.equipment = mapped.equipment_type;
          mapped.equipment_label = equipmentLabelFromCode(mapped.equipment_type);
        } else {
          mapped.equipment = null;
          mapped.equipment_label = '';
        }
        if (!detectedId) console.warn('Supabase row missing explicit id; generated id:', finalId, row);
        CARGAS.push(mapped);
      });
    }

    // Build CAMIONEROS list from driver fields present in the loads (no separate table)
    const truckerMap = new Map();
    CARGAS.forEach((c) => {
      if (c.camionero_id) {
        const key = String(c.camionero_id);
        if (!truckerMap.has(key)) truckerMap.set(key, { id: c.camionero_id, nombre: c.driver || `Conductor ${c.camionero_id}` });
      } else if (c.driver) {
        const key = c.driver;
        if (!truckerMap.has(key)) truckerMap.set(key, { id: c.driver, nombre: c.driver });
      }
    });
    CAMIONEROS.length = 0;
    truckerMap.forEach((v) => CAMIONEROS.push(v));

    // Rebuild camionero filter (avoid duplicates)
    populateCamioneroFilter();
    console.log('Supabase: loaded loads:', CARGAS.length, 'drivers:', CAMIONEROS.length);
    showToast(`Synced: ${CARGAS.length} loads, ${CAMIONEROS.length} drivers`, 'info');
  } catch (err) {
    console.warn('Error loading from Supabase:', err.message || err);
    showToast('Error loading data from Supabase: ' + (err.message || err), 'error');
  }
}

// Load drivers table from Supabase into `DRIVERS` and update `CAMIONEROS` filter
async function loadDrivers(force = false) {
  if (!supabaseClient) return [];
  if (DRIVERS.length > 0 && !force) return DRIVERS;
  try {
    const { data, error } = await supabaseClient.from('drivers').select('*');
    if (error) throw error;
    DRIVERS = Array.isArray(data)
      ? data.map(d => ({
          id: d.id,
          name: d.name || '',
          status: d.status || '',
          rotation_state: d.state || d.rotation_state || '',
          phone_number: d.phonenumber || d.phone_number || d.phone || '',
          company_name: d.company_name || d.company || '',
          email: d.email || '',
          mc: d.MC || d.mc || d.mc_number || '',
          pallets: d.pallets || d.pallet || '',
          total_weight: d.total_weight || d.weight || d.max_weight_lbs || '',
          vin_number: d.VIN_number || d.VIN || d.vin_number || d.vin || '',
          truck_number: d.truck_number || d.trucknumber || d.unit_number || d.unit || '',
          dot: d.DOT || d.dot || d.dot_number || '',
          commission: d['commission_ %'] ?? d['commission_%'] ?? d.commission ?? d.commision ?? '',
          free_city: d.free_city || '',
          free_state: d.free_state || '',
          free_date: d.free_date || '',
          free_time: d.free_time || '',
          trips: d.trips || '[]',
          waypoints: d.waypoints || '[]',
          raw: d
        }))
      : [];
    // keep CAMIONEROS list in sync for other UI pieces
    CAMIONEROS.length = 0;
    DRIVERS.forEach(d => CAMIONEROS.push({ id: d.id, nombre: d.name }));
    populateCamioneroFilter();
    return DRIVERS;
  } catch (err) {
    console.error('Error loading drivers from Supabase', err);
    return [];
  }
}

// Load brokers table from Supabase into `BROKERS`
async function loadBrokers(force = false) {
  if (!supabaseClient) return [];
  if (BROKERS.length > 0 && !force) return BROKERS;
  try {
    const { data, error } = await supabaseClient
      .from('brokers')
      .select('id, name, mc, emails, phonenumbers');
    if (error) throw error;

    BROKERS = Array.isArray(data)
      ? data.map((b) => ({
          id: b.id,
          name: String(b.name || '').trim(),
          mc: String(b.mc || '').trim(),
          emails: normalizeBrokerArrayField(b.emails),
          phonenumbers: normalizeBrokerArrayField(b.phonenumbers)
        }))
      : [];
    return BROKERS;
  } catch (err) {
    console.error('Error loading brokers from Supabase', err);
    return [];
  }
}

// Load cities table from Supabase into `CITIES`
async function loadCities(force = false) {
  if (!supabaseClient) return [];
  if (CITIES.length > 0 && !force) return CITIES;
  try {
    const { data, error } = await supabaseClient
      .from('cities')
      .select('id, city, states');
    if (error) throw error;

    CITIES = Array.isArray(data)
      ? data.map((row) => ({
          id: row.id,
          city: String(row.city || '').trim(),
          states: normalizeCityStatesField(row.states)
        }))
      : [];
    return CITIES;
  } catch (err) {
    console.error('Error loading cities from Supabase', err);
    return [];
  }
}

function normalizeCityStatesField(value) {
  let raw = [];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      raw = Array.isArray(parsed) ? parsed : [value];
    } catch (e) {
      raw = value.split(',');
    }
  } else if (value && typeof value === 'object') {
    // jsonb may be returned as object; take enumerable values
    raw = Object.values(value);
  }

  const validCodes = new Set(US_STATES.map(([abbr]) => abbr));
  const out = [];
  for (const entry of raw) {
    const up = String(entry || '').trim().toUpperCase();
    if (!up) continue;
    if (!validCodes.has(up)) continue;
    if (!out.includes(up)) out.push(up);
  }
  return out;
}

function normalizeCityLookupValue(value) {
  return String(value || '').trim().toLowerCase();
}

function findStatesForCity(cityValue) {
  const target = normalizeCityLookupValue(cityValue);
  if (!target) return [];
  const row = CITIES.find((c) => normalizeCityLookupValue(c.city) === target);
  return row && Array.isArray(row.states) ? row.states : [];
}

function buildStateSelectHtmlWithPreferred(preferredStates, placeholderText = 'State') {
  const preferred = Array.isArray(preferredStates)
    ? preferredStates.map((s) => String(s || '').trim().toUpperCase()).filter(Boolean)
    : [];
  const validCodes = new Set(US_STATES.map(([abbr]) => abbr));
  const uniquePreferred = [];
  preferred.forEach((code) => {
    if (!validCodes.has(code)) return;
    if (uniquePreferred.includes(code)) return;
    uniquePreferred.push(code);
  });

  const out = [`<option value="">${escapeHtml(placeholderText)}</option>`];
  uniquePreferred.forEach((code) => {
    out.push(`<option value="${code}">${code}</option>`);
  });

  if (uniquePreferred.length > 0) {
    out.push('<option value="" disabled>──────────</option>');
  }

  US_STATES.forEach(([abbr]) => {
    if (uniquePreferred.includes(abbr)) return;
    out.push(`<option value="${abbr}">${abbr}</option>`);
  });

  return out.join('');
}

function escapeIlikeTerm(value) {
  return String(value || '').replace(/[\\%_]/g, '\\$&');
}

async function fetchCitySuggestions(term) {
  if (!supabaseClient) return [];
  const query = String(term || '').trim();
  if (!query) return [];

  try {
    const pattern = `%${escapeIlikeTerm(query)}%`;
    const { data, error } = await supabaseClient
      .from('cities')
      .select('city')
      .ilike('city', pattern)
      .order('city', { ascending: true })
      .limit(4);
    if (error) throw error;

    const out = [];
    (Array.isArray(data) ? data : []).forEach((row) => {
      const city = String((row && row.city) || '').trim();
      if (!city) return;
      if (out.includes(city)) return;
      out.push(city);
    });
    return out.slice(0, 4);
  } catch (err) {
    console.error('Error fetching city suggestions', err);
    return [];
  }
}

function setupCityAutocomplete() {
  const form = document.getElementById('edit-form');
  if (!form) return;

  const originCityInput = form.querySelector('input[name="origin_city"]');
  const destCityInput = form.querySelector('input[name="dest_city"]');
  const originCityList = document.getElementById('origin-city-suggestions');
  const destCityList = document.getElementById('dest-city-suggestions');

  if (!originCityInput || !destCityInput || !originCityList || !destCityList) return;

  let requestId = 0;

  async function refreshSuggestions(inputEl, datalistEl) {
    const text = String(inputEl.value || '').trim();
    if (!text) {
      setDatalistOptions(datalistEl, []);
      return;
    }

    const currentRequest = ++requestId;
    const suggestions = await fetchCitySuggestions(text);
    if (currentRequest !== requestId) return;
    setDatalistOptions(datalistEl, suggestions);
  }

  function bindCityInput(inputEl, datalistEl) {
    const run = () => { refreshSuggestions(inputEl, datalistEl); };
    inputEl.addEventListener('input', run);
    inputEl.addEventListener('focus', run);
    inputEl.addEventListener('click', run);
  }

  (async () => {
    await loadCities();

    bindCityInput(originCityInput, originCityList);
    bindCityInput(destCityInput, destCityList);
  })();
}

function setupDriverCityAutocomplete() {
  const form = document.getElementById('driver-edit-form');
  if (!form) return;

  const homeCityInput = form.querySelector('input[name="home_city"]');
  const homeCityList = document.getElementById('driver-home-city-suggestions');
  const freeCityInput = form.querySelector('input[name="free_city"]');
  const freeCityList = document.getElementById('driver-free-city-suggestions');
  const freeStateSelect = form.querySelector('select[name="free_state"]');
  const tripOriginCityInput = form.querySelector('input[name="trip_origin_city"]');
  const tripDestCityInput = form.querySelector('input[name="trip_dest_city"]');
  const tripOriginCityList = document.getElementById('driver-trip-origin-city-suggestions');
  const tripDestCityList = document.getElementById('driver-trip-dest-city-suggestions');
  const homeStateSelect = form.querySelector('select[name="home_state"]');
  const tripOriginStateSelect = form.querySelector('select[name="trip_origin_state"]');
  const tripDestStateSelect = form.querySelector('select[name="trip_dest_state"]');

  function bindCityInput(inputEl, datalistEl) {
    if (!inputEl || !datalistEl) return;
    if (inputEl.dataset.cityAutocompleteBound === '1') return;
    inputEl.dataset.cityAutocompleteBound = '1';

    let requestId = 0;
    async function refreshSuggestions() {
      const text = String(inputEl.value || '').trim();
      if (!text) {
        setDatalistOptions(datalistEl, []);
        return;
      }

      const currentRequest = ++requestId;
      const suggestions = await fetchCitySuggestions(text);
      if (currentRequest !== requestId) return;
      setDatalistOptions(datalistEl, suggestions);
    }

    inputEl.addEventListener('input', refreshSuggestions);
    inputEl.addEventListener('focus', refreshSuggestions);
    inputEl.addEventListener('click', refreshSuggestions);
  }

  function bindStopCityInputs() {
    const stopCityInputs = form.querySelectorAll('input[name="stop_city[]"]');
    stopCityInputs.forEach((inputEl, idx) => {
      let listId = inputEl.getAttribute('list');
      let datalistEl = listId ? document.getElementById(listId) : null;
      if (!datalistEl) {
        listId = `driver-stop-city-suggestions-${idx + 1}`;
        datalistEl = document.getElementById(listId);
        if (!datalistEl) {
          datalistEl = document.createElement('datalist');
          datalistEl.id = listId;
          form.appendChild(datalistEl);
        }
        inputEl.setAttribute('list', listId);
      }
      bindCityInput(inputEl, datalistEl);

      const row = inputEl.closest('.driver-stop-row');
      const stateSelect = row ? row.querySelector('select[name="stop_state[]"]') : null;
      bindCityToStateSelect(inputEl, stateSelect);
    });
  }

  function bindCityToStateSelect(cityInput, stateSelect) {
    if (!cityInput || !stateSelect) return;
    if (cityInput.dataset.cityStateBound === '1') return;
    cityInput.dataset.cityStateBound = '1';

    const placeholder = String(
      (stateSelect.querySelector('option[value=""]') && stateSelect.querySelector('option[value=""]').textContent) ||
      'State'
    ).trim() || 'State';

    const applyStateOptionsForCity = () => {
      const currentValue = String(stateSelect.value || '').trim().toUpperCase();
      const preferredStates = findStatesForCity(cityInput.value);
      stateSelect.innerHTML = buildStateSelectHtmlWithPreferred(preferredStates, placeholder);

      if (preferredStates.length === 1) {
        stateSelect.value = preferredStates[0];
        return;
      }

      if (currentValue) {
        stateSelect.value = currentValue;
      }
    };

    cityInput.addEventListener('input', applyStateOptionsForCity);
    cityInput.addEventListener('change', applyStateOptionsForCity);
    cityInput.addEventListener('blur', applyStateOptionsForCity);
    applyStateOptionsForCity();
  }

  function bindFreeCityToStateDropdown() {
    if (!freeCityInput || !freeStateSelect) return;

    const applyStateOptionsForCity = () => {
      const currentValue = String(freeStateSelect.value || '').trim().toUpperCase();
      const preferredStates = findStatesForCity(freeCityInput.value);
      freeStateSelect.innerHTML = buildStateSelectHtmlWithPreferred(preferredStates, 'Select state');

      if (preferredStates.length === 1) {
        freeStateSelect.value = preferredStates[0];
        return;
      }

      if (currentValue) {
        freeStateSelect.value = currentValue;
      }
    };

    freeCityInput.addEventListener('input', applyStateOptionsForCity);
    freeCityInput.addEventListener('change', applyStateOptionsForCity);
    freeCityInput.addEventListener('blur', applyStateOptionsForCity);
    applyStateOptionsForCity();
  }

  (async () => {
    await loadCities();

    bindCityInput(homeCityInput, homeCityList);
    bindCityInput(freeCityInput, freeCityList);
    bindCityInput(tripOriginCityInput, tripOriginCityList);
    bindCityInput(tripDestCityInput, tripDestCityList);
    bindCityToStateSelect(homeCityInput, homeStateSelect);
    bindCityToStateSelect(tripOriginCityInput, tripOriginStateSelect);
    bindCityToStateSelect(tripDestCityInput, tripDestStateSelect);
    bindStopCityInputs();
    bindFreeCityToStateDropdown();
  })();
}

function normalizeBrokerArrayField(value) {
  if (Array.isArray(value)) {
    return value
      .map((x) => String(x || '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((x) => String(x || '').trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeMcValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCompanyValue(value) {
  return String(value || '').trim().toLowerCase();
}

function findBrokerByMc(mcValue) {
  const target = normalizeMcValue(mcValue);
  if (!target) return null;
  return BROKERS.find((b) => normalizeMcValue(b.mc) === target) || null;
}

function findBrokerByCompany(companyValue) {
  const target = normalizeCompanyValue(companyValue);
  if (!target) return null;
  return BROKERS.find((b) => normalizeCompanyValue(b.name) === target) || null;
}

function setDatalistOptions(datalistEl, options) {
  if (!datalistEl) return;
  datalistEl.innerHTML = (options || [])
    .map((opt) => `<option value="${escapeHtml(opt)}"></option>`)
    .join('');
}

function setupBrokerInfoAutocomplete() {
  const form = document.getElementById('edit-form');
  if (!form) return;

  const companyInput = form.querySelector('input[name="company_name"]');
  const mcInput = form.querySelector('input[name="mc_number"]');
  const emailInput = form.querySelector('input[name="company_email"]');
  const phoneInput = form.querySelector('input[name="company_phone"]');

  const companyList = document.getElementById('broker-company-suggestions');
  const mcList = document.getElementById('broker-mc-suggestions');
  const emailList = document.getElementById('broker-email-suggestions');
  const phoneList = document.getElementById('broker-phone-suggestions');

  if (!companyInput || !mcInput || !emailInput || !phoneInput) return;

  function applyBrokerToForm(broker) {
    if (!broker) return;

    if (broker.name && companyInput.value.trim() !== broker.name) {
      companyInput.value = broker.name;
    }
    if (broker.mc && mcInput.value.trim() !== broker.mc) {
      mcInput.value = broker.mc;
    }

    const emails = Array.isArray(broker.emails) ? broker.emails : [];
    const phones = Array.isArray(broker.phonenumbers) ? broker.phonenumbers : [];

    setDatalistOptions(emailList, emails);
    setDatalistOptions(phoneList, phones);

    if (emails.length === 1) {
      emailInput.value = emails[0];
    }
    if (phones.length === 1) {
      phoneInput.value = phones[0];
    }
  }

  function clearDependentSuggestions() {
    setDatalistOptions(emailList, []);
    setDatalistOptions(phoneList, []);
  }

  function tryResolveByMc() {
    const broker = findBrokerByMc(mcInput.value);
    if (broker) {
      applyBrokerToForm(broker);
      return true;
    }
    return false;
  }

  function tryResolveByCompany() {
    const broker = findBrokerByCompany(companyInput.value);
    if (broker) {
      applyBrokerToForm(broker);
      return true;
    }
    return false;
  }

  function resolveBrokerFromCurrentInputs(fieldChanged = null) {
    const companyValue = companyInput.value.trim();
    const mcValue = mcInput.value.trim();

    if (fieldChanged === 'company') {
      if (!companyValue) {
        clearDependentSuggestions();
        return;
      }
      if (tryResolveByCompany()) return;
      clearDependentSuggestions();
      return;
    }

    if (fieldChanged === 'mc') {
      if (!mcValue) {
        clearDependentSuggestions();
        return;
      }
      if (tryResolveByMc()) return;
      clearDependentSuggestions();
      return;
    }

    if (companyValue && tryResolveByCompany()) return;
    if (mcValue && tryResolveByMc()) return;
    clearDependentSuggestions();
  }

  (async () => {
    const brokers = await loadBrokers();
    if (!brokers || brokers.length === 0) return;

    setDatalistOptions(
      companyList,
      brokers.map((b) => b.name).filter(Boolean)
    );
    setDatalistOptions(
      mcList,
      brokers.map((b) => b.mc).filter(Boolean)
    );

    resolveBrokerFromCurrentInputs();

    mcInput.addEventListener('input', () => resolveBrokerFromCurrentInputs('mc'));
    mcInput.addEventListener('change', () => resolveBrokerFromCurrentInputs('mc'));
    mcInput.addEventListener('blur', () => resolveBrokerFromCurrentInputs('mc'));

    companyInput.addEventListener('input', () => resolveBrokerFromCurrentInputs('company'));
    companyInput.addEventListener('change', () => resolveBrokerFromCurrentInputs('company'));
    companyInput.addEventListener('blur', () => resolveBrokerFromCurrentInputs('company'));
  })();
}

// Sidebar collapse handling
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('mobile-sidebar-overlay');
  const isMobile = window.matchMedia('(max-width: 900px)').matches;

  if (isMobile) {
    const isOpen = sidebar.classList.toggle('mobile-open');
    if (overlay) overlay.classList.toggle('hidden', !isOpen);
    return;
  }

  const collapsed = sidebar.classList.toggle('collapsed');
  try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); } catch (e) {}
}

function closeMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('mobile-sidebar-overlay');
  if (!sidebar) return;
  sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.add('hidden');
}

function syncSidebarWithViewport() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('mobile-sidebar-overlay');
  if (!sidebar) return;

  updateCurrentPageTitle();
  try { refreshFilterDropdownLabels(); } catch (e) {}

  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  if (isMobile) {
    sidebar.classList.remove('collapsed');
    sidebar.classList.remove('mobile-open');
    if (overlay) overlay.classList.add('hidden');
    return;
  }

  // Desktop behavior: default to collapsed unless user explicitly saved expanded.
  try {
    const val = localStorage.getItem('sidebarCollapsed');
    const shouldCollapse = val !== '0';
    sidebar.classList.toggle('collapsed', shouldCollapse);
  } catch (e) {
    sidebar.classList.add('collapsed');
  }

  sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.add('hidden');
}

function restoreSidebarState() {
  try {
    syncSidebarWithViewport();
    if (window.matchMedia('(max-width: 900px)').matches) return;
    const val = localStorage.getItem('sidebarCollapsed');
    // Por defecto: colapsada, excepto si el usuario guardó '0'
    if (val !== '0') document.querySelector('.sidebar').classList.add('collapsed');
  } catch (e) {}
}

function setHeaderDate() {
  const now = new Date();
  const opts = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
  document.getElementById("page-date").textContent = now.toLocaleDateString("en-US", opts);
}

// =============================================================
// NAVEGACIÓN
// =============================================================

function setupNavigation() {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", async (e) => {
      e.preventDefault();
      closeMobileSidebar();
      await navigateTo(item.dataset.view);
    });
  });
}

function getViewTitle(view) {
  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  if (view === 'dashboard') return 'Dashboard';
  if (view === 'cargas') return isMobile ? 'Loads' : 'Loads Management';
  return '';
}

function updateCurrentPageTitle() {
  const titleEl = document.getElementById('page-title');
  if (!titleEl) return;
  titleEl.textContent = getViewTitle(currentView);
}

async function navigateTo(view) {
  const refreshToken = ++navigationRefreshToken;
  currentView = view;

  document.querySelectorAll(".nav-item").forEach((el) =>
    el.classList.toggle("active", el.dataset.view === view)
  );

  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById(`view-${view}`).classList.remove("hidden");

  updateCurrentPageTitle();

  const btn = document.getElementById("btn-nueva-carga");
  const downloadBtn = document.getElementById("btn-download-invoice");
  view === "cargas" ? btn.classList.remove("hidden") : btn.classList.add("hidden");
  if (downloadBtn) {
    view === "cargas" ? downloadBtn.classList.remove("hidden") : downloadBtn.classList.add("hidden");
  }

  // Refresh remote data every time user opens Dashboard or Loads from sidebar.
  if (view === 'dashboard' || view === 'cargas') {
    try {
      isLoadingLoads = true;
      loadsFetched = false;
      if (view === 'cargas') renderCargas();
      await loadRemoteData();
      await loadDrivers(true);
    } finally {
      // Ignore stale updates if a newer navigation action started.
      if (refreshToken === navigationRefreshToken) {
        isLoadingLoads = false;
        loadsFetched = true;
      }
    }
  }

  if (refreshToken !== navigationRefreshToken || currentView !== view) return;

  if (view === "dashboard") renderDashboard();
  if (view === "cargas") renderCargas();
}

// =============================================================
// HELPERS
// =============================================================

function getCamionero(id) {
  const raw = id === null || id === undefined ? '' : String(id).trim();
  if (!raw) return { nombre: "Sin asignar", telefono: "—", placa: "—" };

  return CAMIONEROS.find((c) => {
    const cid = c && c.id !== null && c.id !== undefined ? String(c.id).trim() : '';
    const name = c && c.nombre ? String(c.nombre).trim().toLowerCase() : '';
    return cid === raw || name === raw.toLowerCase();
  }) || { nombre: "Sin asignar", telefono: "—", placa: "—" };
}

function getLoadDriverGroupKey(c) {
  const driverId = c && c.camionero_id !== null && c.camionero_id !== undefined ? String(c.camionero_id).trim() : '';
  if (driverId) return `id:${driverId}`;

  const driverName = c && c.driver ? String(c.driver).trim() : '';
  if (driverName) return `name:${driverName.toLowerCase()}`;

  return 'unassigned';
}

function getLoadDriverMeta(cargas) {
  const firstWithId = cargas.find((c) => c && c.camionero_id !== null && c.camionero_id !== undefined && String(c.camionero_id).trim() !== '');
  const firstWithName = cargas.find((c) => c && c.driver && String(c.driver).trim() !== '');
  const lookupValue = firstWithId ? firstWithId.camionero_id : (firstWithName ? firstWithName.driver : '');
  const cam = getCamionero(lookupValue);
  const fallbackName = firstWithName ? String(firstWithName.driver).trim() : cam.nombre;

  return {
    nombre: fallbackName || cam.nombre || 'Sin asignar',
    telefono: cam.telefono || '—',
    placa: cam.placa || '—'
  };
}

function getDriverAvatarStyle(seedValue) {
  const palettes = [
    { bg: 'linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%)', shadow: 'rgba(37, 99, 235, 0.22)' },
    { bg: 'linear-gradient(135deg, #dc2626 0%, #fb7185 100%)', shadow: 'rgba(220, 38, 38, 0.22)' },
    { bg: 'linear-gradient(135deg, #059669 0%, #34d399 100%)', shadow: 'rgba(5, 150, 105, 0.22)' },
    { bg: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)', shadow: 'rgba(124, 58, 237, 0.22)' },
    { bg: 'linear-gradient(135deg, #ea580c 0%, #f59e0b 100%)', shadow: 'rgba(234, 88, 12, 0.22)' },
    { bg: 'linear-gradient(135deg, #0f766e 0%, #2dd4bf 100%)', shadow: 'rgba(15, 118, 110, 0.22)' },
    { bg: 'linear-gradient(135deg, #be123c 0%, #fb7185 100%)', shadow: 'rgba(190, 18, 60, 0.22)' },
    { bg: 'linear-gradient(135deg, #4f46e5 0%, #60a5fa 100%)', shadow: 'rgba(79, 70, 229, 0.22)' }
  ];

  const raw = String(seedValue || 'unassigned').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }

  const palette = palettes[Math.abs(hash) % palettes.length];
  return `background:${palette.bg}; box-shadow: 0 8px 18px ${palette.shadow};`;
}

function formatDate(str) {
  if (!str) return "—";
  const [y, m, d] = str.split("-");
  return `${m}/${d}/${y}`;
}

function formatTripMiniDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'mm/dd';
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[2]}/${isoMatch[3]}`;
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/);
  if (slashMatch) return `${slashMatch[1].padStart(2, '0')}/${slashMatch[2].padStart(2, '0')}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return `${String(parsed.getMonth() + 1).padStart(2, '0')}/${String(parsed.getDate()).padStart(2, '0')}`;
  }
  return raw;
}

function resolveTripDisplayTime(preferred, fallback) {
  const value = String(preferred || fallback || '').trim();
  return value || '--:--';
}

function formatPickupDisplay(c) {
  // If explicit pick_up_date exists, prefer it and show time below when available
  if (c.pick_up_date) {
    const dateHtml = `<span class="pickup-date">${formatDate(c.pick_up_date)}</span>`;
    const timeHtml = c.pick_up_time ? `<div class="pickup-time">${c.pick_up_time}</div>` : "";
    return `${dateHtml}${timeHtml}`;
  }
  // Otherwise, use availability window if present
  if (c.availability) {
    const s = String(c.availability).trim();
    const m = s.match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/);
    if (m) {
      if (m[1] === m[2]) return `<span class="pickup-date">${formatDate(m[1])}</span>`;
      return `<span class="pickup-date">${formatDate(m[1])} - ${formatDate(m[2])}</span>`;
    }
    return `<span class="pickup-date">${s}</span>`;
  }
  return '—';
}

function formatDeliveryDisplay(c) {
  // Prefer explicit delivery_date + delivery_time when available
  if (c.delivery_date) {
    const dateHtml = `<span class="pickup-date">${formatDate(c.delivery_date)}</span>`;
    const timeHtml = c.delivery_time ? `<div class="pickup-time">${c.delivery_time}</div>` : "";
    return `${dateHtml}${timeHtml}`;
  }
  // Fallback to fecha_entrega
  if (c.fecha_entrega) return `<span class="pickup-date">${formatDate(c.fecha_entrega)}</span>`;
  return '—';
}

function isDelayed(carga) {
  const normalizedEstado = normalizeEstado(carga.estado);
  if (normalizedEstado === "Completed" || normalizedEstado === "Canceled") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // parse fecha_entrega as local date (avoid Date-string UTC parsing which can shift the day)
  const delivery = parseISOToLocalDate(carga.fecha_entrega);
  if (!delivery) return false;
  delivery.setHours(0,0,0,0);
  return delivery < today;
}

// Normalize status strings to English equivalents
function normalizeEstado(s) {
  if (!s) return 'Pending';
  const val = String(s).trim().toLowerCase();
  const map = {
    pendiente: 'Pending',
    confirmada: 'Confirmed',
    'en camino': 'In Transit',
    'en-camino': 'In Transit',
    completada: 'Completed',
    retrasada: 'Delayed',
    cancelado: 'Canceled',
    cancelled: 'Canceled',
    canceled: 'Canceled',
    pending: 'Pending',
    confirmed: 'Confirmed',
    'in transit': 'In Transit',
    completed: 'Completed',
    delayed: 'Delayed'
  };
  return map[val] || (s.charAt(0).toUpperCase() + s.slice(1));
}

function resolveEstado(carga) {
  if (isDelayed(carga)) return "Delayed";
  return normalizeEstado(carga.estado);
}

function estadoClass(estado) {
  const map = {
    Pending: "badge-pendiente",
    Confirmed: "badge-confirmada",
    "In Transit": "badge-en-camino",
    Completed: "badge-completada",
    Delayed: "badge-retrasada",
    Canceled: "badge-cancelada",
  };
  return map[estado] || "badge-pendiente";
}

function initials(nombre) {
  return nombre
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();
}

function populateCamioneroFilter() {
  const menu = document.getElementById("filter-driver-menu");
  if (!menu) return;

  menu.innerHTML = '';
  const activeDriversMap = new Map((DRIVERS || [])
    .filter((d) => String(d.status || '').trim().toLowerCase() === 'active')
    .map((d) => [String(d.id), d])
  );

  CAMIONEROS.filter((c) => activeDriversMap.has(String(c.id))).forEach((c) => {
    const label = document.createElement("label");
    label.className = 'multi-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(c.id);
    checkbox.checked = (window.filterDriverSelected || []).includes(String(c.id));
    checkbox.onchange = function () { onFilterCheckboxChange('driver', this); };

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(` ${c.nombre}`));
    menu.appendChild(label);
  });

  // Remove stale selected values if drivers list changed
  const validIds = new Set((CAMIONEROS || [])
    .filter((c) => activeDriversMap.has(String(c.id)))
    .map((d) => String(d.id))
  );
  window.filterDriverSelected = (window.filterDriverSelected || []).filter((id) => validIds.has(String(id)));
  updateDropdownLabel('driver');
}

// =============================================================
// DASHBOARD
// =============================================================

function renderDashboard() {
  renderDashboardStats();
  renderTruckerCards();
}

function renderDashboardStats() {
  const fallbackDrivers = new Map();
  CARGAS.forEach((c) => {
    const key = getLoadDriverGroupKey(c);
    if (!fallbackDrivers.has(key)) {
      const meta = getLoadDriverMeta([c]);
      fallbackDrivers.set(key, {
        id: c.camionero_id || c.driver || key,
        nombre: meta.nombre || 'Unassigned',
        key,
        status: '',
        rotation_state: '',
        free_city: '',
        free_state: '',
        free_date: '',
        free_time: '',
        trips: '[]',
        waypoints: '[]'
      });
    }
  });

  const driversSource = DRIVERS.length > 0
    ? DRIVERS.map((driver) => ({
        id: driver.id,
        nombre: driver.name,
        status: driver.status || '',
        rotation_state: driver.rotation_state || '',
        free_city: driver.free_city || '',
        free_state: driver.free_state || '',
        free_date: driver.free_date || '',
        free_time: driver.free_time || '',
        trips: driver.trips || '[]',
        waypoints: driver.waypoints || '[]'
      }))
    : (CAMIONEROS.length > 0
        ? CAMIONEROS.map((driver) => ({
            id: driver.id,
            nombre: driver.nombre,
            status: '',
            rotation_state: '',
            free_city: '',
            free_state: '',
            free_date: '',
            free_time: '',
            trips: '[]',
            waypoints: '[]'
          }))
        : Array.from(fallbackDrivers.values()));

  const driverCards = driversSource
    .map((driver) => {
      const matchLoad = CARGAS.find((c) => {
        const sameId = c && c.camionero_id !== null && c.camionero_id !== undefined
          ? String(c.camionero_id) === String(driver.id)
          : false;
        const sameName = c && c.driver && driver && driver.nombre
          ? String(c.driver).trim().toLowerCase() === String(driver.nombre).trim().toLowerCase()
          : false;
        return sameId || sameName;
      });

      return {
        id: driver.id,
        nombre: driver.nombre,
        key: matchLoad ? getLoadDriverGroupKey(matchLoad) : getLoadDriverGroupKey({ camionero_id: driver.id, driver: driver.nombre }),
        status: driver.status || '',
        rotation_state: driver.rotation_state || '',
        free_city: driver.free_city || '',
        free_state: driver.free_state || '',
        free_date: driver.free_date || '',
        free_time: driver.free_time || '',
        trips: driver.trips || '[]',
        waypoints: driver.waypoints || '[]'
      };
    })
    .filter((driver) => driver && driver.nombre && String(driver.status || '').trim().toLowerCase() === 'active')
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));

  if (driverCards.length === 0) {
    document.getElementById("dashboard-stats").innerHTML = `
      <div class="driver-summary-empty">No active drivers available yet.</div>
    `;
    return;
  }

  // Group drivers visually by rotation state: In Rotation first, Out of Rotation last
  const inRotation = driverCards.filter(d => String(d.rotation_state || '').trim().toLowerCase() === 'in rotation');
  const outRotation = driverCards.filter(d => String(d.rotation_state || '').trim().toLowerCase() === 'out of rotation');
  const others = driverCards.filter(d => {
    const r = String(d.rotation_state || '').trim().toLowerCase();
    return r !== 'in rotation' && r !== 'out of rotation';
  });
  const orderedDriverCards = [...inRotation, ...others, ...outRotation];

  document.getElementById("dashboard-stats").innerHTML = orderedDriverCards
    .map((driver) => {
      const avatarStyle = getDriverAvatarStyle(driver.key || driver.nombre);
      const locationLabel = [driver.free_city, driver.free_state].filter(Boolean).join(', ') || 'No availability saved';
      const freeDateRaw = driver.free_date ? String(driver.free_date).trim() : '';
      const freeDateLabel = /^\d{4}-\d{2}-\d{2}$/.test(freeDateRaw) ? formatDate(freeDateRaw) : (freeDateRaw || '—');
      const freeTimeLabel = driver.free_time ? String(driver.free_time).trim() : '—';
      const driverIdSafe = String(driver.id ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const stateChipLabel = String(driver.rotation_state || '').trim() || '—';
      const stateChipClass = stateChipLabel.toLowerCase() === 'in rotation'
        ? 'driver-state-chip--in'
        : (stateChipLabel.toLowerCase() === 'out of rotation' ? 'driver-state-chip--out' : '');
      const driverLoadsForCard = CARGAS.filter((c) => {
        const sameId = c && c.camionero_id !== null && c.camionero_id !== undefined
          ? String(c.camionero_id) === String(driver.id)
          : false;
        const sameName = c && c.driver && driver && driver.nombre
          ? String(c.driver).trim().toLowerCase() === String(driver.nombre).trim().toLowerCase()
          : false;
        return sameId || sameName;
      });
      // Try to resolve the full driver record (to read capacities) for fallback calculations
      const driverFullRec = DRIVERS.find((d) => String(d.id) === String(driver.id))
        || DRIVERS.find((d) => String(d.name || d.nombre || '').trim().toLowerCase() === String(driver.nombre).trim().toLowerCase())
        || {};
      const parseNum = (v) => {
        if (v === null || v === undefined) return null;
        const s = String(v || '').trim();
        if (!s) return null;
        const n = Number(s.replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
        return Number.isFinite(n) ? n : null;
      };
      const findTripLoad = (origin, destination) => {
        const normalizedOrigin = String(origin || '').trim().toLowerCase();
        const normalizedDestination = String(destination || '').trim().toLowerCase();
        return driverLoadsForCard.find((load) => {
          const loadOrigin = String(load?.origen || '').trim().toLowerCase();
          const loadDestination = String(load?.destino || '').trim().toLowerCase();
          return loadOrigin === normalizedOrigin && loadDestination === normalizedDestination;
        }) || null;
      };
      let partialTrips = [];
      let waypointList = [];
      try {
        const parsedTrips = Array.isArray(driver.trips) ? driver.trips : JSON.parse(driver.trips || '[]');
        partialTrips = Array.isArray(parsedTrips)
          ? parsedTrips.filter((trip) => String(trip?.partial || '').trim().toLowerCase() === 'partial')
          : [];
      } catch (e) {
        partialTrips = [];
      }
      try {
        const parsedWaypoints = Array.isArray(driver.waypoints) ? driver.waypoints : JSON.parse(driver.waypoints || '[]');
        waypointList = Array.isArray(parsedWaypoints) ? parsedWaypoints : [];
      } catch (e) {
        waypointList = [];
      }
      const partialTripsHtml = partialTrips.length > 0
        ? `<div class="driver-summary-block"><span class="driver-summary-section-title">Partial loads</span><div class="driver-summary-partials"><div class="driver-summary-partial-list">${partialTrips.map((trip) => {
            const origin = String(trip?.origin || trip?.origen || '').trim();
            const destination = String(trip?.destination || trip?.destino || '').trim();
            const matchedLoad = findTripLoad(origin, destination);
            const pickupDate = String(trip?.pickup_date || matchedLoad?.pick_up_date || '').trim();
            const deliveryDate = String(trip?.delivery_date || matchedLoad?.delivery_date || matchedLoad?.fecha_entrega || '').trim();
            const pickupTime = resolveTripDisplayTime(trip?.expected_pick_up || trip?.pick_up_expected_time || matchedLoad?.pick_up_expected_time, trip?.pickup_time || matchedLoad?.pick_up_time || '');
            const deliveryTime = resolveTripDisplayTime(trip?.expected_delivery || trip?.delivery_expected_time || matchedLoad?.delivery_expected_time, trip?.delivery_time || matchedLoad?.delivery_time || '');
            if (!origin && !destination) return '';

            // prefer stored free values
            let freePalletsLabel = String(trip?.free_pallets || trip?.freePallets || '').trim();
            let freeWeightLabel = String(trip?.free_weight || trip?.freeWeight || '').trim();
            // fallback: compute from driver capacities and load values
            if (!freePalletsLabel) {
              const driverPalletCap = parseNum(driverFullRec?.pallets || driverFullRec?.pallet_count || driverFullRec?.pallets_capacity || driverFullRec?.pallet_capacity);
              const tripPalletsVal = parseNum(trip?.pallets || matchedLoad?.pallets);
              if (tripPalletsVal !== null && driverPalletCap !== null) freePalletsLabel = String(Math.max(driverPalletCap - tripPalletsVal, 0));
            }
            if (!freeWeightLabel) {
              const driverWeightCap = parseNum(driverFullRec?.total_weight || driverFullRec?.totalWeight || driverFullRec?.max_weight_lbs || driverFullRec?.max_weight);
              const tripWeightVal = parseNum(trip?.weight || trip?.total_weight || matchedLoad?.weight || matchedLoad?.max_weight_lbs);
              if (tripWeightVal !== null && driverWeightCap !== null) freeWeightLabel = String(Math.max(driverWeightCap - tripWeightVal, 0));
            }

            return `<div class="driver-summary-partial-card">
              <div class="driver-summary-load-row">
                <div class="driver-summary-load-left">
                  <div class="driver-summary-trip-grid">
                    <div class="driver-summary-trip-stop">
                      <div class="driver-summary-trip-city">${escapeHtml(origin || '—')}</div>
                      <div class="driver-summary-trip-meta">${escapeHtml(formatTripMiniDate(pickupDate))}</div>
                      <div class="driver-summary-trip-meta driver-summary-trip-meta--time">${escapeHtml(pickupTime)}</div>
                    </div>
                    <div class="driver-summary-trip-arrow">→</div>
                    <div class="driver-summary-trip-stop driver-summary-trip-stop--right">
                      <div class="driver-summary-trip-city">${escapeHtml(destination || '—')}</div>
                      <div class="driver-summary-trip-meta">${escapeHtml(formatTripMiniDate(deliveryDate))}</div>
                      <div class="driver-summary-trip-meta driver-summary-trip-meta--time">${escapeHtml(deliveryTime)}</div>
                    </div>
                  </div>
                </div>
                ${freePalletsLabel || freeWeightLabel ? `<div class="driver-summary-chips">
                  ${freeWeightLabel ? `<div class="driver-summary-chip-row driver-summary-chip-top"><span class="chip chip--weight">Weight: ${escapeHtml(freeWeightLabel)}</span></div>` : ''}
                  ${freePalletsLabel ? `<div class="driver-summary-chip-row driver-summary-chip-mid"><span class="chip chip--pallet">Pallets: ${escapeHtml(freePalletsLabel)}</span></div>` : ''}
                </div>` : ''}
              </div>
            </div>`;
          }).join('')}</div></div></div>`
        : '';
      const waypointsHtml = waypointList.length > 0
        ? `<div class="driver-summary-block"><span class="driver-summary-section-title">Waypoints</span><div class="driver-summary-partials"><div class="driver-summary-partial-list">${waypointList.map((point) => {
            const label = [String(point?.city || '').trim(), String(point?.state || '').trim()].filter(Boolean).join(', ');
            return label ? `<div class="driver-summary-partial-route">${escapeHtml(label)}</div>` : '';
          }).join('')}</div></div></div>`
        : '';
      return `
        <div class="driver-summary-card">
          <span class="driver-state-chip ${stateChipClass}" role="button" tabindex="0" onclick="event.stopPropagation(); showDriverStateDropdown('${driverIdSafe}', this)">${escapeHtml(stateChipLabel)}</span>
          <button type="button" class="driver-home-btn" onclick="event.stopPropagation(); setDriverHomeAsFree('${driverIdSafe}')" title="Set home as free" aria-label="Set home as free">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5L12 3l9 6.5"/><path d="M9 22V12h6v10"/><path d="M21 22H3"/></svg>
          </button>
          <button type="button" class="driver-summary-edit" onclick="event.stopPropagation(); openDriverEditModal('${driverIdSafe}')" aria-label="Edit driver">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
          </button>
          <div class="driver-summary-head">
            <div class="driver-summary-avatar" style="${avatarStyle}">${initials(driver.nombre)}</div>
            <div class="driver-summary-copy">
              <button type="button" class="driver-summary-name driver-name-link" onclick="event.stopPropagation(); openDriverInfoModal('${driverIdSafe}')">${escapeHtml(driver.nombre)}</button>
            </div>
          </div>
          <div class="driver-summary-block">
            <span class="driver-summary-section-title">Next Availability</span>
            <div class="driver-summary-body">
              <div class="driver-summary-details">
                <div class="driver-summary-location">${escapeHtml(locationLabel)}</div>
                <div class="driver-summary-availability">
                  <span>${escapeHtml(freeDateLabel)}</span>
                  <span>${escapeHtml(freeTimeLabel)}</span>
                </div>
              </div>
            </div>
          </div>
          ${partialTripsHtml}
          ${waypointsHtml}
        </div>`;
    })
    .join("");
}

async function openDriverEditModal(driverId) {
  try { document.getElementById('modal-panel').classList.remove('modal-panel-load-details'); } catch (e) {}
  openDriverEditId = driverId;
  try { await loadDrivers(true); } catch (e) {}
  const driver = DRIVERS.find((d) => String(d.id) === String(driverId));
  if (!driver) {
    showToast('Driver not found', 'error');
    return;
  }

  const buildStateOptions = (selectedValue = '') => {
    const selected = normalizeStateAbbrev(selectedValue || '');
    return `<option value="">State</option>${US_STATES.map(([abbr]) => `<option value="${abbr}" ${abbr === selected ? 'selected' : ''}>${abbr}</option>`).join('')}`;
  };
  const stateOptions = buildStateOptions();
  const parseDriverArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  };
  const safeDriverId = String(driver.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const driverPhone = driver.phone_number || '';
  const driverCompany = driver.company_name || '';
  const driverEmail = driver.email || '';
  const driverMc = driver.mc || '';
  const driverPallets = driver.pallets || '';
  const driverTotalWeight = driver.total_weight || '';
  const driverVin = driver.vin_number || '';
  const driverTruckNumber = driver.truck_number || '';
  const driverDot = driver.dot || '';
  // home city/state fields (may exist under several column names). Prefer mapped value, then raw DB row.
  const driverHomeCity = (
    driver.home_city || driver.homeCity || driver.home ||
    (driver.raw && (driver.raw.home_city || driver.raw.homeCity || driver.raw.home)) ||
    ''
  );
  const driverHomeState = (
    driver.home_state || driver.homeState || driver.home_state_abbr ||
    (driver.raw && (driver.raw.home_state || driver.raw.homeState || driver.raw.home_state_abbr || driver.raw.home_state_abbrev)) ||
    ''
  );
  const driverCommission = driver.commission !== null && driver.commission !== undefined ? String(driver.commission) : '';
  const driverRotationState = String(driver.rotation_state || '').trim().toLowerCase();
  const isInRotation = driverRotationState !== 'out of rotation';
  const storedTrips = parseDriverArray(driver.trips || driver.raw?.trips);
  const storedWaypoints = parseDriverArray(driver.waypoints || driver.raw?.waypoints);
  const activeStates = ['Confirmed', 'In Transit'];
  const driverTrips = CARGAS.filter((c) => {
    const sameId = c && c.camionero_id !== null && c.camionero_id !== undefined
      ? String(c.camionero_id) === String(driver.id)
      : false;
    const sameName = c && c.driver && driver && driver.name
      ? String(c.driver).trim().toLowerCase() === String(driver.name).trim().toLowerCase()
      : false;
    return activeStates.includes(normalizeEstado(c.estado)) && (sameId || sameName);
  });
  const allDriverLoads = CARGAS.filter((c) => {
    const sameId = c && c.camionero_id !== null && c.camionero_id !== undefined
      ? String(c.camionero_id) === String(driver.id)
      : false;
    const sameName = c && c.driver && driver && driver.name
      ? String(c.driver).trim().toLowerCase() === String(driver.name).trim().toLowerCase()
      : false;
    return sameId || sameName;
  });
  const findMatchingDriverLoad = (origin, destination) => {
    const o = String(origin || '').trim().toLowerCase();
    const d = String(destination || '').trim().toLowerCase();
    return allDriverLoads.find((load) => {
      const lo = String(load.origen || '').trim().toLowerCase();
      const ld = String(load.destino || '').trim().toLowerCase();
      return lo === o && ld === d;
    }) || null;
  };
  const formatTripMiniDate = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return 'mm/dd';
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) return `${isoMatch[2]}/${isoMatch[3]}`;
    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/);
    if (slashMatch) return `${slashMatch[1].padStart(2, '0')}/${slashMatch[2].padStart(2, '0')}`;
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return `${String(parsed.getMonth() + 1).padStart(2, '0')}/${String(parsed.getDate()).padStart(2, '0')}`;
    }
    return raw;
  };
  const resolveTripDisplayTime = (preferred, fallback) => {
    const value = String(preferred || fallback || '').trim();
    return value || '--:--';
  };
  const tripCardsSource = storedTrips.length > 0
    ? storedTrips.map((trip, idx) => {
        const origin = String(trip.origin || trip.origen || '').trim();
        const destination = String(trip.destination || trip.destino || '').trim();
        const matchedLoad = findMatchingDriverLoad(origin, destination);
        const pickupDate = String(trip.pickup_date || matchedLoad?.pick_up_date || '').trim();
        const deliveryDate = String(trip.delivery_date || matchedLoad?.delivery_date || matchedLoad?.fecha_entrega || '').trim();
        const pickupTime = String(trip.pickup_time || matchedLoad?.pick_up_time || '').trim();
        const deliveryTime = String(trip.delivery_time || matchedLoad?.delivery_time || '').trim();
        return {
          key: `stored_${idx}`,
          origin,
          destination,
          partial: String(trip.partial || '').trim().toLowerCase() === 'partial',
          pickup_date: pickupDate,
          pickup_time: pickupTime,
          pickup_display_date: formatTripMiniDate(pickupDate),
          pickup_display_time: resolveTripDisplayTime(trip.expected_pick_up || trip.pick_up_expected_time || matchedLoad?.pick_up_expected_time, pickupTime),
          delivery_date: deliveryDate,
          delivery_time: deliveryTime,
          delivery_display_date: formatTripMiniDate(deliveryDate),
          delivery_display_time: resolveTripDisplayTime(trip.expected_delivery || trip.delivery_expected_time || matchedLoad?.delivery_expected_time, deliveryTime),
          pallets: String(trip.pallets || matchedLoad?.pallets || '').trim(),
          weight: String(trip.weight || trip.total_weight || matchedLoad?.weight || matchedLoad?.max_weight_lbs || '').trim(),
          loadId: matchedLoad?.id || null
        };
      })
    : driverTrips.map((trip, idx) => {
        const pickupDate = String(trip.pick_up_date || '').trim();
        const deliveryDate = String(trip.delivery_date || trip.fecha_entrega || '').trim();
        const pickupTime = String(trip.pick_up_time || '').trim();
        const deliveryTime = String(trip.delivery_time || '').trim();
        return {
          key: String(trip.id ?? `active_${idx}`).replace(/[^a-zA-Z0-9_-]/g, '_'),
          origin: String(trip.origen || '').trim(),
          destination: String(trip.destino || '').trim(),
          partial: String(trip.capacity || trip.partial || '').trim().toLowerCase() === 'partial',
          pickup_date: pickupDate,
          pickup_time: pickupTime,
          pickup_display_date: formatTripMiniDate(pickupDate),
          pickup_display_time: resolveTripDisplayTime(trip.expected_pick_up || trip.pick_up_expected_time, pickupTime),
          delivery_date: deliveryDate,
          delivery_time: deliveryTime,
          delivery_display_date: formatTripMiniDate(deliveryDate),
          delivery_display_time: resolveTripDisplayTime(trip.expected_delivery || trip.delivery_expected_time, deliveryTime),
          pallets: String(trip.pallets || '').trim(),
          weight: String(trip.weight || trip.max_weight_lbs || '').trim(),
          loadId: trip.id
        };
      });
  const waypointRowsHtml = (storedWaypoints.length > 0 ? storedWaypoints : [{ city: '', state: '' }]).map((point) => `
    <div class="driver-stop-row">
      <div class="form-group">
        <label>City</label>
        <input type="text" name="stop_city[]" value="${escapeHtml(point.city || '')}" placeholder="City" />
      </div>
      <div class="form-group">
        <label>State</label>
        <select name="stop_state[]">
          ${buildStateOptions(point.state || '')}
        </select>
      </div>
    </div>`).join('');
  const driverTripsHtml = `
      <div class="driver-trip-strip">
        <div class="driver-trip-cards">${tripCardsSource.map((trip) => {
          const tripKeySafe = String(trip.key).replace(/[^a-zA-Z0-9_-]/g, '_');
          const clickAttr = trip.loadId ? `onclick="openModal('${String(trip.loadId).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')"` : '';
          return `
              <div class="driver-trip-item"
                data-origin="${escapeHtml(trip.origin || '')}"
                data-destination="${escapeHtml(trip.destination || '')}"
                data-pickup-date="${escapeHtml(trip.pickup_date || '')}"
                data-pickup-time="${escapeHtml(trip.pickup_time || '')}"
                data-delivery-date="${escapeHtml(trip.delivery_date || '')}"
                data-delivery-time="${escapeHtml(trip.delivery_time || '')}"
                data-load-id="${escapeHtml(trip.loadId || '')}">
              <div class="driver-trip-card" ${clickAttr}>
                <div class="driver-trip-route-grid">
                  <div class="driver-trip-route-stop">
                    <div class="driver-trip-city">${escapeHtml(trip.origin || '—')}</div>
                    <div class="driver-trip-meta">${escapeHtml(trip.pickup_display_date || 'mm/dd')}</div>
                    <div class="driver-trip-meta driver-trip-meta--time">${escapeHtml(trip.pickup_display_time || '--:--')}</div>
                  </div>
                  <div class="driver-trip-route-arrow">→</div>
                  <div class="driver-trip-route-stop driver-trip-route-stop--right">
                    <div class="driver-trip-city">${escapeHtml(trip.destination || '—')}</div>
                    <div class="driver-trip-meta">${escapeHtml(trip.delivery_display_date || 'mm/dd')}</div>
                    <div class="driver-trip-meta driver-trip-meta--time">${escapeHtml(trip.delivery_display_time || '--:--')}</div>
                  </div>
                </div>
              </div>
              <div class="driver-trip-controls">
                <label class="toggle-switch driver-partial-toggle driver-partial-toggle--trip">
                  <input type="checkbox" name="trip_partial_existing_${tripKeySafe}" value="partial" ${trip.partial ? 'checked' : ''} onchange="toggleTripPartialFields(this)" />
                  <span class="toggle-slider"></span>
                  <span class="toggle-labels" data-off="No Partial" data-on="Partial"></span>
                </label>
                <button type="button" class="btn btn-sm btn-outline driver-trip-remove-btn" onclick="event.stopPropagation(); removeDriverTrip(this)" title="Remove trip">✕</button>
              </div>
              <div class="trip-partial-fields ${trip.partial ? '' : 'hidden'}">
                <div class="form-group">
                  <label>Pallets</label>
                  <input type="text" name="trip_pallets_existing_${tripKeySafe}" value="${escapeHtml(trip.pallets || '')}" placeholder="Pallets" />
                </div>
                <div class="form-group">
                  <label>Weight</label>
                  <input type="text" name="trip_weight_existing_${tripKeySafe}" value="${escapeHtml(trip.weight || trip.total_weight || '')}" placeholder="Weight" />
                </div>
              </div>
            </div>`;
        }).join('')}
          <button type="button" class="driver-trip-add-btn" onclick="toggleDriverTripBuilder(this)" aria-expanded="false" aria-label="Add trip">
            <span>+</span>
          </button>
          ${storedWaypoints.length > 0
            ? `<button type="button" class="btn btn-outline btn-sm driver-stops-delete-btn" onclick="deleteDriverWaypoints(this)">Delete Waypoints</button>`
            : `<button type="button" class="btn btn-outline btn-sm driver-stops-btn" onclick="toggleDriverStopsBuilder(this)">Add Waypoints</button>`}
        </div>
        <div class="driver-stops-builder ${storedWaypoints.length > 0 ? '' : 'hidden'}">
          <div class="driver-trip-section-label">Waypoints</div>
          <div class="driver-stops-list">
            ${waypointRowsHtml}
          </div>
          <div class="driver-stops-actions">
            <button type="button" class="btn btn-outline btn-sm driver-remove-stop-btn" onclick="removeDriverStopRow(this)">-</button>
            <button type="button" class="btn btn-outline btn-sm driver-add-stop-row" onclick="addDriverStopRow(this)">Agregar</button>
          </div>
        </div>
        <div class="driver-trip-builder hidden">
          <div class="driver-trip-route-row">
            <div class="driver-trip-location-block">
              <div class="driver-trip-section-label">Origin</div>
              <div class="modal-grid-2">
                <div class="form-group">
                  <label>City</label>
                  <input type="text" name="trip_origin_city" list="driver-trip-origin-city-suggestions" placeholder="City" />
                </div>
                <div class="form-group">
                  <label>State</label>
                  <select name="trip_origin_state">
                    <option value="">State</option>
                    ${stateOptions}
                  </select>
                </div>
              </div>
            </div>
            <div class="driver-trip-builder-arrow">→</div>
            <div class="driver-trip-location-block">
              <div class="driver-trip-section-label">Destination</div>
              <div class="modal-grid-2">
                <div class="form-group">
                  <label>City</label>
                  <input type="text" name="trip_dest_city" list="driver-trip-dest-city-suggestions" placeholder="City" />
                </div>
                <div class="form-group">
                  <label>State</label>
                  <select name="trip_dest_state">
                    <option value="">State</option>
                    ${stateOptions}
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div class="driver-trip-form-grid">
            <div class="form-group">
              <label>Pickup Date</label>
              <input type="date" name="trip_pickup_date" />
            </div>
            <div class="form-group">
              <label>Pickup time</label>
              <input type="time" name="trip_pickup_time" />
            </div>
            <div class="form-group">
              <label>Delivery Date</label>
              <input type="date" name="trip_delivery_date" />
            </div>
            <div class="form-group">
              <label>Delivery time</label>
              <input type="time" name="trip_delivery_time" />
            </div>
            <div class="form-group">
              <label>Partial</label>
              <label class="toggle-switch driver-partial-toggle">
                <input type="checkbox" name="trip_partial" value="partial" onchange="toggleTripPartialFields(this)" />
                <span class="toggle-slider"></span>
                <span class="toggle-labels" data-off="No Partial" data-on="Partial"></span>
              </label>
            </div>
          </div>

          <div class="trip-partial-fields hidden">
            <div class="form-group">
              <label>Pallets</label>
              <input type="text" name="trip_pallets" placeholder="Pallets" />
            </div>
            <div class="form-group">
              <label>Weight</label>
              <input type="text" name="trip_weight" placeholder="Weight" />
            </div>
          </div>
          <datalist id="driver-trip-origin-city-suggestions"></datalist>
          <datalist id="driver-trip-dest-city-suggestions"></datalist>
        </div>
      </div>`;

  document.getElementById('modal-title').textContent = 'Edit Driver';
  document.getElementById('modal-subtitle').textContent = '';
  document.getElementById('modal-panel').classList.add('modal-panel-wide');
  document.getElementById('modal-body').innerHTML = `
    <form id="driver-edit-form" onsubmit="handleDriverEditSubmit(event, '${safeDriverId}')">
      <div class="edit-modal-card bg-pastel-blue collapsed">
        <div class="card-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <div class="card-title">Driver Info</div>
          <div class="card-toggle-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="card-content">
          <div class="modal-grid-2">
            <div class="form-group">
              <label>Driver name</label>
              <input type="text" name="name" value="${escapeHtml(driver.name || '')}" placeholder="Driver name" />
            </div>
            <div class="form-group">
              <label>Phone number</label>
              <input type="text" name="phone_number" value="${escapeHtml(driverPhone)}" placeholder="Phone number" />
            </div>
            <div class="form-group">
              <label>Company name</label>
              <input type="text" name="company_name" value="${escapeHtml(driverCompany)}" placeholder="Company name" />
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" name="email" value="${escapeHtml(driverEmail)}" placeholder="Email" />
            </div>
            <div class="form-group">
              <label>MC</label>
              <input type="text" name="mc" value="${escapeHtml(driverMc)}" placeholder="MC" />
            </div>
            <div class="form-group">
              <label>Pallets</label>
              <input type="text" name="pallets" value="${escapeHtml(driverPallets)}" placeholder="Pallets" />
            </div>
            <div class="form-group">
              <label>DOT</label>
              <input type="text" name="dot" value="${escapeHtml(driverDot)}" placeholder="DOT" />
            </div>
            <div class="form-group">
              <label>Total Weight</label>
              <input type="text" name="total_weight" value="${escapeHtml(driverTotalWeight)}" placeholder="Total Weight" />
            </div>
            <div class="form-group">
              <label>VIN number</label>
              <input type="text" name="vin_number" value="${escapeHtml(driverVin)}" placeholder="VIN number" />
            </div>
            <div class="form-group">
              <label>Commision</label>
              <input type="number" step="0.01" name="commission" value="${escapeHtml(driverCommission)}" placeholder="0.00" />
            </div>
            <div class="form-group">
              <label>Truck Number</label>
              <input type="text" name="truck_number" value="${escapeHtml(driverTruckNumber)}" placeholder="Truck Number" />
            </div>
            <div style="grid-column: 2; display:flex; gap:8px; align-items:flex-start;">
              <div class="form-group" style="flex:1; margin:0;">
                <label>Home city</label>
                <input type="text" name="home_city" list="driver-home-city-suggestions" value="${escapeHtml(driverHomeCity)}" placeholder="Home city" />
              </div>
              <div class="form-group" style="width:120px; margin:0;">
                <label>Home state</label>
                <select name="home_state">
                  <option value="">State</option>
                  ${stateOptions}
                </select>
              </div>
            </div>
            <datalist id="driver-home-city-suggestions"></datalist>
            <div class="driver-toggle-pair">
              <div class="form-group">
                <label>Status</label>
                <label class="toggle-switch driver-partial-toggle">
                  <input type="checkbox" name="status_toggle" value="active" ${String(driver.status || '').toLowerCase() === 'active' ? 'checked' : ''} />
                  <span class="toggle-slider"></span>
                  <span class="toggle-labels" data-off="Inactive" data-on="Active"></span>
                </label>
              </div>
              <div class="form-group">
                <label>State</label>
                <label class="toggle-switch driver-partial-toggle">
                  <input type="checkbox" name="rotation_state" value="In Rotation" ${isInRotation ? 'checked' : ''} />
                  <span class="toggle-slider"></span>
                  <span class="toggle-labels" data-off="Out of Rotation" data-on="In Rotation"></span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="edit-modal-card bg-pastel-green collapsed">
        <div class="card-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <div class="card-title">Edit Location</div>
          <div class="card-toggle-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="card-content">
          <div class="modal-grid-2">
            <div class="form-group">
              <label>Free city</label>
              <input type="text" name="free_city" list="driver-free-city-suggestions" value="${escapeHtml(driver.free_city || '')}" placeholder="City" />
            </div>
            <div class="form-group">
              <label>Free state</label>
              <select name="free_state">
                <option value="">Select state</option>
                ${stateOptions}
              </select>
            </div>
            <div class="form-group">
              <label>Free date</label>
              <input type="date" name="free_date" value="${escapeHtml(driver.free_date || '')}" />
            </div>
            <div class="form-group">
              <label>Free time</label>
              <input type="time" name="free_time" value="${escapeHtml(normalizeTimeInputValue(driver.free_time || ''))}" />
            </div>
          </div>
          <datalist id="driver-free-city-suggestions"></datalist>
        </div>
      </div>

      <div class="edit-modal-card bg-pastel-purple collapsed">
        <div class="card-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <div class="card-title">Edit Trips</div>
          <div class="card-toggle-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="card-content">
          ${driverTripsHtml}
        </div>
      </div>

      <div class="edit-modal-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `;

  const stateEl = document.querySelector('#driver-edit-form select[name="free_state"]');
  if (stateEl && driver.free_state) stateEl.value = normalizeStateAbbrev(driver.free_state);
  const homeStateEl = document.querySelector('#driver-edit-form select[name="home_state"]');
  if (homeStateEl) {
    const pref = driver.home_state || driver.homeState || driverHomeState || (driver.raw && (driver.raw.home_state || driver.raw.homeState || driver.raw.home_state_abbr || driver.raw.home_state_abbrev)) || '';
    if (pref) homeStateEl.value = normalizeStateAbbrev(pref);
  }

  setupDriverCityAutocomplete();

  document.getElementById('modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

async function fetchCompanyRecord(companyName) {
  const name = String(companyName || '').trim();
  if (!supabaseClient || !name) return null;
  try {
    const { data, error } = await supabaseClient.from('companies').select('*').ilike('company_name', name).maybeSingle();
    if (!error && data) return data;
  } catch (e) {}
  return null;
}

function parseJsonField(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (e) { return null; }
}

function normalizeJsonEntries(value) {
  const parsed = parseJsonField(value);
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed.filter((item) => item && typeof item === 'object');
  if (typeof parsed === 'object') return [parsed];
  return [];
}

function driverInfoIcon(pathD, size = 13) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">${pathD}</svg>`;
}

const DRIVER_INFO_ICONS = {
  phone: driverInfoIcon('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>'),
  email: driverInfoIcon('<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22,6 12,13 2,6"/>'),
  truck: driverInfoIcon('<path d="M1 3h13v13H1z"/><path d="M14 8h4l4 4v4h-8V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'),
  vin: driverInfoIcon('<rect x="3" y="7" width="18" height="10" rx="1"/><path d="M7 11v3M11 11v3M15 11v3"/>'),
  fax: driverInfoIcon('<path d="M6 9V3h12v6"/><path d="M6 18h12v3H6z"/><rect x="4" y="9" width="16" height="9" rx="1"/>'),
  mapPin: driverInfoIcon('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
  route: driverInfoIcon('<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8a4 4 0 0 0 4-4V9a4 4 0 0 0-4-4H9"/>')
};

function toTitleCase(value) {
  return String(value || '').trim().toLowerCase().replace(/(^|\s|-)([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

function renderOperatingCities(rawValue) {
  let text = Array.isArray(rawValue)
    ? rawValue.join(', ')
    : String(rawValue || '').trim();

  if (!text) return '';

  if (text.includes(',')) {
    text = text.replace(/\s*,\s*/g, ', ');
  }

  return `<div class="driver-operating-cities">${DRIVER_INFO_ICONS.route}<span class="driver-cities-text">${escapeHtml(text)}</span></div>`;
}

function renderContactsBlock(rawValue) {
  const entries = normalizeJsonEntries(rawValue);
  if (entries.length === 0) return '<p class="driver-info-empty">No contacts on file.</p>';

  return entries.map((contact) => {
    const name = contact.name || contact.contact_name || '';
    const phone = contact.phone || contact.number || '';
    const cell = contact.cell && contact.cell !== phone ? contact.cell : '';
    const fax = contact.fax || '';
    const badge = contact.badge || contact.tag || contact.label || contact.note || '';
    const emails = Array.isArray(contact.emails) ? contact.emails : (contact.email ? [contact.email] : []);
    const badgeHtml = badge ? `<span class="badge-mini">${escapeHtml(toTitleCase(badge))}</span>` : '';

    const lines = [];
    if (phone) lines.push(`<div class="driver-contact-line">${DRIVER_INFO_ICONS.phone}<span>${escapeHtml(name ? `${name}: ` : '')}${escapeHtml(phone)}</span>${badgeHtml}</div>`);
    if (cell) lines.push(`<div class="driver-contact-line">${DRIVER_INFO_ICONS.phone}<span>Cell: ${escapeHtml(cell)}</span></div>`);
    if (fax) lines.push(`<div class="driver-contact-line">${DRIVER_INFO_ICONS.fax}<span>Fax: ${escapeHtml(fax)}</span></div>`);
    emails.forEach((email) => {
      lines.push(`<div class="driver-contact-line">${DRIVER_INFO_ICONS.email}<span>${escapeHtml(email)}</span>${!phone && !cell ? badgeHtml : ''}</div>`);
    });
    return lines.join('') || '';
  }).join('') || '<p class="driver-info-empty">No contacts on file.</p>';
}

function renderPlatformAccess(rawValue) {
  const parsed = parseJsonField(rawValue);
  if (!parsed) return '<p class="driver-info-empty">No portal access saved.</p>';

  let entries = [];
  if (Array.isArray(parsed)) {
    entries = parsed.filter((item) => item && typeof item === 'object').map((item) => ({
      platform: item.platform || item.name || item.site || 'Portal',
      username: item.username || item.user || item.login || '',
      password: item.password || item.pass || ''
    }));
  } else if (typeof parsed === 'object') {
    entries = Object.keys(parsed).map((key) => {
      const value = parsed[key];
      if (value && typeof value === 'object') {
        return { platform: key, username: value.username || value.user || '', password: value.password || value.pass || '' };
      }
      return { platform: key, username: String(value || ''), password: '' };
    });
  }

  if (entries.length === 0) return '<p class="driver-info-empty">No portal access saved.</p>';
  return `<div class="driver-platform-list">${entries.map((entry) => `
    <div class="driver-platform-entry">
      <span class="driver-platform-name">${escapeHtml(entry.platform)}</span>
      <span class="driver-platform-meta">${entry.username ? `<span class="driver-platform-user">User: ${escapeHtml(entry.username)}</span>` : ''}${entry.password ? `<span class="driver-platform-pass">Pass: ${escapeHtml(entry.password)}</span>` : ''}${!entry.username && !entry.password ? '<span class="driver-platform-user">—</span>' : ''}</span>
    </div>`).join('')}</div>`;
}

async function openDriverInfoModal(driverReference) {
  const rawReference = String(driverReference || '').trim();
  let driver = DRIVERS.find((item) => String(item.id) === rawReference)
    || DRIVERS.find((item) => String(item.name || '').trim().toLowerCase() === rawReference.toLowerCase());

  if (!driver && supabaseClient) {
    try {
      await loadDrivers(true);
      driver = DRIVERS.find((item) => String(item.id) === rawReference)
        || DRIVERS.find((item) => String(item.name || '').trim().toLowerCase() === rawReference.toLowerCase());
    } catch (e) {}
  }

  if (!driver) {
    showToast('Driver information not found', 'error');
    return;
  }

  const driverName = String(driver.name || '—').trim() || '—';
  const company = await fetchCompanyRecord(driver.company_name);

  const companyName = (company && company.company_name) || driver.company_name || '';
  const companyType = company && company.company_type ? String(company.company_type).trim() : '';
  const companyAddress = company && company.address ? String(company.address).trim() : '';
  const companyEmail = (company && company.company_email) || '';

  try { document.getElementById('modal-panel').classList.add('modal-panel-wide'); document.getElementById('modal-panel').classList.remove('modal-panel-load-details'); } catch (e) {}
  openModalCargaId = null;
  openDriverEditId = null;
  document.getElementById('modal-title').textContent = '';
  document.getElementById('modal-subtitle').textContent = '';
  document.getElementById('modal-body').innerHTML = `
    <div class="driver-info-modal">
      <div class="driver-info-header">
        <div class="driver-info-avatar" style="${getDriverAvatarStyle(driver.id || driverName)}">${initials(driverName)}</div>
        <div class="driver-info-name-block">
          <h2 class="driver-info-name">${escapeHtml(driverName)}</h2>
          ${driver.status ? `<span class="badge badge-lg ${String(driver.status).toLowerCase() === 'active' ? 'badge-confirmada' : 'badge-cancelada'}">${escapeHtml(driver.status)}</span>` : ''}
        </div>
      </div>

      <div class="driver-info-columns">
        <div class="driver-info-col">
          <div class="driver-info-section">
            <div class="driver-info-section-title">Driver Details</div>
            <div class="driver-detail-grid">
              <span class="driver-detail-item">${DRIVER_INFO_ICONS.phone}${escapeHtml(driver.phone_number || '—')}</span>
              <span class="driver-detail-item">${DRIVER_INFO_ICONS.email}${escapeHtml(driver.email || '—')}</span>
              <span class="driver-detail-item">${DRIVER_INFO_ICONS.truck}Truck #: ${escapeHtml(driver.truck_number || '—')}</span>
              <span class="driver-detail-item">${DRIVER_INFO_ICONS.vin}VIN: ${escapeHtml(driver.vin_number || '—')}</span>
            </div>
          </div>

          <div class="driver-info-section">
            <div class="driver-info-section-title">Company Information</div>
            ${companyName ? `
              <div class="driver-company-name-row">
                <span class="driver-company-name">${escapeHtml(companyName)}</span>
                ${companyType ? `<span class="badge-mini badge-mini--type">${escapeHtml(companyType)}</span>` : ''}
              </div>
              ${companyAddress ? `<div class="driver-address-line">${DRIVER_INFO_ICONS.mapPin}<span>${escapeHtml(companyAddress)}</span></div>` : ''}
              <div class="driver-quick-grid">
                <div class="driver-quick-tile"><span class="driver-quick-label">MC#</span><span class="driver-quick-value">${escapeHtml(String((company && company.mc) || '—'))}</span></div>
                <div class="driver-quick-tile"><span class="driver-quick-label">DOT#</span><span class="driver-quick-value">${escapeHtml(String((company && company.dot) || '—'))}</span></div>
                <div class="driver-quick-tile"><span class="driver-quick-label">EIN</span><span class="driver-quick-value">${escapeHtml(String((company && company.ein) || '—'))}</span></div>
                <div class="driver-quick-tile"><span class="driver-quick-label">RMIS ID</span><span class="driver-quick-value">${escapeHtml(String((company && company.rmis_id) || '—'))}</span></div>
              </div>
              ${renderOperatingCities(company && company.operating_cities)}
              <div class="driver-platform-box">
                <div class="driver-contact-line">${DRIVER_INFO_ICONS.email}<span>${escapeHtml(companyEmail || '—')}</span></div>
                <div class="driver-platform-title">Passwords / Portals</div>
                ${renderPlatformAccess(company && company.platform_access)}
              </div>
            ` : `<p class="driver-info-empty">No company information saved for this driver.</p>`}
          </div>
        </div>

        <div class="driver-info-col">
          <div class="driver-info-section">
            <div class="driver-info-section-title">Factoring${company && company.factoring_name ? `: ${escapeHtml(company.factoring_name)}` : ''}</div>
            ${company && company.factoring_address ? `<div class="driver-address-line">${DRIVER_INFO_ICONS.mapPin}<span>${escapeHtml(company.factoring_address)}</span></div>` : ''}
            <div class="driver-contact-list">${renderContactsBlock(company && company.factoring_contacts)}</div>
          </div>

          <div class="driver-info-section">
            <div class="driver-info-section-title">Insurance${company && company.insurance_name ? `: ${escapeHtml(company.insurance_name)}` : ''}</div>
            ${company && company.insurance_type ? `<div class="driver-info-subtitle">${escapeHtml(company.insurance_type)}</div>` : ''}
            ${company && company.insurance_address ? `<div class="driver-address-line">${DRIVER_INFO_ICONS.mapPin}<span>${escapeHtml(company.insurance_address)}</span></div>` : ''}
            ${company && company.insurance_policy_number ? `
              <div class="driver-policy-highlight">
                <span class="driver-policy-label">Policy Number</span>
                <span class="driver-policy-value">${escapeHtml(company.insurance_policy_number)}</span>
              </div>` : ''}
            <div class="driver-contact-list">${renderContactsBlock(company && company.insurance_contacts)}</div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function toggleDriverTripBuilder(button) {
  if (!button) return;
  const wrapper = button.closest('.driver-trip-strip') || button.closest('.driver-trip-empty-wrap');
  if (!wrapper) return;
  const panel = wrapper.querySelector('.driver-trip-builder');
  if (!panel) return;
  const isHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !isHidden);
  button.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
}

function toggleDriverStopsBuilder(button) {
  if (!button) return;
  const wrapper = button.closest('.driver-trip-strip') || button.closest('.driver-trip-empty-wrap');
  if (!wrapper) return;
  const panel = wrapper.querySelector('.driver-stops-builder');
  if (!panel) return;
  const willShow = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (willShow) {
    // If the user re-opens the stops builder, remove any clear flag so newly entered waypoints are saved
    const form = button.closest('form') || document.getElementById('driver-edit-form');
    if (form) {
      const flag = form.querySelector('input[name="clear_waypoints"]');
      if (flag) flag.remove();
    }
  }
}

function deleteDriverWaypoints(button) {
  if (!button) return;
  const wrapper = button.closest('.driver-trip-strip') || button.closest('.driver-trip-empty-wrap');
  if (!wrapper) return;
  const builder = wrapper.querySelector('.driver-stops-builder');
  if (!builder) return;
  const list = builder.querySelector('.driver-stops-list');
  if (list) list.innerHTML = '';
  // Close the builder panel
  builder.classList.add('hidden');
  // Add a hidden flag to the form so save will write an empty waypoints array
  const form = button.closest('form') || document.getElementById('driver-edit-form');
  if (form) {
    let flag = form.querySelector('input[name="clear_waypoints"]');
    if (!flag) {
      flag = document.createElement('input');
      flag.type = 'hidden';
      flag.name = 'clear_waypoints';
      flag.value = '1';
      form.appendChild(flag);
    } else {
      flag.value = '1';
    }
  }
  // Turn the button back into an Add Waypoints button (so user can re-open)
  button.classList.remove('driver-stops-delete-btn');
  button.classList.add('driver-stops-btn');
  button.textContent = 'Add Waypoints';
  button.setAttribute('onclick', 'toggleDriverStopsBuilder(this)');
}

function toggleTripPartialFields(input) {
  if (!input) return;
  const tripContainer = input.closest('.driver-trip-item') || input.closest('.driver-trip-builder');
  if (!tripContainer) return;
  const fields = tripContainer.querySelector('.trip-partial-fields');
  if (!fields) return;
  fields.classList.toggle('hidden', !input.checked);
}

function addDriverStopRow(button) {
  if (!button) return;
  const builder = button.closest('.driver-stops-builder');
  if (!builder) return;
  const list = builder.querySelector('.driver-stops-list');
  if (!list) return;
  const stateOptions = US_STATES.map(([abbr]) => `<option value="${abbr}">${abbr}</option>`).join('');
  const row = document.createElement('div');
  row.className = 'driver-stop-row';
  row.innerHTML = `
    <div class="form-group">
      <label>City</label>
      <input type="text" name="stop_city[]" placeholder="City" />
    </div>
    <div class="form-group">
      <label>State</label>
      <select name="stop_state[]">
        <option value="">State</option>
        ${stateOptions}
      </select>
    </div>`;
  list.appendChild(row);

  // Re-bind city autocomplete for newly added stop city input using existing setup.
  try { setupDriverCityAutocomplete(); } catch (e) {}
}

function removeDriverStopRow(button) {
  if (!button) return;
  const row = button.closest('.driver-stop-row');
  if (row) {
    row.remove();
    return;
  }

  const builder = button.closest('.driver-stops-builder');
  if (!builder) return;
  const list = builder.querySelector('.driver-stops-list');
  if (!list) return;
  const rows = list.querySelectorAll('.driver-stop-row');
  if (rows.length === 0) return;
  rows[rows.length - 1].remove();
}

async function removeDriverTrip(button) {
  if (!button) return;
  const item = button.closest('.driver-trip-item');
  if (!item) return;

  // collect identifying data from the DOM
  const origin = String(item.dataset.origin || '').trim();
  const destination = String(item.dataset.destination || '').trim();
  const pickupDate = String(item.dataset.pickupDate || '').trim();
  const deliveryDate = String(item.dataset.deliveryDate || '').trim();
  const loadId = String(item.dataset.loadId || '').trim() || null;

  // remove from UI immediately
  item.remove();

  // persist removal to Supabase drivers.trips array
  const driverId = openDriverEditId;
  if (!driverId) {
    showToast('Driver not selected', 'error');
    return;
  }
  if (!supabaseClient) {
    showToast('Supabase client not available', 'error');
    return;
  }

  // fetch current trips for the driver (prefer local cache)
  let driverRow = DRIVERS.find(d => String(d.id) === String(driverId));
  try {
    if (!driverRow) {
      const { data, error } = await supabaseClient.from('drivers').select('trips').eq('id', driverId).maybeSingle();
      if (!error && data) driverRow = data;
    }
  } catch (e) {
    console.error('Error fetching driver for trip removal', e);
  }

  // parse existing trips
  let existingTrips = [];
  try {
    if (driverRow) {
      if (Array.isArray(driverRow.trips)) existingTrips = driverRow.trips;
      else if (typeof driverRow.trips === 'string' && driverRow.trips.trim()) {
        const parsed = JSON.parse(driverRow.trips);
        existingTrips = Array.isArray(parsed) ? parsed : [];
      }
    }
  } catch (e) {
    existingTrips = [];
  }

  const normalize = (s) => String(s || '').trim().toLowerCase();
  function tripMatches(t) {
    try {
      // prefer matching by explicit load id when available
      const tLoadId = String(t.load_id || t.loadId || t.id || '').trim();
      if (loadId && tLoadId && tLoadId === loadId) return true;

      // match by origin/destination (and dates when available)
      const to = normalize(t.origin || t.origen || t.origin_city || '');
      const td = normalize(t.destination || t.destino || t.dest_city || '');
      if (to === normalize(origin) && td === normalize(destination)) {
        if (pickupDate) {
          const tp = normalize(t.pickup_date || t.pick_up_date || '');
          if (tp && tp === normalize(pickupDate)) return true;
        } else {
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  const nextTrips = existingTrips.filter(t => !tripMatches(t));

  // If nothing changed, no need to update DB
  if (nextTrips.length === existingTrips.length) {
    showToast('Trip removed locally', 'info');
    return;
  }

  // persist
  try {
    const payloadTrips = JSON.stringify(nextTrips);
    const { error } = await supabaseClient.from('drivers').update({ trips: payloadTrips }).eq('id', driverId);
    if (error) throw error;
    // update local cache and UI
    if (driverRow) driverRow.trips = payloadTrips;
    try { await loadDrivers(true); } catch (e) {}
    try { renderDashboard(); } catch (e) {}
    showToast('Trip removed from driver', 'success');
  } catch (err) {
    console.error('Failed to persist trip removal', err);
    showToast('Failed to remove trip from driver', 'error');
  }
}

// Show dropdown to change driver's rotation state from dashboard cards and persist to Supabase
function showDriverStateDropdown(driverId, anchorEl) {
  if (!anchorEl) return;
  const options = ['In Rotation', 'Out of Rotation'];
  showChipDropdown(anchorEl, options, async (selected) => {
    if (selected === null || selected === undefined) return;
    try {
      // Optimistically update local DRIVERS model if possible
      let localDriver = DRIVERS.find(d => String(d.id) === String(driverId));
      if (!localDriver) localDriver = DRIVERS.find(d => String(d.name || '').trim().toLowerCase() === String(driverId).trim().toLowerCase()) || null;
      if (localDriver) {
        localDriver.rotation_state = selected;
      }
      // Update UI immediately
      try { renderDashboard(); } catch (e) {}

      if (!supabaseClient) throw new Error('Supabase client not initialized');

      // Try updating common column names on drivers table
      const cols = ['state', 'rotation_state', 'rotationState'];
      let updated = false;
      for (const col of cols) {
        try {
          const { data, error } = await supabaseClient.from('drivers').update({ [col]: selected }).eq('id', driverId).select('id').limit(1);
          if (!error && Array.isArray(data) && data.length > 0) { updated = true; break; }
        } catch (e) {
          // continue trying other column names
        }
      }

      if (!updated) {
        // try matching by name if id-based update didn't affect anything
        if (localDriver && localDriver.name) {
          for (const col of cols) {
            try {
              const { data, error } = await supabaseClient.from('drivers').update({ [col]: selected }).eq('name', localDriver.name).select('id').limit(1);
              if (!error && Array.isArray(data) && data.length > 0) { updated = true; break; }
            } catch (e) {}
          }
        }
      }

      if (!updated) throw new Error('No driver row updated');

      showToast('Driver state updated', 'success');
      try { await loadDrivers(true); } catch (e) {}
      try { renderDashboard(); } catch (e) {}
    } catch (err) {
      console.error('Error updating driver state', err);
      showToast('Failed to update driver state', 'error');
    }
  });
}

// Copy driver's saved home location into their free availability and persist
async function setDriverHomeAsFree(driverId) {
  if (!driverId) return;
  let homeCity = '';
  let homeState = '';
  let freeDate = '';
  let freeTime = '';
  try {
    // find local driver record first
    let localDriver = DRIVERS.find(d => String(d.id) === String(driverId));
    if (!localDriver) localDriver = DRIVERS.find(d => String(d.name || '').trim().toLowerCase() === String(driverId).trim().toLowerCase()) || null;

    // Attempt to read home values from local mapped record or from its raw DB row
    const raw = localDriver && localDriver.raw ? localDriver.raw : (localDriver || {});
    homeCity = (localDriver && (localDriver.home_city || localDriver.homeCity)) || (raw && (raw.home_city || raw.homeCity || raw.home)) || '';
    homeState = (localDriver && (localDriver.home_state || localDriver.homeState)) || (raw && (raw.home_state || raw.homeState || raw.home_state_abbr || raw.home_state_abbrev)) || '';

    if (!homeCity && !homeState) {
      showToast('No home location saved for this driver', 'error');
      return;
    }

    const now = new Date();
    freeDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    freeTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const payload = {
      free_city: homeCity || null,
      free_state: normalizeStateAbbrev(homeState || '') || null,
      free_date: freeDate,
      free_time: freeTime
    };

    // Optimistic UI update
    try {
      const idx = DRIVERS.findIndex(d => String(d.id) === String(driverId));
      if (idx !== -1) {
        DRIVERS[idx] = { ...(DRIVERS[idx] || {}), free_city: payload.free_city, free_state: payload.free_state, free_date: payload.free_date, free_time: payload.free_time };
      }
      // CAMIONEROS fallback
      const cidx = CAMIONEROS.findIndex(c => String(c.id) === String(driverId) || String(c.nombre || '').trim().toLowerCase() === String(localDriver && localDriver.name || '').trim().toLowerCase());
      if (cidx !== -1) {
        CAMIONEROS[cidx] = { ...(CAMIONEROS[cidx] || {}), free_city: payload.free_city, free_state: payload.free_state };
      }
      renderDashboard();
    } catch (e) {}

    if (!supabaseClient) throw new Error('Supabase client not initialized');

    // Try a straightforward update first
    let updated = false;
    try {
      const { data, error } = await supabaseClient.from('drivers').update(payload).eq('id', driverId).select('id').limit(1);
      if (!error && Array.isArray(data) && data.length > 0) updated = true;
    } catch (e) {}

    // If not updated by id, try updating by name as a fallback
    if (!updated) {
      try {
        const nameKey = (localDriver && (localDriver.name || localDriver.nombre)) || null;
        if (nameKey) {
          const { data, error } = await supabaseClient.from('drivers').update(payload).eq('name', nameKey).select('id').limit(1);
          if (!error && Array.isArray(data) && data.length > 0) updated = true;
        }
      } catch (e) {}
    }

    if (!updated) throw new Error('No driver row updated');

    showToast('Driver availability updated', 'success');
    try { await loadDrivers(true); } catch (e) {}
    try { renderDashboard(); } catch (e) {}
    return;
  } catch (err) {
    console.error('setDriverHomeAsFree failed', err);
    // Webhook fallback
    try {
      const webhookUrl = 'https://n8n.othfreight.com/webhook/panelweb';
      const body = { action: 'edit_driver', id: driverId, free_city: homeCity || '', free_state: normalizeStateAbbrev(homeState || '') || '', free_date: freeDate || '', free_time: freeTime || '' };
      await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      showToast('Driver availability persisted via webhook', 'success');
      try { await loadDrivers(true); } catch (e) {}
      try { renderDashboard(); } catch (e) {}
      return;
    } catch (e) {
      console.error('Webhook fallback failed', e);
      showToast('Failed to persist driver availability', 'error');
    }
  }
}

function formatDriverClockInput(input) {
  if (!input) return;
  let raw = String(input.value || '').toUpperCase().replace(/[^0-9APM]/g, '');
  const ampm = raw.includes('PM') ? 'PM' : (raw.includes('AM') ? 'AM' : '');
  raw = raw.replace(/AM|PM/g, '').slice(0, 4);

  let formatted = raw;
  if (raw.length >= 3) {
    formatted = `${raw.slice(0, 2)}:${raw.slice(2, 4)}`;
  }
  if (ampm) {
    formatted += ` ${ampm}`;
  }
  input.value = formatted.trim();
}

function formatDriverFreeTimeInput(input) {
  if (!input) return;
  const digits = String(input.value || '').replace(/\D/g, '').slice(0, 8);
  const parts = [];

  if (digits.length > 0) {
    parts.push(digits.slice(0, 2));
  }
  if (digits.length >= 3) {
    parts[0] = `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
  }
  if (digits.length >= 5) {
    parts.push(digits.slice(4, 6));
  }
  if (digits.length >= 7) {
    parts[1] = `${digits.slice(4, 6)}:${digits.slice(6, 8)}`;
  }

  let formatted = parts[0] || '';
  if (digits.length > 4) {
    formatted += ' - ' + (parts[1] || '');
  }
  input.value = formatted;
}

function normalizeTimeInputValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hours = String(Math.min(23, Math.max(0, Number(match[1]) || 0))).padStart(2, '0');
  const minutes = String(Math.min(59, Math.max(0, Number(match[2]) || 0))).padStart(2, '0');
  return `${hours}:${minutes}`;
}

async function handleDriverEditSubmit(event, driverId) {
  event.preventDefault();
  if (!supabaseClient) {
    showToast('Supabase is not available', 'error');
    return;
  }

  const form = event.target;
  const fd = new FormData(form);
  const currentDriver = DRIVERS.find((d) => String(d.id) === String(driverId)) || {};
  const rawDriver = currentDriver.raw || {};

  function parseStoredArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  const statusValue = fd.get('status_toggle') ? 'active' : 'inactive';
  const rotationStateValue = fd.get('rotation_state') ? 'In Rotation' : 'Out of Rotation';
  const existingTrips = parseStoredArray(rawDriver.trips);
  const existingWaypoints = parseStoredArray(rawDriver.waypoints);

  const parseCapacityNumber = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const normalized = raw.replace(/,/g, '').replace(/[^\d.-]/g, '');
    if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') return null;
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
  };
  const formatCapacityNumber = (value) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '';
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  };
  const driverPalletsCapacity = parseCapacityNumber(fd.get('pallets'));
  const driverWeightCapacity = parseCapacityNumber(fd.get('total_weight'));
  const addRemainingCapacityToTrip = (trip) => {
    const tripPallets = parseCapacityNumber(trip?.pallets);
    const tripWeight = parseCapacityNumber(trip?.weight || trip?.total_weight);

    let freePallets = '';
    if (tripPallets === null) {
      // If the trip has no pallets specified, keep free_pallets empty
      freePallets = '';
    } else if (driverPalletsCapacity !== null) {
      freePallets = formatCapacityNumber(Math.max(driverPalletsCapacity - tripPallets, 0));
    } else {
      freePallets = String(trip?.free_pallets || '').trim();
    }

    let freeWeight = '';
    if (tripWeight === null) {
      // If the trip has no weight specified, keep free_weight empty
      freeWeight = '';
    } else if (driverWeightCapacity !== null) {
      freeWeight = formatCapacityNumber(Math.max(driverWeightCapacity - tripWeight, 0));
    } else {
      freeWeight = String(trip?.free_weight || '').trim();
    }

    return {
      ...trip,
      free_pallets: freePallets,
      free_weight: freeWeight
    };
  };

  const tripsFromCards = Array.from(form.querySelectorAll('.driver-trip-item')).map((item) => {
    const partialToggle = item.querySelector('input[name^="trip_partial_existing_"]');
    const palletsInput = item.querySelector('input[name^="trip_pallets_existing_"]');
    const weightInput = item.querySelector('input[name^="trip_weight_existing_"]');
    return {
      origin: String(item.dataset.origin || '').trim(),
      destination: String(item.dataset.destination || '').trim(),
      load_id: item.dataset.loadId || null,
      partial: partialToggle && partialToggle.checked ? 'partial' : 'no partial',
      pickup_date: String(item.dataset.pickupDate || '').trim(),
      pickup_time: String(item.dataset.pickupTime || '').trim(),
      delivery_date: String(item.dataset.deliveryDate || '').trim(),
      delivery_time: String(item.dataset.deliveryTime || '').trim(),
        pallets: String(palletsInput?.value || '').trim(),
        weight: String(weightInput?.value || '').trim()
    };
  }).filter((trip) => trip.origin && trip.destination);

  const originCity = String(fd.get('trip_origin_city') || '').trim();
  const originState = normalizeStateAbbrev(fd.get('trip_origin_state') || '');
  const destCity = String(fd.get('trip_dest_city') || '').trim();
  const destState = normalizeStateAbbrev(fd.get('trip_dest_state') || '');
  const pickupDate = String(fd.get('trip_pickup_date') || '').trim();
  const pickupTime = String(fd.get('trip_pickup_time') || '').trim();
  const deliveryDate = String(fd.get('trip_delivery_date') || '').trim();
  const deliveryTime = String(fd.get('trip_delivery_time') || '').trim();
  const tripPallets = String(fd.get('trip_pallets') || '').trim();
  const tripWeight = String(fd.get('trip_weight') || '').trim();
  const newTrip = {
    origin: [originCity, originState].filter(Boolean).join(', '),
    destination: [destCity, destState].filter(Boolean).join(', '),
    partial: fd.get('trip_partial') ? 'partial' : 'no partial',
    pickup_date: pickupDate,
    pickup_time: pickupTime,
    delivery_date: deliveryDate,
    delivery_time: deliveryTime,
    pallets: tripPallets,
    weight: tripWeight
  };
  const hasNewTripData = !!(newTrip.origin && newTrip.destination);

  const stopCities = fd.getAll('stop_city[]');
  const stopStates = fd.getAll('stop_state[]');
  const enteredWaypoints = stopCities.map((city, idx) => ({
    city: String(city || '').trim(),
    state: normalizeStateAbbrev(stopStates[idx] || '')
  })).filter((point) => point.city || point.state);

  const cleanExistingTrips = existingTrips.filter((trip) => {
    const origin = String(trip?.origin || trip?.origen || '').trim();
    const destination = String(trip?.destination || trip?.destino || '').trim();
    return origin && destination;
  });

  const tripsPayloadBase = tripsFromCards.length > 0
    ? [...tripsFromCards, ...(hasNewTripData ? [newTrip] : [])]
    : (hasNewTripData ? [...cleanExistingTrips, newTrip] : cleanExistingTrips);
  const tripsPayload = tripsPayloadBase.map(addRemainingCapacityToTrip);

  // Try to attach DB `load_id` to each trip when we can find a matching carga
  (function attachLoadIdToTrips() {
    function normalizeKey(v) {
      return String(v || '').trim().toLowerCase();
    }
    function findCargaByOriginDestination(origin, destination) {
      const o = normalizeKey(origin);
      const d = normalizeKey(destination);
      return CARGAS.find((load) => {
        const lo = normalizeKey(load.origen || load.origin_city || '');
        const ld = normalizeKey(load.destino || load.dest_city || '');
        return lo === o && ld === d;
      }) || null;
    }

    for (let i = 0; i < tripsPayload.length; i += 1) {
      const t = tripsPayload[i];
      if (!t) continue;
      if (t.load_id) continue; // already present
      const matched = findCargaByOriginDestination(t.origin, t.destination);
      if (matched) {
        // prefer explicit original DB load_id if present, fallback to mapped id
        t.load_id = matched.load_id || matched.id || null;
      }
    }
  })();
  const clearWaypointsFlag = fd.get('clear_waypoints');
  const waypointsBuilder = form.querySelector('.driver-stops-builder');
  const waypointsEditorOpen = waypointsBuilder && !waypointsBuilder.classList.contains('hidden');
  const waypointsPayload = clearWaypointsFlag || (waypointsEditorOpen && enteredWaypoints.length === 0)
    ? []
    : (enteredWaypoints.length > 0 ? enteredWaypoints : existingWaypoints);

  const payload = {
    name: (fd.get('name') || '').trim(),
    email: (fd.get('email') || '').trim() || null,
    phonenumber: (fd.get('phone_number') || '').trim() || null,
    company_name: (fd.get('company_name') || '').trim() || null,
    MC: (fd.get('mc') || '').trim() || null,
    pallets: (fd.get('pallets') || '').trim() || null,
    DOT: (fd.get('dot') || '').trim() || null,
    total_weight: (fd.get('total_weight') || '').trim() || null,
    VIN: (fd.get('vin_number') || '').trim() || null,
    VIN_number: (fd.get('vin_number') || '').trim() || null,
    truck_number: (fd.get('truck_number') || '').trim() || null,
    status: statusValue,
    state: rotationStateValue,
    free_city: (fd.get('free_city') || '').trim() || null,
    free_state: normalizeStateAbbrev(fd.get('free_state') || ''),
    free_date: (fd.get('free_date') || '').trim() || null,
    free_time: (fd.get('free_time') || '').trim() || null,
    // home location fields
    home_city: (fd.get('home_city') || '').trim() || null,
    home_state: normalizeStateAbbrev(fd.get('home_state') || ''),
    trips: JSON.stringify(tripsPayload),
    waypoints: JSON.stringify(waypointsPayload)
  };
  const commissionKey = ['commission_ %', 'commission_%', 'commission', 'commision']
    .find((key) => Object.prototype.hasOwnProperty.call(rawDriver, key));
  if (commissionKey) {
    payload[commissionKey] = (fd.get('commission') || '').trim() || null;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    const { error } = await supabaseClient.from('drivers').update(payload).eq('id', driverId);
    if (error) throw error;
    await loadDrivers(true);
    renderDashboard();
    closeModal();
    showToast('Driver updated successfully', 'success');
  } catch (err) {
    console.error('Error updating driver', err);
    showToast('Error updating driver: ' + (err.message || err), 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function renderTruckerCards() {
  const activeStates = ["Confirmed", "In Transit"];
  const byTrucker = new Map();

  CARGAS.filter((c) => activeStates.includes(normalizeEstado(c.estado))).forEach((c) => {
    const truckerKey = getLoadDriverGroupKey(c);
    if (!byTrucker.has(truckerKey)) byTrucker.set(truckerKey, []);
    byTrucker.get(truckerKey).push(c);
  });

  const entries = Array.from(byTrucker.entries());
  const total = entries.reduce((acc, [, arr]) => acc + arr.length, 0);
  document.getElementById("active-count-badge").textContent = `${total} active loads`;

  if (entries.length === 0) {
    document.getElementById("dashboard-truckers").innerHTML = `
      <div class="empty-state empty-state-loads">
        <img class="empty-state-illustration" src="assets/no_loads.svg" alt="No active loads" onerror="this.style.display='none'" />
        <p>No active loads at the moment.</p>
        <button type="button" class="btn btn-primary btn-sm" onclick="openNewCargaModal()">Add New Load</button>
      </div>`;
    return;
  }

  // Choose layout strategy: if every driver has exactly one load, render
  // compact multi-column grid; otherwise render flexible sections where
  // each driver section grows proportionally to the number of loads.
  const allSingles = entries.every(([, cargas]) => cargas.length === 1);
  const containerClass = allSingles ? 'trucker-list trucker-multi-column' : 'trucker-list trucker-flex';

  const innerHtml = entries
    .map(([truckerKey, cargas]) => {
      const cam = getLoadDriverMeta(cargas);
      const avatarStyle = getDriverAvatarStyle(truckerKey || cam.nombre);
      const flexWeight = Math.max(1, cargas.length || 1);
      const flexStyle = allSingles ? '' : `style="flex: ${flexWeight} 1 320px; min-width: 220px;"`;
      const driverReference = cargas[0] && cargas[0].camionero_id
        ? String(cargas[0].camionero_id)
        : String(cam.nombre || '');
      const driverReferenceSafe = driverReference.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      return `
        <div class="trucker-section" ${flexStyle}>
          <div class="trucker-header">
            <div class="trucker-avatar" style="${avatarStyle}">${initials(cam.nombre)}</div>
            <div class="trucker-info">
              <button type="button" class="trucker-name driver-name-link" onclick="event.stopPropagation(); openDriverInfoModal('${driverReferenceSafe}')">${escapeHtml(cam.nombre)}</button>
            </div>
            <span class="trucker-count">${cargas.length} carga${cargas.length !== 1 ? "s" : ""}</span>
          </div>
          <div class="cargas-grid">
            ${cargas.map(cargaCard).join("")}
          </div>
        </div>`;
    })
    .join("");

  document.getElementById("dashboard-truckers").innerHTML = `<div class="${containerClass}">${innerHtml}</div>`;
}

function cargaCard(c) {
  const estado = resolveEstado(c);
  const stateLabel = c.load_state && String(c.load_state).trim() ? String(c.load_state).trim() : '';
  return `
    <div class="carga-card" onclick="openModal('${c.id}')">
      <div class="carga-card-header">
        <div class="carga-card-chips">
          <span class="badge ${estadoClass(estado)}">${estado}</span>
          ${stateLabel ? `<span class="badge badge-sm badge-state">${escapeHtml(stateLabel)}</span>` : ''}
        </div>
      </div>
      <div class="carga-route">
        <div class="route-point">
          ${pinIcon(14)}
          <span class="carga-location">${c.origen}</span>
        </div>
        <span class="route-arrow">→</span>
        <div class="route-point">
          ${flagIcon(14)}
          <span class="carga-location">${c.destino}</span>
        </div>
      </div>
      <div class="carga-card-footer">
        <div class="carga-dates-grid">
          <div class="carga-date-col">
            <div class="carga-date-main">${formatPickupDisplay(c)}</div>
          </div>
          <div class="carga-date-col">
            <div class="carga-date-main">${formatDeliveryDisplay(c)}</div>
          </div>
        </div>
      </div>
      <div class="carga-card-bottom">
        ${c.cliente ? `<div class="carga-company">${escapeHtml(c.cliente)}</div>` : ''}
        ${c.broker_mc ? `<div class="carga-mc">MC: ${escapeHtml(c.broker_mc)}</div>` : ''}
      </div>
      ${(c.rate_usd !== null && c.rate_usd !== undefined && String(c.rate_usd).trim() !== '') ? `<div class="carga-price-chip">$${escapeHtml(String(c.rate_usd))}</div>` : ''}
    </div>`;
}

// =============================================================
// CARGAS
// =============================================================

function renderCargas() {
  applyFilters();
}

function toNumberAmount(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(/[^0-9.-]/g, '').trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUsd(value) {
  return Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateMMDDYYYY(value) {
  if (!value) return '—';
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const mm = String(slash[1]).padStart(2, '0');
    const dd = String(slash[2]).padStart(2, '0');
    const yy = String(slash[3]);
    const yyyy = yy.length === 2 ? `20${yy}` : yy;
    return `${mm}/${dd}/${yyyy}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    const yyyy = String(parsed.getFullYear());
    return `${mm}/${dd}/${yyyy}`;
  }
  return raw;
}

function formatTodayMMDDYYYY() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  return `${mm}/${dd}/${yyyy}`;
}

function formatTodayFileDate() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(-2);
  return `${mm}-${dd}-${yy}`;
}

function sanitizeFilenamePart(value) {
  const safe = String(value || '').trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return safe || 'Company';
}

function formatCommissionPercent(value) {
  const pct = toNumberAmount(value);
  if (!(pct > 0)) return '';
  if (Number.isInteger(pct)) return String(pct);
  return String(Number(pct.toFixed(2)));
}

function resolveInvoiceDriver(selectedDriverIds, selectedLoads = []) {
  const normalizedIds = Array.isArray(selectedDriverIds)
    ? selectedDriverIds.map((id) => String(id).trim()).filter(Boolean)
    : [];
  const driversById = new Map((DRIVERS || []).map((d) => [String(d.id), d]));
  const driversByName = new Map((DRIVERS || []).map((d) => [String(d.name || '').trim().toLowerCase(), d]));
  const camionerosById = new Map((CAMIONEROS || []).map((d) => [String(d.id), d]));

  for (const id of normalizedIds) {
    const byId = driversById.get(id);
    if (byId) return byId;

    const cam = camionerosById.get(id) || null;
    const selectedName = cam && cam.nombre ? String(cam.nombre).trim().toLowerCase() : id.toLowerCase();
    const byName = driversByName.get(selectedName);
    if (byName) return byName;
  }

  const loadCandidates = Array.isArray(selectedLoads)
    ? selectedLoads.map((c) => ({
        id: c && c.camionero_id !== undefined && c.camionero_id !== null ? String(c.camionero_id).trim() : '',
        name: String((c && c.driver) || '').trim().toLowerCase()
      }))
    : [];

  for (const candidate of loadCandidates) {
    if (candidate.id && driversById.has(candidate.id)) return driversById.get(candidate.id);
    if (candidate.name && driversByName.has(candidate.name)) return driversByName.get(candidate.name);
  }

  return null;
}

function pickSelectedDriverCompanyName(selectedDriverIds) {
  if (!Array.isArray(selectedDriverIds) || selectedDriverIds.length === 0) return '';

  const driversById = new Map((DRIVERS || []).map((d) => [String(d.id), d]));
  const camionerosById = new Map((CAMIONEROS || []).map((d) => [String(d.id), d]));
  const selectedCandidates = [];

  selectedDriverIds.forEach((rawId) => {
    const id = String(rawId).trim();
    if (!id) return;

    let driver = driversById.get(id) || null;
    if (!driver) {
      const cam = camionerosById.get(id) || null;
      const selectedName = cam && cam.nombre ? String(cam.nombre).trim().toLowerCase() : id.toLowerCase();
      driver = (DRIVERS || []).find((d) => String(d.name || '').trim().toLowerCase() === selectedName) || null;
    }
    if (driver) selectedCandidates.push(driver);
  });

  if (selectedCandidates.length === 0) return '';
  const randomDriver = selectedCandidates[Math.floor(Math.random() * selectedCandidates.length)];
  return String(randomDriver.company_name || '').trim();
}

function isLoadFromSelectedDrivers(load, selectedDriverIds, selectedDriverNames) {
  const cargaCamIdStr = (load.camionero_id !== null && load.camionero_id !== undefined) ? String(load.camionero_id).trim() : '';
  const cargaDriverName = (load.driver !== null && load.driver !== undefined) ? String(load.driver).trim().toLowerCase() : '';
  const idMatch = cargaCamIdStr && selectedDriverIds.has(cargaCamIdStr);
  const nameMatch = cargaDriverName && selectedDriverNames.has(cargaDriverName);
  const directNameMatch = cargaDriverName && selectedDriverIds.has(cargaDriverName);
  return idMatch || nameMatch || directNameMatch;
}

function downloadInvoiceDoc() {
  const selectedDrivers = (window.filterDriverSelected || []).map((id) => String(id).trim()).filter(Boolean);

  const totalResults = Array.isArray(filtered) ? filtered.length : 0;
  const perPage = pagination.rowsPerPage || 40;
  const totalPages = Math.max(1, Math.ceil(totalResults / perPage));
  const currentPage = Math.min(Math.max(1, pagination.currentPage || 1), totalPages);
  const startIdx = (currentPage - 1) * perPage;
  const endIdx = Math.min(startIdx + perPage, totalResults);
  const selectedLoads = (filtered || []).slice(startIdx, endIdx).filter((c) => c && !c.__isNew);

  if (selectedLoads.length === 0) {
    showToast('No visible loads to export with current filters', 'error');
    return;
  }

  const invoiceDriver = resolveInvoiceDriver(selectedDrivers, selectedLoads);
  let companyName = invoiceDriver ? String(invoiceDriver.company_name || '').trim() : '';
  if (!companyName) companyName = pickSelectedDriverCompanyName(selectedDrivers) || '';
  if (!companyName) {
    const visibleDriverNames = new Set(selectedLoads.map((c) => String(c.driver || '').trim().toLowerCase()).filter(Boolean));
    const anyDriver = (DRIVERS || []).find((d) => visibleDriverNames.has(String(d.name || '').trim().toLowerCase()));
    companyName = anyDriver ? String(anyDriver.company_name || '').trim() : '';
  }
  companyName = companyName || 'Company not available';
  const todayDisplay = formatTodayMMDDYYYY();

  let subtotalGross = 0;
  let dispatchFeeTotal = 0;

  const tableRows = selectedLoads.map((c) => {
    const loadNumber = String(c.invoice_number || '').trim() || '—';
    const bol = String(c.bol_number || '').trim() || '—';
    const dateVal = formatDateMMDDYYYY(c.pick_up_date || c.fecha_recogida || '');
    const driver = String(c.driver || '—');
    const broker = String(c.cliente || '—');
    const mc = String(c.broker_mc || '').trim();

    const rateValue = toNumberAmount(c.rate_usd);
    const commissionValue = toNumberAmount(c.commission);
    const netRaw = c.net_price;
    const hasNet = netRaw !== null && netRaw !== undefined && String(netRaw).trim() !== '';
    const netText = hasNet ? String(netRaw).trim() : '';

    subtotalGross += rateValue;
    dispatchFeeTotal += commissionValue;

    const priceCell = hasNet ? `${formatUsd(rateValue)}\n(${netText})` : formatUsd(rateValue);
    const brokerCell = mc ? `${broker}\nMC: ${mc}` : broker;

    return [loadNumber, bol, dateVal, driver, brokerCell, priceCell, formatUsd(commissionValue)];
  });

  let commissionPctLabel = formatCommissionPercent(invoiceDriver ? invoiceDriver.commission : null);
  if (!commissionPctLabel && subtotalGross > 0) {
    const derivedPct = Math.round((dispatchFeeTotal / subtotalGross) * 10000) / 100;
    commissionPctLabel = formatCommissionPercent(derivedPct);
  }
  const commissionColumnHeader = commissionPctLabel ? `${commissionPctLabel}%` : 'Fee %';
  const dispatchFeeLabel = commissionPctLabel ? `Dispatch Fee (${commissionPctLabel}%):` : 'Dispatch Fee:';

  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast('PDF library not available — please reload the page', 'error');
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const left = 50;

  // Title
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text('INVOICE', pageWidth / 2, 50, { align: 'center' });

  // Meta block
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.text(`Company name: ${companyName}`, left, 82);
  pdf.text(`Date: ${todayDisplay}`, left, 98);
  pdf.text('Dispatcher: Arielys Salgado', left, 114);

  // Two blank lines before table (startY 154 = 114 + ~40pt gap)
  pdf.autoTable({
    startY: 154,
    head: [['Load #', 'BOL', 'Date', 'Driver', 'Broker', 'Price', commissionColumnHeader]],
    body: tableRows,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 5,
      lineColor: [34, 34, 34],
      lineWidth: 0.6,
      valign: 'top',
      overflow: 'linebreak'
    },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: [17, 17, 17],
      fontStyle: 'bold'
    },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 54 },
      2: { cellWidth: 60 },
      3: { cellWidth: 68 },
      4: { cellWidth: 120 },
      5: { cellWidth: 84 },
      6: { cellWidth: 64 }
    },
    margin: { left: 50, right: 50 }
  });

  // Totals block below table
  let totalsY = (pdf.lastAutoTable && pdf.lastAutoTable.finalY ? pdf.lastAutoTable.finalY : 154) + 28;
  const pageHeight = pdf.internal.pageSize.getHeight();
  if (totalsY > pageHeight - 80) {
    pdf.addPage('letter', 'portrait');
    totalsY = 60;
  }

  pdf.setDrawColor(17, 17, 17);
  pdf.setLineWidth(1.5);
  pdf.line(left, totalsY - 10, left + 320, totalsY - 10);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text('Subtotal Gross Loads:', left, totalsY + 8);
  pdf.text(formatUsd(subtotalGross), left + 320, totalsY + 8, { align: 'right' });
  pdf.text(dispatchFeeLabel, left, totalsY + 26);
  pdf.text(formatUsd(dispatchFeeTotal), left + 320, totalsY + 26, { align: 'right' });
  pdf.line(left, totalsY + 36, left + 320, totalsY + 36);

  const fileCompany = sanitizeFilenamePart(companyName);
  const fileName = `${formatTodayFileDate()}-Invoice-${fileCompany}.pdf`;
  pdf.save(fileName);
  showToast('Invoice PDF downloaded', 'success');
}

function applyFilters() {
  const search    = document.getElementById("filter-search").value.toLowerCase().trim();
  const selectedDrivers = (window.filterDriverSelected || []).map((id) => String(id).trim()).filter(Boolean);
  const selectedDriverIds = new Set(selectedDrivers);
  const selectedDriverNames = new Set(
    (CAMIONEROS || [])
      .filter((d) => selectedDriverIds.has(String(d.id)))
      .map((d) => String(d.nombre || '').trim().toLowerCase())
      .filter(Boolean)
  );
  // Date range filter state (single input picker)
  const dateStart = dateRangeState.start;
  const dateEnd = dateRangeState.end || dateRangeState.start;
  const statusSelected = (window.filterStatusSelected || []).slice();
  const stateSelected = (window.filterStateSelected || []).slice();

  filtered = CARGAS.filter((c) => {
    // Never show unsaved temporary loads in the table (ids like new-<timestamp>)
    if (c && c.__isNew) return false;

    const estadoLabel = resolveEstado(c);

    const matchSearch =
      !search ||
      c.id.toLowerCase().includes(search) ||
      c.cliente.toLowerCase().includes(search) ||
      (String(c.broker_mc || '').toLowerCase().includes(search)) ||
      c.origen.toLowerCase().includes(search) ||
      c.destino.toLowerCase().includes(search) ||
      (String(c.invoice_number || c.invoice || '').toLowerCase().includes(search)) ||
      (String(c.bol_number || c.BOL || c.bol || '').toLowerCase().includes(search));

    const matchStatus = !statusSelected || statusSelected.length === 0 || statusSelected.includes(estadoLabel);
    let matchState = true;
    if (stateSelected && stateSelected.length > 0) {
      const cargaState = String(c.load_state || '').trim().toLowerCase();
      matchState = !!(cargaState && stateSelected.some(s => String(s || '').trim().toLowerCase() === cargaState));
    }
    let matchCam = true;
    if (selectedDrivers.length > 0) {
      const cargaCamIdStr = (c.camionero_id !== null && c.camionero_id !== undefined) ? String(c.camionero_id).trim() : '';
      const cargaDriverName = (c.driver !== null && c.driver !== undefined) ? String(c.driver).trim().toLowerCase() : '';
      const idMatch = cargaCamIdStr && selectedDriverIds.has(cargaCamIdStr);
      const nameMatch = cargaDriverName && selectedDriverNames.has(cargaDriverName);
      const directNameMatch = cargaDriverName && selectedDriverIds.has(cargaDriverName);
      matchCam = idMatch || nameMatch || directNameMatch;
    }
    let matchFecha = true;
    if (dateStart) {
      matchFecha = anyDateInCargaBetween(c, dateStart, dateEnd);
    }

    return matchSearch && matchStatus && matchCam && matchFecha && matchState;
  });

  // Sort by effective pickup date shown on web (mirrors formatPickupDisplay logic)
  // pick_up_date takes priority; otherwise use start date from availability
  filtered.sort((a, b) => {
    function effectivePickup(c) {
      if (c.pick_up_date) return new Date(c.pick_up_date);
      if (c.availability) {
        const m = String(c.availability).match(/(\d{4}-\d{2}-\d{2})/);
        if (m) return new Date(m[1]);
      }
      return new Date(0);
    }
    return effectivePickup(b) - effectivePickup(a);
  });

  // Reset to first page whenever filters/search change
  pagination.currentPage = 1;

  renderStatusSummary();
  renderTable();
}

function clearFilters() {
  const searchEl = document.getElementById("filter-search");
  if (searchEl) searchEl.value = "";
  selectedEstado = "";
  window.filterDriverSelected = [];
  document.querySelectorAll('#filter-driver-menu input[type="checkbox"]').forEach(cb => cb.checked = false);
  updateDropdownLabel('driver');

  // Also clear the date-range picker state and its input
  dateRangeState.start = null;
  dateRangeState.end = null;
  const dateInput = document.getElementById('filter-date-range');
  if (dateInput) dateInput.value = '';
  // ensure overlay is hidden
  try { hideDatePicker(); } catch (e) {}

  // clear multi-select filters and update UI
  try {
    window.filterStatusSelected = [];
    window.filterStateSelected = [];
    document.querySelectorAll('#filter-status-menu input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('#filter-state-menu input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateDropdownLabel('status');
    updateDropdownLabel('state');
  } catch (e) {}

  applyFilters();
}

function renderStatusSummary() {
  // Previously rendered chips here; chips have been removed in favor of multi-select dropdowns.
  const container = document.getElementById("cargas-status-summary");
  if (container) container.innerHTML = '';
}

function isAnyFilterActive() {
  const search = document.getElementById('filter-search');
  if (search && search.value.trim()) return true;
  if (window.filterStatusSelected && window.filterStatusSelected.length > 0) return true;
  if (window.filterStateSelected && window.filterStateSelected.length > 0) return true;
  if (window.filterDriverSelected && window.filterDriverSelected.length > 0) return true;
  if (dateRangeState.start) return true;
  return false;
}

function renderFinancialSummary() {
  const container = document.getElementById('financial-summary');
  if (!container) return;

  if (!isAnyFilterActive() || !filtered || filtered.length === 0) {
    container.classList.add('hidden');
    return;
  }

  // Use the same page slice as the PDF export
  const perPage = pagination.rowsPerPage || 40;
  const totalResults = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / perPage));
  const currentPage = Math.min(Math.max(1, pagination.currentPage || 1), totalPages);
  const startIdx = (currentPage - 1) * perPage;
  const endIdx = Math.min(startIdx + perPage, totalResults);
  const pageLoads = filtered.slice(startIdx, endIdx).filter(c => c && !c.__isNew);

  if (pageLoads.length === 0) {
    container.classList.add('hidden');
    return;
  }

  let subtotalGross = 0;
  let dispatchFeeTotal = 0;
  pageLoads.forEach(c => {
    subtotalGross += toNumberAmount(c.rate_usd);
    dispatchFeeTotal += toNumberAmount(c.commission);
  });

  const rawPct = subtotalGross > 0 ? Math.round((dispatchFeeTotal / subtotalGross) * 10000) / 100 : 0;
  const feeLabel = rawPct > 0 ? `Dispatch Fee (${Number.isInteger(rawPct) ? rawPct : rawPct.toFixed(1)}%)` : 'Dispatch Fee';
  const netAmount = subtotalGross - dispatchFeeTotal;
  const loadCount = pageLoads.length;

  container.classList.remove('hidden');
  container.innerHTML = `
    <div class="financial-summary-header">
      <span class="financial-summary-title">Financial Summary</span>
      <span class="financial-summary-badge">${loadCount} load${loadCount !== 1 ? 's' : ''} · page ${currentPage}</span>
    </div>
    <div class="financial-summary-rows">
      <div class="financial-summary-row">
        <span class="financial-summary-label">Subtotal Gross Loads</span>
        <span class="financial-summary-value">${formatUsd(subtotalGross)}</span>
      </div>
      <div class="financial-summary-row">
        <span class="financial-summary-label">${feeLabel}</span>
        <span class="financial-summary-value">${formatUsd(dispatchFeeTotal)}</span>
      </div>
      <div class="financial-summary-divider"></div>
      <div class="financial-summary-row net">
        <span class="financial-summary-label">Net Amount</span>
        <span class="financial-summary-value">${formatUsd(netAmount)}</span>
      </div>
    </div>
  `;
}

function quickFilterEstado(estado) {
  selectedEstado = estado;
  applyFilters();
}

function renderTable() {
  const tbody      = document.getElementById("cargas-tbody");
  const emptyState = document.getElementById("empty-state");

  // Show loading state while remote loads are being fetched
  if (isLoadingLoads) {
    tbody.innerHTML = "";
    emptyState.classList.remove("hidden");
    emptyState.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <p>Loading loads…</p>
    `;
    // remove pagination while loading
    const existingPagination = document.getElementById('table-pagination');
    if (existingPagination) existingPagination.remove();
    renderFinancialSummary();
    return;
  }

  const totalResults = filtered.length;
  const perPage = pagination.rowsPerPage || 40;
  const totalPages = Math.max(1, Math.ceil(totalResults / perPage));
  pagination.totalPages = totalPages;
  if (pagination.currentPage > totalPages) pagination.currentPage = totalPages;

  if (totalResults === 0) {
    tbody.innerHTML = "";
    emptyState.classList.remove("hidden");
    // Different messages depending on whether we attempted to fetch data
    if (loadsFetched) {
      emptyState.innerHTML = `
        <img class="empty-state-illustration" src="assets/no_loads_saved.svg" alt="No loads available" onerror="this.style.display='none'" />
        <p>No loads available.</p>
        <button class="btn btn-outline btn-sm" onclick="clearFilters()">Clear filters</button>
      `;
    } else {
      emptyState.innerHTML = `
        <img class="empty-state-illustration" src="assets/no_loads_saved.svg" alt="No loads available" onerror="this.style.display='none'" />
        <p>No loads found with the selected filters.</p>
        <button class="btn btn-outline btn-sm" onclick="clearFilters()">Clear filters</button>
      `;
    }
    // remove pagination when no results
    const existingPagination = document.getElementById('table-pagination');
    if (existingPagination) existingPagination.remove();
    renderFinancialSummary();
    return;
  }

  emptyState.classList.add("hidden");

  const startIdx = (pagination.currentPage - 1) * perPage;
  const endIdx = Math.min(startIdx + perPage, totalResults);
  const pageItems = filtered.slice(startIdx, endIdx);

  // animate rows fade-out / fade-in
  try {
    tbody.style.transition = 'opacity 160ms ease';
    tbody.style.opacity = 0;
  } catch (e) {}

  setTimeout(() => {
    tbody.innerHTML = pageItems
      .map((c) => {
        const cam    = c.camionero_id ? getCamionero(c.camionero_id) : null;
        const estado = resolveEstado(c);
        const stateLabel = c.load_state && String(c.load_state).trim() ? String(c.load_state).trim() : '';
        const driverText = c.driver ? String(c.driver).trim() : '';
        const showDriverMeta = (estado && String(estado).toLowerCase() !== 'pending') || !!driverText;
        const brokerHtml = `
          <div class="carga-client">${c.cliente || '—'}</div>
          ${c.broker_mc ? `<div class="carga-client-sub">${c.broker_mc}</div>` : ''}
        `;

        const truckerHtml = c.driver ? `<div>${c.driver}</div>` : '-';

        return `
          <tr onclick="openModal('${c.id}')">
            <td class="hidden-column-load-id" style="display:none;"><span class="load-id">${c.id}</span></td>
            <td>${brokerHtml}</td>
            <td>
              <div class="route-cell">
                <span class="route-origin">${c.origen}</span>
                <span class="route-sep">→</span>
                <span class="route-dest">${c.destino}</span>
              </div>
              ${ (c.trip_miles || c.stops) ? `<div class="route-distance">${c.trip_miles ? `${c.trip_miles} mi` : ''}${c.stops ? ` <span class="stops-flag">stops</span>` : ''}</div>` : '' }
              <div class="mobile-meta-info">
                <span class="status-dot ${estadoClass(estado)}" aria-label="${escapeHtml(estado)}" title="${escapeHtml(estado)}"></span>
                ${stateLabel ? `<span class="badge badge-sm badge-state">${escapeHtml(stateLabel)}</span>` : ''}
                ${showDriverMeta && driverText ? `<span class="mobile-driver-meta">${escapeHtml(driverText)}</span>` : ''}
              </div>
            </td>
            <td>
              ${c.rate_usd ? `<div class="price-cell">$${c.rate_usd}</div>` : `<div class="price-cell">—</div>`}
              ${(c.commission !== null && c.commission !== undefined && String(c.commission).trim() !== '') ? `<div class="commission-cell">(${escapeHtml(String(c.commission))})</div>` : ''}
            </td>
            <td>${truckerHtml}</td>
            <td>
              <div class="status-stack">
                <span class="badge ${estadoClass(estado)}">${estado}</span>
                ${stateLabel ? `<span class="badge badge-sm badge-state">${stateLabel}</span>` : ''}
              </div>
            </td>
            <td>${formatPickupDisplay(c)}</td>
            <td>${formatDeliveryDisplay(c)}</td>
            <td>
              <div class="action-menu" onclick="event.stopPropagation();">
                <button class="action-toggle btn-icon" aria-controls="actions-${c.id}" aria-expanded="false" onclick="event.stopPropagation(); toggleRowActions(event, '${c.id}')">⋯</button>
                <div class="action-dropdown" id="actions-${c.id}" role="menu" aria-hidden="true">
                  <button class="dropdown-item" onclick="event.stopPropagation(); openEditModal('${c.id}')"><svg class="menu-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>Edit</button>
                  <button class="dropdown-item" onclick="event.stopPropagation(); openUpload('${c.id}','Rate Conf.')"><svg class="menu-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Rate ${c.rate_conf_url ? '<span class="upload-check-inline">✓</span>' : ''}</button>
                  <button class="dropdown-item" onclick="event.stopPropagation(); openUpload('${c.id}','BOL')"><svg class="menu-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>BOL ${c.bol_url ? '<span class="upload-check-inline">✓</span>' : ''}</button>
                  <button class="dropdown-item" onclick="event.stopPropagation(); openUpload('${c.id}','Other Doc')"><svg class="menu-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a1.5 1.5 0 0 1-2.12-2.12l8.49-8.48"/></svg>Other Doc</button>
                </div>
              </div>
            </td>
          </tr>`;
      })
      .join("");

    try { tbody.style.opacity = 1; } catch (e) {}

    // render/update pagination footer
    renderPaginationControls(startIdx + 1, endIdx, totalResults, pagination.currentPage, totalPages, perPage);
    renderFinancialSummary();
  }, 140);
}

// Render pagination footer controls
function renderPaginationControls(startShowing, endShowing, totalResults, currentPage, totalPages, perPage) {
  const wrapperId = 'table-pagination';
  let container = document.getElementById(wrapperId);
  const host = document.querySelector('.table-container');
  if (!host) return;
  if (!container) {
    container = document.createElement('div');
    container.id = wrapperId;
    container.className = 'table-pagination';
    host.appendChild(container);
  }

  // build page number list (compact)
  function getPageList(cur, total) {
    const delta = 2;
    const range = [];
    if (total <= 7) {
      for (let i = 1; i <= total; i++) range.push(i);
      return range;
    }
    range.push(1);
    let left = Math.max(2, cur - delta);
    let right = Math.min(total - 1, cur + delta);
    if (left > 2) range.push('...');
    for (let i = left; i <= right; i++) range.push(i);
    if (right < total - 1) range.push('...');
    range.push(total);
    return range;
  }

  const pages = getPageList(currentPage, totalPages);

  const pagesHtml = pages
    .map(p => {
      if (p === '...') return `<span class="page-ellipsis">…</span>`;
      return `<button class="page-btn ${p===currentPage? 'active':''}" onclick="goToPage(${p})">${p}</button>`;
    }).join('');

  const allSelected = totalResults > 0 && perPage >= totalResults;

  container.innerHTML = `
    <div class="pagination-footer">
      <div class="pagination-info">Showing ${startShowing}–${endShowing} of ${totalResults} results</div>
      <div class="pagination-controls">
        <div class="pagination-left">
          <label class="rows-label">Rows:</label>
          <select id="rows-per-page-select" class="rows-per-page-select" onchange="changeRowsPerPage(this.value)">
            <option value="20" ${perPage==20? 'selected':''}>20</option>
            <option value="40" ${perPage==40? 'selected':''}>40</option>
            <option value="80" ${perPage==80? 'selected':''}>80</option>
            <option value="100" ${perPage==100? 'selected':''}>100</option>
            <option value="500" ${perPage==500? 'selected':''}>500</option>
            <option value="all" ${allSelected ? 'selected' : ''}>All</option>
          </select>
        </div>
        <div class="pagination-nav">
          <button class="page-btn prev ${currentPage===1? 'disabled':''}" ${currentPage===1? 'disabled':''} onclick="prevPage()">Previous</button>
          ${pagesHtml}
          <button class="page-btn next ${currentPage===totalPages? 'disabled':''}" ${currentPage===totalPages? 'disabled':''} onclick="nextPage()">Next</button>
        </div>
      </div>
    </div>`;
}

function goToPage(n) {
  const page = Number(n) || 1;
  if (page < 1) return;
  if (!pagination.totalPages) pagination.totalPages = Math.max(1, Math.ceil(filtered.length / pagination.rowsPerPage));
  if (page > pagination.totalPages) return;
  if (page === pagination.currentPage) return;
  pagination.currentPage = page;
  renderTable();
  // smooth scroll container to the top of the table
  try {
    const content = document.querySelector('.content');
    const table = document.querySelector('.table-container');
    if (content && table) {
      const top = table.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop - 8;
      content.scrollTo({ top, behavior: 'smooth' });
    }
  } catch (e) {}
}

function prevPage() { if (pagination.currentPage > 1) goToPage(pagination.currentPage - 1); }
function nextPage() { if (pagination.currentPage < (pagination.totalPages || 1)) goToPage(pagination.currentPage + 1); }

function changeRowsPerPage(val) {
  const num = String(val).toLowerCase() === 'all' ? Math.max(filtered.length, 1) : (Number(val) || 40);
  pagination.rowsPerPage = num;
  pagination.currentPage = 1;
  renderTable();
}

function closeAllActionMenus() {
  const openMenus = document.querySelectorAll('.action-dropdown.show');
  openMenus.forEach(menu => {
    menu.classList.remove('show');
    menu.setAttribute('aria-hidden', 'true');
    const toggle = document.querySelector(`[aria-controls="${menu.id}"]`);
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    menu.style.top = '';
    menu.style.left = '';
    menu.style.right = '';
    menu.style.bottom = '';
  });
}

function positionActionMenu(menu, button) {
  const rect = button.getBoundingClientRect();
  const gap = 8;
  const menuWidth = menu.offsetWidth || 160;
  const menuHeight = menu.offsetHeight || 220;

  let top = rect.bottom + gap;
  let left = rect.right - menuWidth;

  if (left < 8) left = 8;
  if (top + menuHeight > window.innerHeight - 8) {
    top = Math.max(8, rect.top - menuHeight - gap);
  }
  if (left + menuWidth > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - menuWidth - 8);
  }

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  menu.style.right = 'auto';
  menu.style.bottom = 'auto';
}

function toggleRowActions(event, id) {
  try { event.stopPropagation(); } catch (e) {}
  const menu = document.getElementById(`actions-${id}`);
  if (!menu) return;
  const isShown = menu.classList.contains('show');
  closeAllActionMenus();
  if (!isShown) {
    menu.classList.add('show');
    menu.setAttribute('aria-hidden', 'false');
    const toggle = document.querySelector(`[aria-controls="${menu.id}"]`);
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'true');
      positionActionMenu(menu, toggle);
    }
  }
}

// Close action menus when clicking outside
document.addEventListener('click', (e) => {
  closeAllActionMenus();
});

window.addEventListener('scroll', () => {
  closeAllActionMenus();
}, { capture: true });

// =============================================================
// MODAL – DETALLE DE CARGA
// =============================================================

function openModal(cargaId) {
  const c = CARGAS.find((x) => x.id === cargaId);
  if (!c) return;
  try {
    const panel = document.getElementById('modal-panel');
    panel.classList.remove('modal-panel-wide');
    panel.classList.add('modal-panel-load-details');
  } catch (e) {}
  openModalCargaId = cargaId;
  // Build canonical document list and deduplicate by storage path (prefer Supabase URLs)
  const rateFiles = parseDocField(c.rate_conf_url);
  const bolFiles = parseDocField(c.bol_url);
  const miscFiles = parseDocField(c.other_doc);

  // preserve insertion order: rate -> bol -> other
  const candidates = [];
  rateFiles.forEach((item, idx) => candidates.push({ type: 'rate_conf_url', label: rateFiles.length > 1 ? `Rate Confirmation ${idx + 1}` : 'Rate Confirmation', raw: item }));
  bolFiles.forEach((item, idx) => candidates.push({ type: 'bol_url', label: bolFiles.length > 1 ? `BOL ${idx + 1}` : 'BOL', raw: item }));
  miscFiles.forEach((item, idx) => candidates.push({ type: 'other_doc', label: miscFiles.length > 1 ? `Other Doc ${idx + 1}` : 'Other Doc', raw: item }));

  // Deduplicate by canonical storage key and prefer Supabase/public URLs
  const docsByKey = new Map();
  candidates.forEach((doc) => {
    const raw = doc.raw;
    const key = canonicalizeDocKey(raw);
    if (!key) return;

    // build a candidate URL: prefer raw value if already an http(s) URL,
    // otherwise build a public file URL if possible
    const candidateUrl = (typeof raw === 'string' && /^https?:\/\//i.test(raw)) ? raw : (buildFileUrl(raw) || String(raw || ''));

    const existing = docsByKey.get(key);
    if (!existing) {
      docsByKey.set(key, { type: doc.type, label: doc.label, fileName: raw, url: candidateUrl, fname: getDocFilename(candidateUrl) });
      return;
    }

    // If the existing entry is not an HTTP URL but the new one is, prefer the new one
    const existingIsHttp = /^https?:\/\//i.test(existing.url || '');
    const newIsHttp = /^https?:\/\//i.test(candidateUrl || '');
    if (!existingIsHttp && newIsHttp) {
      docsByKey.set(key, { type: doc.type, label: doc.label, fileName: raw, url: candidateUrl, fname: getDocFilename(candidateUrl) });
    }
    // otherwise keep the first/earlier entry (stable order)
  });

  const docLinksArr = Array.from(docsByKey.values());
  const hasRateUrl = docLinksArr.some(d => d.type === 'rate_conf_url');
  const hasBolUrl = docLinksArr.some(d => d.type === 'bol_url');
  const rateCheckHtml = hasRateUrl ? '<span class="upload-check" style="margin-left:8px; color:#10b981; font-weight:700;">✔</span>' : '';
  const bolCheckHtml = hasBolUrl ? '<span class="upload-check" style="margin-left:8px; color:#10b981; font-weight:700;">✔</span>' : '';
  const docLinksHtml = docLinksArr.length === 0 ? '<p class="no-docs">No attached documents.</p>' : docLinksArr.map(d => {
    const safeUrl = String(d.url || '').replace(/'/g, "\\'");
    const safeName = String(d.fname || '').replace(/'/g, "\\'");
    const safeFileName = String(d.fileName || '').replace(/'/g, "\\'");
    const safeLabel = String(d.label || 'document').replace(/'/g, "\\'");
    return `<div class="doc-item" draggable="true" title="Arrastrar a carpeta para descargar · Click para previsualizar" ondragstart="startDocDownloadDrag(event,'${safeUrl}','${safeName}')" onclick="openDocPreview('${safeUrl}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <div class="doc-item-info">
                <span class="doc-item-label">${safeLabel}</span>
                <span class="doc-item-name">${safeName}</span>
              </div>
              <button class="doc-item-delete" type="button" title="Delete document" onclick="event.stopPropagation(); openDeleteDocConfirm('${c.id}','${d.type}','${safeFileName}','${safeLabel}')" aria-label="Delete ${safeLabel}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18"/>
                  <path d="M8 6V4h8v2"/>
                  <path d="M19 6l-1 14H6L5 6"/>
                  <path d="M10 11v6"/>
                  <path d="M14 11v6"/>
                </svg>
              </button>
              <button class="doc-item-download" type="button" title="Download document" onclick="event.stopPropagation(); downloadDoc('${safeUrl}', '${safeName}')" aria-label="Download ${safeLabel}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
            </div>`;
  }).join('');

  const cam    = getCamionero(c.camionero_id);
  const estado = resolveEstado(c);
  const stateLabel = c.load_state && String(c.load_state).trim() ? String(c.load_state).trim() : '';
  const driverName = c.driver && String(c.driver).trim() ? String(c.driver).trim() : cam.nombre;
  const driverInitials = initials(driverName || 'NA');
  const driverAvatarStyle = getDriverAvatarStyle(getLoadDriverGroupKey(c) || driverName);
  const tripMilesValue = c.trip_miles !== null && c.trip_miles !== undefined && String(c.trip_miles).trim() !== '' ? `${c.trip_miles} mi` : '';
  const rateUsdValue = (() => {
    const raw = c.rate_usd;
    if (raw === null || raw === undefined || String(raw).trim() === '') return '';
    const asNum = Number(raw);
    if (!Number.isNaN(asNum)) return `$${asNum.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    return `$${String(raw).trim()}`;
  })();
  const estimatedRpmValue = c.estimated_rpm !== null && c.estimated_rpm !== undefined && String(c.estimated_rpm).trim() !== ''
    ? `${String(c.estimated_rpm).trim()} rpm`
    : '';

  // Commission value from Supabase (may be numeric or string). Show as (value) when present.
  const commissionRaw = c.commission ?? c['commission_ %'] ?? c['commission_%'] ?? null;
  const commissionValue = (commissionRaw !== null && commissionRaw !== undefined && String(commissionRaw).trim() !== '')
    ? escapeHtml(String(commissionRaw).trim())
    : '';

  // Parse stops for route display
  let stopsArray = [];
  try {
    if (Array.isArray(c.stops)) stopsArray = c.stops;
    else if (typeof c.stops === 'string' && c.stops.trim()) {
      const parsed = JSON.parse(c.stops);
      if (Array.isArray(parsed)) stopsArray = parsed;
      else stopsArray = [{ city: String(c.stops), state: '' }];
    }
  } catch (e) {
    if (c.stops) stopsArray = [{ city: String(c.stops), state: '' }];
  }
  const stopsRouteHtml = stopsArray
    .filter(s => s && (s.city || s.state))
    .map(s => {
      const label = [s.city, s.state].filter(Boolean).join(', ');
      return `
        <div class="modal-route-point">
          <div class="route-dot route-dot-stop"></div>
          <div>
            <span class="modal-route-label">Stop</span>
            <span class="modal-route-value">${label}</span>
          </div>
        </div>
        <div class="route-connector"></div>`;
    }).join('');

  document.getElementById("modal-title").textContent    = "Load Details";
  document.getElementById("modal-subtitle").textContent = "";

  document.getElementById("modal-body").innerHTML = `
    <!-- Ruta (izquierda) + Estado (derecha) -->
    <div class="modal-grid">
      <div class="modal-section">
        <div class="modal-section-head modal-section-head--route">
          <div class="modal-section-title">Route</div>
          <div class="modal-route-meta">
            ${tripMilesValue ? `<div class="modal-route-chip modal-route-chip--miles">${tripMilesValue}</div>` : ''}
            ${rateUsdValue ? `<div class="modal-route-chip modal-route-chip--money">${rateUsdValue}</div>` : ''}
            ${estimatedRpmValue ? `<div class="modal-route-chip modal-route-chip--rpm">${estimatedRpmValue}</div>` : ''}
            ${commissionValue ? `<div class="modal-route-chip modal-route-chip--commission">${commissionValue}</div>` : ''}
          </div>
        </div>
        <div class="modal-route">
          <div class="modal-route-point">
            <div class="route-dot route-dot-origin"></div>
            <div>
              <span class="modal-route-label">Origin</span>
              <span class="modal-route-value">${c.origen}${c.origin_deadhead ? ` <span class="modal-route-deadhead">(${c.origin_deadhead})</span>` : ''}</span>
            </div>
          </div>
          <div class="route-connector"></div>
          ${stopsRouteHtml}
          <div class="modal-route-point">
            <div class="route-dot route-dot-dest"></div>
            <div>
              <span class="modal-route-label">Destination</span>
              <span class="modal-route-value">${c.destino}${c.dest_deadhead ? ` <span class="modal-route-deadhead">(${c.dest_deadhead})</span>` : ''}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-section">
        <div class="modal-status-row modal-status-row--dual">
          <span class="badge badge-lg ${estadoClass(estado)}">${estado}</span>
          ${stateLabel ? `<span class="badge badge-lg badge-state">${stateLabel}</span>` : ''}
        </div>
        <div class="modal-section" style="margin-top: 12px; margin-bottom: 0;">
          <div class="modal-section-title">Assigned driver</div>
          <div class="modal-trucker">
            <div class="modal-avatar" style="${driverAvatarStyle}">${driverInitials}</div>
            <div>
              <span class="modal-trucker-name">${driverName}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Fechas + Carga -->
    <div class="modal-grid">
      <div class="modal-section">
        <div class="modal-section-title">Dates</div>
        <div class="modal-info-item modal-dates-grid">
          <div class="modal-date-col">
            <span class="modal-date-col-label">PICK UP</span>
            <span class="modal-date-col-date">${c.pick_up_date ? formatDate(c.pick_up_date) : '—'}</span>
            <span class="modal-date-col-time">${c.pick_up_time || ''}</span>
            ${c.pick_up_expected_time ? `<span class="modal-date-col-expected">(${c.pick_up_expected_time})</span>` : ''}
          </div>
          <div class="modal-date-divider"></div>
          <div class="modal-date-col">
            <span class="modal-date-col-label">DELIVERY</span>
            <span class="modal-date-col-date">${c.delivery_date ? formatDate(c.delivery_date) : (c.fecha_entrega ? formatDate(c.fecha_entrega) : '—')}</span>
            <span class="modal-date-col-time">${c.delivery_time || ''}</span>
            ${c.delivery_expected_time ? `<span class="modal-date-col-expected">(${c.delivery_expected_time})</span>` : ''}
          </div>
        </div>
        <div class="modal-info-item modal-dates-grid" style="margin-top:8px;">
          <div class="modal-date-col">
            <span class="modal-date-col-label">INVOICE</span>
            <div class="modal-inline-field">
              <div class="modal-inline-display">
                <span class="modal-date-col-date" data-load-detail-display="invoice_number">${escapeHtml(c.invoice_number || '—')}</span>
                <button class="modal-inline-edit-trigger" type="button" title="Edit invoice number" aria-label="Edit invoice number" onclick="toggleLoadDetailEdit(this)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                </button>
              </div>
              <div class="modal-inline-edit hidden">
                <input class="modal-inline-input" type="text" value="${escapeHtml(c.invoice_number || '')}" data-load-detail-field="invoice_number" placeholder="Invoice number" aria-label="Invoice number" />
                <button class="modal-inline-save" type="button" title="Save invoice number" aria-label="Save invoice number" onclick="saveLoadDetailField('${c.id}', 'invoice_number', this)">✓</button>
              </div>
            </div>
          </div>
          <div class="modal-date-divider"></div>
          <div class="modal-date-col">
            <span class="modal-date-col-label">BOL</span>
            <div class="modal-inline-field">
              <div class="modal-inline-display">
                <span class="modal-date-col-date" data-load-detail-display="bol_number">${escapeHtml(c.bol_number || '—')}</span>
                <button class="modal-inline-edit-trigger" type="button" title="Edit BOL number" aria-label="Edit BOL number" onclick="toggleLoadDetailEdit(this)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                </button>
              </div>
              <div class="modal-inline-edit hidden">
                <input class="modal-inline-input" type="text" value="${escapeHtml(c.bol_number || '')}" data-load-detail-field="bol_number" placeholder="BOL number" aria-label="BOL number" />
                <button class="modal-inline-save" type="button" title="Save BOL number" aria-label="Save BOL number" onclick="saveLoadDetailField('${c.id}', 'bol_number', this)">✓</button>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-load-id-box" style="margin-top:8px;">
          <span class="modal-broker-key">Load ID:</span>
          <span class="modal-load-id-val">${c.id}</span>
        </div>
      </div>

      <div class="modal-section">
        <div class="modal-section-title">Load details</div>
        <div class="modal-load-details-grid">
          <div class="modal-detail-tile">
            <span class="modal-detail-label">Type</span>
            <span class="modal-detail-value">${c.tipo || '—'}</span>
          </div>
          <div class="modal-detail-tile">
            <span class="modal-detail-label">Weight</span>
            <span class="modal-detail-value">${c.weight || c.peso || '—'}</span>
          </div>
          <div class="modal-detail-tile">
            <span class="modal-detail-label">Pallets</span>
            <span class="modal-detail-value">${c.pallets || '—'}</span>
          </div>
          <div class="modal-detail-tile">
            <span class="modal-detail-label">Capacity</span>
            <span class="modal-detail-value">${c.capacity || '—'}</span>
          </div>
          <div class="modal-detail-tile">
            <span class="modal-detail-label">Length (ft)</span>
            <span class="modal-detail-value">${c.length_ft || c.length || '—'}</span>
          </div>
        </div>
        <div class="modal-section" style="margin-top:12px; margin-bottom:0;">
          <div class="modal-section-title">Broker information</div>
          <div class="modal-broker-box">
            ${c.cliente ? `<div class="modal-broker-line"><span class="modal-broker-key">Company:</span><span class="modal-broker-val">${c.cliente}</span></div>` : ''}
            ${c.broker_mc ? `<div class="modal-broker-line"><span class="modal-broker-key">MC:</span><span class="modal-broker-val">${c.broker_mc}</span></div>` : ''}
            ${(c.contact_email && !/^no[\s_-]?email/i.test(String(c.contact_email).trim())) ? `<div class="modal-broker-line"><svg class="modal-broker-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="2,4 12,13 22,4"/></svg><span class="modal-broker-val">${c.contact_email}</span></div>` : ''}
            ${(c.contact_phone && !/^no[\s_-]?phone/i.test(String(c.contact_phone).trim())) ? `<div class="modal-broker-line"><svg class="modal-broker-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3-8.59A2 2 0 0 1 3.68 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span class="modal-broker-val">${c.contact_phone}${c.contact_phone_ext ? ` x${c.contact_phone_ext}` : ''}</span></div>` : ''}
          </div>
        </div>
      </div>
    </div>

    <!-- Notas -->
    ${
      (c.notas || c.comments)
        ? `<div class="modal-section modal-notes-section">
             <span class="modal-notes-label">Notes:</span>
             <div class="modal-notes-box">${[c.comments, c.notas].filter(Boolean).join('\n\n')}</div>
           </div>`
        : ""
    }

    <!-- Documents -->
    <div class="modal-section">
      <div class="modal-section-title">Documents</div>
      <div class="docs-list" id="docs-list-${c.id}">
        ${docLinksHtml}
      </div>
      <div class="docs-upload-row">
            <button class="btn btn-sm btn-outline" onclick="openUpload('${c.id}','Rate Confirmation')">
              + Upload Rate Confirmation ${rateCheckHtml}
            </button>
            <button class="btn btn-sm btn-outline" onclick="openUpload('${c.id}','BOL')">
              + Upload BOL ${bolCheckHtml}
            </button>
            <button class="btn btn-sm btn-outline" onclick="openUpload('${c.id}','Other Doc')">
              + Other Doc
            </button>
            <button class="btn btn-sm btn-primary" onclick="openEditModal('${c.id}')">
              ✎ Edit Load
            </button>
      </div>
    </div>
  `;

  document.getElementById("modal-overlay").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function docItem(name) {
  return `
    <div class="doc-item">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      ${name}
    </div>`;
}

function parseDocField(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(v => String(v || '').trim()).filter(Boolean);
  }

  const raw = String(value).trim();
  if (!raw) return [];

  // Preferred format: JSON array string in DB, e.g. ["BOL-1.pdf","BOL-2.pdf"]
  if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('"') && raw.endsWith('"'))) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(v => String(v || '').trim()).filter(Boolean);
      if (typeof parsed === 'string' && parsed.trim()) return [parsed.trim()];
    } catch (e) {}
  }

  // Backward compatible fallback for ad-hoc lists.
  if (raw.includes('\n')) return raw.split('\n').map(v => v.trim()).filter(Boolean);
  if (raw.includes(',')) return raw.split(',').map(v => v.trim()).filter(Boolean);

  return [raw];
}

function buildFileUrl(fileName) {
  if (!fileName) return null;
  const cleanName = String(fileName).trim();
  if (!cleanName) return null;
  if (/^https?:\/\//i.test(cleanName)) return cleanName;

  // Normalize keys stored as "load_documents/file.pdf" or "/load_documents/file.pdf"
  // and keep nested folder separators valid for Supabase object paths.
  let normalized = cleanName.replace(/^\/+/, '');
  normalized = normalized.replace(/^load_documents\/+?/i, '');
  if (!normalized) return null;

  const encodedPath = normalized
    .split('/')
    .filter(Boolean)
    .map(part => encodeURIComponent(part))
    .join('/');

  return LOAD_DOCS_BASE_URL + encodedPath;
}

function getDocFilename(url) {
  try {
    return decodeURIComponent(url.split('?')[0].split('/').pop());
  } catch {
    return url.split('/').pop();
  }
}

function getStoragePathFromDoc(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    const marker = '/load_documents/';
    const idx = raw.indexOf(marker);
    if (idx === -1) return getDocFilename(raw);
    return decodeURIComponent(raw.slice(idx + marker.length).split('?')[0]);
  }

  return raw.replace(/^\/+/, '').replace(/^load_documents\/+?/i, '');
}

// Create a stable, normalized key for a document entry so different
// representations (plain filename, storage path, public URL) collapse
// to the same canonical key. Handles JSON-ish strings and decodes
// URL encodings. Result is lowercased and trimmed.
function canonicalizeDocKey(value) {
  if (value === null || value === undefined) return null;
  // If the value is an object (rare), try to extract common props
  if (typeof value === 'object') {
    if (value.url) return canonicalizeDocKey(value.url);
    if (value.name) return canonicalizeDocKey(value.name);
    try { return canonicalizeDocKey(String(value)); } catch (e) { return null; }
  }

  let s = String(value || '').trim();
  if (!s) return null;

  // If the string contains a JSON object, try to parse and extract
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        // prefer first item
        if (parsed.length === 0) return null;
        return canonicalizeDocKey(parsed[0]);
      }
      if (parsed && typeof parsed === 'object') {
        if (parsed.url) return canonicalizeDocKey(parsed.url);
        if (parsed.name) return canonicalizeDocKey(parsed.name);
      }
    } catch (e) {
      // fall through
    }
  }

  // Prefer extracting storage path from a public URL when present
  const path = getStoragePathFromDoc(s) || getDocFilename(s) || s;
  try {
    // decode URI components and normalize whitespace/case
    const decoded = decodeURIComponent(String(path));
    return decoded.replace(/\+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  } catch (e) {
    return String(path).replace(/\+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }
}

function formatDocFieldValue(nextDocs, originalValue) {
  if (Array.isArray(originalValue)) return nextDocs;
  if (!nextDocs.length) return null;

  const raw = String(originalValue || '').trim();
  if (!raw) return nextDocs.length === 1 ? nextDocs[0] : JSON.stringify(nextDocs);
  if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('"') && raw.endsWith('"'))) return JSON.stringify(nextDocs);
  if (raw.includes('\n')) return nextDocs.join('\n');
  if (raw.includes(',')) return nextDocs.join(', ');
  return nextDocs.length === 1 ? nextDocs[0] : JSON.stringify(nextDocs);
}

async function updateLoadDocField(cargaId, field, value, extraFields = {}) {
  if (!supabaseClient || !cargaId || !field) throw new Error('Supabase client unavailable');

  for (const table of ['loads_data', 'past_loads_data']) {
    try {
      const { data, error } = await supabaseClient
        .from(table)
        .update({ [field]: value, ...extraFields })
        .eq('load_id', cargaId)
        .select('load_id')
        .limit(1);
      if (error) throw error;
      if (Array.isArray(data) && data.length > 0) return true;
    } catch (e) {}
  }

  throw new Error('Load record not found');
}

async function saveLoadDetailField(cargaId, field, button) {
  const allowedFields = {
    invoice_number: ['invoice', 'invoice_number', 'invoice_no', 'invoiceId'],
    bol_number: ['BOL', 'bol', 'bol_number', 'bill_of_lading', 'bill_of_lading_number']
  };
  const candidates = allowedFields[field];
  const input = button && button.parentElement
    ? button.parentElement.querySelector(`[data-load-detail-field="${field}"]`)
    : null;
  if (!candidates || !input || !cargaId || !supabaseClient) return;

  const value = input.value.trim() || null;
  button.disabled = true;

  try {
    let saved = false;
    for (const table of ['loads_data', 'past_loads_data']) {
      const { data: row, error: selectError } = await supabaseClient
        .from(table)
        .select('*')
        .eq('load_id', cargaId)
        .maybeSingle();
      if (selectError) continue;
      if (!row) continue;

      const targetColumn = candidates.find((column) => Object.prototype.hasOwnProperty.call(row, column)) || candidates[0];
      const { error: updateError } = await supabaseClient
        .from(table)
        .update({ [targetColumn]: value })
        .eq('load_id', cargaId);
      if (updateError) throw updateError;

      saved = true;
      break;
    }

    if (!saved) throw new Error('Load record not found');

    const carga = CARGAS.find((item) => item.id === cargaId);
    if (carga) carga[field] = value;
    const wrapper = button.closest('.modal-inline-field');
    const display = wrapper ? wrapper.querySelector(`[data-load-detail-display="${field}"]`) : null;
    const editor = wrapper ? wrapper.querySelector('.modal-inline-edit') : null;
    if (display) display.textContent = value || '—';
    const displayWrapper = wrapper ? wrapper.querySelector('.modal-inline-display') : null;
    if (displayWrapper) displayWrapper.classList.remove('hidden');
    if (editor) editor.classList.add('hidden');
    applyFilters();
    showToast(`${field === 'invoice_number' ? 'Invoice' : 'BOL'} number updated`, 'success');
  } catch (error) {
    showToast(`Failed to update ${field === 'invoice_number' ? 'invoice' : 'BOL'} number`, 'error');
    console.error('Error updating Load Details field', error);
  } finally {
    button.disabled = false;
  }
}

function toggleLoadDetailEdit(button) {
  const wrapper = button.closest('.modal-inline-field');
  if (!wrapper) return;
  const display = wrapper.querySelector('.modal-inline-display');
  const editor = wrapper.querySelector('.modal-inline-edit');
  if (!display || !editor) return;
  display.classList.add('hidden');
  editor.classList.remove('hidden');
  const input = editor.querySelector('.modal-inline-input');
  if (input) {
    input.focus();
    input.select();
  }
}

// Update a single `status` or `state` field on the load identified by `load_id`.
// Robust version: selects the row first to detect the actual column name
// (e.g. `status`, `load_status`, `estado` or `state`, `load_state`, `load_stage`) and
// updates that column on the table where the row exists. Returns an outcome object.
async function updateLoadField({ load_id, field, value }) {
  if (!supabaseClient) {
    const err = new Error('Supabase client not initialized');
    console.error('updateLoadField error:', err);
    throw err;
  }
  if (!load_id) throw new Error('Missing load_id');
  if (!field || (field !== 'status' && field !== 'state')) throw new Error('Field must be "status" or "state"');

  const STATUS_COLS = ['status', 'load_status', 'estado'];
  const STATE_COLS = ['state', 'load_state', 'load_stage', 'stage'];
  const candidates = field === 'status' ? STATUS_COLS : STATE_COLS;

  // Normalize value to write
  // Normalize value to write — persist lowercase strings to database/webhook
  let valueToWrite = value;
  if (field === 'status') {
    const norm = normalizeEstado(value || '');
    valueToWrite = norm === 'Pending' ? '' : norm.toLowerCase();
  } else {
    valueToWrite = (value === '' || value === null) ? null : String(value).toLowerCase();
  }

  try {
    for (const table of ['loads_data', 'past_loads_data']) {
      // fetch the row so we can inspect available columns
      let row = null;
      try {
        const { data, error } = await supabaseClient.from(table).select('*').eq('load_id', load_id).maybeSingle();
        if (error) {
          console.debug(`updateLoadField: select error on ${table}`, error);
          continue;
        }
        if (!data) continue; // not in this table
        row = data;
      } catch (e) {
        console.debug(`updateLoadField: select failed on ${table}`, e);
        continue;
      }

      // choose best matching column
      let targetCol = null;
      for (const col of candidates) {
        if (Object.prototype.hasOwnProperty.call(row, col)) { targetCol = col; break; }
      }
      // fallback to canonical `field` if candidate not found
      if (!targetCol) targetCol = field;

      // perform update
      try {
        const payload = { [targetCol]: valueToWrite };
        const { data: updData, error: updErr } = await supabaseClient
          .from(table)
          .update(payload)
          .eq('load_id', load_id)
          .select(targetCol)
          .limit(1);

        if (updErr) {
          console.error(`updateLoadField: update error on ${table}.${targetCol}`, updErr);
          throw updErr;
        }

        if (Array.isArray(updData) && updData.length > 0) {
          console.info(`updateLoadField: updated ${table}.${targetCol} for load_id=${load_id}`);
          return { success: true, table, column: targetCol, row: updData[0] };
        }

        // If update returned no rows, verify the row still exists and return success
        const { data: verify, error: verifyErr } = await supabaseClient.from(table).select(targetCol).eq('load_id', load_id).maybeSingle();
        if (!verifyErr && verify) {
          return { success: true, table, column: targetCol, row: verify };
        }
      } catch (e) {
        // bubble up to outer catch
        throw e;
      }
    }

    return { success: false, table: null, message: 'Load not found' };
  } catch (err) {
    console.error('updateLoadField: unexpected error', err);
    throw err;
  }
}

function closeDeleteDocConfirm() {
  pendingDocDelete = null;
  const overlay = document.getElementById('doc-delete-confirm');
  if (overlay) overlay.remove();
}

function openDeleteDocConfirm(cargaId, field, fileName, label) {
  closeDeleteDocConfirm();
  pendingDocDelete = { cargaId, field, fileName, label };

  const overlay = document.createElement('div');
  overlay.id = 'doc-delete-confirm';
  overlay.className = 'doc-confirm-overlay';
  overlay.onclick = (event) => {
    if (event.target === overlay) closeDeleteDocConfirm();
  };
  overlay.innerHTML = `
    <div class="doc-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="doc-confirm-title">
      <div class="doc-confirm-icon-wrap">
        <svg class="doc-confirm-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18"/>
          <path d="M8 6V4h8v2"/>
          <path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6"/>
          <path d="M14 11v6"/>
        </svg>
      </div>
      <h3 class="doc-confirm-title" id="doc-confirm-title">Delete document</h3>
      <p class="doc-confirm-text">Are you sure you want to delete this document?</p>
      <div class="doc-confirm-name">${escapeHtml(label || getDocFilename(fileName) || 'Document')}</div>
      <div class="doc-confirm-actions">
        <button class="btn btn-sm btn-outline" type="button" onclick="closeDeleteDocConfirm()">Cancel</button>
        <button class="btn btn-sm doc-confirm-accept" type="button" onclick="confirmDeleteDoc()">Accept</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function confirmDeleteDoc() {
  const pending = pendingDocDelete;
  if (!pending) return;

  const { cargaId, field, fileName } = pending;
  const c = CARGAS.find((x) => x.id === cargaId);
  if (!c) {
    closeDeleteDocConfirm();
    return;
  }

  const currentDocs = parseDocField(c[field]);
  const nextDocs = [...currentDocs];
  const exactIndex = nextDocs.indexOf(fileName);
  const fallbackIndex = exactIndex === -1
    ? nextDocs.findIndex((item) => getDocFilename(item) === getDocFilename(fileName))
    : exactIndex;

  if (fallbackIndex === -1) {
    showToast('Document not found', 'error');
    closeDeleteDocConfirm();
    return;
  }

  nextDocs.splice(fallbackIndex, 1);
  const nextValue = formatDocFieldValue(nextDocs, c[field]);
  const storagePath = getStoragePathFromDoc(fileName);
  const previousValue = c[field];
  const isRateConfirmation = field === 'rate_conf_url';
  const documentIdFields = isRateConfirmation
    ? { file_id: null, rate_drive_id: null }
    : {};

  try {
    await updateLoadDocField(cargaId, field, nextValue, documentIdFields);
    c[field] = nextValue;

    if (isRateConfirmation) {
      c.file_id = null;
      c.rate_drive_id = null;
    }

    if (field === 'other_doc') {
      c.other_doc = nextValue;
    }

    if (storagePath && supabaseClient) {
      try {
        await supabaseClient.storage.from('load_documents').remove([storagePath]);
      } catch (e) {}
    }

    closeDeleteDocConfirm();
    showToast('Document deleted', 'success');
    if (openModalCargaId === cargaId) openModal(cargaId);
  } catch (error) {
    c[field] = previousValue;
    closeDeleteDocConfirm();
    showToast('Failed to delete document', 'error');
    console.error('Error deleting document', error);
  }
}

function getMimeTypeFromName(nameOrUrl) {
  const ext = String(nameOrUrl || '').split('?')[0].split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

function startDocDownloadDrag(ev, url, fileName) {
  if (!ev || !ev.dataTransfer) return;
  const mimeType = getMimeTypeFromName(fileName || url);
  const cleanName = getDocFilename(fileName || url) || 'document';

  try {
    // Chromium supports DownloadURL to drag files from browser to OS folders.
    ev.dataTransfer.setData('DownloadURL', `${mimeType}:${cleanName}:${url}`);
    ev.dataTransfer.setData('text/uri-list', url);
    ev.dataTransfer.setData('text/plain', url);
    ev.dataTransfer.effectAllowed = 'copy';
  } catch (e) {}
}

function applyDocPreviewTransform() {
  const img = document.getElementById('doc-preview-img');
  if (!img) return;
  img.style.transform = `translate(${docPreviewOffsetX}px, ${docPreviewOffsetY}px) scale(${docPreviewScale}) rotate(${docPreviewRotation}deg)`;
  if (docPreviewScale > 1) img.classList.add('is-zoomed');
  else img.classList.remove('is-zoomed');
}

function resetDocPreviewTransform() {
  docPreviewScale = 1;
  docPreviewRotation = 0;
  docPreviewOffsetX = 0;
  docPreviewOffsetY = 0;
  docPreviewDragging = false;
  applyDocPreviewTransform();
}

function zoomDocPreview(step) {
  zoomDocPreviewAt(step);
}

function zoomDocPreviewAt(step, anchorX, anchorY) {
  const img = document.getElementById('doc-preview-img');
  const prevScale = docPreviewScale;
  const nextScale = Math.max(0.25, Math.min(4, docPreviewScale + step));
  if (nextScale === prevScale) return;

  if (img && typeof anchorX === 'number' && typeof anchorY === 'number') {
    const rect = img.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const ratio = nextScale / prevScale;

    docPreviewOffsetX = (anchorX - centerX) * (1 - ratio) + (docPreviewOffsetX * ratio);
    docPreviewOffsetY = (anchorY - centerY) * (1 - ratio) + (docPreviewOffsetY * ratio);
  }

  docPreviewScale = nextScale;
  if (docPreviewScale <= 1) {
    docPreviewOffsetX = 0;
    docPreviewOffsetY = 0;
  }
  applyDocPreviewTransform();
}

function rotateDocPreview(stepDeg) {
  docPreviewRotation = (docPreviewRotation + stepDeg) % 360;
  applyDocPreviewTransform();
}

function getDocPreviewPoint(ev) {
  if (ev && ev.touches && ev.touches[0]) {
    return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
  }
  return { x: ev.clientX, y: ev.clientY };
}

function startDocPreviewDrag(ev) {
  if (docPreviewScale <= 1) return;
  const img = document.getElementById('doc-preview-img');
  if (!img || img.style.display === 'none') return;
  const p = getDocPreviewPoint(ev);
  docPreviewDragging = true;
  docPreviewDragStartX = p.x - docPreviewOffsetX;
  docPreviewDragStartY = p.y - docPreviewOffsetY;
  img.classList.add('is-dragging');
  try { ev.preventDefault(); } catch (e) {}
}

function onDocPreviewDrag(ev) {
  if (!docPreviewDragging) return;
  const p = getDocPreviewPoint(ev);
  docPreviewOffsetX = p.x - docPreviewDragStartX;
  docPreviewOffsetY = p.y - docPreviewDragStartY;
  applyDocPreviewTransform();
  try { ev.preventDefault(); } catch (e) {}
}

function endDocPreviewDrag() {
  docPreviewDragging = false;
  const img = document.getElementById('doc-preview-img');
  if (img) img.classList.remove('is-dragging');
}

function onDocPreviewWheel(ev) {
  const img = document.getElementById('doc-preview-img');
  if (!img || img.style.display === 'none') return;
  try { ev.preventDefault(); } catch (e) {}

  const step = ev.deltaY < 0 ? 0.2 : -0.2;
  zoomDocPreviewAt(step, ev.clientX, ev.clientY);
}

function initDocPreviewInteractions() {
  const img = document.getElementById('doc-preview-img');
  if (!img || img.__panBound) return;
  img.__panBound = true;

  img.addEventListener('mousedown', startDocPreviewDrag);
  window.addEventListener('mousemove', onDocPreviewDrag);
  window.addEventListener('mouseup', endDocPreviewDrag);

  img.addEventListener('touchstart', startDocPreviewDrag, { passive: false });
  window.addEventListener('touchmove', onDocPreviewDrag, { passive: false });
  window.addEventListener('touchend', endDocPreviewDrag);
  img.addEventListener('wheel', onDocPreviewWheel, { passive: false });
}

async function openDocPreview(url) {
  const overlay = document.getElementById('doc-preview-overlay');
  const iframe = document.getElementById('doc-preview-iframe');
  const img = document.getElementById('doc-preview-img');
  const imageTools = document.getElementById('doc-preview-tools');
  const ext = url.split('?')[0].split('.').pop().toLowerCase();
  const encodedUrl = encodeURIComponent(url);
  const googleDocsViewerUrl = `https://docs.google.com/gview?embedded=1&url=${encodedUrl}`;
  const isImage = ['jpg','jpeg','png','gif','webp','bmp'].includes(ext);
  const isPdf = ext === 'pdf';

  iframe.removeAttribute('srcdoc');

  resetDocPreviewTransform();
  if (isImage) {
    if (docPreviewBlobUrl) {
      try { URL.revokeObjectURL(docPreviewBlobUrl); } catch (e) {}
      docPreviewBlobUrl = null;
    }
    iframe.style.display = 'none';
    iframe.src = '';
    iframe.removeAttribute('srcdoc');
    img.src = url;
    img.style.display = 'block';
    if (imageTools) imageTools.classList.remove('hidden');
  } else {
    img.style.display = 'none';

    if (docPreviewBlobUrl) {
      try { URL.revokeObjectURL(docPreviewBlobUrl); } catch (e) {}
      docPreviewBlobUrl = null;
    }

    if (isPdf) {
      try {
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const pdfBytes = await res.arrayBuffer();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        docPreviewBlobUrl = URL.createObjectURL(blob);
        iframe.removeAttribute('srcdoc');
        window.open(url, "_blank");
        overlay.classList.add('hidden');
document.body.style.overflow = '';
return;
      } catch (e) {
        iframe.src = 'about:blank';
        iframe.srcdoc = `<!doctype html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;background:#0b1220;color:#e2e8f0;font-family:Arial,sans-serif;"><div style="max-width:520px;padding:16px;text-align:center;"><div style="font-size:16px;font-weight:700;margin-bottom:8px;">No se pudo cargar la vista previa del PDF</div><div style="font-size:13px;opacity:.85;line-height:1.45;">El archivo no pudo renderizarse inline desde esta sesión. Intenta abrirlo en una pestaña nueva.</div><a href="${url}" target="_blank" rel="noopener" style="display:inline-block;margin-top:14px;padding:8px 12px;border-radius:8px;background:#1d4ed8;color:#fff;text-decoration:none;font-size:13px;">Abrir PDF</a></div></body></html>`;
      }
    } else {
      iframe.src = googleDocsViewerUrl;
    }

    iframe.style.display = 'block';
    if (imageTools) imageTools.classList.add('hidden');
  }
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeDocPreview(e) {
  if (e && e.target !== document.getElementById('doc-preview-overlay') && !e.target.closest('.doc-preview-close')) return;
  const overlay = document.getElementById('doc-preview-overlay');
  overlay.classList.add('hidden');
  document.getElementById('doc-preview-iframe').src = '';
  document.getElementById('doc-preview-iframe').removeAttribute('srcdoc');
  document.getElementById('doc-preview-img').src = '';
  if (docPreviewBlobUrl) {
    try { URL.revokeObjectURL(docPreviewBlobUrl); } catch (e) {}
    docPreviewBlobUrl = null;
  }
  resetDocPreviewTransform();
  document.body.style.overflow = 'hidden'; // keep main modal scroll locked
}

function downloadDoc(url, name) {
  fetch(url)
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok');
      return response.blob();
    })
    .then(blob => {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = name || 'document';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    })
    .catch(error => {
      console.error('Download failed:', error);
      // Fallback: open in new tab
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
}

initDocPreviewInteractions();

function handleOverlayClick(e) {
  if (e.target === document.getElementById("modal-overlay")) closeModal();
}

function closeModal() {
  // If the modal was opened for a temporary new load (not saved), remove it
  if (openModalCargaId) {
    const idx = CARGAS.findIndex(x => x.id === openModalCargaId && x.__isNew);
    if (idx !== -1) {
      const tmp = CARGAS[idx];
      const hasData = (tmp.cliente && String(tmp.cliente).trim()) || (tmp.origen && String(tmp.origen).trim()) || (tmp.destino && String(tmp.destino).trim()) || (tmp.invoice_number && String(tmp.invoice_number).trim()) || (tmp.bol_number && String(tmp.bol_number).trim());
      if (!hasData) {
        CARGAS.splice(idx, 1);
        applyFilters();
      }
    }
  }

  document.getElementById("modal-overlay").classList.add("hidden");
  document.getElementById("modal-panel").classList.remove("modal-panel-wide");
  document.getElementById("modal-panel").classList.remove("modal-panel-load-details");
  document.body.style.overflow = "";
  openModalCargaId = null;
}

// =============================================================
// CAMBIAR ESTADO DE CARGA
// =============================================================

// Dropdown helpers for status/state chips in Load Details modal
let _chipDropdownOutsideListener = null;
let _chipDropdownKeyListener = null;

function closeChipDropdown() {
  const existing = document.getElementById('chip-dropdown');
  if (existing) existing.remove();
  if (_chipDropdownOutsideListener) {
    document.removeEventListener('click', _chipDropdownOutsideListener);
    _chipDropdownOutsideListener = null;
  }
  if (_chipDropdownKeyListener) {
    document.removeEventListener('keydown', _chipDropdownKeyListener);
    _chipDropdownKeyListener = null;
  }
}

function showChipDropdown(anchorEl, items, onSelect) {
  closeChipDropdown();
  if (!anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const container = document.createElement('div');
  container.id = 'chip-dropdown';
  container.className = 'chip-dropdown';
  container.style.position = 'absolute';
  container.style.background = '#fff';
  container.style.border = '1px solid rgba(0,0,0,.08)';
  container.style.borderRadius = '6px';
  container.style.boxShadow = '0 8px 20px rgba(2,6,23,0.08)';
  container.style.padding = '6px 0';
  container.style.zIndex = 4000;
  container.style.minWidth = '160px';
  container.style.fontSize = '13px';
  container.style.color = '#0f172a';
  items.forEach((it) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip-dropdown-item';
    btn.style.display = 'block';
    btn.style.width = '100%';
    btn.style.textAlign = 'left';
    btn.style.padding = '8px 12px';
    btn.style.border = 'none';
    btn.style.background = 'transparent';
    btn.style.cursor = 'pointer';
    btn.style.outline = 'none';
    btn.textContent = it;
    btn.onclick = (e) => { e.stopPropagation(); closeChipDropdown(); onSelect(it); };
    btn.onmouseover = () => btn.style.background = 'rgba(15,23,42,0.04)';
    btn.onmouseout = () => btn.style.background = 'transparent';
    container.appendChild(btn);
  });
  const noneBtn = document.createElement('button');
  noneBtn.type = 'button';
  noneBtn.className = 'chip-dropdown-item-none';
  noneBtn.style.display = 'block';
  noneBtn.style.width = '100%';
  noneBtn.style.textAlign = 'left';
  noneBtn.style.padding = '8px 12px';
  noneBtn.style.border = 'none';
  noneBtn.style.background = 'transparent';
  noneBtn.style.cursor = 'pointer';
  noneBtn.style.outline = 'none';
  noneBtn.style.color = '#ef4444';
  noneBtn.textContent = 'Clear';
  noneBtn.onclick = (e) => { e.stopPropagation(); closeChipDropdown(); onSelect(''); };
  container.appendChild(noneBtn);
  document.body.appendChild(container);
  // position
  let left = rect.left + window.scrollX;
  let top = rect.bottom + window.scrollY + 6;
  const rightOverflow = (left + container.offsetWidth) - (window.scrollX + document.documentElement.clientWidth);
  if (rightOverflow > 0) left = Math.max(8 + window.scrollX, left - rightOverflow - 8);
  container.style.left = `${left}px`;
  container.style.top = `${top}px`;
  _chipDropdownOutsideListener = function(e) {
    if (!container.contains(e.target) && e.target !== anchorEl) closeChipDropdown();
  };
  document.addEventListener('click', _chipDropdownOutsideListener);
  _chipDropdownKeyListener = function(e) {
    if (e.key === 'Escape') closeChipDropdown();
  };
  document.addEventListener('keydown', _chipDropdownKeyListener);
}

async function showStatusDropdown(cargaId, anchorEl) {
  const options = ['Pending','Confirmed','Completed','Canceled'];
  showChipDropdown(anchorEl, options, async (selected) => {
    if (selected === null || selected === undefined) return;
    updateStatus(cargaId, selected);
    try {
      // Try to persist directly to Supabase first
      await updateLoadField({ load_id: cargaId, field: 'status', value: selected });
      showToast('Status persisted to Supabase', 'success');
    } catch (supErr) {
      console.error('Supabase status update failed', supErr);
      // Fallback: send to webhook to avoid losing the change
      try {
        const norm = normalizeEstado(selected);
        const payload = { action: 'edit_load', id: cargaId, status: (norm === 'Pending' ? '' : norm.toLowerCase()) };
        await fetch('https://n8n.othfreight.com/webhook/panelweb', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        showToast('Status persisted via webhook', 'success');
      } catch (e) {
        console.error('Status webhook error', e);
        showToast('Failed to persist status change', 'error');
      }
    }
  });
}

async function showStateDropdown(cargaId, anchorEl) {
  const options = STATE_FILTER_OPTIONS.slice();
  showChipDropdown(anchorEl, options, async (selected) => {
    const val = String(selected || '').trim();
    const c = CARGAS.find(x => x.id === cargaId);
    if (!c) return;
    c.load_state = val || null;
    const stateBadge = document.querySelector('.modal-status-row .badge-state');
    if (stateBadge) stateBadge.textContent = val || '—';
    renderDashboard();
    renderCargas();
    try {
      // Persist to Supabase directly
      await updateLoadField({ load_id: cargaId, field: 'state', value: val || '' });
      showToast('State persisted to Supabase', 'success');
    } catch (supErr) {
      console.error('Supabase state update failed', supErr);
      // Fallback to webhook
      try {
        const payload = { action: 'edit_load', id: cargaId, state: val ? String(val).toLowerCase() : '' };
        await fetch('https://n8n.othfreight.com/webhook/panelweb', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        showToast('State persisted via webhook', 'success');
      } catch (e) {
        console.error('State webhook error', e);
        showToast('Failed to persist state change', 'error');
      }
    }
  });
}

// Delegated click handler: open dropdowns when clicking badges inside the Load Details modal
document.addEventListener('click', function modalStatusChipClickHandler(e) {
  try {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    const badge = e.target.closest('.badge');
    if (!badge) return;
    const statusRow = badge.closest('.modal-status-row');
    if (!statusRow) return;
    e.stopPropagation();
    if (badge.classList.contains('badge-state')) {
      showStateDropdown(openModalCargaId, badge);
      return;
    }
    const firstBadge = statusRow.querySelector('.badge');
    if (firstBadge && firstBadge === badge) {
      showStatusDropdown(openModalCargaId, badge);
    }
  } catch (err) {}
});

function updateStatus(cargaId, newStatus) {
  if (!newStatus) return;
  const c = CARGAS.find((x) => x.id === cargaId);
  if (!c) return;
  c.estado = newStatus;
  showToast(`Status updated → ${newStatus}`, "success");
  openModal(cargaId);
  if (currentView === "dashboard") renderDashboard();
  if (currentView === "cargas")    renderCargas();
}

// =============================================================
// CARGA DE DOCUMENTOS
// =============================================================

function getRateConfirmationMissingFields(c) {
  if (!c) return ['load'];

  const missing = [];
  const driverValue = c.driver || c.driver_name || c.camionero_id;
  const pickupValue = c.pick_up_date_db || c.pick_up_date || c.fecha_recogida;
  const invoiceValue = c.invoice_number || c.invoice || c.invoice_no || c.invoiceId;

  if (driverValue === null || driverValue === undefined || String(driverValue).trim() === '') {
    missing.push('driver');
  }
  if (pickupValue === null || pickupValue === undefined || String(pickupValue).trim() === '') {
    missing.push('pickup date');
  }
  if (invoiceValue === null || invoiceValue === undefined || String(invoiceValue).trim() === '') {
    missing.push('invoice number');
  }

  return missing;
}

async function openUpload(cargaId, tipo) {
  currentUploadCargaId = cargaId;
  currentUploadTipo    = tipo;

  const c = CARGAS.find((x) => x.id === cargaId);
  if (!c) return;

  // Refresh authoritative fields (including file ids) before opening the file picker
  if (supabaseClient) {
    try {
      const row = await fetchLoadRow(cargaId);
      if (row) {
        c.rate_conf_url = row.rate_conf_url || row.rate_conf || row.rate_url || row.rate_confirmation_url || c.rate_conf_url;
        c.bol_url = row.bol_url || row.bill_of_lading_url || row.bol_link || c.bol_url;
        c.other_doc = row.other_doc || row.documents || row.documentos || c.other_doc;

        // file identifier columns may be named differently across databases; prefer the common variants
        c.file_id = row.file_id || row.fileid || row.rate_file_id || row.bol_file_id || row.rate_drive_id || row.bol_drive_id || row.rate_id || row.bol_id || c.file_id || null;
        c.rate_file_id = row.rate_file_id || row.rate_file || row.rate_drive_id || row.rate_id || c.rate_file_id || null;
        c.bol_file_id = row.bol_file_id || row.bol_file || row.bol_drive_id || row.bol_id || c.bol_file_id || null;
        c.rate_drive_id = row.rate_drive_id || row.rate_drive || c.rate_drive_id || null;
        c.bol_drive_id = row.bol_drive_id || row.bol_drive || c.bol_drive_id || null;
      }
    } catch (e) {
      console.debug('openUpload: failed to refresh load row', e);
    }
  }

  const uploadType = String(currentUploadTipo || '').toLowerCase();

  if (uploadType.includes('rate')) {
    const missingFields = getRateConfirmationMissingFields(c);
    if (missingFields.length > 0) {
      showToast(`Cannot upload Rate Confirmation. Missing: ${missingFields.join(', ')}.`, 'error');
      currentUploadCargaId = null;
      currentUploadTipo = null;
      return;
    }
  }

  const requiresRateConfirmation = uploadType.includes('bol') || uploadType.includes('other');
  const hasRateConfirmation = c.rate_conf_url !== null
    && c.rate_conf_url !== undefined
    && String(c.rate_conf_url).trim() !== '';
  if (requiresRateConfirmation && !hasRateConfirmation) {
    showToast('Upload a Rate Confirmation before uploading a BOL or other document.', 'error');
    currentUploadCargaId = null;
    currentUploadTipo = null;
    return;
  }

  document.getElementById("upload-input").click();
}

async function fetchCurrentDocUrl(cargaId, column) {
  if (!supabaseClient || !cargaId || !column) return null;
  // Try loads_data first, then past_loads_data
  for (const table of ['loads_data', 'past_loads_data']) {
    try {
      const { data, error } = await supabaseClient
        .from(table)
        .select(column)
        .eq('load_id', cargaId)
        .maybeSingle();
      if (!error && data) return data[column] ?? null;
    } catch (e) {}
  }
  return null;
}

// Fetch the full load row (searching current and past loads) so we can read any column
async function fetchLoadRow(cargaId) {
  if (!supabaseClient || !cargaId) return null;
  for (const table of ['loads_data', 'past_loads_data']) {
    try {
      const { data, error } = await supabaseClient
        .from(table)
        .select('*')
        .eq('load_id', cargaId)
        .maybeSingle();
      if (!error && data) return data;
    } catch (e) {}
  }
  return null;
}

function buildN8nDocumentActionPayload(carga, tipo) {
  const normalizedType = String(tipo || '').toLowerCase().trim();
  const isOtherDoc = normalizedType === 'other doc' || normalizedType === 'other_doc' || normalizedType === 'other-doc';
  if (isOtherDoc) {
    return {
      action: 'upload_documents',
      other_doc: carga && carga.other_doc !== undefined && carga.other_doc !== null ? carga.other_doc : ''
    };
  }

  const hasRate = normalizedType.includes('rate');
  const isUpdate = hasRate && !!(carga && carga.rate_conf_url);
  return {
    action: isUpdate ? 'update_documents' : 'upload_documents'
  };
}

async function handleFileUpload() {
  const input = document.getElementById("upload-input");
  if (!input.files || input.files.length === 0) return;

  const file = input.files[0];
  const c    = CARGAS.find((x) => x.id === currentUploadCargaId);
  if (!c) return;

  // Rate Confirmations require the load metadata before the document is sent.
  const uploadType = String(currentUploadTipo || '').toLowerCase();
  if (uploadType.includes('rate')) {
    const missingFields = getRateConfirmationMissingFields(c);
    if (missingFields.length > 0) {
      showToast(`Cannot upload Rate Confirmation. Missing: ${missingFields.join(', ')}.`, 'error');
      input.value = '';
      return;
    }
  }

  const suffix = currentUploadCargaId.split("-").pop();
  const docName = `${currentUploadTipo.replace(/\s+/g, "-")}-${suffix}_${file.name}`;
  // Send file to n8n webhook as multipart/form-data
  const webhookUrl = 'https://n8n.othfreight.com/webhook/panelweb';
  const form = new FormData();
  // BOL and Other Doc uploads are always upload_documents.
  // Rate Confirmation is treated as update_documents if one already exists.
  const __t = String(currentUploadTipo || '').toLowerCase();
  const n8nDocPayload = buildN8nDocumentActionPayload(c, currentUploadTipo);
  const actionType = n8nDocPayload.action;
  const __isUpdate = actionType === 'update_documents';
  form.append('action', actionType);
  if (Object.prototype.hasOwnProperty.call(n8nDocPayload, 'other_doc')) {
    form.append('other_doc', n8nDocPayload.other_doc == null ? '' : String(n8nDocPayload.other_doc));
  }
  // When updating, include webhookUrl and executionMode as requested
  if (__isUpdate) {
    form.append('webhookUrl', webhookUrl);
    form.append('executionMode', 'production');
  }
  form.append('carga_id', currentUploadCargaId);
  form.append('tipo', currentUploadTipo || '');
  form.append('doc_name', docName);
  form.append('original_filename', file.name);

  // If this is an update (re-upload) include the document_id based on carga fields
  if (__isUpdate) {
    let documentId = '';
    try {
      if (__t.includes('rate')) {
        documentId = c.rate_drive_id || c.rate_driver_id || c.rate_doc_id || c.rate_id || c.rate_drive || c.rate_driveid || '';
      } else if (__t.includes('bol')) {
        documentId = c.bol_drive_id || c.bol_driver_id || c.bol_doc_id || c.bol_id || c.bol_drive || c.bol_driveid || '';
      }
    } catch (e) { documentId = ''; }
    if (documentId) form.append('document_id', String(documentId));
  }

  // Always include the carga's `file_id` (if present) when sending to n8n.
  try {
    // Prefer the explicit `file_id` column, but fall back to common variants
    const fileIdVal = String(
      c.file_id || c.fileid || c.rate_file_id || c.bol_file_id || c.rate_drive_id || c.bol_drive_id || ''
    ).trim();
    if (fileIdVal) form.append('file_id', fileIdVal);
  } catch (e) {
    // non-blocking
  }

  // include invoice number from carga (if present)
  try {
    const invoiceVal = (c.invoice_number || c.invoice || '') || '';
    form.append('invoice', String(invoiceVal));
  } catch (e) {
    form.append('invoice', '');
  }

  // include driver and pick_up_date from the carga (if present)
  try {
    const driverVal = (c.driver || c.driver_name || c.camionero_id || '') || '';
    form.append('driver', String(driverVal));
  } catch (e) {
    form.append('driver', '');
  }

  try {
    const pickUpVal = (c.pick_up_date_db || c.pick_up_date || '') || '';
    form.append('pick_up_date', String(pickUpVal));
  } catch (e) {
    form.append('pick_up_date', '');
  }

  // determine file format (extension) and normalize
  let format = '';
  try {
    const m = String(file.name || '').match(/\.([^.\s]+)$/);
    if (m && m[1]) format = m[1].toLowerCase();
    if (format === 'jpeg') format = 'jpg';
  } catch (e) { format = ''; }
  form.append('format', format);

  // attach the binary
  form.append('file', file);

  // Fetch current document columns and file identifiers from Supabase before sending to n8n.
  const isBolOrRateOrOther = __t.includes('bol') || __t.includes('rate') || __t.includes('other');
  if (isBolOrRateOrOther && supabaseClient) {
    try {
      const row = await fetchLoadRow(currentUploadCargaId);
      // prefer authoritative row values when available, fallback to per-column selects
      let currentBolUrl = '';
      let currentRateUrl = '';
      let currentOtherDoc = '';
      let currentFileId = '';
      if (row) {
        currentBolUrl = row.bol_url || row.bill_of_lading_url || row.bol_link || '';
        currentRateUrl = row.rate_conf_url || row.rate_conf || row.rate_url || row.rate_confirmation_url || '';
        currentOtherDoc = row.other_doc || row.documents || row.documentos || '';
        currentFileId = row.file_id || row.fileid || row.rate_file_id || row.bol_file_id || row.rate_drive_id || row.bol_drive_id || row.rate_id || row.bol_id || '';
      } else {
        try { currentBolUrl = (await fetchCurrentDocUrl(currentUploadCargaId, 'bol_url')) || ''; } catch (e) { currentBolUrl = ''; }
        try { currentRateUrl = (await fetchCurrentDocUrl(currentUploadCargaId, 'rate_conf_url')) || ''; } catch (e) { currentRateUrl = ''; }
        try { currentOtherDoc = (await fetchCurrentDocUrl(currentUploadCargaId, 'other_doc')) || ''; } catch (e) { currentOtherDoc = ''; }
      }

      form.append('current_bol_url', String(currentBolUrl || ''));
      form.append('current_rate_conf_url', String(currentRateUrl || ''));
      form.append('current_other_doc', String(currentOtherDoc || ''));
      form.append('current_file_id', String(currentFileId || ''));
    } catch (e) {
      form.append('current_bol_url', '');
      form.append('current_rate_conf_url', '');
      form.append('current_other_doc', '');
      form.append('current_file_id', '');
    }
  }

  showToast(`Uploading "${file.name}"...`, 'success');
  try {
    const res = await fetch(webhookUrl, { method: 'POST', body: form });
      if (!res.ok) {
        const txt = await res.text().catch(() => null);
        console.error('Upload error', res.status, txt);
        showToast('Failed to upload document', 'error');
      } else {
        let json = null;
        try { json = await res.json(); } catch (e) { json = null; }
        console.log('n8n upload response', json);

        // Prefer authoritative values from Supabase once the upload completes.
        // Try to read the document columns from Supabase and update the local carga.
        async function refreshDocsFromSupabase() {
          if (!supabaseClient) return false;
          try {
            const row = await fetchLoadRow(currentUploadCargaId);
            if (!row) return false;

            // update canonical URL columns
            c.rate_conf_url = row.rate_conf_url || row.rate_conf || row.rate_url || row.rate_confirmation_url || c.rate_conf_url;
            c.bol_url = row.bol_url || row.bill_of_lading_url || row.bol_link || c.bol_url;
            c.other_doc = row.other_doc || row.documents || row.documentos || c.other_doc;

            // update file identifier columns so subsequent uploads include them
            c.file_id = row.file_id || row.fileid || row.rate_file_id || row.bol_file_id || row.rate_drive_id || row.bol_drive_id || row.rate_id || row.bol_id || c.file_id || null;
            c.rate_file_id = row.rate_file_id || row.rate_file || row.rate_drive_id || row.rate_id || c.rate_file_id || null;
            c.bol_file_id = row.bol_file_id || row.bol_file || row.bol_drive_id || row.bol_id || c.bol_file_id || null;
            c.rate_drive_id = row.rate_drive_id || row.rate_drive || c.rate_drive_id || null;
            c.bol_drive_id = row.bol_drive_id || row.bol_drive || c.bol_drive_id || null;

            return true;
          } catch (e) {
            console.debug('refreshDocsFromSupabase failed', e);
            return false;
          }
        }

        const refreshed = await refreshDocsFromSupabase();

        // If Supabase was not available or didn't return values, fall back to n8n response
        try {
          if (!refreshed) {
            if (json && json.rate_conf_url) c.rate_conf_url = json.rate_conf_url;
            if (json && json.bol_url) c.bol_url = json.bol_url;
            if (json && json.other_doc) c.other_doc = json.other_doc;
          }
        } catch (e) {}

        // If still missing, apply optimistic fallback so UI shows the uploaded file immediately
        try {
          const t = String(currentUploadTipo || '').toLowerCase();
          if (!c.rate_conf_url && t.includes('rate')) c.rate_conf_url = docName;
          if (!c.bol_url && t.includes('bol')) c.bol_url = docName;
          if (t.includes('other') && !(json && json.other_doc)) {
            const nextOtherDocs = parseDocField(c.other_doc);
            try {
              const existingKeys = new Set(nextOtherDocs.map(x => canonicalizeDocKey(x)).filter(Boolean));
              const newKey = canonicalizeDocKey(docName);
              if (!newKey || !existingKeys.has(newKey)) {
                nextOtherDocs.push(docName);
              }
            } catch (e) {
              nextOtherDocs.push(docName);
            }
            c.other_doc = formatDocFieldValue(nextOtherDocs, c.other_doc);
          }
        } catch (e) {}

        showToast(`Document "${file.name}" uploaded successfully`, 'success');
        // Re-open the modal so it renders using the refreshed Supabase-backed fields
        if (openModalCargaId === currentUploadCargaId) openModal(currentUploadCargaId);
      }
  } catch (err) {
    console.error('Error uploading file to n8n', err);
    showToast('Error uploading document: ' + (err.message || err), 'error');
  } finally {
    input.value = '';
  }
}

// =============================================================
// EDIT LOAD
// =============================================================

async function openEditModal(cargaId) {
  try { document.getElementById('modal-panel').classList.remove('modal-panel-load-details'); } catch (e) {}
  const c = CARGAS.find((x) => x.id === cargaId);
  if (!c) return;
  openModalCargaId = cargaId;

  document.getElementById("modal-title").textContent = 'Edit Load';
  document.getElementById("modal-subtitle").textContent = '';

  // determine origin/destination city + state preferring explicit fields from loaded rows
  let origCity = '';
  let origState = '';
  if (c.origin_city || c.origin_state) {
    origCity = c.origin_city || '';
    origState = normalizeStateAbbrev(c.origin_state || '') || '';
  } else {
    const [oc, osRaw] = splitCityState(c.origen || '');
    origCity = oc || '';
    origState = normalizeStateAbbrev(osRaw || '') || '';
  }
  let destCity = '';
  let destState = '';
  if (c.dest_city || c.dest_state) {
    destCity = c.dest_city || '';
    destState = normalizeStateAbbrev(c.dest_state || '') || '';
  } else {
    const [dc, dsRaw] = splitCityState(c.destino || '');
    destCity = dc || '';
    destState = normalizeStateAbbrev(dsRaw || '') || '';
  }

  // build state options
  const stateOptions = US_STATES.map(s => `<option value="${s[0]}">${s[0]}</option>`).join('');

  // parse existing time ranges into start/end
  const [pickStart, pickEnd] = (c.pick_up_time || '').includes('-') ? c.pick_up_time.split('-').map(s=>s.trim()) : [(c.pick_up_time||''),''];
  const [delStart, delEnd] = (c.delivery_time || '').includes('-') ? c.delivery_time.split('-').map(s=>s.trim()) : [(c.delivery_time||''),''];
  const pickExpected = c.pick_up_expected_time || '';
  const delExpected = c.delivery_expected_time || '';
  const capacity = c.capacity || '';
  const lengthFt = (c.length_ft || c.length || '');
  const weight = c.weight || c.peso || '';
  const pallets = (c.pallets || '');
  const hasValue = (v) => v !== null && v !== undefined && String(v).trim() !== '';
  let netPricePrefill = c.net_price;
  // Always prefer net_price from source tables when available.
  try {
    const authoritative = await fetchLoadRow(cargaId);
    if (authoritative && hasValue(authoritative.net_price)) {
      netPricePrefill = authoritative.net_price;
      c.net_price = authoritative.net_price;
    }
  } catch (e) {
    // Non-blocking: keep local value when authoritative fetch fails.
  }
  const netPriceInputValue = hasValue(netPricePrefill) ? String(netPricePrefill) : '';
  const equipment = canonicalEquipmentCode(c.equipment || c.equipment_type || '');
  const companyEmail = c.contact_email || c.email || '';
  const companyPhone = c.contact_phone || c.phone || '';
  const companyPhoneExt = c.contact_phone_ext || c.phone_ext || '';

  // determine whether upload URLs exist so we can show checkmarks next to upload buttons
  const hasRateUrl = !!(c.rate_conf_url && String(c.rate_conf_url).trim());
  const hasBolUrl = !!(c.bol_url && String(c.bol_url).trim());
  const rateCheckHtml = hasRateUrl ? `<span class="upload-check" title="Rate uploaded" style="color:#10b981; margin-left:8px; font-weight:700;">✔</span>` : '';
  const bolCheckHtml = hasBolUrl ? `<span class="upload-check" title="BOL uploaded" style="color:#10b981; margin-left:8px; font-weight:700;">✔</span>` : '';

  document.getElementById("modal-body").innerHTML = `
    <form id="edit-form" onsubmit="event.preventDefault(); saveEdit('${cargaId}')">

      <!-- 1. ROUTE & SCHEDULE -->
      <div class="edit-modal-card bg-pastel-blue collapsed">
        <div class="card-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <div class="card-title">Route & Schedule</div>
          <div class="card-toggle-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="card-content">
          <div class="modal-grid-2" style="align-items: stretch; margin-bottom: 24px;">
            <div style="background:#fff; padding:16px; border-radius:8px; border:1px solid #e2e8f0; display:flex; flex-direction:column;">
              <div style="font-size:11px; font-weight:700; color:#3b82f6; text-transform:uppercase; margin-bottom:12px; letter-spacing:0.05em">Origin</div>
              <div class="location-row">
                <div class="location-field form-group">
                  <label>City</label>
                  <input type="text" name="origin_city" list="origin-city-suggestions" value="${escapeHtml(origCity)}" placeholder="City" />
                </div>
                <div class="location-field location-field--state form-group">
                  <label>State</label>
                  <select name="origin_state">
                    <option value="">State</option>
                    ${stateOptions}
                  </select>
                </div>
              </div>
            </div>

            <div style="position:relative;">
              <div style="position:absolute; top:50%; left:-34px; width:48px; text-align:center; transform:translateY(-50%); font-size:24px; color:#94a3b8; font-weight:bold; z-index:2;">
                &rarr;
              </div>
              
              <div style="background:#fff; padding:16px; border-radius:8px; border:1px solid #e2e8f0; height:100%; display:flex; flex-direction:column; position:relative; z-index:1;">
                <div style="font-size:11px; font-weight:700; color:#10b981; text-transform:uppercase; margin-bottom:12px; letter-spacing:0.05em">Destination</div>
                <div class="location-row" style="gap:12px;">
                  <div class="location-field form-group">
                    <label>City</label>
                    <input type="text" name="dest_city" list="dest-city-suggestions" value="${escapeHtml(destCity)}" placeholder="City" />
                  </div>
                  <div class="location-field location-field--state form-group">
                    <label>State</label>
                    <select name="dest_state">
                      <option value="">State</option>
                      ${stateOptions}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <datalist id="origin-city-suggestions"></datalist>
          <datalist id="dest-city-suggestions"></datalist>

          <div style="margin-bottom: 24px;">
            <label style="font-size:13px; font-weight:600; color:#475569; display:block; margin-bottom:10px;">Stops</label>
            <div id="stops-list"></div>
            <button type="button" class="btn btn-sm btn-outline" id="add-stop-btn" style="margin-top:8px;">+ Add Stop</button>
          </div>

          <div class="modal-grid-2">
            <!-- Pickup -->
            <div style="background:#fff; padding:16px; border-radius:8px; border:1px solid #e2e8f0;">
              <div style="font-size:13px; font-weight:700; margin-bottom:12px; color:#1e293b;">Pickup</div>
                <div class="form-group">
                <label>Date</label>
                <input type="date" name="pick_up_date" value="${c.pick_up_date_db || ''}" />
              </div>
              <div class="modal-grid-2" style="gap:12px;">
                <div class="form-group">
                  <label>Start time</label>
                  <input type="time" name="pick_up_time_start" value="${pickStart || ''}" />
                </div>
                <div class="form-group">
                  <label>End time</label>
                  <input type="time" name="pick_up_time_end" value="${pickEnd || ''}" />
                </div>
              </div>
              <div class="form-group" style="margin-top:4px;">
                <label>Expected Pickup</label>
                <input type="time" name="pick_up_expected_time" value="${escapeHtml(pickExpected || '')}" />
              </div>
            </div>

            <!-- Delivery -->
            <div style="background:#fff; padding:16px; border-radius:8px; border:1px solid #e2e8f0;">
              <div style="font-size:13px; font-weight:700; margin-bottom:12px; color:#1e293b;">Delivery</div>
              <div class="form-group">
                <label>Date</label>
                <input type="date" name="delivery_date" value="${c.delivery_date_db || c.delivery_date || ''}" />
              </div>
              <div class="modal-grid-2" style="gap:12px;">
                <div class="form-group">
                  <label>Start time</label>
                  <input type="time" name="delivery_time_start" value="${delStart || ''}" />
                </div>
                <div class="form-group">
                  <label>End time</label>
                  <input type="time" name="delivery_time_end" value="${delEnd || ''}" />
                </div>
              </div>
              <div class="form-group" style="margin-top:4px;">
                <label>Expected Delivery</label>
                <input type="time" name="delivery_expected_time" value="${escapeHtml(delExpected || '')}" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. LOAD DETAILS -->
      <div class="edit-modal-card bg-pastel-green collapsed">
        <div class="card-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <div class="card-title">Load Details</div>
          <div class="card-toggle-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="card-content">
          <div class="modal-grid-3">
            <div class="form-group">
              <label>Equipment</label>
              <select name="equipment">
                <option value="">Select equipment</option>
                <option value="SB">Straight Box Truck</option>
                <option value="V">Van</option>
                <option value="FB">Flatbed</option>
                <option value="PO">Power Only</option>
                <option value="RE">Reefer</option>
                <option value="SD">Step Deck</option>
                <option value="SP">Sprinter Van</option>
              </select>
            </div>
            <div class="form-group">
              <label>Capacity</label>
              <select name="capacity">
                <option value="">Select capacity</option>
                <option value="full">Full</option>
                <option value="partial">Partial</option>
              </select>
            </div>
            <div class="form-group">
              <label>Weight</label>
              <input type="text" name="weight" value="${escapeHtml(weight)}" placeholder="e.g. 40,000 lbs" />
            </div>
            <div class="form-group">
              <label>Length (ft)</label>
              <input type="number" name="length_ft" step="1" value="${lengthFt}" placeholder="e.g. 53" />
            </div>
            <div class="form-group">
              <label>Pallets</label>
              <input type="number" name="pallets" step="1" value="${pallets}" placeholder="Number" />
            </div>
            <div class="form-group">
              <label>Miles</label>
              <input type="number" name="trip_miles" step="1" value="${c.trip_miles || ''}" placeholder="Total miles" />
            </div>
            <div class="form-group">
              <label>Driver</label>
              <select name="driver">
                <option value="">Loading drivers...</option>
              </select>
            </div>
            <div class="form-group">
              <label>Rate (USD)</label>
              <input type="number" step="0.01" name="rate_usd" value="${c.rate_usd || ''}" placeholder="0.00" />
            </div>
            <div class="form-group">
              <label>Net Price</label>
              <input type="number" step="0.01" name="net_price" value="${escapeHtml(netPriceInputValue)}" placeholder="0.00" />
            </div>
          </div>
        </div>
      </div>

      <!-- 3. BROKER INFORMATION -->
      <div class="edit-modal-card bg-pastel-yellow collapsed">
        <div class="card-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <div class="card-title">Broker Information</div>
          <div class="card-toggle-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="card-content">
          <div class="modal-grid-2">
            <div class="form-group">
              <label>Company name</label>
              <input type="text" name="company_name" list="broker-company-suggestions" value="${escapeHtml(c.cliente || '')}" placeholder="Company Name" />
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="text" name="company_email" list="broker-email-suggestions" value="${escapeHtml(companyEmail)}" placeholder="email@example.com" />
            </div>
            <div class="form-group">
              <label>MC number</label>
              <input type="text" name="mc_number" list="broker-mc-suggestions" value="${escapeHtml(c.broker_mc || '')}" placeholder="MC Number" />
            </div>
            <div class="form-group">
              <label>Phone number</label>
              <div class="phone-ext-row">
                <input type="text" name="company_phone" list="broker-phone-suggestions" class="phone-input" value="${escapeHtml(companyPhone)}" placeholder="(555) 555-5555" />
                <input type="text" name="company_phone_ext" class="input-ext" value="${escapeHtml(companyPhoneExt)}" placeholder="Ext." />
              </div>
            </div>
          </div>
          <datalist id="broker-company-suggestions"></datalist>
          <datalist id="broker-mc-suggestions"></datalist>
          <datalist id="broker-email-suggestions"></datalist>
          <datalist id="broker-phone-suggestions"></datalist>
        </div>
      </div>

      <!-- 4. STATUS & NOTES -->
      <div class="edit-modal-card bg-pastel-purple collapsed">
        <div class="card-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <div class="card-title">Status & Notes</div>
          <div class="card-toggle-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="card-content">
          <div class="modal-grid-2" style="margin-bottom:12px;">
            <div class="form-group">
              <label>Status</label>
              <select name="status">
                <option value="">Select status</option>
                <option value="Pending">Pending</option>
                <option value="Confirmed">Confirmed</option>
                <option value="Completed">Completed</option>
                <option value="Canceled">Canceled</option>
              </select>
            </div>
            <div class="form-group">
              <label>#Invoice</label>
              <input type="text" name="invoice_number" value="${escapeHtml(c.invoice_number || '')}" placeholder="Invoice number" />
            </div>
          </div>
          <div class="modal-grid-2" style="margin-bottom:16px;">
            <div class="form-group">
              <label>State</label>
              <select name="load_state">
                <option value="">Select state</option>
                <option value="Awaiting">Awaiting</option>
                <option value="Picked up">Picked up</option>
                <option value="In Transit">In Transit</option>
                <option value="Delivered">Delivered</option>
                <option value="Waiting for new rate">Waiting for new rate</option>
                <option value="Invoice uploaded">Invoice uploaded</option>
                <option value="Paid">Paid</option>
              </select>
            </div>
            <div class="form-group">
              <label>BOL</label>
              <input type="text" name="bol_number" value="${escapeHtml(c.bol_number || '')}" placeholder="BOL number" />
            </div>
          </div>
          <div class="form-group">
            <label>Notes</label>
            <textarea name="notas" placeholder="Add any relevant notes here...">${escapeHtml(c.notas||'')}</textarea>
          </div>
        </div>
      </div>

      <div class="edit-modal-actions">
        <button class="btn btn-secondary" type="button" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" type="submit">Save</button>
      </div>

    </form>
  `;

  // set selected states after inserting options
  if (origState) document.querySelector('select[name="origin_state"]').value = origState;
  if (destState) document.querySelector('select[name="dest_state"]').value = destState;
  // set capacity if present
  if (capacity) {
    const capEl = document.querySelector('select[name="capacity"]');
    if (capEl) capEl.value = capacity;
  }
  // set equipment select if present
  try {
    const eqVal = equipment || '';
    const eqEl = document.querySelector('select[name="equipment"]');
    if (eqEl && eqVal) eqEl.value = eqVal;
  } catch (e) {}

  // load drivers for the driver select asynchronously and handle loading state
  (async () => {
    const driverEl = document.querySelector('select[name="driver"]');
    if (!driverEl) return;
    driverEl.disabled = true;
    driverEl.innerHTML = '<option value="">Loading drivers...</option>';
    try {
      const drivers = await loadDrivers();
      const activeDrivers = (drivers || []).filter((d) => String(d.status || '').trim().toLowerCase() === 'active');
      driverEl.disabled = false;
      if (!activeDrivers || activeDrivers.length === 0) {
        driverEl.innerHTML = '<option value="">No drivers available</option>';
      } else {
        driverEl.innerHTML = '<option value="">Select driver</option>' + activeDrivers.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`).join('');
        // prefer camionero_id if present, otherwise try to match by name
        if (c.camionero_id) {
          driverEl.value = c.camionero_id;
        } else if (c.driver) {
          const found = activeDrivers.find(dd => String(dd.name) === String(c.driver) || String(dd.id) === String(c.driver));
          if (found) driverEl.value = found.id;
        }
      }
    } catch (err) {
      driverEl.disabled = false;
      driverEl.innerHTML = '<option value="">No drivers available</option>';
      console.error('Error loading drivers for modal', err);
    }
  })();
  // set status select to normalized current status when available
  try {
    const curStatus = normalizeEstado(c.estado || '');
    const statusEl = document.querySelector('select[name="status"]');
    if (statusEl && curStatus) {
      const opt = Array.from(statusEl.options).find(o => o.value === curStatus);
      if (opt) statusEl.value = curStatus;
    }
  } catch (e) {}

  // set load_state if present (match option case-insensitively)
  if (c.load_state) {
    const ls = document.querySelector('select[name="load_state"]');
    if (ls) {
      const target = String(c.load_state || '').trim();
      if (target) {
        const match = Array.from(ls.options).find(o => String(o.value || '').trim().toLowerCase() === target.toLowerCase());
        if (match) ls.value = match.value;
      }
    }
  }

  // Initialize stops list UI
  (function initStops() {
    const stopsList = document.getElementById('stops-list');
    function makeRow(city = '', state = '') {
      const row = document.createElement('div');
      row.className = 'stop-row';
      row.style.marginBottom = '6px';
      row.innerHTML = `
        <div class="stop-row-box">
          <div class="form-group">
            <label>Stop City</label>
            <input name="stop_city" value="${escapeHtml(city)}" placeholder="City" />
          </div>
          <div class="form-group">
            <label>State</label>
            <select name="stop_state">
              <option value="">State</option>
              ${stateOptions}
            </select>
          </div>
          <button type="button" class="btn btn-sm btn-outline btn-delete-stop remove-stop" title="Remove stop">-</button>
        </div>`;
      // set selected state
      const sel = row.querySelector('select[name="stop_state"]');
      if (sel && state) sel.value = state;
      // remove handler
      row.querySelector('.remove-stop').addEventListener('click', (e) => {
        e.stopPropagation();
        row.remove();
      });
      return row;
    }

    // parse existing stops (accept array or JSON string)
    let stopsData = [];
    try {
      if (Array.isArray(c.stops)) stopsData = c.stops;
      else if (typeof c.stops === 'string' && c.stops.trim()) {
        const parsed = JSON.parse(c.stops);
        if (Array.isArray(parsed)) stopsData = parsed;
        else stopsData = [{ city: c.stops, state: '' }];
      }
    } catch (e) {
      stopsData = [{ city: c.stops || '', state: '' }];
    }

    // render existing rows only when data is present
    if (stopsData.length > 0) {
      stopsData.forEach(s => stopsList.appendChild(makeRow(s.city || '', s.state || '')));
    }

    document.getElementById('add-stop-btn').addEventListener('click', (evt) => {
      evt.stopPropagation();
      stopsList.appendChild(makeRow('', ''));
    });
  })();

  setupCityAutocomplete();
  setupBrokerInfoAutocomplete();

  document.getElementById("modal-overlay").classList.remove("hidden");
  document.getElementById("modal-panel").classList.add("modal-panel-wide");
  document.body.style.overflow = "hidden";
}

async function saveEdit(cargaId) {
  const form = document.getElementById('edit-form');
  if (!form) return;
  const fd = new FormData(form);
  const c = CARGAS.find((x) => x.id === cargaId);
  if (!c) return;
  const wasNew = !!c.__isNew;

  // driver select returns driver id (value) — save both id and name when possible
  const driverVal = (fd.get('driver') || '').toString().trim();
  if (driverVal) {
    const drv = DRIVERS.find(d => String(d.id) === driverVal);
    if (drv) {
      c.camionero_id = drv.id;
      c.driver = drv.name;
    } else {
      // fallback: if user typed a name or id that doesn't exist in DRIVERS
      c.driver = driverVal;
      const asNum = Number(driverVal);
      if (!Number.isNaN(asNum)) c.camionero_id = asNum;
    }
  } else {
    c.driver = null;
    c.camionero_id = null;
  }
  // capture previous status before changing
  const prevStatus = normalizeEstado(c.estado || '');
  // status (left selector)
  const statusVal = (fd.get('status') || '').trim();
  if (statusVal) c.estado = statusVal;
  // origin / destination edits
  const origin_city = (fd.get('origin_city') || '').trim();
  const origin_state = (fd.get('origin_state') || '').trim();
  if (origin_city) {
    c.origen = origin_state ? `${origin_city}, ${origin_state}` : origin_city;
    c.origin_city = origin_city;
    c.origin_state = origin_state;
  }
  const dest_city = (fd.get('dest_city') || '').trim();
  const dest_state = (fd.get('dest_state') || '').trim();
  if (dest_city) {
    c.destino = dest_state ? `${dest_city}, ${dest_state}` : dest_city;
    c.dest_city = dest_city;
    c.dest_state = dest_state;
  }
  const pickDateInput = fd.get('pick_up_date') || '';
  c.pick_up_date = pickDateInput;
  c.pick_up_date_db = pickDateInput || c.pick_up_date_db;
  const pus = (fd.get('pick_up_time_start') || '').trim();
  const pue = (fd.get('pick_up_time_end') || '').trim();
  c.pick_up_time = pus && pue ? `${pus}-${pue}` : (pus || pue || '');
  const deliveryDateInput = fd.get('delivery_date') || '';
  c.delivery_date = deliveryDateInput;
  c.delivery_date_db = deliveryDateInput || c.delivery_date_db;
  const ds = (fd.get('delivery_time_start') || '').trim();
  const de = (fd.get('delivery_time_end') || '').trim();
  c.delivery_time = ds && de ? `${ds}-${de}` : (ds || de || '');
  // expected single-time fields
  const pe = (fd.get('pick_up_expected_time') || '').trim();
  c.pick_up_expected_time = pe || null;
  const dexp = (fd.get('delivery_expected_time') || '').trim();
  c.delivery_expected_time = dexp || null;
  // capacity / length / weight / pallets
  const capVal = (fd.get('capacity') || '').trim();
  c.capacity = capVal || null;
  const lengthVal = (fd.get('length_ft') || '').toString().trim();
  c.length_ft = lengthVal ? Number(lengthVal) : null;
  const weightVal = (fd.get('weight') || '').trim();
  c.weight = weightVal || null;
  const palletsVal = (fd.get('pallets') || '').toString().trim();
  c.pallets = palletsVal ? Number(palletsVal) : null;
  // company name and MC number
  const companyName = (fd.get('company_name') || '').trim();
  c.cliente = companyName || c.cliente;
  const mcNumber = (fd.get('mc_number') || '').trim();
  c.broker_mc = mcNumber || c.broker_mc;
  const equipmentVal = (fd.get('equipment') || '').trim();
  c.equipment = canonicalEquipmentCode(equipmentVal) || c.equipment || null;
  // company email and phone
  const compEmail = (fd.get('company_email') || '').trim();
  c.contact_email = compEmail || c.contact_email || null;
  const compPhone = (fd.get('company_phone') || '').trim();
  const compPhoneExt = (fd.get('company_phone_ext') || '').trim();
  c.contact_phone = compPhone || c.contact_phone || null;
  c.contact_phone_ext = compPhoneExt || c.contact_phone_ext || null;
  // invoice / BOL fields
  const invoiceVal = (fd.get('invoice_number') || '').trim();
  c.invoice_number = invoiceVal || c.invoice_number || null;
  const bolVal = (fd.get('bol_number') || '').trim();
  c.bol_number = bolVal || c.bol_number || null;
  // load state (right selector)
  const loadStateVal = (fd.get('load_state') || '').trim();
  c.load_state = loadStateVal || null;
  c.rate_usd = fd.get('rate_usd') || null;
  c.net_price = fd.get('net_price') || null;
  c.trip_miles = fd.get('trip_miles') ? Number(fd.get('trip_miles')) : c.trip_miles;
  // collect stops rows
  const stopsContainer = document.getElementById('stops-list');
  if (stopsContainer) {
    const rows = Array.from(stopsContainer.querySelectorAll('.stop-row'));
    const stopsArr = rows
      .map(r => {
        const cityEl = r.querySelector('input[name="stop_city"]');
        const stateEl = r.querySelector('select[name="stop_state"]');
        const city = cityEl ? (cityEl.value || '').trim() : '';
        const state = stateEl ? (stateEl.value || '').trim() : '';
        return city || state ? { city, state } : null;
      })
      .filter(Boolean);
    c.stops = stopsArr.length ? stopsArr : null;
  } else {
    c.stops = null;
  }
  c.notas = fd.get('notas') || '';

  // build and send webhook payload to n8n
  // If status normalizes to 'Pending', send it as empty string
  const normalizedStatus = normalizeEstado(c.estado || '');
  const statusToSend = normalizedStatus === 'Pending' ? '' : normalizedStatus.toLowerCase();
  const payload = {
    action: wasNew ? 'create_load' : 'edit_load',
    id: c.id,
    equipment_typee: c.equipment || '',
    equipment_type: c.equipment || '',
    capacity_type: c.capacity || '',
    max_length_ft: c.length_ft || '',
    max_weight_lbs: c.weight || '',
    availability: c.availability || '',
    trip_miles: c.trip_miles || null,
    rate_usd: c.rate_usd || null,
    origin_city: c.origin_city || '',
    origin_state: c.origin_state || '',
    dest_city: c.dest_city || '',
    dest_state: c.dest_state || '',
    broker_mc: c.broker_mc || '',
    company_name: c.cliente || '',
    contact_email: c.contact_email || '',
    contact_phone: c.contact_phone || '',
    phone_ext: c.contact_phone_ext || '',
    notes: c.notas || '',
    load_id: c.id,
    status: statusToSend,
    state: c.load_state ? String(c.load_state).toLowerCase() : '',
    driver: c.driver || '',
    pick_up_date: c.pick_up_date || '',
    pick_up_time: c.pick_up_time || '',
    delivery_date: c.delivery_date || '',
    delivery_time: c.delivery_time || '',
    pallets: c.pallets || null,
    stops: c.stops || null,
    expected_pick_up: c.pick_up_expected_time || '',
    expected_delivery: c.delivery_expected_time || '',
    net_price: c.net_price || null,
    BOL: c.bol_number || '',
    invoice: c.invoice_number || ''
  };

  const webhookUrl = 'https://n8n.othfreight.com/webhook/panelweb';
  const submitBtn = document.querySelector('#edit-form button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    console.log('n8n webhook response', json);
    if (json && json.action === 'completed' && json.success === true) {
      if (wasNew) {
        // Refresh from source of truth so temporary ids are replaced by real ids
        await loadRemoteData();
        showToast('New load created (webhook confirmed)', 'success');
      } else {
        // Try to fetch authoritative row from Supabase and merge into local model
        try {
          const authoritative = await fetchLoadRow(cargaId);
          if (authoritative) {
            // origin / destination
            const [parsedOrigCity, parsedOrigState] = splitCityState(authoritative.origen || '');
            const originCityVal = authoritative.origin_city || parsedOrigCity || '';
            const originStateVal = authoritative.origin_state || parsedOrigState || '';
            c.origen = originCityVal ? `${originCityVal}${originStateVal ? ', ' + originStateVal : ''}` : (authoritative.origen || c.origen);
            c.origin_city = originCityVal || c.origin_city;
            c.origin_state = originStateVal || c.origin_state;

            const [parsedDestCity, parsedDestState] = splitCityState(authoritative.destino || '');
            const destCityVal = authoritative.dest_city || parsedDestCity || '';
            const destStateVal = authoritative.dest_state || parsedDestState || '';
            c.destino = destCityVal ? `${destCityVal}${destStateVal ? ', ' + destStateVal : ''}` : (authoritative.destino || c.destino);
            c.dest_city = destCityVal || c.dest_city;
            c.dest_state = destStateVal || c.dest_state;

            c.cliente = authoritative.company_name || authoritative.broker || c.cliente;
            c.broker_mc = authoritative.broker_mc || c.broker_mc;

            c.driver = authoritative.driver || c.driver;
            c.camionero_id = authoritative.driver_id || c.camionero_id;

            // normalize status from authoritative row
            c.estado = normalizeEstado(authoritative.status || authoritative.load_status || authoritative.estado || c.estado);

            // pickup / delivery
            c.pick_up_date = authoritative.pick_up_date || authoritative.pickup_date || authoritative.fecha_recogida || c.pick_up_date;
            c.pick_up_date_db = authoritative.pick_up_date || c.pick_up_date_db;
            c.pick_up_time = authoritative.pick_up_time || authoritative.pickup_time || c.pick_up_time;
            c.delivery_date = authoritative.delivery_date || authoritative.fecha_entrega || c.delivery_date;
            c.delivery_date_db = authoritative.delivery_date || c.delivery_date_db;
            c.delivery_time = authoritative.delivery_time || authoritative.delivery_time_col || c.delivery_time;

            // rates / pricing
            c.rate_usd = authoritative.rate_usd || authoritative.rate || c.rate_usd;
            c.net_price = authoritative.net_price ?? c.net_price;
            c.commission = authoritative['commission_ %'] ?? authoritative['commission_%'] ?? authoritative.commission ?? authoritative.commision ?? authoritative.commission_pct ?? authoritative.commission_percentage ?? c.commission ?? null;

            // documents & file ids
            c.rate_conf_url = authoritative.rate_conf_url || authoritative.rate_conf || authoritative.rate_url || authoritative.rate_confirmation_url || c.rate_conf_url;
            c.bol_url = authoritative.bol_url || authoritative.bill_of_lading_url || authoritative.bol_link || c.bol_url;
            c.other_doc = authoritative.other_doc || authoritative.documents || authoritative.documentos || c.other_doc;

            c.file_id = authoritative.file_id || authoritative.fileid || authoritative.rate_file_id || authoritative.bol_file_id || authoritative.rate_drive_id || authoritative.bol_drive_id || authoritative.rate_id || authoritative.bol_id || c.file_id || null;
            c.rate_file_id = authoritative.rate_file_id || authoritative.rate_file || authoritative.rate_drive_id || authoritative.rate_id || c.rate_file_id || null;
            c.bol_file_id = authoritative.bol_file_id || authoritative.bol_file || authoritative.bol_drive_id || authoritative.bol_id || c.bol_file_id || null;
            c.rate_drive_id = authoritative.rate_drive_id || authoritative.rate_drive || c.rate_drive_id || null;
            c.bol_drive_id = authoritative.bol_drive_id || authoritative.bol_drive || c.bol_drive_id || null;

            // other simple mappings
            c.trip_miles = authoritative.trip_miles || authoritative.miles || authoritative.distance || c.trip_miles;
            c.pallets = authoritative.pallets || authoritative.pallet_count || authoritative.num_pallets || c.pallets;
          }
        } catch (e) {
          console.debug('saveEdit: failed to refresh authoritative row', e);
        }
        showToast('Load updated (webhook confirmed)', 'success');
      }
      // If the load transitioned from Confirmed -> Delayed/Completed, remove any matching trips
      try {
        const newNorm = normalizeEstado(c.estado || '');
        if (prevStatus === 'Confirmed' && (newNorm === 'Delayed' || newNorm === 'Completed')) {
          await removeLoadFromDriverTrips(cargaId);
        }
      } catch (e) {
        console.error('Error removing load from driver trips after status change', e);
      }
      closeModal();
      if (currentView === 'dashboard') renderDashboard();
      if (currentView === 'cargas') renderCargas();
    } else {
      showToast('Webhook did not confirm success', 'error');
      console.warn('n8n webhook unexpected response', json);
    }
  } catch (err) {
    console.error('Error sending n8n webhook', err);
    showToast('Error sending webhook: ' + (err.message || err), 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;

    // Ensure the UI reflects authoritative data even if webhook didn't confirm.
    try {
      if (wasNew) {
        // For new loads, refresh all remote data so generated ids are present
        try { await loadRemoteData(); } catch (e) { console.debug('Failed to full reload after save', e); }
      } else {
        try {
          const authoritative = await fetchLoadRow(cargaId);
          if (authoritative) {
            // Merge authoritative fields into local carga object `c`
            const [parsedOrigCity, parsedOrigState] = splitCityState(authoritative.origen || '');
            const originCityVal = authoritative.origin_city || parsedOrigCity || '';
            const originStateVal = authoritative.origin_state || parsedOrigState || '';
            c.origen = originCityVal ? `${originCityVal}${originStateVal ? ', ' + originStateVal : ''}` : (authoritative.origen || c.origen);
            c.origin_city = originCityVal || c.origin_city;
            c.origin_state = originStateVal || c.origin_state;

            const [parsedDestCity, parsedDestState] = splitCityState(authoritative.destino || '');
            const destCityVal = authoritative.dest_city || parsedDestCity || '';
            const destStateVal = authoritative.dest_state || parsedDestState || '';
            c.destino = destCityVal ? `${destCityVal}${destStateVal ? ', ' + destStateVal : ''}` : (authoritative.destino || c.destino);
            c.dest_city = destCityVal || c.dest_city;
            c.dest_state = destStateVal || c.dest_state;

            c.cliente = authoritative.company_name || authoritative.broker || c.cliente;
            c.broker_mc = authoritative.broker_mc || c.broker_mc;

            c.driver = authoritative.driver || c.driver;
            c.camionero_id = authoritative.driver_id || c.camionero_id;

            c.estado = normalizeEstado(authoritative.status || authoritative.load_status || authoritative.estado || c.estado);

            c.pick_up_date = authoritative.pick_up_date || authoritative.pickup_date || authoritative.fecha_recogida || c.pick_up_date;
            c.pick_up_date_db = authoritative.pick_up_date || c.pick_up_date_db;
            c.pick_up_time = authoritative.pick_up_time || authoritative.pickup_time || c.pick_up_time;
            c.delivery_date = authoritative.delivery_date || authoritative.fecha_entrega || c.delivery_date;
            c.delivery_date_db = authoritative.delivery_date || c.delivery_date_db;
            c.delivery_time = authoritative.delivery_time || authoritative.delivery_time_col || c.delivery_time;

            c.rate_usd = authoritative.rate_usd || authoritative.rate || c.rate_usd;
            c.net_price = authoritative.net_price ?? c.net_price;
            c.commission = authoritative['commission_ %'] ?? authoritative['commission_%'] ?? authoritative.commission ?? authoritative.commision ?? authoritative.commission_pct ?? authoritative.commission_percentage ?? c.commission ?? null;

            c.rate_conf_url = authoritative.rate_conf_url || authoritative.rate_conf || authoritative.rate_url || authoritative.rate_confirmation_url || c.rate_conf_url;
            c.bol_url = authoritative.bol_url || authoritative.bill_of_lading_url || authoritative.bol_link || c.bol_url;
            c.other_doc = authoritative.other_doc || authoritative.documents || authoritative.documentos || c.other_doc;

            c.file_id = authoritative.file_id || authoritative.fileid || authoritative.rate_file_id || authoritative.bol_file_id || authoritative.rate_drive_id || authoritative.bol_drive_id || authoritative.rate_id || authoritative.bol_id || c.file_id || null;
            c.rate_file_id = authoritative.rate_file_id || authoritative.rate_file || authoritative.rate_drive_id || authoritative.rate_id || c.rate_file_id || null;
            c.bol_file_id = authoritative.bol_file_id || authoritative.bol_file || authoritative.bol_drive_id || authoritative.bol_id || c.bol_file_id || null;
            c.rate_drive_id = authoritative.rate_drive_id || authoritative.rate_drive || c.rate_drive_id || null;
            c.bol_drive_id = authoritative.bol_drive_id || authoritative.bol_drive || c.bol_drive_id || null;

            c.trip_miles = authoritative.trip_miles || authoritative.miles || authoritative.distance || c.trip_miles;
            c.pallets = authoritative.pallets || authoritative.pallet_count || authoritative.num_pallets || c.pallets;
          }
        } catch (e) {
          console.debug('saveEdit finally: failed to fetch authoritative row', e);
        }
      }
    } catch (e) {
      console.debug('saveEdit: post-save refresh failed', e);
    }

    // Ensure UI is refreshed
    try { if (openModalCargaId === cargaId) closeModal(); } catch (e) {}
    try { if (currentView === 'dashboard') renderDashboard(); } catch (e) {}
    try { if (currentView === 'cargas') renderCargas(); } catch (e) {}
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function (s) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}).hasOwnProperty(s) ? ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[s] : s;
  });
}

// US states list for dropdowns
const US_STATES = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming']
];

function splitCityState(str) {
  if (!str) return ['',''];
  const parts = String(str).split(',');
  const city = parts[0] ? parts[0].trim() : '';
  const state = parts[1] ? parts[1].trim() : '';
  return [city, state];
}

function normalizeStateAbbrev(s) {
  if (!s) return '';
  const v = String(s).trim();
  // If already abbreviation
  const up = v.toUpperCase();
  if (US_STATES.some(([a]) => a === up)) return up;
  // Try to match full name
  const found = US_STATES.find(([, name]) => name.toLowerCase() === v.toLowerCase());
  return found ? found[0] : '';
}

// =============================================================
// DATE RANGE PICKER
// =============================================================

function initDateRangePicker() {
  const input = document.getElementById('filter-date-range');
  const clearBtn = document.getElementById('clear-date-range');
  if (!input) return;
  input.addEventListener('click', (e) => { e.stopPropagation(); toggleDatePicker(input); });
  if (clearBtn) clearBtn.addEventListener('click', (e) => { e.stopPropagation(); clearDateRange(); });

  if (!document.getElementById('date-picker-overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'date-picker-overlay';
    overlay.className = 'date-picker-overlay hidden';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (ev) => ev.stopPropagation());
  }

  window.addEventListener('resize', hideDatePicker);
  window.addEventListener('scroll', hideDatePicker, true);
  // Close the date picker when clicking outside the input or the calendar overlay
  document.addEventListener('click', (e) => {
    const overlay = document.getElementById('date-picker-overlay');
    if (!overlay) return;
    if (overlay.classList.contains('hidden')) return;
    const inputEl = document.getElementById('filter-date-range');
    // ignore clicks on the input or inside the overlay (they stop propagation anyway)
    if (inputEl && (inputEl === e.target || inputEl.contains(e.target))) return;
    if (overlay.contains(e.target)) return;
    hideDatePicker();
  });
}

function toggleDatePicker(input) {
  const overlay = document.getElementById('date-picker-overlay');
  if (!overlay) return;
  if (!overlay.classList.contains('hidden')) { hideDatePicker(); return; }
  dateRangeState.visibleMonth = dateRangeState.visibleMonth || new Date();
  showDatePicker(input);
}

function showDatePicker(input) {
  const overlay = document.getElementById('date-picker-overlay');
  if (!overlay) return;

  const viewportMargin = 12;
  const gap = 8;
  overlay.classList.remove('hidden');

  const rect = input.getBoundingClientRect();
  overlay.style.position = 'fixed';
  overlay.style.left = '0px';
  overlay.style.top = '0px';
  overlay.style.zIndex = 2000;
  overlay.style.minWidth = Math.min(Math.max(320, rect.width), window.innerWidth - (viewportMargin * 2)) + 'px';

  renderDatePicker();

  // Clamp the calendar inside the viewport and open upward if needed.
  const overlayRect = overlay.getBoundingClientRect();
  let left = rect.left;
  const maxLeft = Math.max(viewportMargin, window.innerWidth - overlayRect.width - viewportMargin);
  if (left > maxLeft) left = maxLeft;
  if (left < viewportMargin) left = viewportMargin;

  let top = rect.bottom + gap;
  const bottomLimit = window.innerHeight - viewportMargin;
  if ((top + overlayRect.height) > bottomLimit) {
    top = rect.top - overlayRect.height - gap;
  }
  if (top < viewportMargin) top = viewportMargin;

  overlay.style.left = Math.round(left) + 'px';
  overlay.style.top = Math.round(top) + 'px';
}

function hideDatePicker() {
  const overlay = document.getElementById('date-picker-overlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
}

function dpChangeMonth(delta) {
  const m = dateRangeState.visibleMonth || new Date();
  dateRangeState.visibleMonth = new Date(m.getFullYear(), m.getMonth() + delta, 1);
  renderDatePicker();
}

function renderDatePicker() {
  const overlay = document.getElementById('date-picker-overlay');
  if (!overlay) return;
  const monthDate = new Date(dateRangeState.visibleMonth || new Date());
  const monthLabel = monthDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const today = new Date();
  let html = `<div class="dp-card"><div class="dp-header"><button class="dp-prev" onclick="dpChangeMonth(-1)">‹</button><div class="dp-month">${monthLabel}</div><button class="dp-next" onclick="dpChangeMonth(1)">›</button></div>`;
  html += '<div class="dp-weekdays">';
  const days = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  days.forEach(d => html += `<div class="dp-weekday">${d}</div>`);
  html += '</div>';

  html += '<div class="dp-grid">';
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const startWeek = first.getDay();
  for (let i = 0; i < startWeek; i++) html += `<div class="dp-cell empty"></div>`;
  for (let day = 1; day <= last.getDate(); day++) {
    const dt = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
    const iso = formatDateISO(dt);
    const isStart = dateRangeState.start === iso;
    const isEnd = dateRangeState.end === iso;
    const isToday = day === today.getDate() && monthDate.getMonth() === today.getMonth() && monthDate.getFullYear() === today.getFullYear();
    let inRange = false;
    if (dateRangeState.start && dateRangeState.end) {
      inRange = (iso >= dateRangeState.start && iso <= dateRangeState.end);
    }
    html += `<button class="dp-cell day ${isStart ? 'start' : ''} ${isEnd ? 'end' : ''} ${inRange ? 'in-range' : ''} ${isToday ? 'is-today' : ''}" data-date="${iso}" onclick="dpOnDayClick('${iso}', event)">${day}</button>`;
  }
  html += '</div>';
  // Only show calendar grid — remove selected-range display and action buttons per request
  html += '</div>';
  overlay.innerHTML = html;
}

function dpOnDayClick(iso, ev) {
  try { ev.stopPropagation(); } catch (e) {}
  if (!dateRangeState.start || (dateRangeState.start && dateRangeState.end)) {
    dateRangeState.start = iso;
    dateRangeState.end = null;
  } else if (dateRangeState.start && !dateRangeState.end) {
    if (iso >= dateRangeState.start) {
      dateRangeState.end = iso;
    } else {
      // swap
      dateRangeState.end = dateRangeState.start;
      dateRangeState.start = iso;
    }
  }
  renderDatePicker();
  // If both set, auto apply and close
  if (dateRangeState.start && dateRangeState.end) {
    dpApply();
  }
}

function dpApply() {
  if (!dateRangeState.start) return;
  if (!dateRangeState.end) dateRangeState.end = dateRangeState.start;
  const input = document.getElementById('filter-date-range');
  if (input) input.value = formatDisplayRange(dateRangeState.start, dateRangeState.end);
  hideDatePicker();
  applyFilters();
}

function dpClear() {
  dateRangeState.start = null;
  dateRangeState.end = null;
  const input = document.getElementById('filter-date-range');
  if (input) input.value = '';
  hideDatePicker();
  applyFilters();
}

function clearDateRange() { dpClear(); }

// Prevenir que el scroll cambie los valores de los inputs numéricos
document.addEventListener('wheel', function(event) {
  const active = document.activeElement;
  if (active && active.type === 'number') {
    active.blur();
  }
}, { passive: true });

function formatDateISO(d) {
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseToISO(s) {
  if (!s) return null;
  const t = String(s).trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const dt = new Date(s);
  if (isNaN(dt)) return null;
  return formatDateISO(dt);
}

// Parse an ISO date string (YYYY-MM-DD) into a local Date at midnight
function parseISOToLocalDate(iso) {
  if (!iso) return null;
  const m = String(iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d);
}

function formatDisplayRange(startISO, endISO) {
  if (!startISO) return '';
  const sDate = parseISOToLocalDate(startISO);
  const eDate = parseISOToLocalDate(endISO || startISO);
  if (!sDate) return '';
  const fmtS = sDate.toLocaleString('en-US', { month: 'short', day: '2-digit' });
  const fmtE = eDate ? eDate.toLocaleString('en-US', { month: 'short', day: '2-digit' }) : fmtS;
  if (startISO === endISO) return fmtS;
  return `${fmtS} - ${fmtE}`;
}

function anyDateInCargaBetween(c, startISO, endISO) {
  if (!startISO) return true;
  const fields = [c.pick_up_date, c.pick_up_date_db, c.fecha_recogida, c.delivery_date, c.delivery_date_db, c.fecha_entrega];
  for (let f of fields) {
    const iso = parseToISO(f);
    if (!iso) continue;
    if (iso >= startISO && iso <= endISO) return true;
  }
  return false;
}
// NUEVA CARGA (placeholder)
// =============================================================

function createEmptyCarga() {
  const id = `new-${Date.now()}`;
  return {
    id,
    cliente: "",
    broker_mc: "",
    origen: "",
    destino: "",
    origin_city: '',
    origin_state: '',
    dest_city: '',
    dest_state: '',
    driver: null,
    camionero_id: null,
    estado: 'Pending',
    pick_up_date: '',
    pick_up_date_db: '',
    pick_up_time: '',
    pick_up_expected_time: '',
    delivery_expected_time: '',
    availability: '',
    fecha_recogida: '',
    fecha_entrega: '',
    delivery_date: '',
    delivery_date_db: '',
    delivery_time: '',
    max_weight_lbs: null,
    weight: '',
    max_length_ft: null,
    length_ft: '',
    pallets: null,
    tipo: '',
    documentos: [],
    other_doc: '',
    rate_usd: null,
    net_price: null,
    capacity: '',
    trip_miles: null,
    stops: null,
    notas: '',
    contact_email: '',
    contact_phone: '',
    contact_phone_ext: '',
    invoice_number: '',
    bol_number: '',
    load_state: '',
    equipment_type: '',
    equipment: '',
    equipment_label: '',
    __isNew: true
  };
}

function openNewCargaModal() {
  const newCarga = createEmptyCarga();
  // insert temporarily so openEditModal can find it and reuse the same UI
  CARGAS.unshift(newCarga);
  openEditModal(newCarga.id);
  // override title/subtitle to indicate creation
  const titleEl = document.getElementById('modal-title');
  const subEl = document.getElementById('modal-subtitle');
  if (titleEl) titleEl.textContent = 'New Load';
  if (subEl) subEl.textContent = '';
  // mark form as new (optional marker)
  const form = document.getElementById('edit-form');
  if (form) form.dataset.isNew = '1';
}

// =============================================================
// TOAST NOTIFICATION
// =============================================================

function showToast(message, type = "success") {
  const existing = document.getElementById("toast-notification");
  if (existing) {
    clearTimeout(existing._timeout);
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.id        = "toast-notification";
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("toast-show"));
  });

  toast._timeout = setTimeout(() => {
    toast.classList.remove("toast-show");
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// =============================================================
// SVG ICON HELPERS
// =============================================================

function truckIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="1" y="3" width="14" height="12" rx="1"/>
    <path d="M15 7h4l4 4v4h-8V7z"/>
    <circle cx="5.5" cy="17.5" r="2.5"/>
    <circle cx="18.5" cy="17.5" r="2.5"/>
  </svg>`;
}

function onWayIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="5 12 19 12"/>
    <polyline points="12 5 19 12 12 19"/>
  </svg>`;
}

function checkIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>`;
}

function alertIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <circle cx="12" cy="16" r="0.5" fill="currentColor"/>
  </svg>`;
}

function pinIcon(size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
  </svg>`;
}

function flagIcon(size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
    <line x1="4" y1="22" x2="4" y2="15"/>
  </svg>`;
}
