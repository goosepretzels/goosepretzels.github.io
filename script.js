const STORAGE_KEY = 'goosePretzelOrders';
const CART_KEY = 'goosePretzelCart';
const PRODUCTS_KEY = 'goosePretzelCatalog';
const EMAILJS_CONFIG_KEY = 'goosePretzelEmailJsConfig';
const supabaseConfig = window.GOOSE_SUPABASE_CONFIG || {};
const backend = window.supabase?.createClient && supabaseConfig.url && supabaseConfig.publishableKey
  ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.publishableKey)
  : null;

const defaultProducts = [
  { id: 'original', name: 'Original Hard Pretzel', price: 8, emoji: '🥨', description: 'Classic hard pretzel with savory seasoning.' },
  { id: 'crabby', name: 'Crabby Hard Pretzel', price: 9, emoji: '🦀', description: 'A bold crabby-seasoned hard pretzel with extra flavor.' }
];

let productsCache = [...defaultProducts];
let emailJsConfigCache = {};

function getProducts() {
  try {
    const stored = JSON.parse(localStorage.getItem(PRODUCTS_KEY) || 'null');
    return Array.isArray(stored) && stored.length ? stored : [...defaultProducts];
  } catch (error) {
    return [...defaultProducts];
  }
}

async function saveProducts(products) {
  if (backend) {
    const { error } = await backend.from('shared_settings').upsert({ key: 'products', value: products });
    if (error) throw error;
  } else {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
  }
  productsCache = products;
}

function getEmailJsConfig() {
  try {
    return JSON.parse(localStorage.getItem(EMAILJS_CONFIG_KEY) || '{}');
  } catch (error) {
    return {};
  }
}

async function saveEmailJsConfig(config) {
  if (backend) {
    const { error } = await backend.from('shared_settings').upsert({ key: 'emailjs', value: config });
    if (error) throw error;
  } else {
    localStorage.setItem(EMAILJS_CONFIG_KEY, JSON.stringify(config));
  }
  emailJsConfigCache = config;
}

async function loadSharedSettings() {
  if (!backend) {
    productsCache = getProducts();
    emailJsConfigCache = getEmailJsConfig();
    return;
  }

  const { data, error } = await backend.from('shared_settings').select('key, value');
  if (error) throw error;

  const settings = Object.fromEntries((data || []).map(setting => [setting.key, setting.value]));
  productsCache = Array.isArray(settings.products) && settings.products.length
    ? settings.products
    : [...defaultProducts];
  emailJsConfigCache = settings.emailjs || {};
}

async function migrateLocalDataToShared() {
  if (!backend) return;

  const { data: settings, error: settingsError } = await backend.from('shared_settings').select('key');
  if (settingsError) throw settingsError;
  const keys = new Set((settings || []).map(setting => setting.key));

  if (!keys.has('products')) {
    const { error } = await backend.from('shared_settings').insert({ key: 'products', value: getProducts() });
    if (error) throw error;
  }
  if (!keys.has('emailjs')) {
    const { error } = await backend.from('shared_settings').insert({ key: 'emailjs', value: getEmailJsConfig() });
    if (error) throw error;
  }

  const localOrders = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (localOrders.length) {
    const { data: existingOrders, error: ordersError } = await backend.from('orders').select('id');
    if (ordersError) throw ordersError;
    const existingOrderIds = new Set((existingOrders || []).map(order => order.id));
    const rows = localOrders.filter(order => !existingOrderIds.has(order.id)).map(order => ({
      id: order.id,
      customer_name: order.customerName,
      customer_email: order.customerEmail,
      phone: order.phone || '',
      notes: order.notes || '',
      items: order.items,
      total: order.total,
      created_at: order.createdAt,
      expires_at: order.expiresAt,
      status: order.status || 'pending',
      payment: order.payment || 'cash in person'
    }));
    if (rows.length) {
      const { error } = await backend.from('orders').insert(rows);
      if (error) throw error;
    }
  }

  await loadSharedSettings();
}

function getCart() {
  const raw = localStorage.getItem(CART_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function currency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value || 0));
}

function themeToggle() {
  const current = localStorage.getItem('theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  localStorage.setItem('theme', next);
  document.body.setAttribute('data-theme', next);
  const icon = document.querySelector('.toggle-icon');
  if (icon) icon.textContent = next === 'dark' ? '🌙' : '☀️';
}

function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.body.setAttribute('data-theme', saved);
  const icon = document.querySelector('.toggle-icon');
  if (icon) icon.textContent = saved === 'dark' ? '🌙' : '☀️';

  const toggle = document.querySelector('.theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', themeToggle);
  }
}

function addToCart(productId) {
  const cart = getCart();
  const existing = cart.find(item => item.id === productId);

  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ id: productId, quantity: 1 });
  }

  saveCart(cart);
  renderCart();
}

function adjustCartQuantity(productId, change) {
  const cart = getCart();
  const itemIndex = cart.findIndex(item => item.id === productId);

  if (itemIndex === -1) return;

  cart[itemIndex].quantity += change;

  if (cart[itemIndex].quantity <= 0) {
    cart.splice(itemIndex, 1);
  }

  saveCart(cart);
  renderCart();
}

function getCartSummary() {
  const cart = getCart();
  const products = productsCache;

  const items = cart.map(item => {
    const product = products.find(entry => entry.id === item.id);
    if (!product) return null;

    return {
      ...product,
      quantity: item.quantity,
      lineTotal: Number(product.price) * Number(item.quantity)
    };
  }).filter(Boolean);

  const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
  return { items, total };
}

function renderCart() {
  const container = document.getElementById('cartItems');
  const count = document.getElementById('cartCount');
  const total = document.getElementById('cartTotal');

  if (!container || !count || !total) return;

  const { items, total: totalValue } = getCartSummary();

  if (!items.length) {
    container.innerHTML = '<p class="empty-state">Your cart is empty. Add a few pretzels to get started.</p>';
    count.textContent = '0 items';
    total.textContent = '$0.00';
    return;
  }

  count.textContent = `${items.reduce((sum, item) => sum + item.quantity, 0)} items`;
  total.textContent = currency(totalValue);
  container.innerHTML = items.map(item => `
    <div class="cart-item">
      <div class="cart-item-info">
        <strong>${item.name}</strong>
        <div>${item.quantity} × ${currency(item.price)}</div>
      </div>

      <div class="cart-item-controls">
        <div class="quantity-box">
          <button class="qty-btn" type="button" data-change-qty="${item.id}" data-direction="-1" aria-label="Reduce ${item.name} quantity">−</button>
          <span>${item.quantity}</span>
          <button class="qty-btn" type="button" data-change-qty="${item.id}" data-direction="1" aria-label="Increase ${item.name} quantity">+</button>
        </div>
        <button class="remove-item-btn" type="button" data-remove-item="${item.id}" aria-label="Remove ${item.name} from order">Remove</button>
      </div>

      <div>${currency(item.lineTotal)}</div>
    </div>
  `).join('');

  container.querySelectorAll('[data-change-qty]').forEach(button => {
    button.addEventListener('click', () => {
      const productId = button.dataset.changeQty;
      const direction = Number(button.dataset.direction || 0);
      adjustCartQuantity(productId, direction);
    });
  });

  container.querySelectorAll('[data-remove-item]').forEach(button => {
    button.addEventListener('click', () => {
      adjustCartQuantity(button.dataset.removeItem, -9999);
    });
  });
}

function renderProductGrid() {
  const grid = document.getElementById('productGrid');
  if (!grid) return;

  const products = productsCache;

  if (!products.length) {
    grid.innerHTML = '<p class="empty-state">No menu items are currently available.</p>';
    return;
  }

  grid.innerHTML = products.map(product => `
    <article class="product-card">
      <div class="product-image" aria-hidden="true">${product.emoji || '🥨'}</div>
      <div class="product-body">
        <h3>${product.name}</h3>
        <p>${product.description || 'Seasoned hard pretzel.'}</p>
        <div class="product-meta">
          <span class="product-price">${currency(product.price)}</span>
          <span>Hard pretzel</span>
        </div>
        <button class="primary-btn" type="button" data-add-to-cart="${product.id}">Add to order</button>
      </div>
    </article>
  `).join('');

}

function createOrderFromCart(formData) {
  const { items, total } = getCartSummary();

  if (!items.length) {
    return null;
  }

  const order = {
    id: `GOOSE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 900 + 100)}`,
    customerName: formData.name,
    customerEmail: formData.email,
    phone: formData.phone || '',
    notes: formData.notes || '',
    items: items.map(item => ({ name: item.name, quantity: item.quantity, price: Number(item.price) })),
    total,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'pending',
    payment: 'cash in person'
  };

  return order;
}

async function sendOrderEmail(order) {
  const config = emailJsConfigCache;
  if (!config.serviceId || !config.templateId || !config.publicKey) {
    throw new Error('EmailJS settings have not been configured in shared storage.');
  }
  if (!window.emailjs) {
    throw new Error('EmailJS SDK could not be loaded.');
  }

  const emailBody = [
    'New Goose Pretzels order request',
    '',
    `Customer: ${order.customerName}`,
    `Email: ${order.customerEmail}`,
    `Phone: ${order.phone || 'Not provided'}`,
    `Order ID: ${order.id}`,
    `Order total: ${currency(order.total)}`,
    `Order expires: ${new Date(order.expiresAt).toLocaleDateString()}`,
    '',
    'Items:',
    ...order.items.map(item => `- ${item.name} x${item.quantity} @ ${currency(item.price)}`),
    '',
    `Notes: ${order.notes || 'None'}`,
    '',
    'Payment: cash in person',
    'Please confirm pickup and fulfillment details by email.'
  ].join('\n');

  return window.emailjs.send(config.serviceId, config.templateId, {
    customer_name: order.customerName,
    customer_email: order.customerEmail,
    phone: order.phone || 'Not provided',
    order_id: order.id,
    order_total: currency(order.total),
    order_expires: new Date(order.expiresAt).toLocaleDateString(),
    order_details: emailBody,
    notes: order.notes || 'None',
    payment: 'Cash in person'
  }, {
    publicKey: config.publicKey
  });
}

async function saveOrder(order) {
  if (backend) {
    const { error } = await backend.from('orders').insert({
      id: order.id,
      customer_name: order.customerName,
      customer_email: order.customerEmail,
      phone: order.phone,
      notes: order.notes,
      items: order.items,
      total: order.total,
      created_at: order.createdAt,
      expires_at: order.expiresAt,
      status: order.status,
      payment: order.payment
    });
    if (error) throw error;
    return;
  }

  const orders = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  orders.push(order);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}

function renderCheckoutPage() {
  const form = document.getElementById('checkoutForm');
  const summary = document.getElementById('checkoutSummary');
  if (!form || !summary) return;

  const { items, total } = getCartSummary();

  if (!items.length) {
    summary.innerHTML = '<p class="empty-state">Your cart is empty. Start with a few pretzels before checking out.</p>';
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    return;
  }

  summary.innerHTML = `
    <ul class="summary-list">
      ${items.map(item => `
        <li>
          <span>${item.name} × ${item.quantity}</span>
          <span>${currency(item.lineTotal)}</span>
        </li>
      `).join('')}
    </ul>
    <div class="summary-total">
      <span>Total</span>
      <span>${currency(total)}</span>
    </div>
  `;

  form.onsubmit = async event => {
    event.preventDefault();

    try {
      const formData = new FormData(form);
      const order = createOrderFromCart({
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        notes: formData.get('notes')
      });

      if (!order) {
        alert('Your cart is empty. Add an order before checking out.');
        return;
      }

      await saveOrder(order);
      localStorage.removeItem(CART_KEY);
      renderCheckoutPage();

      try {
        await sendOrderEmail(order);
        alert('Your order has been sent successfully. You can review it in the admin page when you return.');
      } catch (emailError) {
        console.error('Order email failed:', emailError);
        alert(`Your order was saved, but its email could not be sent. Please contact finn1212@gmail.com and include order ${order.id}.`);
      }
    } catch (error) {
      console.error('Order could not be saved:', error);
      alert('We could not save your order. Your cart is still saved; please try again in a moment.');
    }
  };
}

async function getOrders() {
  if (!backend) return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

  const { data, error } = await backend.from('orders').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(order => ({
    id: order.id,
    customerName: order.customer_name,
    customerEmail: order.customer_email,
    phone: order.phone,
    notes: order.notes,
    items: order.items,
    total: Number(order.total),
    createdAt: order.created_at,
    expiresAt: order.expires_at,
    status: order.status,
    payment: order.payment
  }));
}

function renderCatalogManager() {
  const catalogList = document.getElementById('catalogList');
  if (!catalogList) return;

  const products = productsCache;

  if (!products.length) {
    catalogList.innerHTML = '<p class="empty-state">No menu items yet. Add a new flavor above.</p>';
    return;
  }

  catalogList.innerHTML = products.map(product => `
    <div class="catalog-item" style="display:grid; gap:0.75rem; padding:0.9rem; border:1px solid var(--border); border-radius:12px; margin-bottom:0.75rem; background:var(--bg-soft);">
      <div class="field">
        <label>Product name</label>
        <input data-product-name="${product.id}" value="${product.name}" />
      </div>
      <div class="field">
        <label>Price</label>
        <input data-product-price="${product.id}" type="number" min="0" step="0.01" value="${Number(product.price).toFixed(2)}" />
      </div>
      <div class="field">
        <label>Description</label>
        <input data-product-description="${product.id}" value="${product.description || ''}" />
      </div>
      <div class="field">
        <label>Emoji</label>
        <input data-product-emoji="${product.id}" maxlength="2" value="${product.emoji || '🥨'}" />
      </div>
      <div class="inline-actions">
        <button class="action-btn" type="button" data-save-product="${product.id}">Save</button>
        <button class="delete-btn" type="button" data-delete-product="${product.id}">Delete</button>
      </div>
    </div>
  `).join('');

  catalogList.querySelectorAll('[data-save-product]').forEach(button => {
    button.addEventListener('click', async () => {
      const id = button.dataset.saveProduct;
      const nameInput = catalogList.querySelector(`[data-product-name="${id}"]`);
      const priceInput = catalogList.querySelector(`[data-product-price="${id}"]`);
      const descriptionInput = catalogList.querySelector(`[data-product-description="${id}"]`);
      const emojiInput = catalogList.querySelector(`[data-product-emoji="${id}"]`);

      if (!nameInput || !priceInput || !descriptionInput || !emojiInput) return;

      const products = productsCache;
      const target = products.find(product => product.id === id);
      if (!target) return;

      target.name = nameInput.value.trim() || target.name;
      target.price = Number(priceInput.value) || 0;
      target.description = descriptionInput.value.trim() || 'Seasoned hard pretzel.';
      target.emoji = emojiInput.value.trim() || '🥨';

      try {
        await saveProducts(products);
      } catch (error) {
        alert('Could not save the shared catalog. Check your connection and try again.');
        return;
      }
      renderProductGrid();
      renderCart();
      renderCheckoutPage();
      renderCatalogManager();
    });
  });

  catalogList.querySelectorAll('[data-delete-product]').forEach(button => {
    button.addEventListener('click', async () => {
      const id = button.dataset.deleteProduct;
      const products = productsCache.filter(product => product.id !== id);
      try {
        await saveProducts(products);
      } catch (error) {
        alert('Could not update the shared catalog. Check your connection and try again.');
        return;
      }
      renderProductGrid();
      renderCart();
      renderCheckoutPage();
      renderCatalogManager();
    });
  });
}

async function renderAdminPage() {
  const page = document.getElementById('adminPage');
  const loginBlock = document.getElementById('adminLogin');
  const ordersBlock = document.getElementById('ordersBlock');
  const ordersList = document.getElementById('ordersList');

  if (!page) return;

  if (!backend) {
    loginBlock.classList.remove('hidden');
    ordersBlock.classList.add('hidden');
    const error = document.getElementById('adminError');
    if (error) error.textContent = 'Shared storage is not configured yet. Follow the Supabase setup in README.md.';
    return;
  }

  const { data: { session } } = await backend.auth.getSession();
  const unlocked = Boolean(session);

  if (!unlocked) {
    loginBlock.classList.remove('hidden');
    ordersBlock.classList.add('hidden');
    return;
  }

  loginBlock.classList.add('hidden');
  ordersBlock.classList.remove('hidden');
  renderEmailJsSettings();
  renderCatalogManager();

  if (!ordersList) return;

  let orders;
  try {
    orders = await getOrders();
  } catch (error) {
    ordersList.innerHTML = '<tr><td colspan="8" class="empty-state">Could not load shared orders.</td></tr>';
    console.error('Could not load orders:', error);
    return;
  }

  if (!orders.length) {
    ordersList.innerHTML = '<tr><td colspan="8" class="empty-state">No orders yet.</td></tr>';
    return;
  }

  const rows = orders.map(order => {
    const expiresOn = new Date(order.expiresAt);
    const expired = Date.now() > expiresOn.getTime();
    const statusClass = expired ? 'status-expired' : 'status-pending';
    const statusText = expired ? 'Expired' : 'Open';
    const itemText = order.items.map(item => `${item.name} x${item.quantity}`).join(', ');

    return `
      <tr>
        <td>${order.id}</td>
        <td>${order.customerName}</td>
        <td>${order.customerEmail}</td>
        <td>${itemText}</td>
        <td>${currency(order.total)}</td>
        <td>${new Date(order.createdAt).toLocaleDateString()}</td>
        <td><span class="order-status ${statusClass}">${statusText}</span></td>
        <td><button class="delete-btn" type="button" data-delete-order="${order.id}">Fulfilled</button></td>
      </tr>
    `;
  }).join('');

  ordersList.innerHTML = rows;

  ordersList.querySelectorAll('[data-delete-order]').forEach(button => {
    button.addEventListener('click', async () => {
      const orderId = button.dataset.deleteOrder;
      const { error } = await backend.from('orders').delete().eq('id', orderId);
      if (error) {
        alert('Could not delete the shared order. Check your connection and try again.');
        return;
      }
      await renderAdminPage();
    });
  });
}

function renderEmailJsSettings() {
  const form = document.getElementById('emailSettingsForm');
  if (!form) return;

  const config = emailJsConfigCache;
  form.elements.serviceId.value = config.serviceId || '';
  form.elements.templateId.value = config.templateId || '';
  form.elements.publicKey.value = config.publicKey || '';
}

function initAdminPage() {
  const loginForm = document.getElementById('loginForm');
  if (!loginForm) return;

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const error = document.getElementById('adminError');
    if (!backend) {
      if (error) error.textContent = 'Shared storage is not configured yet. Follow the Supabase setup in README.md.';
      return;
    }

    const formData = new FormData(loginForm);
    const { error: authError } = await backend.auth.signInWithPassword({
      email: String(formData.get('email') || '').trim(),
      password: String(formData.get('password') || '')
    });
    if (authError) {
      if (error) error.textContent = 'Sign-in failed. Check the admin email and password.';
      return;
    }

    try {
      await migrateLocalDataToShared();
      await renderAdminPage();
    } catch (migrationError) {
      console.error('Shared data migration failed:', migrationError);
      if (error) error.textContent = 'Signed in, but existing local data could not be copied. Check Supabase setup and retry.';
    }
  });

  const logoutButton = document.getElementById('logoutButton');
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      if (backend) await backend.auth.signOut({ scope: 'local' });
      await renderAdminPage();
    });
  }

  const emailSettingsForm = document.getElementById('emailSettingsForm');
  if (emailSettingsForm) {
    emailSettingsForm.addEventListener('submit', async event => {
      event.preventDefault();
      const formData = new FormData(emailSettingsForm);
      try {
        await saveEmailJsConfig({
          serviceId: String(formData.get('serviceId') || '').trim(),
          templateId: String(formData.get('templateId') || '').trim(),
          publicKey: String(formData.get('publicKey') || '').trim()
        });
        const status = document.getElementById('emailSettingsStatus');
        if (status) status.textContent = 'EmailJS settings saved for all visitors.';
      } catch (error) {
        const status = document.getElementById('emailSettingsStatus');
        if (status) status.textContent = 'Could not save settings to shared storage.';
      }
    });
  }

  const productForm = document.getElementById('productForm');
  if (productForm) {
    productForm.addEventListener('submit', async event => {
      event.preventDefault();
      const formData = new FormData(productForm);
      const name = String(formData.get('name') || '').trim();
      const price = Number(formData.get('price'));
      const description = String(formData.get('description') || '').trim();
      const emoji = String(formData.get('emoji') || '').trim() || '🥨';

      if (!name || Number.isNaN(price)) {
        return;
      }

      const products = productsCache;
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString().slice(-5);

      products.push({
        id,
        name,
        price,
        description: description || 'Seasoned hard pretzel.',
        emoji
      });

      try {
        await saveProducts(products);
      } catch (error) {
        alert('Could not save the shared catalog. Check your connection and try again.');
        return;
      }
      productForm.reset();
      renderProductGrid();
      renderCart();
      renderCheckoutPage();
      renderCatalogManager();
    });
  }

  renderAdminPage();
}

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  try {
    await loadSharedSettings();
  } catch (error) {
    console.error('Could not load shared settings:', error);
  }

  renderProductGrid();
  renderCart();
  renderCheckoutPage();
  initAdminPage();

  document.addEventListener('click', event => {
    const productButton = event.target.closest('[data-add-to-cart]');
    if (productButton) {
      addToCart(productButton.dataset.addToCart);
    }
  });
});
