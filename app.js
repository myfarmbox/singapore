const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbyjQEITL5yb5URDIM3lYtjprZNy0YEpqmEuFNlidbjDdVNoQCuDvGsbau4WzMRUu4Oonw/exec",
  SINGAPORE_PHONE_DISPLAY: "+65 8575 6146",
  SINGAPORE_PHONE_KEY: "6585456146",
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
  reverseTimer: null
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
    html: '<div style="width:30px;height:30px;border-radius:50% 50% 50% 0;background:#173d34;transform:rotate(-45deg);border:3px solid white;box-shadow:0 4px 14px rgba(0,0,0,.28)"><div style="width:8px;height:8px;border-radius:50%;background:white;margin:8px"></div></div>',
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
