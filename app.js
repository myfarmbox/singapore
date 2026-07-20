const API_URL = "PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE";

const state = {
  step: 1,
  products: [],
  filtered: [],
  selected: new Map(),
  category: "All",
  search: ""
};

const $ = id => document.getElementById(id);
const form = $("waitlistForm");

document.addEventListener("DOMContentLoaded", () => {
  $("nextBtn").onclick = nextStep;
  $("backBtn").onclick = previousStep;
  $("productSearch").oninput = event => {
    state.search = event.target.value.trim().toLowerCase();
    renderProducts();
  };
  $("reviewSelection").onclick = openSelection;
  $("closeSelection").onclick = () => $("selectionDrawer").classList.add("hidden");
  $("doneBtn").onclick = () => $("successDialog").close();
  form.onsubmit = submitForm;
  loadProducts();
  updateStep();
});

async function loadProducts() {
  if (!API_URL || API_URL.includes("PASTE_YOUR")) {
    $("catalogState").textContent = "Add the Apps Script /exec URL in app.js to load products.";
    return;
  }

  try {
    const response = await fetch(`${API_URL}?action=products`);
    const result = await response.json();

    if (!result.ok) throw new Error(result.message || "Unable to load products.");

    state.products = result.products || [];
    renderTabs(result.categories || ["Veggie", "Fruits", "Greens"]);
    renderProducts();
  } catch (error) {
    $("catalogState").innerHTML =
      `Products could not be loaded. <button type="button" onclick="loadProducts()">Try again</button>`;
  }
}

function renderTabs(categories) {
  const values = ["All", ...categories];
  $("categoryTabs").innerHTML = values.map(category =>
    `<button type="button" class="${category === state.category ? "active" : ""}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
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
  state.filtered = state.products.filter(product => {
    const categoryMatch =
      state.category === "All" ||
      product.category === state.category;

    const haystack =
      `${product.name} ${product.tanglish} ${product.category}`
        .toLowerCase();

    return categoryMatch &&
      (!state.search || haystack.includes(state.search));
  });

  $("catalogState").classList.toggle("hidden", state.filtered.length > 0);
  $("catalogState").textContent =
    state.products.length
      ? "No produce matches this search."
      : "Loading fresh produce…";

  $("productGrid").innerHTML = state.filtered.map(product => {
    const item = state.selected.get(product.id);
    const quantities = product.quantities || [];

    return `<article class="product-card ${item ? "selected" : ""}" data-id="${escapeHtml(product.id)}">
      <div class="product-image">
        ${product.imageUrl
          ? `<img src="${escapeAttribute(product.imageUrl)}" alt="${escapeAttribute(product.name)}" loading="lazy" onerror="this.outerHTML='<div class=&quot;fallback&quot;>MFB</div>'">`
          : '<div class="fallback">MFB</div>'}
        <span class="product-check">✓</span>
      </div>
      <div class="product-info">
        <b>${escapeHtml(product.name)}</b>
        <small>${escapeHtml(product.tanglish || product.category)}</small>
        <select aria-label="${escapeAttribute(product.name)} quantity">
          ${quantities.map(option =>
            `<option value="${escapeAttribute(option.label)}" data-kg="${Number(option.estimatedKg || 0)}" ${item && item.weeklyQuantity === option.label ? "selected" : ""}>${escapeHtml(option.label)}</option>`
          ).join("")}
        </select>
      </div>
    </article>`;
  }).join("");

  $("productGrid").querySelectorAll(".product-card").forEach(card => {
    card.onclick = event => {
      if (event.target.tagName === "SELECT") return;
      toggleProduct(card.dataset.id);
    };

    const select = card.querySelector("select");
    select.onchange = event => updateQuantity(card.dataset.id, event.target);
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
  updateSelection();
}

function updateQuantity(id, select) {
  const item = state.selected.get(id);
  if (!item) return;

  const option = select.options[select.selectedIndex];
  item.weeklyQuantity = option.value;
  item.estimatedKg = Number(option.dataset.kg || 0);
  state.selected.set(id, item);
  updateSelection();
}

function updateSelection() {
  const items = [...state.selected.values()];
  const kg = items.reduce(
    (total, item) => total + Number(item.estimatedKg || 0),
    0
  );

  $("selectedCount").textContent =
    `${items.length} selected`;
  $("estimatedKg").textContent =
    `${formatNumber(kg)} kg per week`;

  $("selectedList").innerHTML = items.length
    ? items.map(item => `<div class="selected-row"><div><b>${escapeHtml(item.productName)}</b><small>${escapeHtml(item.category)}</small></div><span>${escapeHtml(item.weeklyQuantity)}</span></div>`).join("")
    : '<p>No products selected yet.</p>';
}

function openSelection() {
  updateSelection();
  $("selectionDrawer").classList.remove("hidden");
}

function nextStep() {
  if (!validateCurrentStep()) return;
  state.step = Math.min(4, state.step + 1);
  updateStep();
}

function previousStep() {
  state.step = Math.max(1, state.step - 1);
  updateStep();
}

function validateCurrentStep() {
  $("formMessage").textContent = "";

  if (state.step === 1) {
    const fields = [...document.querySelector('[data-step="1"]').querySelectorAll("[required]")];
    for (const field of fields) {
      if (!field.checkValidity()) {
        field.reportValidity();
        return false;
      }
    }
  }

  if (state.step === 2 && state.selected.size === 0) {
    $("formMessage").textContent =
      "Please select at least one product.";
    return false;
  }

  if (state.step === 3) {
    const budget = form.querySelector('[name="weeklyBudget"]:checked');
    if (!budget) {
      $("formMessage").textContent =
        "Please select an expected weekly budget.";
      return false;
    }
  }

  return true;
}

function updateStep() {
  document.querySelectorAll(".step").forEach(section => {
    section.classList.toggle(
      "active",
      Number(section.dataset.step) === state.step
    );
  });

  $("progress").style.width = `${state.step * 25}%`;
  $("backBtn").classList.toggle("hidden", state.step === 1);
  $("nextBtn").classList.toggle("hidden", state.step === 4);
  $("submitBtn").classList.toggle("hidden", state.step !== 4);
  $("formMessage").textContent = "";
  document.querySelector(".journey").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

async function submitForm(event) {
  event.preventDefault();

  if (!validateCurrentStep()) return;
  if (!form.reportValidity()) return;

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
    source: params.get("utm_source") || "Direct",
    campaign: params.get("utm_campaign") || "SG Founding Harvest",
    products: [...state.selected.values()]
  };

  button.disabled = true;
  button.textContent = "Joining…";
  $("formMessage").textContent = "";

  try {
    const body = new URLSearchParams();
    body.set("payload", JSON.stringify(payload));

    const response = await fetch(API_URL, {
      method: "POST",
      body: body
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.message || "Unable to submit.");
    }

    $("waitlistId").textContent = result.waitlistId;
    $("successDialog").showModal();

    form.reset();
    state.selected.clear();
    state.step = 1;
    renderProducts();
    updateSelection();
    updateStep();
  } catch (error) {
    $("formMessage").textContent =
      error.message || "Something went wrong. Please try again.";
  } finally {
    button.disabled = false;
    button.textContent = "Join the waitlist";
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
