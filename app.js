const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbyjQEITL5yb5URDIM3lYtjprZNy0YEpqmEuFNlidbjDdVNoQCuDvGsbau4WzMRUu4Oonw/exec",
  SINGAPORE_PHONE_DISPLAY: "+65 8575 6146",
  SINGAPORE_PHONE_KEY: "6585756146",
  DEFAULT_MAP: {
    latitude: 1.3521,
    longitude: 103.8198,
    zoom: 11
  }
};

const state = {
  step: 0,
  products: [],
  selected: new Map(),
  category: "All",
  search: "",
  map: null,
  marker: null,
  locationConfirmed: false,
  reverseTimer: null,
  productPage: 0,
  productsPerPage: 5,
  productCategories: ["Veggie", "Fruits", "Greens"],
  draftToken: "",
  draftLoaded: false,
  saveTimer: null,
  saveInFlight: false,
  lastSavedJson: "",
  pendingResume: null
};

const $ = id => document.getElementById(id);
const form = $("waitlistForm");

document.addEventListener("DOMContentLoaded", () => {
  applyContactDetails();
  initialiseMap();
  bindJourney();
  bindCounters();
  bindPriorityLimit();
  bindProductControls();
  loadProducts();
  showStep(0);

  $("doneBtn").onclick = () => $("successDialog").close();
  form.onsubmit = submitForm;
});

function applyContactDetails() {
  const waUrl = `https://wa.me/${CONFIG.SINGAPORE_PHONE_KEY}`;
  ["headerPhone", "heroWhatsApp", "contactPhone"].forEach(id => {
    const element = $(id);
    if (element) element.href = waUrl;
  });

  $("headerPhone").textContent = CONFIG.SINGAPORE_PHONE_DISPLAY;
  $("contactPhone").textContent = CONFIG.SINGAPORE_PHONE_DISPLAY;
}

function bindJourney() {
  $("nextBtn").onclick = () => {
    if (!validateStep(state.step)) return;
    showStep(Math.min(state.step + 1, 5));
  };

  $("backBtn").onclick = () => showStep(Math.max(state.step - 1, 0));

  document.querySelectorAll("[data-go]").forEach(button => {
    button.onclick = () => {
      const target = Number(button.dataset.go);
      if (target <= state.step || allPreviousStepsValid(target)) {
        showStep(target);
      }
    };
  });
}

function showStep(index) {
  state.step = index;

  document.querySelectorAll(".step-panel").forEach(panel => {
    panel.classList.toggle("active", Number(panel.dataset.step) === index);
  });

  document.querySelectorAll("#stepNav li").forEach((item, itemIndex) => {
    item.classList.toggle("active", itemIndex === index);
    item.classList.toggle("complete", itemIndex < index);
  });

  $("progressNumber").textContent = index + 1;
  $("backBtn").classList.toggle("hidden", index === 0);
  $("nextBtn").classList.toggle("hidden", index === 5);
  $("formMessage").textContent = "";

  if (index === 0 && state.map) {
    setTimeout(() => state.map.invalidateSize(), 80);
  }

  if (index === 5) renderReview();

  document.querySelector(".journey-layout").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function allPreviousStepsValid(target) {
  for (let index = 0; index < target; index += 1) {
    if (!validateStep(index, false)) return false;
  }
  return true;
}

function validateStep(index, showMessage = true) {
  const panel = document.querySelector(`.step-panel[data-step="${index}"]`);
  const requiredFields = [...panel.querySelectorAll("[required]")];

  for (const field of requiredFields) {
    if (!field.checkValidity()) {
      if (showMessage) {
        field.reportValidity();
        setMessage("Please complete the highlighted field.");
      }
      return false;
    }
  }

  if (index === 0 && !state.locationConfirmed) {
    if (showMessage) setMessage("Please select and confirm your location on the map.");
    return false;
  }

  if (index === 2 && state.selected.size === 0) {
    if (showMessage) setMessage("Please select at least one product.");
    return false;
  }

  if (index === 3) {
    const selectedPriorities = form.querySelectorAll('input[name="priorities"]:checked').length;
    if (selectedPriorities === 0) {
      if (showMessage) setMessage("Please choose at least one priority.");
      return false;
    }
  }

  return true;
}

function setMessage(message) {
  $("formMessage").textContent = message;
}

function bindCounters() {
  document.querySelectorAll("[data-counter]").forEach(button => {
    button.onclick = () => {
      const name = button.dataset.counter;
      const input = form.elements[name];
      const minimum = name === "adults" ? 1 : 0;
      const maximum = 10;
      const next = Math.max(
        minimum,
        Math.min(maximum, Number(input.value || 0) + Number(button.dataset.change))
      );

      input.value = next;
      $(`${name}Value`).textContent = next;
    };
  });
}

function bindPriorityLimit() {
  const boxes = [...form.querySelectorAll('input[name="priorities"]')];

  boxes.forEach(box => {
    box.onchange = () => {
      const checked = boxes.filter(item => item.checked);
      $("priorityCount").textContent = `${checked.length} of 3`;

      boxes.forEach(item => {
        item.closest("label").classList.toggle(
          "disabled",
          checked.length >= 3 && !item.checked
        );
      });
    };
  });
}

function initialiseMap() {
  state.map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: false
  }).setView(
    [CONFIG.DEFAULT_MAP.latitude, CONFIG.DEFAULT_MAP.longitude],
    CONFIG.DEFAULT_MAP.zoom
  );

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(state.map);

  const markerIcon = L.divIcon({
    className: "mfb-map-marker",
    html: '<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:#228B22;transform:rotate(-45deg);border:3px solid white;box-shadow:0 4px 14px rgba(0,0,0,.28)"><div style="width:8px;height:8px;border-radius:50%;background:white;margin:8px"></div></div>',
    iconSize: [34, 42],
    iconAnchor: [17, 39]
  });

  state.marker = L.marker(
    [CONFIG.DEFAULT_MAP.latitude, CONFIG.DEFAULT_MAP.longitude],
    { draggable: true, icon: markerIcon }
  ).addTo(state.map);

  state.marker.on("dragend", () => {
    const point = state.marker.getLatLng();
    selectCoordinates(point.lat, point.lng, true);
  });

  state.map.on("click", event => {
    state.marker.setLatLng(event.latlng);
    selectCoordinates(event.latlng.lat, event.latlng.lng, true);
  });

  $("searchLocationBtn").onclick = searchLocation;
  $("locationSearch").onkeydown = event => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchLocation();
    }
  };
  $("locateMeBtn").onclick = useCurrentLocation;
}

async function searchLocation() {
  const query = $("locationSearch").value.trim();
  if (!query) {
    setMessage("Enter a Singapore area, address or postal code.");
    return;
  }

  const resultsBox = $("locationResults");
  resultsBox.classList.remove("hidden");
  resultsBox.innerHTML = '<button type="button" class="location-result">Searching…</button>';

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("countrycodes", "sg");
    url.searchParams.set("limit", "5");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("q", `${query}, Singapore`);

    const response = await fetch(url, {
      headers: { "Accept-Language": "en" }
    });

    if (!response.ok) throw new Error("Location search is temporarily unavailable.");

    const results = await response.json();

    if (!results.length) {
      resultsBox.innerHTML =
        '<button type="button" class="location-result">No Singapore location found. Try a nearby landmark or postal code.</button>';
      return;
    }

    resultsBox.innerHTML = results.map((result, index) => `
      <button type="button" class="location-result" data-result="${index}">
        <b>${escapeHtml(locationTitle(result.address, result.display_name))}</b>
        <small>${escapeHtml(result.display_name)}</small>
      </button>
    `).join("");

    resultsBox.querySelectorAll("[data-result]").forEach(button => {
      button.onclick = () => {
        const result = results[Number(button.dataset.result)];
        const latitude = Number(result.lat);
        const longitude = Number(result.lon);

        state.marker.setLatLng([latitude, longitude]);
        state.map.setView([latitude, longitude], 16);
        applyLocationData(latitude, longitude, result);
        resultsBox.classList.add("hidden");
      };
    });
  } catch (error) {
    resultsBox.innerHTML =
      `<button type="button" class="location-result">${escapeHtml(error.message)}</button>`;
  }
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    setMessage("Current location is not available on this device.");
    return;
  }

  const button = $("locateMeBtn");
  button.disabled = true;
  button.textContent = "Locating…";

  navigator.geolocation.getCurrentPosition(
    position => {
      const { latitude, longitude } = position.coords;
      state.marker.setLatLng([latitude, longitude]);
      state.map.setView([latitude, longitude], 17);
      selectCoordinates(latitude, longitude, true);
      button.disabled = false;
      button.textContent = "Use my location";
    },
    () => {
      setMessage("We could not access your current location. Search or move the map pin instead.");
      button.disabled = false;
      button.textContent = "Use my location";
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

function selectCoordinates(latitude, longitude, reverseLookup) {
  setBasicCoordinates(latitude, longitude);

  if (!reverseLookup) return;

  clearTimeout(state.reverseTimer);
  state.reverseTimer = setTimeout(
    () => reverseGeocode(latitude, longitude),
    450
  );
}

function setBasicCoordinates(latitude, longitude) {
  form.elements.latitude.value = Number(latitude).toFixed(6);
  form.elements.longitude.value = Number(longitude).toFixed(6);
  form.elements.mapLink.value =
    `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;

  $("selectedCoordinates").textContent =
    `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}`;

  $("selectedLocationText").textContent =
    "Checking this location…";

  state.locationConfirmed = true;
}

async function reverseGeocode(latitude, longitude) {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", latitude);
    url.searchParams.set("lon", longitude);
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url, {
      headers: { "Accept-Language": "en" }
    });

    if (!response.ok) throw new Error("Address lookup unavailable.");

    const result = await response.json();
    applyLocationData(latitude, longitude, result);
  } catch (error) {
    form.elements.locationName.value = "Selected map location";
    form.elements.locationAddress.value = "";
    form.elements.locationArea.value = "";
    form.elements.postalCode.value = "";
    $("selectedLocationText").textContent = "Selected map location";
  }
}

function applyLocationData(latitude, longitude, result) {
  const address = result.address || {};
  const title = locationTitle(address, result.display_name);
  const area =
    address.suburb ||
    address.neighbourhood ||
    address.quarter ||
    address.city_district ||
    address.town ||
    address.city ||
    "";

  form.elements.locationName.value = title;
  form.elements.locationAddress.value = result.display_name || title;
  form.elements.locationArea.value = area;
  form.elements.postalCode.value = address.postcode || "";
  form.elements.latitude.value = Number(latitude).toFixed(6);
  form.elements.longitude.value = Number(longitude).toFixed(6);
  form.elements.mapLink.value =
    `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;

  $("selectedLocationText").textContent = title;
  $("selectedCoordinates").textContent =
    `${address.postcode ? `${address.postcode} · ` : ""}${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}`;

  state.locationConfirmed = true;
  setMessage("");
}

function locationTitle(address = {}, fallback = "") {
  return (
    address.amenity ||
    address.building ||
    address.road ||
    address.neighbourhood ||
    address.suburb ||
    address.quarter ||
    address.city_district ||
    address.town ||
    address.city ||
    fallback.split(",")[0] ||
    "Selected Singapore location"
  );
}

function bindProductControls() {
  $("productSearch").oninput = event => {
    state.search = event.target.value.trim().toLowerCase();
    renderProducts();
  };

  $("clearSelection").onclick = () => {
    state.selected.clear();
    renderProducts();
    updateSummary();
  };
}

async function loadProducts() {
  try {
    const response = await fetch(`${CONFIG.API_URL}?action=products`);
    const result = await response.json();

    if (!result.ok) throw new Error(result.message || "Unable to load produce.");

    state.products = result.products || [];
    renderTabs(result.categories || ["Veggie", "Fruits", "Greens"]);
    renderProducts();
  } catch (error) {
    $("catalogState").textContent =
      "Produce could not be loaded. Please refresh the page.";
    console.error(error);
  }
}

function renderTabs(categories) {
  const values = ["All", ...categories];

  $("categoryTabs").innerHTML = values.map(category =>
    `<button type="button"
      class="${category === state.category ? "active" : ""}"
      data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
  ).join("");

  $("categoryTabs").querySelectorAll("button").forEach(button => {
    button.onclick = () => {
      state.category = button.dataset.category;
      renderTabs(categories);
      renderProducts();
    };
  });
}

function renderProducts() {
  const list = state.products.filter(product => {
    const categoryMatch =
      state.category === "All" ||
      product.category === state.category;

    const haystack =
      `${product.name} ${product.tanglish} ${product.category}`.toLowerCase();

    return categoryMatch &&
      (!state.search || haystack.includes(state.search));
  });

  $("catalogState").classList.toggle("hidden", list.length > 0);
  $("catalogState").textContent =
    state.products.length
      ? "No produce matches this search."
      : "Loading produce…";

  $("productList").innerHTML = list.map(product => {
    const chosen = state.selected.get(product.id);

    return `<article class="product-row ${chosen ? "selected" : ""}" data-id="${escapeHtml(product.id)}">
      <div class="product-thumb">
        ${product.imageUrl
          ? `<img src="${escapeAttribute(product.imageUrl)}" alt="${escapeAttribute(product.name)}" loading="lazy" onerror="this.outerHTML='<div class=&quot;fallback&quot;>MFB</div>'">`
          : '<div class="fallback">MFB</div>'}
      </div>

      <div class="product-copy">
        <b>${escapeHtml(product.name)}</b>
        <small>${escapeHtml(product.tanglish || product.category)}</small>
      </div>

      <div class="product-toggle">${chosen ? "✓" : "+"}</div>

      <select aria-label="${escapeAttribute(product.name)} quantity">
        ${(product.quantities || []).map(option =>
          `<option
            value="${escapeAttribute(option.label)}"
            data-kg="${Number(option.estimatedKg || 0)}"
            ${chosen && chosen.weeklyQuantity === option.label ? "selected" : ""}
          >${escapeHtml(option.label)}</option>`
        ).join("")}
      </select>
    </article>`;
  }).join("");

  $("productList").querySelectorAll(".product-row").forEach(row => {
    row.onclick = event => {
      if (event.target.tagName === "SELECT") return;
      toggleProduct(row.dataset.id);
    };

    row.querySelector("select").onchange = event =>
      updateQuantity(row.dataset.id, event.target);
  });
}

function toggleProduct(id) {
  const product = state.products.find(item => item.id === id);
  if (!product) return;

  if (state.selected.has(id)) {
    state.selected.delete(id);
  } else {
    const quantity = product.quantities[0];
    state.selected.set(id, {
      productId: product.id,
      productName: product.name,
      category: product.category,
      weeklyQuantity: quantity.label,
      estimatedKg: Number(quantity.estimatedKg || 0),
      expectedPrice: ""
    });
  }

  renderProducts();
  updateSummary();
}

function updateQuantity(id, select) {
  const item = state.selected.get(id);
  if (!item) return;

  const option = select.options[select.selectedIndex];
  item.weeklyQuantity = option.value;
  item.estimatedKg = Number(option.dataset.kg || 0);
  state.selected.set(id, item);
  updateSummary();
}

function updateSummary() {
  const items = [...state.selected.values()];
  const totalKg = items.reduce(
    (sum, item) => sum + Number(item.estimatedKg || 0),
    0
  );

  $("selectedCount").textContent = `${items.length} selected`;
  $("estimatedKg").textContent = `${formatNumber(totalKg)} kg per week`;
}

function renderReview() {
  const data = new FormData(form);
  const productNames = [...state.selected.values()]
    .slice(0, 4)
    .map(item => item.productName)
    .join(", ");

  const extra =
    state.selected.size > 4 ? ` +${state.selected.size - 4} more` : "";

  $("reviewCard").innerHTML = `
    ${reviewRow("Name", data.get("name") || "—")}
    ${reviewRow("Location", data.get("locationName") || "—")}
    ${reviewRow("Family", `${data.get("adults")} adult(s), ${data.get("children")} child(ren)`)}
    ${reviewRow("Cooking", data.get("cookingFrequency") || "—")}
    ${reviewRow("Delivery", data.get("deliveryFrequency") || "—")}
    ${reviewRow("Produce", `${productNames}${extra}` || "—")}
    ${reviewRow("Weekly budget", data.get("weeklyBudget") || "—")}
  `;
}

function reviewRow(label, value) {
  return `<div class="review-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

async function submitForm(event) {
  event.preventDefault();
  setMessage("");

  if (!allPreviousStepsValid(6) || !form.reportValidity()) {
    setMessage("Please review the incomplete section.");
    return;
  }

  const button = $("submitBtn");
  const data = new FormData(form);
  const params = new URLSearchParams(location.search);

  const payload = {
    action: "joinWaitlist",
    name: data.get("name"),
    phone: data.get("phone"),
    email: data.get("email"),
    postalCode: data.get("postalCode"),
    locationName: data.get("locationName"),
    locationAddress: data.get("locationAddress"),
    locationArea: data.get("locationArea"),
    latitude: data.get("latitude"),
    longitude: data.get("longitude"),
    mapLink: data.get("mapLink"),
    adults: data.get("adults"),
    children: data.get("children"),
    cookingFrequency: data.get("cookingFrequency"),
    deliveryFrequency: data.get("deliveryFrequency"),
    weeklyBudget: data.get("weeklyBudget"),
    priorities: data.getAll("priorities"),
    pilotInterest: data.get("pilotInterest") === "on",
    callback: data.get("callback") === "on",
    launchUpdates: data.get("launchUpdates") === "on",
    consent: data.get("consent") === "on",
    marketingConsent: data.get("marketingConsent") === "on",
    notes: data.get("notes"),
    website: data.get("website"),
    source: params.get("utm_source") || "Singapore Website",
    campaign: params.get("utm_campaign") || "SG Founding Harvest September 2026",
    products: [...state.selected.values()]
  };

  button.disabled = true;
  button.textContent = "Joining…";

  try {
    const body = new URLSearchParams();
    body.set("payload", JSON.stringify(payload));

    const response = await fetch(CONFIG.API_URL, {
      method: "POST",
      body
    });

    const result = await response.json();
    if (!result.ok) throw new Error(result.message || "Unable to submit.");

    $("waitlistId").textContent = result.waitlistId;
    $("successDialog").showModal();

    form.reset();
    form.elements.adults.value = "2";
    form.elements.children.value = "0";
    $("adultsValue").textContent = "2";
    $("childrenValue").textContent = "0";
    state.selected.clear();
    state.locationConfirmed = false;
    renderProducts();
    updateSummary();
    showStep(0);
  } catch (error) {
    setMessage(error.message || "Something went wrong. Please try again.");
    console.error(error);
  } finally {
    button.disabled = false;
    button.textContent = "Join the Founding Harvest";
  }
}

function formatNumber(value) {
  return Number(value || 0)
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]
  );
}

function escapeAttribute(value) {
  return escapeHtml(value);
}


/* =========================================================
   MyFarmBox Singapore Founding Harvest v2.0
   ========================================================= */

const DRAFT_STORAGE_KEY = "mfb_sg_harvest_draft_v2";
const DRAFT_TOKEN_KEY = "mfb_sg_harvest_token_v2";
const TOTAL_STEPS = 7;

document.addEventListener("DOMContentLoaded", () => {
  initialiseV2Journey();
});

function initialiseV2Journey() {
  state.draftToken =
    localStorage.getItem(DRAFT_TOKEN_KEY) ||
    (crypto.randomUUID ? crypto.randomUUID() : `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  localStorage.setItem(DRAFT_TOKEN_KEY, state.draftToken);

  bindAutoSave();
  bindProductPagination();
  setTimeout(checkForSavedDraft, 220);
}

function bindProductPagination() {
  const previous = $("productPrevBtn");
  const next = $("productNextBtn");

  if (previous) {
    previous.onclick = () => {
      state.productPage = Math.max(0, state.productPage - 1);
      renderProducts();
      scheduleDraftSave();
    };
  }

  if (next) {
    next.onclick = () => {
      state.productPage += 1;
      renderProducts();
      scheduleDraftSave();
    };
  }
}

function bindAutoSave() {
  form.addEventListener("input", scheduleDraftSave);
  form.addEventListener("change", scheduleDraftSave);

  document.addEventListener("click", event => {
    if (
      event.target.closest("[data-counter]") ||
      event.target.closest(".product-row") ||
      event.target.closest("#categoryTabs") ||
      event.target.closest(".catalog-pagination")
    ) {
      scheduleDraftSave();
    }
  });

  window.addEventListener("beforeunload", saveDraftLocally);
}

function scheduleDraftSave() {
  if (!state.draftLoaded) return;

  setSaveStatus("Saving…");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveDraft, 900);
}

function setSaveStatus(text) {
  const desktop = $("saveStatus");
  const mobile = $("mobileSaveStatus");
  if (desktop) desktop.textContent = text;
  if (mobile) {
    mobile.textContent =
      text === "Saved"
        ? "✓ Progress saved"
        : text === "Saving…"
          ? "Saving your progress…"
          : text;
  }
}

function collectDraftData() {
  const data = new FormData(form);
  const fields = {};

  for (const [key, value] of data.entries()) {
    if (["priorities", "produceInterests"].includes(key)) continue;
    fields[key] = value;
  }

  fields.priorities = data.getAll("priorities");
  fields.produceInterests = data.getAll("produceInterests");
  fields.pilotInterest = data.get("pilotInterest") === "on";
  fields.callback = data.get("callback") === "on";
  fields.launchUpdates = data.get("launchUpdates") === "on";
  fields.marketingConsent = data.get("marketingConsent") === "on";
  fields.consent = data.get("consent") === "on";

  return {
    version: "2.0",
    draftToken: state.draftToken,
    currentStep: state.step,
    progress: Math.round(((state.step + 1) / TOTAL_STEPS) * 100),
    productPage: state.productPage,
    category: state.category,
    search: state.search,
    locationConfirmed: state.locationConfirmed,
    fields,
    products: [...state.selected.values()],
    savedAt: new Date().toISOString()
  };
}

function saveDraftLocally() {
  const draft = collectDraftData();
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  return draft;
}

async function saveDraft() {
  const draft = saveDraftLocally();
  const draftJson = JSON.stringify(draft);

  if (draftJson === state.lastSavedJson || state.saveInFlight) {
    setSaveStatus("Saved");
    return;
  }

  state.saveInFlight = true;

  try {
    const payload = {
      action: "saveDraft",
      draftToken: state.draftToken,
      phone: draft.fields.phone || "",
      email: draft.fields.email || "",
      name: draft.fields.name || "",
      currentStep: draft.currentStep,
      progress: draft.progress,
      draftData: draft,
      device: navigator.userAgent
    };

    const result = await apiPost(payload);
    if (!result.ok) throw new Error(result.message || "Could not save draft.");

    state.lastSavedJson = draftJson;
    setSaveStatus("Saved");
  } catch (error) {
    setSaveStatus("Saved on this device");
    console.warn("Server draft save failed; local copy preserved.", error);
  } finally {
    state.saveInFlight = false;
  }
}

async function checkForSavedDraft() {
  let draft = null;

  try {
    const local = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (local) draft = JSON.parse(local);
  } catch (error) {
    console.warn("Local draft could not be read.", error);
  }

  try {
    const result = await apiPost({
      action: "getDraft",
      draftToken: state.draftToken
    });

    if (result.ok && result.found && result.draftData) {
      const serverDraft = result.draftData;
      if (!draft || String(serverDraft.savedAt || "") > String(draft.savedAt || "")) {
        draft = serverDraft;
      }
    }
  } catch (error) {
    console.warn("Server draft lookup skipped.", error);
  }

  state.draftLoaded = true;

  if (!draft || draft.completed || !hasMeaningfulDraft(draft)) {
    setSaveStatus("Auto-save on");
    return;
  }

  state.pendingResume = draft;
  showResumeDialog(draft);
}

function hasMeaningfulDraft(draft) {
  const fields = draft.fields || {};
  return Boolean(
    fields.name ||
    fields.phone ||
    fields.email ||
    Number(draft.currentStep || 0) > 0 ||
    (Array.isArray(draft.products) && draft.products.length)
  );
}

function showResumeDialog(draft) {
  const dialog = $("resumeDialog");
  if (!dialog) {
    restoreDraft(draft);
    return;
  }

  const percent = Number(draft.progress || 0);
  const stepNames = [
    "Your details",
    "Family routine",
    "Select produce",
    "Budget & values",
    "Launch preference",
    "Harvest profile",
    "Consent"
  ];

  $("resumePercent").textContent = `${percent}% complete`;
  $("resumeStepName").textContent =
    stepNames[Math.min(Number(draft.currentStep || 0), stepNames.length - 1)];
  $("resumeProgressBar").style.width = `${percent}%`;

  $("resumeContinueBtn").onclick = () => {
    dialog.close();
    restoreDraft(state.pendingResume);
  };

  $("resumeRestartBtn").onclick = async () => {
    dialog.close();
    await clearDraft(true);
    state.draftLoaded = true;
    setSaveStatus("Auto-save on");
  };

  dialog.showModal();
}

function restoreDraft(draft) {
  const fields = draft.fields || {};

  Object.entries(fields).forEach(([name, value]) => {
    if (["priorities", "produceInterests", "pilotInterest", "callback", "launchUpdates", "marketingConsent", "consent"].includes(name)) {
      return;
    }

    const element = form.elements[name];
    if (!element) return;

    if (element instanceof RadioNodeList) {
      [...element].forEach(item => {
        if (item.type === "radio") item.checked = item.value === value;
      });
    } else {
      element.value = value ?? "";
    }
  });

  const priorities = Array.isArray(fields.priorities) ? fields.priorities : [];
  form.querySelectorAll('input[name="priorities"]').forEach(box => {
    box.checked = priorities.includes(box.value);
  });

  const produceInterests = Array.isArray(fields.produceInterests) ? fields.produceInterests : [];
  form.querySelectorAll('input[name="produceInterests"]').forEach(box => {
    box.checked = produceInterests.includes(box.value);
  });

  ["pilotInterest", "callback", "launchUpdates", "marketingConsent", "consent"].forEach(name => {
    if (form.elements[name]) form.elements[name].checked = Boolean(fields[name]);
  });

  state.selected = new Map(
    (Array.isArray(draft.products) ? draft.products : []).map(item => [item.productId, item])
  );

  state.category = draft.category || "All";
  state.search = draft.search || "";
  state.productPage = Number(draft.productPage || 0);
  state.locationConfirmed = Boolean(draft.locationConfirmed);

  if ($("productSearch")) $("productSearch").value = state.search;
  if ($("adultsValue")) $("adultsValue").textContent = fields.adults || "2";
  if ($("childrenValue")) $("childrenValue").textContent = fields.children || "0";
  if ($("priorityCount")) $("priorityCount").textContent = `${priorities.length} of 3`;

  const latitude = Number(fields.latitude);
  const longitude = Number(fields.longitude);

  if (state.map && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    state.marker.setLatLng([latitude, longitude]);
    state.map.setView([latitude, longitude], 15);
    $("selectedLocationText").textContent =
      fields.locationName || fields.locationAddress || "Selected location";
    $("selectedCoordinates").textContent =
      `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  }

  renderTabs(state.productCategories);
  renderProducts();
  updateSummary();
  showStep(Math.min(Number(draft.currentStep || 0), TOTAL_STEPS - 1));
  state.lastSavedJson = JSON.stringify(draft);
  setSaveStatus("Saved");
}

async function clearDraft(notifyServer = false) {
  localStorage.removeItem(DRAFT_STORAGE_KEY);
  state.lastSavedJson = "";
  state.pendingResume = null;

  if (notifyServer) {
    try {
      await apiPost({
        action: "deleteDraft",
        draftToken: state.draftToken
      });
    } catch (error) {
      console.warn("Draft cleanup skipped.", error);
    }
  }
}

async function apiPost(payload) {
  const body = new URLSearchParams();
  body.set("payload", JSON.stringify(payload));

  const response = await fetch(CONFIG.API_URL, {
    method: "POST",
    body
  });

  return response.json();
}

/* v2 journey overrides */

function bindJourney() {
  $("nextBtn").onclick = () => {
    if (!validateStep(state.step)) return;
    showStep(Math.min(state.step + 1, TOTAL_STEPS - 1));
    scheduleDraftSave();
  };

  $("backBtn").onclick = () => {
    showStep(Math.max(state.step - 1, 0));
    scheduleDraftSave();
  };

  document.querySelectorAll("[data-go]").forEach(button => {
    button.onclick = () => {
      const target = Number(button.dataset.go);
      if (target <= state.step || allPreviousStepsValid(target)) {
        showStep(target);
        scheduleDraftSave();
      }
    };
  });
}

function showStep(index) {
  state.step = index;

  document.querySelectorAll(".step-panel").forEach(panel => {
    panel.classList.toggle("active", Number(panel.dataset.step) === index);
  });

  document.querySelectorAll("#stepNav li").forEach((item, itemIndex) => {
    item.classList.toggle("active", itemIndex === index);
    item.classList.toggle("complete", itemIndex < index);
  });

  const percent = Math.round(((index + 1) / TOTAL_STEPS) * 100);

  $("progressNumber").textContent = index + 1;
  $("backBtn").classList.toggle("hidden", index === 0);
  $("nextBtn").classList.toggle("hidden", index === TOTAL_STEPS - 1);
  $("formMessage").textContent = "";

  if ($("journeyProgressLabel")) {
    $("journeyProgressLabel").textContent = `${percent}% complete`;
    $("journeyProgressBar").style.width = `${percent}%`;
  }

  if (index === 0 && state.map) {
    setTimeout(() => state.map.invalidateSize(), 80);
  }

  if (index === 5) renderHarvestProfile();
  if (index === 6) renderReview();

  document.querySelector(".journey-layout").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function renderTabs(categories) {
  state.productCategories = categories;
  const values = ["All", ...categories];

  $("categoryTabs").innerHTML = values.map(category =>
    `<button type="button"
      class="${category === state.category ? "active" : ""}"
      data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
  ).join("");

  $("categoryTabs").querySelectorAll("button").forEach(button => {
    button.onclick = () => {
      state.category = button.dataset.category;
      state.productPage = 0;
      renderTabs(categories);
      renderProducts();
      scheduleDraftSave();
    };
  });
}

function getFilteredProducts() {
  return state.products.filter(product => {
    const categoryMatch =
      state.category === "All" ||
      product.category === state.category;

    const haystack =
      `${product.name} ${product.tanglish} ${product.category}`.toLowerCase();

    return categoryMatch &&
      (!state.search || haystack.includes(state.search));
  });
}

function renderProducts() {
  const list = getFilteredProducts();
  const pageCount = Math.max(1, Math.ceil(list.length / state.productsPerPage));
  state.productPage = Math.min(Math.max(0, state.productPage), pageCount - 1);

  const start = state.productPage * state.productsPerPage;
  const pageItems = list.slice(start, start + state.productsPerPage);

  $("catalogState").classList.toggle("hidden", list.length > 0);
  $("catalogState").textContent =
    state.products.length
      ? "No produce matches this search."
      : "Loading produce…";

  $("productList").innerHTML = pageItems.map(product => {
    const chosen = state.selected.get(product.id);

    return `<article class="product-row ${chosen ? "selected" : ""}" data-id="${escapeHtml(product.id)}">
      <div class="product-thumb">
        ${product.imageUrl
          ? `<img src="${escapeAttribute(product.imageUrl)}" alt="${escapeAttribute(product.name)}" loading="lazy" onerror="this.outerHTML='<div class=&quot;fallback&quot;>MFB</div>'">`
          : '<div class="fallback">MFB</div>'}
      </div>

      <div class="product-copy">
        <b>${escapeHtml(product.name)}</b>
        <small>${escapeHtml(product.tanglish || product.category)}</small>
      </div>

      <div class="product-toggle">${chosen ? "✓" : "+"}</div>

      <select aria-label="${escapeAttribute(product.name)} quantity">
        ${(product.quantities || []).map(option =>
          `<option
            value="${escapeAttribute(option.label)}"
            data-kg="${Number(option.estimatedKg || 0)}"
            ${chosen && chosen.weeklyQuantity === option.label ? "selected" : ""}
          >${escapeHtml(option.label)}</option>`
        ).join("")}
      </select>
    </article>`;
  }).join("");

  $("productList").querySelectorAll(".product-row").forEach(row => {
    row.onclick = event => {
      if (event.target.tagName === "SELECT") return;
      toggleProduct(row.dataset.id);
    };

    row.querySelector("select").onchange = event =>
      updateQuantity(row.dataset.id, event.target);
  });

  const visibleStart = list.length ? start + 1 : 0;
  const visibleEnd = Math.min(start + state.productsPerPage, list.length);
  const percent = list.length ? Math.round((visibleEnd / list.length) * 100) : 0;

  if ($("catalogRange")) {
    $("catalogRange").textContent =
      list.length ? `Viewing ${visibleStart}–${visibleEnd} of ${list.length}` : "No products found";
    $("catalogPageLabel").textContent = list.length ? `Page ${state.productPage + 1} of ${pageCount}` : "";
    $("catalogProgressBar").style.width = `${percent}%`;
  }

  $("productPrevBtn").disabled = state.productPage === 0;
  $("productNextBtn").disabled = state.productPage >= pageCount - 1 || list.length === 0;

  $("productPageDots").innerHTML = Array.from({ length: pageCount }, (_, index) =>
    `<button type="button" class="${index === state.productPage ? "active" : ""}" data-page="${index}" aria-label="Go to product page ${index + 1}"></button>`
  ).join("");

  $("productPageDots").querySelectorAll("button").forEach(button => {
    button.onclick = () => {
      state.productPage = Number(button.dataset.page);
      renderProducts();
      scheduleDraftSave();
    };
  });
}

function bindProductControls() {
  $("productSearch").oninput = event => {
    state.search = event.target.value.trim().toLowerCase();
    state.productPage = 0;
    renderProducts();
    scheduleDraftSave();
  };

  $("clearSelection").onclick = () => {
    state.selected.clear();
    renderProducts();
    updateSummary();
    scheduleDraftSave();
  };
}

function toggleProduct(id) {
  const product = state.products.find(item => item.id === id);
  if (!product) return;

  if (state.selected.has(id)) {
    state.selected.delete(id);
  } else {
    const quantity = product.quantities[0];
    state.selected.set(id, {
      productId: product.id,
      productName: product.name,
      category: product.category,
      weeklyQuantity: quantity.label,
      estimatedKg: Number(quantity.estimatedKg || 0),
      expectedPrice: ""
    });
  }

  renderProducts();
  updateSummary();
  scheduleDraftSave();
}

function updateQuantity(id, select) {
  let item = state.selected.get(id);

  if (!item) {
    const product = state.products.find(productItem => productItem.id === id);
    if (!product) return;

    item = {
      productId: product.id,
      productName: product.name,
      category: product.category,
      expectedPrice: ""
    };
  }

  const option = select.options[select.selectedIndex];
  item.weeklyQuantity = option.value;
  item.estimatedKg = Number(option.dataset.kg || 0);
  state.selected.set(id, item);

  renderProducts();
  updateSummary();
  scheduleDraftSave();
}

function updateSummary() {
  const items = [...state.selected.values()];
  const totalKg = items.reduce(
    (sum, item) => sum + Number(item.estimatedKg || 0),
    0
  );

  $("selectedCount").textContent = `${items.length} selected`;
  $("estimatedKg").textContent = `${formatNumber(totalKg)} kg per week`;
}

function renderHarvestProfile() {
  const data = new FormData(form);
  const adults = Number(data.get("adults") || 0);
  const children = Number(data.get("children") || 0);
  const totalKg = [...state.selected.values()].reduce(
    (sum, item) => sum + Number(item.estimatedKg || 0),
    0
  );

  const household = `${adults} adult${adults === 1 ? "" : "s"} · ${children} child${children === 1 ? "" : "ren"}`;
  const profileTitle =
    state.selected.size >= 15
      ? "A varied family harvest"
      : state.selected.size >= 8
        ? "A balanced weekly harvest"
        : "A focused fresh-produce harvest";

  $("profileTitle").textContent = profileTitle;

  const cards = [
    ["Family", household, `${adults + children} household member${adults + children === 1 ? "" : "s"}`],
    ["Cooking", data.get("cookingFrequency") || "Not selected", "Your household kitchen rhythm"],
    ["Produce", `${state.selected.size} items selected`, `${formatNumber(totalKg)} kg indicative weekly quantity`],
    ["Budget", data.get("weeklyBudget") || "Not selected", "Expected weekly produce spend"],
    ["Delivery", data.get("deliveryFrequency") || "Not selected", "Preferred harvest delivery rhythm"],
    ["Launch", data.get("pilotInterest") === "on" ? "Pilot interested" : "Launch updates", "September 2026 Singapore journey"]
  ];

  $("harvestProfileCard").innerHTML = cards.map(([label, value, note]) =>
    `<article class="profile-card">
      <span>${escapeHtml(label)}</span>
      <b>${escapeHtml(value)}</b>
      <small>${escapeHtml(note)}</small>
    </article>`
  ).join("");
}

function renderReview() {
  const data = new FormData(form);
  const productNames = [...state.selected.values()]
    .slice(0, 4)
    .map(item => item.productName)
    .join(", ");

  const extra =
    state.selected.size > 4 ? ` +${state.selected.size - 4} more` : "";

  $("reviewCard").innerHTML = `
    ${reviewRow("Name", data.get("name") || "—")}
    ${reviewRow("Location", data.get("locationName") || "—")}
    ${reviewRow("Family", `${data.get("adults")} adult(s), ${data.get("children")} child(ren)`)}
    ${reviewRow("Cooking", data.get("cookingFrequency") || "—")}
    ${reviewRow("Delivery", data.get("deliveryFrequency") || "—")}
    ${reviewRow("Produce", `${productNames}${extra}` || "—")}
    ${reviewRow("Weekly budget", data.get("weeklyBudget") || "—")}
  `;
}

async function submitForm(event) {
  event.preventDefault();
  setMessage("");

  if (!allPreviousStepsValid(TOTAL_STEPS - 1) || !form.reportValidity()) {
    setMessage("Please review the incomplete section.");
    return;
  }

  const button = $("submitBtn");
  const data = new FormData(form);
  const params = new URLSearchParams(location.search);

  const payload = {
    action: "joinWaitlist",
    draftToken: state.draftToken,
    name: data.get("name"),
    phone: data.get("phone"),
    email: data.get("email"),
    postalCode: data.get("postalCode"),
    locationName: data.get("locationName"),
    locationAddress: data.get("locationAddress"),
    locationArea: data.get("locationArea"),
    latitude: data.get("latitude"),
    longitude: data.get("longitude"),
    mapLink: data.get("mapLink"),
    adults: data.get("adults"),
    children: data.get("children"),
    cookingFrequency: data.get("cookingFrequency"),
    deliveryFrequency: data.get("deliveryFrequency"),
    weeklyBudget: data.get("weeklyBudget"),
    priorities: data.getAll("priorities"),
    pilotInterest: data.get("pilotInterest") === "on",
    callback: data.get("callback") === "on",
    launchUpdates: data.get("launchUpdates") === "on",
    consent: data.get("consent") === "on",
    marketingConsent: data.get("marketingConsent") === "on",
    notes: data.get("notes"),
    website: data.get("website"),
    source: params.get("utm_source") || "Singapore Website",
    campaign: params.get("utm_campaign") || "SG Founding Harvest September 2026",
    products: [...state.selected.values()]
  };

  button.disabled = true;
  button.textContent = "Joining…";

  try {
    const result = await apiPost(payload);
    if (!result.ok) throw new Error(result.message || "Unable to submit.");

    $("waitlistId").textContent = result.waitlistId;
    $("successDialog").showModal();

    await clearDraft(false);
    localStorage.removeItem(DRAFT_TOKEN_KEY);

    form.reset();
    form.elements.adults.value = "2";
    form.elements.children.value = "0";
    $("adultsValue").textContent = "2";
    $("childrenValue").textContent = "0";

    state.selected.clear();
    state.locationConfirmed = false;
    state.productPage = 0;
    state.category = "All";
    state.search = "";
    state.draftToken =
      crypto.randomUUID ? crypto.randomUUID() : `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DRAFT_TOKEN_KEY, state.draftToken);

    renderTabs(state.productCategories);
    renderProducts();
    updateSummary();
    showStep(0);
    setSaveStatus("Auto-save on");
  } catch (error) {
    setMessage(error.message || "Something went wrong. Please try again.");
    console.error(error);
  } finally {
    button.disabled = false;
    button.textContent = "Join the Founding Harvest";
  }
}
/* =========================================================
   v5.0 Simple signup + optional weekly product explorer
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  initialiseBudgetSlider();

  $("exploreProductsBtn").onclick = openProductExplorer;
  $("doneBtn").onclick = finishInitialJourney;
  $("closeExplorerBtn").onclick = () => $("productExplorerDialog").close();
  $("saveProductPreferencesBtn").onclick = saveProductPreferences;
  $("productSavedDoneBtn").onclick = () => {
    $("productSavedDialog").close();
    finishInitialJourney();
  };
});

function initialiseBudgetSlider() {
  const slider = $("weeklyBudget");
  const display = $("weeklyBudgetValue");
  if (!slider || !display) return;

  const update = () => {
    display.textContent = slider.value;
  };

  slider.addEventListener("input", () => {
    update();
    scheduleDraftSave();
  });
  slider.addEventListener("change", update);
  update();
}

function formatWeeklyBudget(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? `S$${amount} / week` : "Not selected";
}

function selectedProduceInterests(data = new FormData(form)) {
  return data.getAll("produceInterests");
}

function validateStep(index, showMessage = true) {
  const panel = document.querySelector(`.step-panel[data-step="${index}"]`);
  const requiredFields = [...panel.querySelectorAll("[required]")];

  for (const field of requiredFields) {
    if (field.type === "checkbox" && field.name === "produceInterests") continue;
    if (!field.checkValidity()) {
      if (showMessage) {
        field.reportValidity();
        setMessage("Please complete the highlighted field.");
      }
      return false;
    }
  }

  if (index === 0 && !state.locationConfirmed) {
    if (showMessage) setMessage("Please select and confirm your location on the map.");
    return false;
  }

  if (index === 2 && selectedProduceInterests().length === 0) {
    if (showMessage) setMessage("Please choose at least one produce group.");
    return false;
  }

  if (index === 3) {
    const selectedPriorities = form.querySelectorAll('input[name="priorities"]:checked').length;
    if (selectedPriorities === 0) {
      if (showMessage) setMessage("Please choose at least one priority.");
      return false;
    }
  }

  return true;
}

function renderHarvestProfile() {
  const data = new FormData(form);
  const adults = Number(data.get("adults") || 0);
  const children = Number(data.get("children") || 0);
  const interests = selectedProduceInterests(data);
  const household = `${adults} adult${adults === 1 ? "" : "s"} · ${children} child${children === 1 ? "" : "ren"}`;

  $("profileTitle").textContent =
    interests.length === 3
      ? "A complete family harvest"
      : interests.length === 2
        ? "A balanced family harvest"
        : "A focused weekly harvest";

  const cards = [
    ["Family", household, `${adults + children} household member${adults + children === 1 ? "" : "s"}`],
    ["Cooking", data.get("cookingFrequency") || "Not selected", "Your household kitchen rhythm"],
    ["Produce", interests.join(", ") || "Not selected", "Broad weekly produce interests"],
    ["Budget", formatWeeklyBudget(data.get("weeklyBudget")), "Expected weekly produce spend"],
    ["Delivery", data.get("deliveryFrequency") || "Not selected", "Preferred harvest delivery rhythm"],
    ["Launch", data.get("pilotInterest") === "on" ? "Pilot interested" : "Launch updates", "September 2026 Singapore journey"]
  ];

  $("harvestProfileCard").innerHTML = cards.map(([label, value, note]) =>
    `<article class="profile-card"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b><small>${escapeHtml(note)}</small></article>`
  ).join("");
}

function renderReview() {
  const data = new FormData(form);
  const interests = selectedProduceInterests(data);

  $("reviewCard").innerHTML = `
    ${reviewRow("Name", data.get("name") || "—")}
    ${reviewRow("Location", data.get("locationName") || "—")}
    ${reviewRow("Family", `${data.get("adults")} adult(s), ${data.get("children")} child(ren)`)}
    ${reviewRow("Cooking", data.get("cookingFrequency") || "—")}
    ${reviewRow("Delivery", data.get("deliveryFrequency") || "—")}
    ${reviewRow("Produce interests", interests.join(", ") || "—")}
    ${reviewRow("Weekly budget", formatWeeklyBudget(data.get("weeklyBudget")))}
  `;
}

async function submitForm(event) {
  event.preventDefault();
  setMessage("");

  if (!allPreviousStepsValid(TOTAL_STEPS - 1) || !form.reportValidity()) {
    setMessage("Please review the incomplete section.");
    return;
  }

  const button = $("submitBtn");
  const data = new FormData(form);
  const params = new URLSearchParams(location.search);

  const payload = {
    action: "joinWaitlist",
    draftToken: state.draftToken,
    name: data.get("name"),
    phone: data.get("phone"),
    email: data.get("email"),
    postalCode: data.get("postalCode"),
    locationName: data.get("locationName"),
    locationAddress: data.get("locationAddress"),
    locationArea: data.get("locationArea"),
    latitude: data.get("latitude"),
    longitude: data.get("longitude"),
    mapLink: data.get("mapLink"),
    adults: data.get("adults"),
    children: data.get("children"),
    cookingFrequency: data.get("cookingFrequency"),
    deliveryFrequency: data.get("deliveryFrequency"),
    weeklyBudget: Number(data.get("weeklyBudget") || 65),
    produceInterests: selectedProduceInterests(data),
    priorities: data.getAll("priorities"),
    pilotInterest: data.get("pilotInterest") === "on",
    callback: data.get("callback") === "on",
    launchUpdates: data.get("launchUpdates") === "on",
    consent: data.get("consent") === "on",
    marketingConsent: data.get("marketingConsent") === "on",
    notes: data.get("notes"),
    website: data.get("website"),
    source: params.get("utm_source") || "Singapore Website",
    campaign: params.get("utm_campaign") || "SG Founding Harvest September 2026",
    products: []
  };

  button.disabled = true;
  button.textContent = "Joining…";

  try {
    const result = await apiPost(payload);
    if (!result.ok) throw new Error(result.message || "Unable to submit.");

    state.currentWaitlistId = result.waitlistId;
    state.currentPreferenceToken = result.preferenceToken || "";
    $("waitlistId").textContent = result.waitlistId;
    await clearDraft(false);
    localStorage.removeItem(DRAFT_TOKEN_KEY);
    $("successDialog").showModal();
  } catch (error) {
    setMessage(error.message || "Something went wrong. Please try again.");
    console.error(error);
  } finally {
    button.disabled = false;
    button.textContent = "Join the Founding Harvest";
  }
}

function openProductExplorer() {
  $("successDialog").close();
  state.selected.clear();
  state.productPage = 0;
  state.category = "All";
  state.search = "";
  $("productSearch").value = "";
  renderTabs(state.productCategories);
  renderProducts();
  updateSummary();
  $("explorerMessage").textContent = "";
  $("productExplorerDialog").showModal();
}

async function saveProductPreferences() {
  const button = $("saveProductPreferencesBtn");
  const message = $("explorerMessage");
  message.textContent = "";

  if (!state.currentWaitlistId) {
    message.textContent = "Your waitlist reference is missing. Please submit the main form again.";
    return;
  }

  if (state.selected.size === 0) {
    message.textContent = "Please select at least one product and weekly quantity.";
    return;
  }

  button.disabled = true;
  button.textContent = "Saving…";

  try {
    const result = await apiPost({
      action: "saveProductPreferences",
      waitlistId: state.currentWaitlistId,
      preferenceToken: state.currentPreferenceToken || "",
      products: [...state.selected.values()]
    });

    if (!result.ok) throw new Error(result.message || "Unable to save product preferences.");

    $("productExplorerDialog").close();
    $("productSavedDialog").showModal();
  } catch (error) {
    message.textContent = error.message || "Unable to save. Please try again.";
  } finally {
    button.disabled = false;
    button.textContent = "Save Weekly Preferences";
  }
}

function finishInitialJourney() {
  if ($("successDialog").open) $("successDialog").close();

  form.reset();
  form.elements.adults.value = "2";
  form.elements.children.value = "0";
  form.elements.weeklyBudget.value = "65";
  $("adultsValue").textContent = "2";
  $("childrenValue").textContent = "0";
  $("weeklyBudgetValue").textContent = "65";

  state.selected.clear();
  state.locationConfirmed = false;
  state.productPage = 0;
  state.category = "All";
  state.search = "";
  state.currentWaitlistId = "";
  state.currentPreferenceToken = "";
  state.draftToken = crypto.randomUUID
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(DRAFT_TOKEN_KEY, state.draftToken);

  renderTabs(state.productCategories);
  renderProducts();
  updateSummary();
  showStep(0);
  setSaveStatus("Auto-save on");
}

function renderTabs(categories) {
  state.productCategories = categories;
  const values = ["All", ...categories];
  const labels = {
    All: "All",
    Veggie: "Everyday Essentials",
    Fruits: "Seasonal",
    Greens: "Greens"
  };

  $("categoryTabs").innerHTML = values.map(category =>
    `<button type="button" class="${category === state.category ? "active" : ""}" data-category="${escapeHtml(category)}">${escapeHtml(labels[category] || category)}</button>`
  ).join("");

  $("categoryTabs").querySelectorAll("button").forEach(button => {
    button.onclick = () => {
      state.category = button.dataset.category;
      state.productPage = 0;
      renderTabs(categories);
      renderProducts();
      scheduleDraftSave();
    };
  });
}

/* =========================================================
   v5.7 Apple Watch-inspired Harvest Cloud
   This final override replaces the paginated product list.
   ========================================================= */
const HARVEST_CLOUD_SLOTS = [
  [50,18,"large"],[27,24,"small"],[73,25,"small"],
  [14,44,"small"],[38,43,"large"],[63,44,"large"],[86,45,"small"],
  [25,67,"small"],[50,68,"large"],[75,67,"small"],
  [12,82,"small"],[88,82,"small"]
];

const SHORT_PRODUCT_NAMES = {
  "ladies finger":"Okra","lady finger":"Okra","country tomato":"Tomato",
  "indian tomato":"Tomato","cherry tomato":"Cherry Tomato","red onion":"Onion",
  "small onion":"Shallots","big onion":"Onion","drumstick leaves":"Moringa",
  "murungai keerai":"Moringa","ponnanganni keerai":"Ponnanganni",
  "pasalai keerai":"Spinach","arai keerai":"Amaranth","sirukeerai":"Amaranth",
  "coriander leaves":"Coriander","curry leaves":"Curry Leaf",
  "cluster beans":"Cluster Beans","french beans":"Beans","broad beans":"Beans",
  "ridge gourd":"Ridge Gourd","bottle gourd":"Bottle Gourd","snake gourd":"Snake Gourd",
  "bitter gourd":"Bitter Gourd","ash gourd":"Ash Gourd","green chilli":"Chilli",
  "raw banana":"Plantain","elephant yam":"Yam","sweet potato":"Sweet Potato"
};

state.activeCloudProduct = "";
state.pendingCloudQuantity = "";
state.cloudOffset = 0;

function shortProductName(product) {
  const full = String(product.name || "Produce").trim();
  const key = full.toLowerCase();
  if (SHORT_PRODUCT_NAMES[key]) return SHORT_PRODUCT_NAMES[key];
  const cleaned = full
    .replace(/\b(fresh|organic|natural|indian|local|premium|green|red|white)\b/gi, "")
    .replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ");
  return words.length > 2 ? words.slice(0, 2).join(" ") : cleaned;
}

function getFilteredProducts() {
  return state.products.filter(product => {
    const categoryMatch = state.category === "All" || product.category === state.category;
    const haystack = `${product.name} ${product.tanglish} ${product.category}`.toLowerCase();
    return categoryMatch && (!state.search || haystack.includes(state.search));
  });
}

function visibleCloudProducts() {
  const available = getFilteredProducts().filter(product => !state.selected.has(product.id));
  if (!available.length) return [];
  const count = Math.min(HARVEST_CLOUD_SLOTS.length, available.length);
  const offset = state.cloudOffset % available.length;
  return Array.from({length: count}, (_, index) => available[(offset + index) % available.length]);
}

function renderProducts() {
  const filtered = getFilteredProducts();
  const visible = visibleCloudProducts();
  const cloud = $("harvestCloud");
  const list = $("productList");
  if (!list || !cloud) return;

  $("catalogState").classList.toggle("hidden", visible.length > 0);
  $("catalogState").textContent = state.products.length
    ? "Every matching product is already in your basket."
    : "Loading produce…";

  list.innerHTML = visible.map((product, index) => {
    const slot = HARVEST_CLOUD_SLOTS[index];
    const active = state.activeCloudProduct === product.id;
    return `<button type="button" class="cloud-product ${slot[2]} ${active ? "active" : ""}"
      data-id="${escapeAttribute(product.id)}"
      style="--x:${slot[0]}%;--y:${slot[1]}%;--delay:${-(index % 6) * .65}s"
      aria-label="Open ${escapeAttribute(product.name)}">
      ${product.imageUrl ? `<img src="${escapeAttribute(product.imageUrl)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
      <span class="cloud-name">${escapeHtml(shortProductName(product))}</span>
    </button>`;
  }).join("");

  cloud.classList.toggle("has-active", Boolean(state.activeCloudProduct));
  list.querySelectorAll(".cloud-product").forEach(button => {
    button.onclick = () => openCloudProduct(button.dataset.id);
  });

  $("catalogRange").textContent = filtered.length
    ? `${filtered.length - state.selected.size < 0 ? 0 : visible.length} fresh choices on screen`
    : "No products found";
  $("catalogPageLabel").textContent = `${state.selected.size} already in your basket`;
}

function openCloudProduct(id) {
  const product = state.products.find(item => item.id === id);
  if (!product) return;
  state.activeCloudProduct = id;
  state.pendingCloudQuantity = product.quantities?.[0]?.label || "1";
  renderProducts();
  renderProductFocus(product);
}

function closeCloudProduct() {
  state.activeCloudProduct = "";
  state.pendingCloudQuantity = "";
  $("productFocusCard").classList.add("hidden");
  renderProducts();
}

function renderProductFocus(product) {
  const card = $("productFocusCard");
  if (!card) return;
  const quantities = product.quantities || [];
  card.innerHTML = `<div class="focus-top">
    <div class="focus-image">${product.imageUrl ? `<img src="${escapeAttribute(product.imageUrl)}" alt="${escapeAttribute(product.name)}" onerror="this.outerHTML='MFB'">` : "MFB"}</div>
    <div class="focus-title"><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.tanglish || product.category || "Fresh produce")}</small></div>
    <button type="button" class="focus-close" aria-label="Close">✕</button>
  </div>
  <span class="focus-label">CHOOSE WEEKLY QUANTITY</span>
  <div class="focus-quantities">${quantities.map((option,index) => `<button type="button" class="focus-quantity ${index===0?"selected":""}" data-label="${escapeAttribute(option.label)}" data-kg="${Number(option.estimatedKg||0)}">${escapeHtml(option.label)}</button>`).join("")}</div>
  <button type="button" class="focus-add">Add to My Harvest</button>`;
  card.classList.remove("hidden");
  card.querySelector(".focus-close").onclick = closeCloudProduct;
  card.querySelectorAll(".focus-quantity").forEach(button => {
    button.onclick = () => {
      state.pendingCloudQuantity = button.dataset.label;
      card.querySelectorAll(".focus-quantity").forEach(item => item.classList.toggle("selected", item === button));
    };
  });
  card.querySelector(".focus-add").onclick = () => addFocusedProduct(product.id);
  card.scrollIntoView({behavior:"smooth",block:"nearest"});
}

function addFocusedProduct(id) {
  const product = state.products.find(item => item.id === id);
  if (!product) return;
  const option = (product.quantities || []).find(item => item.label === state.pendingCloudQuantity) || product.quantities?.[0] || {label:"1",estimatedKg:0};
  state.selected.set(id, {
    productId: product.id,
    productName: product.name,
    category: product.category,
    weeklyQuantity: option.label,
    estimatedKg: Number(option.estimatedKg || 0),
    expectedPrice: ""
  });

  const tile = document.querySelector(`.cloud-product[data-id="${CSS.escape(id)}"]`);
  if (tile) tile.classList.add("harvested");
  state.activeCloudProduct = "";
  state.pendingCloudQuantity = "";
  state.cloudOffset += 1;
  $("productFocusCard").classList.add("hidden");
  updateSummary();
  scheduleDraftSave();
  bumpBasket();
  setTimeout(renderProducts, 430);
}

function updateSummary() {
  const items = [...state.selected.values()];
  const totalKg = items.reduce((sum,item) => sum + Number(item.estimatedKg || 0),0);
  $("selectedCount").textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
  $("estimatedKg").textContent = items.length ? `${formatNumber(totalKg)} kg per week` : "Start your harvest";
  if ($("basketTotalKg")) $("basketTotalKg").textContent = `${formatNumber(totalKg)} kg`;
  renderBasketItems();
}

function renderBasketItems() {
  const holder = $("basketItems");
  if (!holder) return;
  const items = [...state.selected.values()];
  if (!items.length) {
    holder.innerHTML = '<div class="basket-empty">Your basket is waiting for its first harvest 🌿</div>';
    return;
  }
  holder.innerHTML = items.map(item => {
    const product = state.products.find(productItem => productItem.id === item.productId) || {};
    return `<article class="basket-item">
      <div class="basket-item-thumb">${product.imageUrl ? `<img src="${escapeAttribute(product.imageUrl)}" alt="" onerror="this.outerHTML='🌿'">` : "🌿"}</div>
      <div><b>${escapeHtml(shortProductName(product.name ? product : {name:item.productName}))}</b><small>${escapeHtml(item.weeklyQuantity)}</small></div>
      <button type="button" class="basket-remove" data-remove="${escapeAttribute(item.productId)}" aria-label="Remove ${escapeAttribute(item.productName)}">−</button>
    </article>`;
  }).join("");
  holder.querySelectorAll("[data-remove]").forEach(button => {
    button.onclick = () => {
      state.selected.delete(button.dataset.remove);
      state.cloudOffset += 1;
      updateSummary();
      renderProducts();
      scheduleDraftSave();
    };
  });
}

function bumpBasket() {
  const button = $("harvestBasketButton");
  if (!button) return;
  button.classList.remove("bump");
  void button.offsetWidth;
  button.classList.add("bump");
  setTimeout(() => button.classList.remove("bump"),550);
}

function toggleBasket(force) {
  const drawer = $("harvestBasketDrawer");
  const button = $("harvestBasketButton");
  const open = typeof force === "boolean" ? force : !drawer.classList.contains("open");
  drawer.classList.toggle("open",open);
  drawer.setAttribute("aria-hidden",String(!open));
  button.setAttribute("aria-expanded",String(open));
  if (open) renderBasketItems();
}

function bindProductControls() {
  $("productSearch").oninput = event => {
    state.search = event.target.value.trim().toLowerCase();
    state.cloudOffset = 0;
    closeCloudProduct();
    scheduleDraftSave();
  };
  $("clearSelection").onclick = () => {
    state.selected.clear();
    state.cloudOffset = 0;
    updateSummary();
    renderProducts();
    scheduleDraftSave();
  };
  $("harvestBasketButton").onclick = () => toggleBasket();
  $("closeBasketBtn").onclick = () => toggleBasket(false);
}

function renderTabs(categories) {
  state.productCategories = categories;
  const values = ["All", ...categories];
  const labels = {All:"All",Veggie:"Essentials",Fruits:"Seasonal",Greens:"Greens"};
  $("categoryTabs").innerHTML = values.map(category => `<button type="button" class="${category===state.category?"active":""}" data-category="${escapeAttribute(category)}">${escapeHtml(labels[category]||category)}</button>`).join("");
  $("categoryTabs").querySelectorAll("button").forEach(button => {
    button.onclick = () => {
      state.category = button.dataset.category;
      state.cloudOffset = 0;
      state.activeCloudProduct = "";
      $("productFocusCard").classList.add("hidden");
      renderTabs(categories);
      renderProducts();
      scheduleDraftSave();
    };
  });
}

function openProductExplorer() {
  $("successDialog").close();
  state.selected.clear();
  state.category = "All";
  state.search = "";
  state.cloudOffset = 0;
  state.activeCloudProduct = "";
  $("productSearch").value = "";
  $("productFocusCard").classList.add("hidden");
  toggleBasket(false);
  renderTabs(state.productCategories);
  renderProducts();
  updateSummary();
  $("explorerMessage").textContent = "";
  $("productExplorerDialog").showModal();
}


/* =========================================================
   v5.8 Guided Harvest List — final overrides
   ========================================================= */
state.skippedProducts = new Set();
state.notNeededProducts = new Set();
state.reviewedProducts = new Set();
state.listBatchSize = 6;

function productIconFallback(product) {
  const name = String(product.name || "").toLowerCase();
  if (/tomato/.test(name)) return "🍅";
  if (/onion|shallot/.test(name)) return "🧅";
  if (/potato|yam/.test(name)) return "🥔";
  if (/carrot/.test(name)) return "🥕";
  if (/brinjal|eggplant/.test(name)) return "🍆";
  if (/chilli|capsicum|pepper/.test(name)) return "🌶️";
  if (/mango/.test(name)) return "🥭";
  if (/banana|plantain/.test(name)) return "🍌";
  if (/coconut/.test(name)) return "🥥";
  if (/cucumber|gourd|okra|ladies finger/.test(name)) return "🥒";
  if (/beans|peas/.test(name)) return "🫛";
  if (/lemon|lime|orange/.test(name)) return "🍋";
  if (/apple/.test(name)) return "🍎";
  if (/watermelon/.test(name)) return "🍉";
  if (/pineapple/.test(name)) return "🍍";
  if (/garlic/.test(name)) return "🧄";
  if (/ginger/.test(name)) return "🫚";
  if (/spinach|keerai|leaf|coriander|mint|moringa|greens/.test(name)) return "🥬";
  return "🌿";
}

function getFilteredProducts() {
  return state.products.filter(product => {
    const categoryMatch = state.category === "All" || product.category === state.category;
    const haystack = `${product.name} ${product.tanglish} ${product.category}`.toLowerCase();
    return categoryMatch && (!state.search || haystack.includes(state.search));
  });
}

function getPendingProducts() {
  return getFilteredProducts().filter(product =>
    !state.selected.has(product.id) &&
    !state.skippedProducts.has(product.id) &&
    !state.notNeededProducts.has(product.id)
  );
}

function renderProducts() {
  const all = getFilteredProducts();
  const pending = getPendingProducts();
  const list = $("productList");
  if (!list) return;

  $("catalogState").classList.toggle("hidden", pending.length > 0 || all.length === 0);
  $("catalogState").textContent = state.products.length ? "No matching products left to review." : "Loading produce…";

  if (!pending.length && all.length) {
    list.innerHTML = `<div class="harvest-done-state"><span>🌿</span><h3>You’ve reviewed this harvest.</h3><p>Open your basket to check selected products, or choose another category.</p></div>`;
  } else {
    list.innerHTML = pending.slice(0, state.listBatchSize).map(product => {
      const quantities = product.quantities || [];
      return `<article class="harvest-list-item" data-id="${escapeAttribute(product.id)}">
        <div class="harvest-list-icon">
          ${product.imageUrl ? `<img src="${escapeAttribute(product.imageUrl)}" alt="${escapeAttribute(shortProductName(product))}" loading="lazy" onerror="this.outerHTML='<span>${productIconFallback(product)}</span>'">` : `<span>${productIconFallback(product)}</span>`}
        </div>
        <div class="harvest-list-copy">
          <b>${escapeHtml(shortProductName(product))}</b>
          <small>${escapeHtml(product.tanglish || product.category || "Fresh produce")}</small>
        </div>
        <div class="harvest-list-actions">
          <select aria-label="Weekly quantity for ${escapeAttribute(product.name)}">
            ${quantities.map(option => `<option value="${escapeAttribute(option.label)}" data-kg="${Number(option.estimatedKg || 0)}">${escapeHtml(option.label)}</option>`).join("")}
          </select>
          <button type="button" class="harvest-action add" data-action="add">Add</button>
          <button type="button" class="harvest-action later" data-action="later">Maybe Later</button>
          <button type="button" class="harvest-action no" data-action="no">Don’t Need</button>
        </div>
      </article>`;
    }).join("");

    list.querySelectorAll(".harvest-list-item").forEach(row => {
      row.querySelectorAll("[data-action]").forEach(button => {
        button.onclick = () => reviewProduct(row.dataset.id, button.dataset.action, row);
      });
    });
  }

  updateReviewStats();
}

function reviewProduct(id, action, row) {
  const product = state.products.find(item => item.id === id);
  if (!product) return;

  if (action === "add") {
    const select = row.querySelector("select");
    const option = select.options[select.selectedIndex];
    state.selected.set(id, {
      productId: product.id,
      productName: product.name,
      category: product.category,
      weeklyQuantity: option.value,
      estimatedKg: Number(option.dataset.kg || 0),
      expectedPrice: ""
    });
    state.skippedProducts.delete(id);
    state.notNeededProducts.delete(id);
    bumpBasket();
  } else if (action === "later") {
    state.skippedProducts.add(id);
    state.selected.delete(id);
    state.notNeededProducts.delete(id);
  } else {
    state.notNeededProducts.add(id);
    state.selected.delete(id);
    state.skippedProducts.delete(id);
  }

  state.reviewedProducts.add(id);
  row.classList.add("leaving");
  updateSummary();
  scheduleDraftSave();
  setTimeout(renderProducts, 320);
}

function updateReviewStats() {
  const total = getFilteredProducts().length;
  const reviewedInFilter = getFilteredProducts().filter(product =>
    state.selected.has(product.id) || state.skippedProducts.has(product.id) || state.notNeededProducts.has(product.id)
  ).length;
  const percent = total ? Math.round((reviewedInFilter / total) * 100) : 0;
  if ($("reviewedCount")) $("reviewedCount").textContent = `${reviewedInFilter} / ${total}`;
  if ($("selectedStat")) $("selectedStat").textContent = state.selected.size;
  if ($("skippedStat")) $("skippedStat").textContent = state.skippedProducts.size;
  if ($("notNeededStat")) $("notNeededStat").textContent = state.notNeededProducts.size;
  if ($("reviewProgressBar")) $("reviewProgressBar").style.width = `${percent}%`;
}

function updateSummary() {
  const items = [...state.selected.values()];
  const totalKg = items.reduce((sum,item) => sum + Number(item.estimatedKg || 0),0);
  $("selectedCount").textContent = `${items.length} selected`;
  $("estimatedKg").textContent = `${formatNumber(totalKg)} kg per week`;
  if ($("basketTotalKg")) $("basketTotalKg").textContent = `${formatNumber(totalKg)} kg`;
  renderBasketItems();
  updateReviewStats();
}

function renderBasketItems() {
  const holder = $("basketItems");
  if (!holder) return;
  const items = [...state.selected.values()];
  if (!items.length) {
    holder.innerHTML = '<div class="basket-empty">No products selected yet.</div>';
    return;
  }
  holder.innerHTML = items.map(item => {
    const product = state.products.find(productItem => productItem.id === item.productId) || {name:item.productName};
    return `<article class="basket-item">
      <div class="basket-item-thumb">${product.imageUrl ? `<img src="${escapeAttribute(product.imageUrl)}" alt="" onerror="this.outerHTML='${productIconFallback(product)}'">` : productIconFallback(product)}</div>
      <div><b>${escapeHtml(shortProductName(product))}</b><small>${escapeHtml(item.weeklyQuantity)}</small></div>
      <button type="button" class="basket-remove" data-remove="${escapeAttribute(item.productId)}" aria-label="Remove ${escapeAttribute(item.productName)}">−</button>
    </article>`;
  }).join("");
  holder.querySelectorAll("[data-remove]").forEach(button => {
    button.onclick = () => {
      const id = button.dataset.remove;
      state.selected.delete(id);
      state.reviewedProducts.delete(id);
      updateSummary();
      renderProducts();
      scheduleDraftSave();
    };
  });
}

function bindProductControls() {
  $("productSearch").oninput = event => {
    state.search = event.target.value.trim().toLowerCase();
    renderProducts();
    scheduleDraftSave();
  };
  $("clearSelection").onclick = () => {
    state.selected.clear();
    updateSummary();
    renderProducts();
    scheduleDraftSave();
  };
  $("harvestBasketButton").onclick = () => toggleBasket();
  $("closeBasketBtn").onclick = () => toggleBasket(false);
}

function renderTabs(categories) {
  state.productCategories = categories;
  const values = ["All", ...categories];
  const labels = {All:"All",Veggie:"Essentials",Fruits:"Seasonal",Greens:"Greens"};
  $("categoryTabs").innerHTML = values.map(category => `<button type="button" class="${category===state.category?"active":""}" data-category="${escapeAttribute(category)}">${escapeHtml(labels[category]||category)}</button>`).join("");
  $("categoryTabs").querySelectorAll("button").forEach(button => {
    button.onclick = () => {
      state.category = button.dataset.category;
      renderTabs(categories);
      renderProducts();
      scheduleDraftSave();
    };
  });
}

function openProductExplorer() {
  $("successDialog").close();
  state.selected.clear();
  state.skippedProducts.clear();
  state.notNeededProducts.clear();
  state.reviewedProducts.clear();
  state.category = "All";
  state.search = "";
  $("productSearch").value = "";
  toggleBasket(false);
  renderTabs(state.productCategories);
  renderProducts();
  updateSummary();
  $("explorerMessage").textContent = "";
  $("productExplorerDialog").showModal();
}

async function saveProductPreferences() {
  const button = $("saveProductPreferencesBtn");
  const message = $("explorerMessage");
  message.textContent = "";
  if (!state.currentWaitlistId) {
    message.textContent = "Your waitlist reference is missing. Please submit the main form again.";
    return;
  }
  if (state.selected.size === 0) {
    message.textContent = "Please add at least one product to your weekly harvest.";
    return;
  }
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const result = await apiPost({
      action: "saveProductPreferences",
      waitlistId: state.currentWaitlistId,
      preferenceToken: state.currentPreferenceToken || "",
      products: [...state.selected.values()],
      maybeLaterProducts: [...state.skippedProducts],
      notNeededProducts: [...state.notNeededProducts]
    });
    if (!result.ok) throw new Error(result.message || "Unable to save product preferences.");
    $("productExplorerDialog").close();
    $("productSavedDialog").showModal();
  } catch (error) {
    message.textContent = error.message || "Unable to save. Please try again.";
  } finally {
    button.disabled = false;
    button.textContent = "Save My Weekly Harvest";
  }
}

/* =========================================================
   v5.9 Premium Harvest Cards — final behaviour override
   ========================================================= */
const PRODUCT_ENGLISH_NAMES = {
  "inji":"Ginger","ginger":"Ginger",
  "urulaikizhangu":"Potato","urulai kizhangu":"Potato","potato":"Potato",
  "kathiri":"Brinjal","kathirikkai":"Brinjal","brinjal":"Brinjal","eggplant":"Brinjal",
  "thakkali":"Tomato","thakkali":"Tomato","tomato":"Tomato",
  "vengayam":"Onion","onion":"Onion","sambar vengayam":"Shallots","chinna vengayam":"Shallots",
  "vendakkai":"Okra","ladies finger":"Okra","lady finger":"Okra","okra":"Okra",
  "murungakkai":"Drumstick","drumstick":"Drumstick",
  "murungai keerai":"Moringa Leaves","moringa":"Moringa Leaves",
  "pachai milagai":"Green Chilli","milagai":"Chilli","green chilli":"Green Chilli",
  "poondu":"Garlic","garlic":"Garlic",
  "carrot":"Carrot","kerat":"Carrot",
  "beans":"Beans","french beans":"Beans","avarakkai":"Broad Beans","kothavarangai":"Cluster Beans",
  "vellarikai":"Cucumber","cucumber":"Cucumber",
  "muttai kos":"Cabbage","cabbage":"Cabbage",
  "cauliflower":"Cauliflower","cauli flower":"Cauliflower",
  "broccoli":"Broccoli",
  "beetroot":"Beetroot","beet root":"Beetroot",
  "radish":"Radish","mullangi":"Radish",
  "pudalanga":"Snake Gourd","snake gourd":"Snake Gourd",
  "peerkangai":"Ridge Gourd","ridge gourd":"Ridge Gourd",
  "suraikkai":"Bottle Gourd","bottle gourd":"Bottle Gourd",
  "pavakkai":"Bitter Gourd","bitter gourd":"Bitter Gourd",
  "poosanikai":"Ash Gourd","ash gourd":"Ash Gourd","pumpkin":"Pumpkin","parangikai":"Pumpkin",
  "kovakkai":"Ivy Gourd","ivy gourd":"Ivy Gourd",
  "vazhaikkai":"Plantain","raw banana":"Plantain","plantain":"Plantain",
  "senai kizhangu":"Elephant Yam","elephant yam":"Elephant Yam","yam":"Yam",
  "sakkaravalli kizhangu":"Sweet Potato","sweet potato":"Sweet Potato",
  "kothamalli":"Coriander","coriander":"Coriander",
  "karuveppilai":"Curry Leaves","curry leaves":"Curry Leaves",
  "pudina":"Mint","mint":"Mint",
  "pasalai keerai":"Spinach","spinach":"Spinach",
  "arai keerai":"Amaranth","sirukeerai":"Amaranth","mula keerai":"Amaranth",
  "ponnanganni keerai":"Ponnanganni","ponnanganni":"Ponnanganni",
  "agathi keerai":"Agathi Leaves","agathi":"Agathi Leaves",
  "manga":"Mango","mango":"Mango",
  "papali":"Papaya","papaya":"Papaya",
  "vazhaipazham":"Banana","banana":"Banana",
  "apple":"Apple","orange":"Orange","lemon":"Lemon","elumichai":"Lemon",
  "watermelon":"Watermelon","pineapple":"Pineapple","dragon fruit":"Dragon Fruit",
  "thengai":"Coconut","coconut":"Coconut"
};

function normaliseProductTerm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[–—-]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function premiumProductName(product) {
  const candidates = [product.tanglish, product.name];
  for (const candidate of candidates) {
    const term = normaliseProductTerm(candidate);
    if (!term) continue;
    if (PRODUCT_ENGLISH_NAMES[term]) return PRODUCT_ENGLISH_NAMES[term];
    const exactKey = Object.keys(PRODUCT_ENGLISH_NAMES).find(key => term === key || term.includes(key));
    if (exactKey) return PRODUCT_ENGLISH_NAMES[exactKey];
  }
  const fallback = String(product.tanglish || product.name || "Fresh Produce")
    .replace(/[–—-].*$/, "")
    .trim();
  return fallback.replace(/\b\w/g, letter => letter.toUpperCase());
}

function premiumSecondaryName(product) {
  const raw = String(product.tanglish || "").trim();
  const english = premiumProductName(product).toLowerCase();
  if (raw && raw.toLowerCase() !== english) return raw;
  const original = String(product.name || "").trim();
  return original && original.toLowerCase() !== english ? original : "Fresh produce";
}

function premiumCategoryName(category) {
  return ({Veggie:"Everyday Essentials",Fruits:"Seasonal Fruits",Greens:"Fresh Greens"})[category] || category || "Fresh Produce";
}

function renderProducts() {
  const all = getFilteredProducts();
  const pending = getPendingProducts();
  const list = $("productList");
  if (!list) return;

  $("catalogState").classList.toggle("hidden", pending.length > 0 || all.length === 0);
  $("catalogState").textContent = state.products.length
    ? "No matching products left to review."
    : "Loading produce…";

  if (!pending.length && all.length) {
    list.innerHTML = `<div class="harvest-done-state"><span>🌿</span><h3>You’ve reviewed this harvest.</h3><p>Open your basket to review selected products, or choose another category.</p></div>`;
  } else {
    list.innerHTML = pending.slice(0, state.listBatchSize).map(product => {
      const quantities = product.quantities || [];
      const displayName = premiumProductName(product);
      const secondaryName = premiumSecondaryName(product);
      return `<article class="harvest-list-item" data-id="${escapeAttribute(product.id)}">
        <div class="harvest-card-top">
          <div class="harvest-list-icon">
            ${product.imageUrl
              ? `<img src="${escapeAttribute(product.imageUrl)}" alt="${escapeAttribute(displayName)}" loading="lazy" onerror="this.outerHTML='<span>${productIconFallback(product)}</span>'">`
              : `<span>${productIconFallback(product)}</span>`}
          </div>
          <div class="harvest-list-copy">
            <b title="${escapeAttribute(displayName)}">${escapeHtml(displayName)}</b>
            <small title="${escapeAttribute(secondaryName)}">${escapeHtml(secondaryName)}</small>
            <span class="product-category-chip">${escapeHtml(premiumCategoryName(product.category))}</span>
          </div>
        </div>
        <span class="quantity-label">Weekly quantity</span>
        <div class="harvest-list-actions">
          <select aria-label="Weekly quantity for ${escapeAttribute(displayName)}">
            ${quantities.length
              ? quantities.map(option => `<option value="${escapeAttribute(option.label)}" data-kg="${Number(option.estimatedKg || 0)}">${escapeHtml(option.label)}</option>`).join("")
              : `<option value="1 unit" data-kg="0">1 unit</option>`}
          </select>
          <button type="button" class="harvest-action add" data-action="add">Add to Harvest</button>
          <button type="button" class="harvest-action later" data-action="later">Maybe Later</button>
          <button type="button" class="harvest-action no" data-action="no">Don’t Need</button>
        </div>
      </article>`;
    }).join("");

    list.querySelectorAll(".harvest-list-item").forEach(row => {
      row.querySelectorAll("[data-action]").forEach(button => {
        button.onclick = () => reviewProduct(row.dataset.id, button.dataset.action, row);
      });
    });
  }

  updateReviewStats();
}

function updateSummary() {
  const items = [...state.selected.values()];
  const totalKg = items.reduce((sum, item) => sum + Number(item.estimatedKg || 0), 0);
  $("selectedCount").textContent = `${items.length} product${items.length === 1 ? "" : "s"}`;
  $("estimatedKg").textContent = items.length ? `${formatNumber(totalKg)} kg per week` : "Your basket is empty";
  if ($("basketTotalKg")) $("basketTotalKg").textContent = `${formatNumber(totalKg)} kg`;
  renderBasketItems();
  updateReviewStats();
}

function renderBasketItems() {
  const holder = $("basketItems");
  if (!holder) return;
  const items = [...state.selected.values()];
  if (!items.length) {
    holder.innerHTML = '<div class="basket-empty">Your basket is ready for your first product.</div>';
    return;
  }
  holder.innerHTML = items.map(item => {
    const product = state.products.find(productItem => productItem.id === item.productId) || {name:item.productName};
    const displayName = premiumProductName(product);
    return `<article class="basket-item">
      <div class="basket-item-thumb">${product.imageUrl ? `<img src="${escapeAttribute(product.imageUrl)}" alt="${escapeAttribute(displayName)}" onerror="this.outerHTML='${productIconFallback(product)}'">` : productIconFallback(product)}</div>
      <div><b>${escapeHtml(displayName)}</b><small>${escapeHtml(item.weeklyQuantity)}</small></div>
      <button type="button" class="basket-remove" data-remove="${escapeAttribute(item.productId)}" aria-label="Remove ${escapeAttribute(displayName)}">−</button>
    </article>`;
  }).join("");
  holder.querySelectorAll("[data-remove]").forEach(button => {
    button.onclick = () => {
      const id = button.dataset.remove;
      state.selected.delete(id);
      state.reviewedProducts.delete(id);
      updateSummary();
      renderProducts();
      scheduleDraftSave();
    };
  });
}
