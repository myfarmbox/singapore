const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbyjQEITL5yb5URDIM3lYtjprZNy0YEpqmEuFNlidbjDdVNoQCuDvGsbau4WzMRUu4Oonw/exec",
  SINGAPORE_PHONE_DISPLAY: "+65 8575 6146",
  SINGAPORE_PHONE_KEY: "6585756146"
};

const state = {
  products: [],
  selected: new Map(),
  category: "All",
  search: ""
};

const $ = id => document.getElementById(id);
const form = $("waitlistForm");

document.addEventListener("DOMContentLoaded", () => {
  applyContactDetails();
  $("productSearch").oninput = event => {
    state.search = event.target.value.trim().toLowerCase();
    renderProducts();
  };
  $("clearSelection").onclick = () => {
    state.selected.clear();
    renderProducts();
    updateSummary();
  };
  $("doneBtn").onclick = () => $("successDialog").close();
  form.onsubmit = submitForm;
  loadProducts();
});

function applyContactDetails() {
  const waUrl = `https://wa.me/${CONFIG.SINGAPORE_PHONE_KEY}`;
  ["headerPhone", "heroWhatsApp", "contactPhone"].forEach(id => {
    const element = $(id);
    if (!element) return;
    element.href = waUrl;
  });

  $("headerPhone").textContent = CONFIG.SINGAPORE_PHONE_DISPLAY;
  $("contactPhone").textContent = CONFIG.SINGAPORE_PHONE_DISPLAY;
}

async function loadProducts() {
  try {
    const response = await fetch(`${CONFIG.API_URL}?action=products`);
    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.message || "Unable to load produce.");
    }

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
    `<button
      type="button"
      class="${category === state.category ? "active" : ""}"
      data-category="${escapeHtml(category)}"
    >${escapeHtml(category)}</button>`
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
      `${product.name} ${product.tanglish} ${product.category}`
        .toLowerCase();

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

    const select = row.querySelector("select");
    select.onchange = event =>
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

  $("selectedCount").textContent =
    `${items.length} selected`;

  $("estimatedKg").textContent =
    `${formatNumber(totalKg)} kg per week`;
}

async function submitForm(event) {
  event.preventDefault();

  $("formMessage").textContent = "";

  if (!form.reportValidity()) return;

  if (state.selected.size === 0) {
    $("formMessage").textContent =
      "Please select at least one product.";
    $("productList").scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
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
    notes: data.get("notes"),
    website: data.get("website"),
    source: params.get("utm_source") || "Singapore Website",
    campaign: params.get("utm_campaign") || "SG Founding Harvest",
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

    if (!result.ok) {
      throw new Error(result.message || "Unable to submit.");
    }

    $("waitlistId").textContent = result.waitlistId;
    $("successDialog").showModal();

    form.reset();
    state.selected.clear();
    renderProducts();
    updateSummary();
  } catch (error) {
    $("formMessage").textContent =
      error.message || "Something went wrong. Please try again.";
    console.error(error);
  } finally {
    button.disabled = false;
    button.textContent = "Join as a Founding Harvest Member";
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
