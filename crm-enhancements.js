// file: crm-enhancements.js
const COLLECTIONS = {
  logistics: "nt_service_logistics",
  products: "nt_product_master",
  knowledge: "nt_knowledge_base",
  library: "nt_ai_support_library",
  reviews: "nt_reviews",
  reviewStats: "nt_review_stats",
  reviewCategories: "nt_review_categories",
  futureAmazonSync: "nt_future_amazon_sync",
  audit: "nt_audit_log"
};

const EXISTING_READ_COLLECTIONS = {
  customers: "customers",
  repairs: "repairs",
  warranty: "warranty",
  replacement: "replacement"
};

const CLIENT_SEND_STATUSES = [
  "Client Send",
  "Received",
  "Under Inspection",
  "Repair In Progress",
  "Ready To Ship",
  "Shipped",
  "Delivered"
];

const COMPANY_PICKUP_STATUSES = [
  "Pickup Requested",
  "Pickup Scheduled",
  "Picked Up",
  "Received",
  "Repair In Progress",
  "Ready To Ship",
  "Shipped",
  "Delivered"
];

const AI_CATEGORIES = [
  "Printer Issues",
  "Scanner Issues",
  "Bluetooth Issues",
  "USB Issues",
  "Driver Issues",
  "Label Issues",
  "QR Issues",
  "Warranty Queries",
  "Shipping Queries",
  "Replacement Queries"
];

const DEFAULT_PRODUCTS = [
  ["HT15", "HELETT HT15", "Scanner"],
  ["HT20", "HELETT HT20", "Scanner"],
  ["HT410", "HELETT HT410", "Scanner"],
  ["HT580", "HELETT HT580", "Scanner"],
  ["H80i", "HELETT H80i", "Receipt Printer"],
  ["H30C", "HELETT H30C", "Label Printer"],
  ["HE24", "HELETT HE24", "Label Printer"],
  ["H65C", "HELETT H65C", "Label Printer"],
  ["RapidLabel", "HELETT RapidLabel", "Label Printer"],
  ["InfiniStick", "HELETT InfiniStick", "Smart Device"]
];

let db;
let auth;
let currentUser = null;
let state = {
  logistics: [],
  products: [],
  knowledge: [],
  library: [],
  reviews: [],
  audit: [],
  existing: {
    customers: [],
    repairs: [],
    warranty: [],
    replacement: []
  }
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  if (!window.firebaseConfig || window.firebaseConfig.apiKey === "PASTE_EXISTING_VALUE") {
    showFatal("Firebase config missing. Paste your existing Firebase config in crm-enhancements.html.");
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
  db = firebase.firestore();
  auth = firebase.auth();

  setupUiEvents();
  setupStatusOptions();
  setupLibraryCategories();

  auth.onAuthStateChanged(async user => {
    currentUser = user || null;
    await loadAll();
    await seedProductsIfEmpty();
    renderAll();
  });

  if (localStorage.getItem("ntEnhancementTheme") === "dark") {
    document.body.classList.add("dark");
  }
}

function showFatal(message) {
  document.body.innerHTML = `<main class="content"><section class="panel"><h1>Configuration Required</h1><p>${escapeHtml(message)}</p></section></main>`;
}

function userLabel() {
  if (!currentUser) return "anonymous";
  return currentUser.email || currentUser.uid || "authenticated-user";
}

function serverNow() {
  return firebase.firestore.FieldValue.serverTimestamp();
}

async function loadAll() {
  const [
    logistics,
    products,
    knowledge,
    library,
    reviews,
    audit,
    customers,
    repairs,
    warranty,
    replacement
  ] = await Promise.all([
    readCollection(COLLECTIONS.logistics),
    readCollection(COLLECTIONS.products),
    readCollection(COLLECTIONS.knowledge),
    readCollection(COLLECTIONS.library),
    readCollection(COLLECTIONS.reviews),
    readCollection(COLLECTIONS.audit, "createdAt", "desc", 300),
    readCollectionSafe(EXISTING_READ_COLLECTIONS.customers),
    readCollectionSafe(EXISTING_READ_COLLECTIONS.repairs),
    readCollectionSafe(EXISTING_READ_COLLECTIONS.warranty),
    readCollectionSafe(EXISTING_READ_COLLECTIONS.replacement)
  ]);

  state = {
    logistics,
    products,
    knowledge,
    library,
    reviews,
    audit,
    existing: { customers, repairs, warranty, replacement }
  };
}

async function readCollection(name, orderField = "updatedAt", direction = "desc", limit = 500) {
  let ref = db.collection(name).limit(limit);
  try {
    ref = db.collection(name).orderBy(orderField, direction).limit(limit);
  } catch {
    ref = db.collection(name).limit(limit);
  }
  const snapshot = await ref.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function readCollectionSafe(name) {
  try {
    const snapshot = await db.collection(name).limit(1000).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch {
    return [];
  }
}

async function seedProductsIfEmpty() {
  if (state.products.length) return;
  const batch = db.batch();
  DEFAULT_PRODUCTS.forEach(([sku, productName, category]) => {
    const ref = db.collection(COLLECTIONS.products).doc();
    batch.set(ref, withCreateAudit({ sku, productName, category, active: true }));
  });
  await batch.commit();
  await writeAudit(COLLECTIONS.products, "seed", "create", null, { count: DEFAULT_PRODUCTS.length });
  state.products = await readCollection(COLLECTIONS.products);
}

function withCreateAudit(data) {
  const user = userLabel();
  return {
    ...data,
    createdBy: user,
    updatedBy: user,
    createdAt: serverNow(),
    updatedAt: serverNow(),
    actionHistory: [{
      action: "create",
      user,
      at: new Date().toISOString()
    }]
  };
}

function withUpdateAudit(existing, data) {
  const user = userLabel();
  const history = Array.isArray(existing.actionHistory) ? existing.actionHistory : [];
  return {
    ...data,
    createdBy: existing.createdBy || user,
    createdAt: existing.createdAt || serverNow(),
    updatedBy: user,
    updatedAt: serverNow(),
    actionHistory: [
      ...history,
      { action: "update", user, at: new Date().toISOString() }
    ]
  };
}

async function saveDocument(collectionName, data, existing) {
  const ref = existing && existing.id ? db.collection(collectionName).doc(existing.id) : db.collection(collectionName).doc();
  const payload = existing && existing.id ? withUpdateAudit(existing, data) : withCreateAudit(data);
  await ref.set(payload, { merge: true });
  await writeAudit(collectionName, ref.id, existing && existing.id ? "update" : "create", existing || null, payload);
}

async function deleteDocument(collectionName, doc) {
  await db.collection(collectionName).doc(doc.id).delete();
  await writeAudit(collectionName, doc.id, "delete", doc, null);
}

async function writeAudit(collectionName, documentId, action, before, after) {
  await db.collection(COLLECTIONS.audit).add({
    collectionName,
    documentId,
    action,
    before: sanitizeForAudit(before),
    after: sanitizeForAudit(after),
    user: userLabel(),
    createdAt: serverNow()
  });
}

function sanitizeForAudit(value) {
  if (!value) return null;
  return JSON.parse(JSON.stringify(value, (_, nested) => {
    if (nested && typeof nested.toDate === "function") return nested.toDate().toISOString();
    return nested;
  }));
}

function setupUiEvents() {
  document.addEventListener("click", async event => {
    const nav = event.target.closest(".nav");
    if (nav) {
      document.querySelectorAll(".nav").forEach(button => button.classList.toggle("active", button === nav));
      document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === nav.dataset.view));
      document.getElementById("pageTitle").textContent = nav.textContent;
      if (nav.dataset.view === "dashboard") requestAnimationFrame(renderCharts);
    }

    const reset = event.target.closest("[data-reset]");
    if (reset) resetForm(reset.dataset.reset);

    const edit = event.target.closest("[data-edit]");
    if (edit) startEdit(edit.dataset.type, edit.dataset.id);

    const remove = event.target.closest("[data-delete]");
    if (remove) await handleDelete(remove.dataset.type, remove.dataset.id);

    const exportButton = event.target.closest("[data-export]");
    if (exportButton) exportDataset(exportButton.dataset.export);
  });

  document.getElementById("refreshBtn").addEventListener("click", async () => {
    await loadAll();
    renderAll();
  });

  document.getElementById("darkBtn").addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem("ntEnhancementTheme", document.body.classList.contains("dark") ? "dark" : "light");
    renderCharts();
  });

  document.getElementById("globalSearch").addEventListener("input", renderSearch);
  document.getElementById("logisticsWorkflowFilter").addEventListener("change", renderLogistics);
  document.getElementById("logisticsStatusFilter").addEventListener("change", renderLogistics);
  document.getElementById("logisticsSearch").addEventListener("input", renderLogistics);
  document.getElementById("kbSearch").addEventListener("input", renderKnowledge);
  document.getElementById("librarySearch").addEventListener("input", renderLibrary);

  document.getElementById("logisticsForm").addEventListener("submit", event => saveForm(event, "logistics"));
  document.getElementById("productForm").addEventListener("submit", event => saveForm(event, "products"));
  document.getElementById("kbForm").addEventListener("submit", event => saveForm(event, "knowledge"));
  document.getElementById("libraryForm").addEventListener("submit", event => saveForm(event, "library"));
  document.getElementById("reviewForm").addEventListener("submit", event => saveForm(event, "reviews"));

  document.querySelector("[name='workflowType']").addEventListener("change", setupStatusOptions);
  window.addEventListener("resize", renderCharts);
}

function setupStatusOptions() {
  const workflow = document.querySelector("[name='workflowType']").value;
  const statuses = workflow === "company_pickup" ? COMPANY_PICKUP_STATUSES : CLIENT_SEND_STATUSES;
  document.querySelector("[name='status']").innerHTML = statuses.map(status => `<option>${status}</option>`).join("");
  document.getElementById("logisticsStatusFilter").innerHTML = `<option value="">All statuses</option>${[...new Set([...CLIENT_SEND_STATUSES, ...COMPANY_PICKUP_STATUSES])].map(status => `<option>${status}</option>`).join("")}`;
}

function setupLibraryCategories() {
  document.querySelector("#libraryForm [name='category']").innerHTML = AI_CATEGORIES.map(category => `<option>${category}</option>`).join("");
}

async function saveForm(event, type) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const existing = data.id ? getByType(type).find(item => item.id === data.id) : null;
  delete data.id;

  const normalized = normalizeFormData(type, data);
  await saveDocument(collectionForType(type), normalized, existing);
  resetForm(form.id);
  await loadAll();
  renderAll();
}

function normalizeFormData(type, data) {
  if (type === "products") {
    return {
      ...data,
      sku: data.sku.trim(),
      productName: data.productName.trim(),
      category: data.category.trim(),
      active: data.active === "true"
    };
  }

  if (["knowledge", "library"].includes(type)) {
    return {
      ...data,
      tags: splitTags(data.tags)
    };
  }

  if (type === "reviews") {
    return {
      ...data,
      rating: Number(data.rating),
      source: "manual"
    };
  }

  return data;
}

function splitTags(value) {
  return String(value || "").split(",").map(tag => tag.trim()).filter(Boolean);
}

function getByType(type) {
  return {
    logistics: state.logistics,
    products: state.products,
    knowledge: state.knowledge,
    library: state.library,
    reviews: state.reviews,
    audit: state.audit
  }[type] || [];
}

function collectionForType(type) {
  return {
    logistics: COLLECTIONS.logistics,
    products: COLLECTIONS.products,
    knowledge: COLLECTIONS.knowledge,
    library: COLLECTIONS.library,
    reviews: COLLECTIONS.reviews
  }[type];
}

function resetForm(formId) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.reset();
  const hidden = form.querySelector("[name='id']");
  if (hidden) hidden.value = "";
  if (formId === "logisticsForm") setupStatusOptions();
  if (formId === "reviewForm") form.querySelector("[name='reviewDate']").value = today();
}

function startEdit(type, id) {
  const item = getByType(type).find(row => row.id === id);
  if (!item) return;
  const form = document.getElementById({
    logistics: "logisticsForm",
    products: "productForm",
    knowledge: "kbForm",
    library: "libraryForm",
    reviews: "reviewForm"
  }[type]);

  Object.entries(item).forEach(([key, value]) => {
    if (!form.elements[key]) return;
    form.elements[key].value = Array.isArray(value) ? value.join(", ") : value;
  });

  if (type === "logistics") setupStatusOptions();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function handleDelete(type, id) {
  const item = getByType(type).find(row => row.id === id);
  if (!item || !confirm("Delete this new module record? Existing CRM records are not affected.")) return;
  await deleteDocument(collectionForType(type), item);
  await loadAll();
  renderAll();
}

function renderAll() {
  renderProductOptions();
  renderDashboard();
  renderLogistics();
  renderProducts();
  renderKnowledge();
  renderLibrary();
  renderReviews();
  renderAudit();
  renderSearch();
}

function renderProductOptions() {
  const options = state.products
    .filter(product => product.active !== false)
    .map(product => `<option value="${escapeHtml(product.sku)}">${escapeHtml(product.sku)} - ${escapeHtml(product.productName)}</option>`)
    .join("");

  document.querySelectorAll("[data-product-select]").forEach(select => {
    const current = select.value;
    select.innerHTML = options || `<option value="">Add products first</option>`;
    if (current) select.value = current;
  });

  const reviewDate = document.querySelector("#reviewForm [name='reviewDate']");
  if (reviewDate && !reviewDate.value) reviewDate.value = today();
}

function renderDashboard() {
  const allCases = [...state.existing.repairs, ...state.existing.warranty, ...state.existing.replacement, ...state.logistics];
  const now = new Date();
  const todayKey = today();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(now);
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  const cards = [
    ["Total Customers", state.existing.customers.length],
    ["Total Active Cases", allCases.filter(row => !isClosed(row)).length],
    ["Pending Cases", allCases.filter(row => isPending(row)).length],
    ["Closed Cases", allCases.filter(row => isClosed(row)).length],
    ["Warranty Cases", state.existing.warranty.length],
    ["Replacement Cases", state.existing.replacement.length],
    ["Repair Cases", state.existing.repairs.length],
    ["Pickup Cases", state.logistics.filter(row => row.workflowType === "company_pickup").length],
    ["Client Send Cases", state.logistics.filter(row => row.workflowType === "client_send").length],
    ["Today's Cases", allCases.filter(row => dateKey(row) === todayKey).length],
    ["This Week Cases", allCases.filter(row => parseDate(row) >= weekAgo).length],
    ["This Month Cases", allCases.filter(row => parseDate(row) >= monthAgo).length]
  ];

  document.getElementById("dashboardCards").innerHTML = cards.map(([label, value]) => `
    <article class="metric-card"><span>${label}</span><strong>${value}</strong></article>
  `).join("");

  renderCharts();
}

function renderCharts() {
  const allCases = [...state.existing.repairs, ...state.existing.warranty, ...state.existing.replacement, ...state.logistics];
  drawBar("chartProduct", groupCount(allCases, row => row.productSku || row.sku || row.product || "Unknown"));
  drawBar("chartStatus", groupCount(allCases, row => row.status || "Unknown"));
  drawBar("chartMonth", groupCount(allCases, row => dateKey(row).slice(0, 7) || "Unknown"));
  drawBar("chartCategory", groupCount(allCases, row => row.category || row.workflowType || "General"));
}

function groupCount(rows, mapper) {
  return Object.entries(rows.reduce((map, row) => {
    const key = mapper(row);
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label, count }));
}

function drawBar(id, data) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(260, canvas.parentElement.clientWidth - 36);
  const height = Number(canvas.getAttribute("height"));
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.font = "12px Arial";
  const max = Math.max(1, ...data.map(item => item.count));
  const primary = getCss("--primary");
  const text = getCss("--text");
  const muted = getCss("--muted");

  if (!data.length) {
    ctx.fillStyle = muted;
    ctx.fillText("No data", 14, 24);
    return;
  }

  data.forEach((item, index) => {
    const slot = width / data.length;
    const barWidth = Math.max(18, slot - 16);
    const barHeight = (height - 68) * item.count / max;
    const x = index * slot + 8;
    const y = height - 34 - barHeight;
    ctx.fillStyle = primary;
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = text;
    ctx.fillText(String(item.count), x + 2, y - 6);
    ctx.fillStyle = muted;
    ctx.fillText(String(item.label).slice(0, 11), x, height - 12);
  });
}

function renderLogistics() {
  const workflow = document.getElementById("logisticsWorkflowFilter").value;
  const status = document.getElementById("logisticsStatusFilter").value;
  const query = document.getElementById("logisticsSearch").value.toLowerCase().trim();

  const rows = state.logistics.filter(row => {
    return (!workflow || row.workflowType === workflow)
      && (!status || row.status === status)
      && (!query || searchable(row).includes(query));
  });

  document.getElementById("logisticsTable").innerHTML = table(
    ["Case", "Workflow", "Customer", "SKU", "Status", "Tracking", "Actions"],
    rows,
    row => [
      escapeHtml(row.caseId),
      row.workflowType === "company_pickup" ? "Company Pickup" : "Client Send",
      `${escapeHtml(row.customerName || "")}<br>${escapeHtml(row.customerPhone || "")}`,
      escapeHtml(row.productSku),
      statusBadge(row.status),
      escapeHtml(row.trackingNumber || ""),
      actions("logistics", row.id)
    ]
  );
}

function renderProducts() {
  document.getElementById("productTable").innerHTML = table(
    ["SKU", "Product", "Category", "Active", "Actions"],
    state.products,
    row => [
      escapeHtml(row.sku),
      escapeHtml(row.productName),
      escapeHtml(row.category),
      row.active === false ? "No" : "Yes",
      actions("products", row.id)
    ]
  );
}

function renderKnowledge() {
  const query = document.getElementById("kbSearch").value.toLowerCase().trim();
  const rows = state.knowledge.filter(row => !query || searchable(row).includes(query));

  document.getElementById("kbTable").innerHTML = table(
    ["Issue", "Solution", "Product", "Category", "Language", "Tags", "Actions"],
    rows,
    row => [
      escapeHtml(row.issue),
      escapeHtml(row.solution),
      escapeHtml(row.productSku),
      escapeHtml(row.category),
      escapeHtml(row.language),
      escapeHtml((row.tags || []).join(", ")),
      actions("knowledge", row.id)
    ]
  );
}

function renderLibrary() {
  const query = document.getElementById("librarySearch").value.toLowerCase().trim();
  const rows = state.library.filter(row => !query || searchable(row).includes(query));

  document.getElementById("libraryTable").innerHTML = table(
    ["Category", "Title", "Professional Reply", "WhatsApp", "Email", "Actions"],
    rows,
    row => [
      escapeHtml(row.category),
      escapeHtml(row.title),
      escapeHtml(row.professionalReply),
      escapeHtml(row.whatsappTemplate),
      escapeHtml(row.emailTemplate),
      actions("library", row.id)
    ]
  );
}

function renderReviews() {
  document.getElementById("reviewTable").innerHTML = table(
    ["Date", "SKU", "Rating", "Title", "Text", "Category", "Source", "Actions"],
    state.reviews,
    row => [
      escapeHtml(row.reviewDate),
      escapeHtml(row.productSku),
      escapeHtml(row.rating),
      escapeHtml(row.reviewTitle),
      escapeHtml(row.reviewText),
      escapeHtml(row.category || ""),
      escapeHtml(row.source || "manual"),
      actions("reviews", row.id)
    ]
  );
  updateReviewStats();
}

async function updateReviewStats() {
  const grouped = groupCount(state.reviews, row => row.productSku || "Unknown");
  for (const item of grouped) {
    const rows = state.reviews.filter(row => (row.productSku || "Unknown") === item.label);
    const averageRating = rows.reduce((sum, row) => sum + Number(row.rating || 0), 0) / Math.max(1, rows.length);
    await db.collection(COLLECTIONS.reviewStats).doc(item.label).set({
      productSku: item.label,
      totalReviews: rows.length,
      averageRating,
      negativeReviews: rows.filter(row => Number(row.rating) <= 3).length,
      lastCalculatedAt: serverNow()
    }, { merge: true });
  }
}

function renderAudit() {
  document.getElementById("auditTable").innerHTML = table(
    ["Date", "User", "Action", "Collection", "Document"],
    state.audit,
    row => [
      escapeHtml(formatDate(row.createdAt)),
      escapeHtml(row.user),
      escapeHtml(row.action),
      escapeHtml(row.collectionName),
      escapeHtml(row.documentId)
    ]
  );
}

function renderSearch() {
  const query = document.getElementById("globalSearch").value.toLowerCase().trim();
  const box = document.getElementById("searchResults");

  if (!query) {
    box.classList.add("hidden");
    return;
  }

  const sources = [
    ["Logistics", state.logistics],
    ["Product", state.products],
    ["Knowledge", state.knowledge],
    ["AI Reply", state.library],
    ["Review", state.reviews]
  ];

  const matches = sources
    .flatMap(([label, rows]) => rows.filter(row => searchable(row).includes(query)).map(row => ({ label, row })))
    .slice(0, 40);

  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="panel-head"><h2>Search Results</h2><span class="badge neutral">${matches.length} found</span></div>
    ${matches.map(match => `<div class="search-row"><strong>${match.label}</strong><p>${escapeHtml(summary(match.row))}</p></div>`).join("") || `<div class="empty">No results found.</div>`}
  `;
}

function table(headers, rows, mapper) {
  if (!rows.length) return `<div class="empty">No records found.</div>`;
  return `
    <table>
      <thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(row => `<tr>${(mapper ? mapper(row) : row).map(cell => `<td>${cell ?? ""}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
}

function actions(type, id) {
  return `
    <div class="row-actions">
      <button type="button" data-edit="${type}" data-id="${id}">Edit</button>
      <button type="button" class="danger" data-delete="${type}" data-id="${id}">Delete</button>
    </div>
  `;
}

function statusBadge(status) {
  const lower = String(status || "").toLowerCase();
  const color = lower.includes("delivered") || lower.includes("closed") ? "green"
    : lower.includes("ship") || lower.includes("progress") || lower.includes("inspection") ? "blue"
    : lower.includes("requested") || lower.includes("scheduled") || lower.includes("pending") ? "yellow"
    : "neutral";

  return `<span class="badge ${color}">${escapeHtml(status || "Unknown")}</span>`;
}

function exportDataset(type) {
  const from = document.getElementById("exportFrom")?.value;
  const to = document.getElementById("exportTo")?.value;
  const format = document.getElementById("exportFormat")?.value || "csv";
  const rows = rowsForExport(type).filter(row => inRange(row, from, to));

  if (!rows.length) {
    alert("No records found for export.");
    return;
  }

  if (format === "xlsx" && window.XLSX) exportXlsx(`${type}.xlsx`, rows);
  else exportCsv(`${type}.csv`, rows);
}

function rowsForExport(type) {
  return {
    customers: state.existing.customers,
    repairs: state.existing.repairs,
    warranty: state.existing.warranty,
    replacement: state.existing.replacement,
    logistics: state.logistics,
    products: state.products,
    reviews: state.reviews,
    knowledge: state.knowledge,
    library: state.library,
    audit: state.audit
  }[type] || [];
}

function exportCsv(filename, rows) {
  const flat = rows.map(flattenRow);
  const headers = [...new Set(flat.flatMap(row => Object.keys(row)))];
  const csv = [headers.join(","), ...flat.map(row => headers.map(header => csvCell(row[header])).join(","))].join("\n");
  download(filename, new Blob([csv], { type: "text/csv;charset=utf-8" }));
}

function exportXlsx(filename, rows) {
  const worksheet = XLSX.utils.json_to_sheet(rows.map(flattenRow));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Export");
  XLSX.writeFile(workbook, filename);
}

function flattenRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Array.isArray(value) ? value.join("; ") : formatExportValue(value)]));
}

function formatExportValue(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (value && typeof value === "object") return JSON.stringify(sanitizeForAudit(value));
  return value ?? "";
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function inRange(row, from, to) {
  if (!from && !to) return true;
  const date = parseDate(row);
  if (!date) return true;
  if (from && date < new Date(from)) return false;
  if (to && date > new Date(`${to}T23:59:59`)) return false;
  return true;
}

function parseDate(row) {
  const value = row.createdAt || row.updatedAt || row.date || row.createdDate || row.created_date || row.reviewDate;
  if (!value) return null;
  if (value && typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateKey(row) {
  const date = parseDate(row);
  return date ? date.toISOString().slice(0, 10) : "";
}

function isClosed(row) {
  return /closed|delivered|completed|resolved/i.test(String(row.status || row.caseStatus || ""));
}

function isPending(row) {
  return !isClosed(row) && /pending|requested|scheduled|open|inspection|progress/i.test(String(row.status || row.caseStatus || "open"));
}

function searchable(row) {
  return JSON.stringify(sanitizeForAudit(row)).toLowerCase();
}

function summary(row) {
  return row.productName || row.issue || row.title || row.reviewTitle || row.caseId || row.customerName || row.sku || row.id || "Record";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "";
  if (value && typeof value.toDate === "function") return value.toDate().toLocaleString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function getCss(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
