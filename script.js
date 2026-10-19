const STORAGE_KEY = 'goosePretzelOrders';
const CART_KEY = 'goosePretzelCart';
const PRODUCTS_KEY = 'goosePretzelCatalog';
const EMAILJS_CONFIG_KEY = 'goosePretzelEmailJsConfig';
const supabaseConfig = window.GOOSE_SUPABASE_CONFIG || {};
const backend = window.supabase?.createClient && supabaseConfig.url && supabaseConfig.publishableKey
  ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.publishableKey)
  : null;

const defaultProducts = [
  { id: 'original', name: 'Original Hard Pretzel', sizes: [{ id: 'small', name: 'Small', price: 5 }, { id: 'large', name: 'Large', price: 8 }], emoji: '🥨', description: 'Classic hard pretzel with savory seasoning.' },
  { id: 'crabby', name: 'Crabby Hard Pretzel', sizes: [{ id: 'small', name: 'Small', price: 5 }, { id: 'large', name: 'Large', price: 8 }], emoji: '🦀', description: 'A bold crabby-seasoned hard pretzel with extra flavor.' }
];

function normalizeProduct(product) {
  const legacyLargePrice = product.id === 'original' || product.id === 'crabby'
    ? 8
    : Number(product.price || 8);
  const legacyPrices = product.prices && typeof product.prices === 'object'
    ? product.prices
    : { Small: Number(product.smallPrice ?? 5), Large: Number(product.largePrice ?? legacyLargePrice) };
  const sizes = Array.isArray(product.sizes)
    ? product.sizes
    : Object.entries(legacyPrices)
      .map(([name, price]) => ({ name: name.replace(/\b\w/g, letter => letter.toUpperCase()), price }))
      .sort((left, right) => {
        const order = { small: 0, large: 1 };
        return (order[left.name.toLowerCase()] ?? 2) - (order[right.name.toLowerCase()] ?? 2);
      });
  const seenSizeIds = new Set();

  const normalizedSizes = sizes.map(size => {
    const name = String(size.name || '').trim();
    const id = String(size.id || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return { id, name, price: Number(size.price) };
  }).filter(size => {
    if (!size.id || !size.name || !Number.isFinite(size.price) || size.price < 0 || seenSizeIds.has(size.id)) return false;
    seenSizeIds.add(size.id);
    return true;
  });

  return {
    ...product,
    sizes: normalizedSizes.length ? normalizedSizes : [{ id: 'small', name: 'Small', price: 5 }]
  };
}

async function imageFileToDataUrl(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Choose a valid image file.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');

  let imageSource;
  let objectUrl;
  try {
    try {
      imageSource = await createImageBitmap(file);
    } catch (error) {
      objectUrl = URL.createObjectURL(file);
      imageSource = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not decode this image. Try a self-contained SVG or PNG/JPEG.'));
        image.src = objectUrl;
      });
    }

    const scale = Math.min(1, 720 / Math.max(imageSource.width, imageSource.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(imageSource.width * scale));
    canvas.height = Math.max(1, Math.round(imageSource.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(imageSource, 0, 0, canvas.width, canvas.height);

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    const edgeColor = [0, 0, 0];
    let edgeAlpha = 0;
    for (let row = 0; row < canvas.height; row++) {
      for (let column = 0; column < canvas.width; column++) {
        if (column !== 0 && column !== canvas.width - 1 && row !== 0 && row !== canvas.height - 1) continue;
        const offset = (row * canvas.width + column) * 4;
        const alpha = pixels[offset + 3] / 255;
        edgeColor[0] += pixels[offset] * alpha;
        edgeColor[1] += pixels[offset + 1] * alpha;
        edgeColor[2] += pixels[offset + 2] * alpha;
        edgeAlpha += alpha;
      }
    }

    if (edgeAlpha) {
      edgeColor[0] = Math.round(edgeColor[0] / edgeAlpha);
      edgeColor[1] = Math.round(edgeColor[1] / edgeAlpha);
      edgeColor[2] = Math.round(edgeColor[2] / edgeAlpha);
    } else {
      const fallback = getComputedStyle(document.body).getPropertyValue('--panel-alt').trim();
      const match = fallback.match(/^#([\da-f]{6})$/i);
      const fallbackHex = match ? match[1] : 'f0e5d3';
      edgeColor[0] = parseInt(fallbackHex.slice(0, 2), 16);
      edgeColor[1] = parseInt(fallbackHex.slice(2, 4), 16);
      edgeColor[2] = parseInt(fallbackHex.slice(4, 6), 16);
    }

    const fadeWidth = Math.max(1, Math.round(Math.min(canvas.width, canvas.height) * 0.12));
    for (let row = 0; row < canvas.height; row++) {
      for (let column = 0; column < canvas.width; column++) {
        const offset = (row * canvas.width + column) * 4;
        const distance = Math.min(column, row, canvas.width - 1 - column, canvas.height - 1 - row);
        const progress = Math.min(1, distance / fadeWidth);
        const blend = progress * progress * (3 - 2 * progress);
        const alpha = pixels[offset + 3] / 255;
        for (let channel = 0; channel < 3; channel++) {
          const source = pixels[offset + channel] * alpha + edgeColor[channel] * (1 - alpha);
          pixels[offset + channel] = Math.round(edgeColor[channel] * (1 - blend) + source * blend);
        }
        pixels[offset + 3] = 255;
      }
    }
    context.putImageData(imageData, 0, 0);

    const edgeColorHex = `#${edgeColor.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), edgeColor: edgeColorHex };
  } finally {
    imageSource?.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function softenLegacyProductImages(container) {
  container.querySelectorAll('.product-image img').forEach(image => {
    const frame = image.closest('.product-image');
    if (!frame || frame.style.getPropertyValue('--product-image-edge') || image.dataset.edgeProcessing) return;

    const originalSource = image.src;
    image.dataset.edgeProcessing = 'true';
    fetch(originalSource)
      .then(response => {
        if (!response.ok) throw new Error('Could not load product image.');
        return response.blob();
      })
      .then(imageBlob => imageFileToDataUrl(imageBlob))
      .then(processedImage => {
        if (!image.isConnected || image.src !== originalSource) return;
        frame.style.setProperty('--product-image-edge', processedImage.edgeColor);
        frame.classList.add('has-product-image');
        image.src = processedImage.dataUrl;
      })
      .catch(() => {});
  });
}

function updateProductVisualFields(container) {
  const visualType = container.querySelector('[data-product-visual-type]')?.value;
  const emojiField = container.querySelector('[data-product-emoji-field]');
  const imageField = container.querySelector('[data-product-image-field]');
  if (emojiField) emojiField.hidden = visualType !== 'emoji';
  if (imageField) imageField.hidden = visualType !== 'image';
}

let productsCache = defaultProducts.map(normalizeProduct);
let emailJsConfigCache = {};

function getProducts() {
  try {
    const stored = JSON.parse(localStorage.getItem(PRODUCTS_KEY) || 'null');
    return Array.isArray(stored) && stored.length ? stored.map(normalizeProduct) : defaultProducts.map(normalizeProduct);
  } catch (error) {
    return defaultProducts.map(normalizeProduct);
  }
}

async function saveProducts(products) {
  const normalizedProducts = products.map(normalizeProduct);
  if (backend) {
    const { error } = await backend.from('shared_settings').upsert({ key: 'products', value: normalizedProducts });
    if (error) throw error;
  } else {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(normalizedProducts));
  }
  productsCache = normalizedProducts;
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
    ? settings.products.map(normalizeProduct)
    : defaultProducts.map(normalizeProduct);
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

function setCartPanelOpen(open) {
  const panel = document.getElementById('cartPanel');
  const toggle = document.getElementById('cartToggle');
  const drawer = document.getElementById('cartDrawer');
  if (!panel || !toggle || !drawer) return;

  panel.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  drawer.setAttribute('aria-hidden', String(!open));
  drawer.inert = !open;
}

function initCartPanel() {
  const toggle = document.getElementById('cartToggle');
  const close = document.getElementById('cartClose');
  if (!toggle || !close) return;

  const desktopLayout = window.matchMedia('(min-width: 1024px)');
  const syncCartLayout = () => setCartPanelOpen(desktopLayout.matches);
  syncCartLayout();
  desktopLayout.addEventListener('change', syncCartLayout);

  toggle.addEventListener('click', () => {
    setCartPanelOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });
  close.addEventListener('click', () => setCartPanelOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setCartPanelOpen(false);
  });
}

function addToCart(productId, size) {
  const cart = getCart();
  const product = productsCache.find(entry => entry.id === productId);
  const selectedSize = product?.sizes.find(entry => entry.id === size)?.id || product?.sizes[0]?.id;
  if (!selectedSize) return;
  const existing = cart.find(item => item.id === productId && (item.size || 'small') === selectedSize);

  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ id: productId, size: selectedSize, quantity: 1 });
  }

  saveCart(cart);
  renderCart();
}

function adjustCartQuantity(productId, size, change) {
  const cart = getCart();
  const itemIndex = cart.findIndex(item => item.id === productId && (item.size || 'small') === size);

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
    const size = product.sizes.find(entry => entry.id === (item.size || 'small')) || product.sizes[0];
    if (!size) return null;

    return {
      ...product,
      size: size.id,
      sizeName: size.name,
      price: size.price,
      quantity: item.quantity,
      lineTotal: size.price * Number(item.quantity)
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
        <strong>${item.name} <span class="cart-item-size">(${item.sizeName} bag)</span></strong>
        <div>${item.quantity} × ${currency(item.price)}</div>
      </div>

      <div class="cart-item-controls">
        <div class="quantity-box">
          <button class="qty-btn" type="button" data-change-qty="${item.id}" data-size="${item.size}" data-direction="-1" aria-label="Reduce ${item.name} ${item.sizeName} bag quantity">−</button>
          <span>${item.quantity}</span>
          <button class="qty-btn" type="button" data-change-qty="${item.id}" data-size="${item.size}" data-direction="1" aria-label="Increase ${item.name} ${item.sizeName} bag quantity">+</button>
        </div>
        <button class="remove-item-btn" type="button" data-remove-item="${item.id}" data-size="${item.size}" aria-label="Remove ${item.name} ${item.sizeName} bag from order">Remove</button>
      </div>

      <div>${currency(item.lineTotal)}</div>
    </div>
  `).join('');

  container.querySelectorAll('[data-change-qty]').forEach(button => {
    button.addEventListener('click', () => {
      const productId = button.dataset.changeQty;
      const size = button.dataset.size || 'small';
      const direction = Number(button.dataset.direction || 0);
      adjustCartQuantity(productId, size, direction);
    });
  });

  container.querySelectorAll('[data-remove-item]').forEach(button => {
    button.addEventListener('click', () => {
      adjustCartQuantity(button.dataset.removeItem, button.dataset.size || 'small', -9999);
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

  grid.innerHTML = products.map(product => {
    const edgeColor = /^#[\da-f]{6}$/i.test(product.imageEdgeColor || '') ? product.imageEdgeColor : '';
    return `
    <article class="product-card">
      <div class="product-image${product.image ? ' has-product-image' : ''}" ${edgeColor && product.image ? `style="--product-image-edge:${edgeColor}"` : ''} aria-hidden="true">${product.image ? `<img src="${product.image}" alt="" />` : (product.emoji || '🥨')}</div>
      <div class="product-body">
        <h3>${product.name}</h3>
        <p>${product.description || 'Seasoned hard pretzel.'}</p>
        <div class="product-meta">
          <span class="product-price" data-current-price="${product.id}">${currency(product.sizes[0].price)} ${product.sizes[0].name} bag</span>
          <span>Hard pretzel</span>
        </div>
        <div class="field">
          <label for="bag-size-${product.id}">Bag size</label>
          <select id="bag-size-${product.id}" data-bag-size="${product.id}">
            ${product.sizes.map(size => `<option value="${size.id}">${size.name} (${currency(size.price)})</option>`).join('')}
          </select>
        </div>
        <button class="primary-btn" type="button" data-add-to-cart="${product.id}">Add to order</button>
      </div>
    </article>
  `;
  }).join('');
  softenLegacyProductImages(grid);

  grid.querySelectorAll('[data-bag-size]').forEach(select => {
    select.addEventListener('change', () => {
      const product = products.find(entry => entry.id === select.dataset.bagSize);
      const price = grid.querySelector(`[data-current-price="${select.dataset.bagSize}"]`);
      const size = product?.sizes.find(entry => entry.id === select.value);
      if (size && price) {
        price.textContent = `${currency(size.price)} ${size.name} bag`;
      }
    });
  });

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
    items: items.map(item => ({ name: item.name, size: item.sizeName, quantity: item.quantity, price: Number(item.price) })),
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
    ...order.items.map(item => `- ${item.name} (${item.size || 'small'} bag) x${item.quantity} @ ${currency(item.price)}`),
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
          <span>${item.name} (${item.size} bag) × ${item.quantity}</span>
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

function sizeIdFromName(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function addSizePriceRow(container, size = {}) {
  const row = document.createElement('div');
  row.className = 'size-price-row';
  if (size.id) row.dataset.sizeId = size.id;
  row.innerHTML = `
    <label>Size name<input data-size-name type="text" placeholder="Small, Large, Party pack" required /></label>
    <label>Price<input data-size-price type="number" min="0" step="0.01" placeholder="5.00" required /></label>
    <button class="remove-item-btn" data-remove-size-row type="button" aria-label="Remove this size">Remove size</button>
  `;
  row.querySelector('[data-size-name]').value = size.name || '';
  row.querySelector('[data-size-price]').value = size.price ?? '';
  container.append(row);
  bindSizeRowRemoval(row);
}

function bindSizeRowRemoval(scope) {
  scope.querySelectorAll('[data-remove-size-row]').forEach(button => {
    button.addEventListener('click', () => {
      const container = button.closest('.size-price-list');
      if (!container || container.querySelectorAll('.size-price-row').length <= 1) {
        alert('Each product needs at least one size.');
        return;
      }
      button.closest('.size-price-row').remove();
    });
  });
}

function readSizePriceRows(container) {
  if (!container) return null;
  const sizes = Array.from(container.querySelectorAll('.size-price-row')).map(row => {
    const name = row.querySelector('[data-size-name]').value.trim();
    const priceText = row.querySelector('[data-size-price]').value;
    return {
      id: row.dataset.sizeId || sizeIdFromName(name),
      name,
      price: Number(priceText),
      hasPrice: priceText !== ''
    };
  });

  const ids = sizes.map(size => size.id);
  if (!sizes.length || sizes.some(size => !size.id || !size.name || !size.hasPrice || !Number.isFinite(size.price) || size.price < 0) || new Set(ids).size !== ids.length) {
    return null;
  }
  return sizes.map(({ hasPrice, ...size }) => size);
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
    <div class="catalog-item" data-catalog-product="${product.id}" style="display:grid; gap:0.75rem; padding:0.9rem; border:1px solid var(--border); border-radius:12px; margin-bottom:0.75rem; background:var(--bg-soft);">
      <div class="field">
        <label>Product name</label>
        <input data-product-name="${product.id}" value="${product.name}" />
      </div>
      <div class="product-size-editor">
        <div class="cart-header"><h4>Sizes and prices</h4><button class="secondary-btn" data-add-product-size type="button">Add size</button></div>
        <div class="size-price-list" data-product-sizes>
          ${product.sizes.map(size => `
            <div class="size-price-row" data-size-id="${size.id}">
              <label>Size name<input data-size-name type="text" value="${size.name}" required /></label>
              <label>Price<input data-size-price type="number" min="0" step="0.01" value="${Number(size.price).toFixed(2)}" required /></label>
              <button class="remove-item-btn" data-remove-size-row type="button" aria-label="Remove ${size.name} size">Remove size</button>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="field">
        <label>Description</label>
        <input data-product-description="${product.id}" value="${product.description || ''}" />
      </div>
      <div class="field" data-product-visual-controls>
        <label>Product image</label>
        <select data-product-visual-type>
          <option value="emoji" ${product.image ? '' : 'selected'}>Use emoji</option>
          <option value="image" ${product.image ? 'selected' : ''}>Upload image</option>
        </select>
        <label data-product-emoji-field ${product.image ? 'hidden' : ''}>
          Emoji
          <input data-product-emoji="${product.id}" maxlength="2" value="${product.emoji || '🥨'}" />
        </label>
        <label data-product-image-field ${product.image ? '' : 'hidden'}>
          Upload image
          <input data-product-image type="file" accept="image/*" />
          ${product.image ? `<img class="admin-product-image-preview" src="${product.image}" alt="Current product image" />` : ''}
        </label>
      </div>
      <div class="inline-actions">
        <button class="action-btn" type="button" data-save-product="${product.id}">Save</button>
        <button class="delete-btn" type="button" data-delete-product="${product.id}">Delete</button>
      </div>
    </div>
  `).join('');

  bindSizeRowRemoval(catalogList);
  catalogList.querySelectorAll('[data-product-visual-type]').forEach(select => {
    select.addEventListener('change', () => updateProductVisualFields(select.closest('[data-product-visual-controls]')));
  });
  catalogList.querySelectorAll('[data-add-product-size]').forEach(button => {
    button.addEventListener('click', () => {
      addSizePriceRow(button.closest('[data-catalog-product]').querySelector('[data-product-sizes]'));
    });
  });

  catalogList.querySelectorAll('[data-save-product]').forEach(button => {
    button.addEventListener('click', async () => {
      const id = button.dataset.saveProduct;
      const nameInput = catalogList.querySelector(`[data-product-name="${id}"]`);
      const descriptionInput = catalogList.querySelector(`[data-product-description="${id}"]`);
      const emojiInput = catalogList.querySelector(`[data-product-emoji="${id}"]`);
      const productCard = button.closest('[data-catalog-product]');
      const visualType = productCard?.querySelector('[data-product-visual-type]')?.value;
      const imageInput = productCard?.querySelector('[data-product-image]');
      const sizes = readSizePriceRows(productCard?.querySelector('[data-product-sizes]'));

      if (!nameInput || !sizes || !descriptionInput || (visualType === 'emoji' && !emojiInput)) {
        alert('Enter a unique name and a valid price for every size.');
        return;
      }

      const products = productsCache.map(product => ({ ...product, sizes: product.sizes.map(size => ({ ...size })) }));
      const target = products.find(product => product.id === id);
      if (!target) return;

      target.name = nameInput.value.trim() || target.name;
      target.sizes = sizes;
      target.description = descriptionInput.value.trim() || 'Seasoned hard pretzel.';
      if (visualType === 'emoji') {
        target.emoji = emojiInput.value.trim() || '🥨';
        delete target.image;
        delete target.imageEdgeColor;
      } else if (imageInput?.files[0]) {
        try {
          const processedImage = await imageFileToDataUrl(imageInput.files[0]);
          target.image = processedImage.dataUrl;
          target.imageEdgeColor = processedImage.edgeColor;
        } catch (error) {
          alert(error.message || 'Could not read that image. Choose another file.');
          return;
        }
      } else if (!target.image) {
        alert('Choose an image or switch to using an emoji.');
        return;
      }

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
    const itemText = order.items.map(item => `${item.name} (${item.size || 'small'} bag) x${item.quantity}`).join(', ');

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
    const productSizes = document.getElementById('newProductSizes');
    const toggleProductForm = document.getElementById('toggleProductForm');
    const cancelProductForm = document.getElementById('cancelProductForm');
    const visualTypeInput = productForm.querySelector('[data-product-visual-type]');

    visualTypeInput?.addEventListener('change', () => updateProductVisualFields(productForm));
    updateProductVisualFields(productForm);

    if (productSizes && !productSizes.querySelector('.size-price-row')) {
      addSizePriceRow(productSizes, { name: 'Small', price: 5 });
      addSizePriceRow(productSizes, { name: 'Large', price: 8 });
    }

    if (toggleProductForm) {
      toggleProductForm.addEventListener('click', () => {
        const open = productForm.classList.contains('hidden');
        productForm.classList.toggle('hidden', !open);
        toggleProductForm.setAttribute('aria-expanded', String(open));
        toggleProductForm.textContent = open ? 'Cancel adding product' : 'Add product';
        if (open) document.getElementById('newProductName')?.focus();
      });
    }

    const resetProductForm = () => {
      productForm.reset();
      updateProductVisualFields(productForm);
      productSizes.replaceChildren();
      addSizePriceRow(productSizes, { name: 'Small', price: 5 });
      addSizePriceRow(productSizes, { name: 'Large', price: 8 });
      productForm.classList.add('hidden');
      toggleProductForm?.setAttribute('aria-expanded', 'false');
      if (toggleProductForm) toggleProductForm.textContent = 'Add product';
    };

    if (cancelProductForm) {
      cancelProductForm.addEventListener('click', resetProductForm);
    }

    const addNewSizeButton = productForm.querySelector('[data-add-new-size]');
    if (addNewSizeButton) {
      addNewSizeButton.addEventListener('click', () => addSizePriceRow(productSizes));
    }

    productForm.addEventListener('submit', async event => {
      event.preventDefault();
      const formData = new FormData(productForm);
      const name = String(formData.get('name') || '').trim();
      const description = String(formData.get('description') || '').trim();
      const emoji = String(formData.get('emoji') || '').trim() || '🥨';
      const visualType = String(formData.get('visualType') || 'emoji');
      const imageFile = formData.get('image');
      const sizes = readSizePriceRows(productSizes);

      if (!name || !sizes) {
        alert('Enter a product name and a valid, uniquely named price for every size.');
        return;
      }

      const products = [...productsCache];
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString().slice(-5);
      let processedImage;
      if (visualType === 'image') {
        try {
          processedImage = await imageFileToDataUrl(imageFile);
        } catch (error) {
          alert(error.message || 'Choose an image for this product.');
          return;
        }
      }

      products.push({
        id,
        name,
        sizes,
        description: description || 'Seasoned hard pretzel.',
        emoji,
        ...(processedImage ? { image: processedImage.dataUrl, imageEdgeColor: processedImage.edgeColor } : {})
      });

      try {
        await saveProducts(products);
      } catch (error) {
        alert('Could not save the shared catalog. Check your connection and try again.');
        return;
      }
      resetProductForm();
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
  initCartPanel();

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
      const sizeSelect = document.getElementById(`bag-size-${productButton.dataset.addToCart}`);
      addToCart(productButton.dataset.addToCart, sizeSelect?.value || 'small');
    }
  });
});
