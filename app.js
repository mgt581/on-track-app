const STORAGE_KEY = 'on-track-calendar-v1';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('on-track-sync') : null;

const defaultServices = [
  { id: crypto.randomUUID(), name: 'Teeth Whitening', color: '#2f80ed' },
  { id: crypto.randomUUID(), name: 'Construction', color: '#8d99ae' }
];

let state = loadState();

const serviceForm = document.getElementById('service-form');
const serviceName = document.getElementById('service-name');
const serviceColor = document.getElementById('service-color');
const serviceList = document.getElementById('service-list');

const entryForm = document.getElementById('entry-form');
const entryTitle = document.getElementById('entry-title');
const entryService = document.getElementById('entry-service');
const entryDate = document.getElementById('entry-date');
const entryTime = document.getElementById('entry-time');
const entryReminder = document.getElementById('entry-reminder');
const entryNotify = document.getElementById('entry-notify');
const entryNotes = document.getElementById('entry-notes');

const emptyState = document.getElementById('empty-state');
const scheduleList = document.getElementById('schedule-list');

const saveServiceBtn = document.getElementById('save-service-btn');
const cancelEdit = document.getElementById('cancel-edit');

let editingServiceId = null;

function resetServiceForm() {
  editingServiceId = null;
  saveServiceBtn.textContent = 'Save service';
  cancelEdit.style.display = 'none';
  serviceForm.reset();
  serviceColor.value = '#2f80ed';
}

serviceForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const name = serviceName.value.trim();
  if (!name) {
    return;
  }

  if (editingServiceId) {
    const service = state.services.find((s) => s.id === editingServiceId);
    if (service) {
      service.name = name;
      service.color = serviceColor.value;
    }
  } else {
    state.services.push({
      id: crypto.randomUUID(),
      name,
      color: serviceColor.value
    });
  }

  resetServiceForm();
  persistAndRender();
});

cancelEdit.addEventListener('click', () => {
  resetServiceForm();
});

serviceList.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) {
    return;
  }
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  if (action === 'edit') {
    const service = state.services.find((s) => s.id === id);
    if (!service) {
      return;
    }
    editingServiceId = id;
    serviceName.value = service.name;
    serviceColor.value = service.color;
    saveServiceBtn.textContent = 'Update service';
    cancelEdit.style.display = '';
    serviceName.focus();
  }

  if (action === 'remove') {
    state.services = state.services.filter((s) => s.id !== id);
    if (editingServiceId === id) {
      resetServiceForm();
    }
    persistAndRender();
  }
});

entryForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const dateTime = `${entryDate.value}T${entryTime.value}:00`;
  const service = state.services.find((item) => item.id === entryService.value);
  if (!service) {
    return;
  }

  const record = {
    id: crypto.randomUUID(),
    title: entryTitle.value.trim(),
    notes: entryNotes.value.trim(),
    serviceId: service.id,
    dateTime,
    reminderMinutes: Number(entryReminder.value),
    notify: entryNotify.value,
    createdAt: new Date().toISOString()
  };

  if (!record.title || Number.isNaN(Date.parse(record.dateTime))) {
    return;
  }

  state.entries.push(record);
  state.entries.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  persistAndRender();
  entryForm.reset();

  await requestNotificationPermission();
  scheduleReminder(record, service);
});

if (channel) {
  channel.addEventListener('message', (event) => {
    if (event.data === 'sync') {
      state = loadState();
      render();
    }
  });
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return { services: [...defaultServices], entries: [] };
  }

  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.services) || !Array.isArray(parsed.entries)) {
      throw new Error('Invalid state');
    }
    return parsed;
  } catch {
    return { services: [...defaultServices], entries: [] };
  }
}

function persistAndRender() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (channel) {
    channel.postMessage('sync');
  }
  render();
}

function render() {
  serviceList.innerHTML = '';
  entryService.innerHTML = '';

  state.services.forEach((service) => {
    const item = document.createElement('li');
    item.className = 'service-item';
    item.innerHTML = `
      <span class="chip" style="background:${service.color}">${escapeHtml(service.name)}</span>
      <span class="service-actions">
        <button type="button" class="btn-sm" data-action="edit" data-id="${service.id}">Edit</button>
        <button type="button" class="btn-sm btn-danger" data-action="remove" data-id="${service.id}">Remove</button>
      </span>
    `;
    serviceList.appendChild(item);

    const option = document.createElement('option');
    option.value = service.id;
    option.textContent = service.name;
    entryService.appendChild(option);
  });

  scheduleList.innerHTML = '';

  state.entries.forEach((entry) => {
    const service = state.services.find((item) => item.id === entry.serviceId);
    const color = service?.color || '#2f80ed';
    const item = document.createElement('li');
    item.className = 'schedule-item';
    item.style.borderLeftColor = color;

    const when = new Date(entry.dateTime);
    const reminderText = reminderLabel(entry.reminderMinutes);

    item.innerHTML = `
      <strong>${escapeHtml(entry.title)}</strong>
      <div class="schedule-meta">${when.toLocaleDateString()} at ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${escapeHtml(service?.name || 'General')}</div>
      <div class="schedule-meta">Reminder: ${reminderText} • Notify: ${escapeHtml(entry.notify)}</div>
      ${entry.notes ? `<div>${escapeHtml(entry.notes)}</div>` : ''}
    `;

    scheduleList.appendChild(item);
  });

  emptyState.style.display = state.entries.length ? 'none' : 'block';
}

function reminderLabel(minutes) {
  if (minutes === 0) {
    return 'at start time';
  }
  if (minutes === 60) {
    return '1 hour before';
  }
  if (minutes === 1440) {
    return '1 day before';
  }
  return `${minutes} mins before`;
}

async function requestNotificationPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') {
    return;
  }

  try {
    await Notification.requestPermission();
  } catch {
    // Ignore permission errors from restricted environments.
  }
}

function scheduleReminder(entry, service) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const eventTime = new Date(entry.dateTime).getTime();
  const reminderTime = eventTime - entry.reminderMinutes * 60 * 1000;
  const delay = reminderTime - Date.now();

  if (delay <= 0 || delay > 2147483647) {
    return;
  }

  setTimeout(() => {
    const target = entry.notify === 'both' ? 'Owner + Partner' : entry.notify;
    new Notification('ON TRACK reminder', {
      body: `${entry.title} (${service.name}) for ${target}`
    });
  }, delay);
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

render();
