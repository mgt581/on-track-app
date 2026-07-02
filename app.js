import {
  firebaseSetupError, 
  isFirebaseConfigured,
  loadStateForUser,
  observeAuthState,
  saveStateForUser,
  signOutUser,
  subscribeToUserState,
  waitForInitialAuthState
} from './auth.js';

const STORAGE_KEY = 'on-track-calendar-v1';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('on-track-sync') : null;
const DEFAULT_DURATION_MINUTES = 60;
const VIEW_LABELS = {
  dayGridMonth: 'Month',
  timeGridWeek: 'Week',
  timeGridDay: 'Day'
};

const defaultServices = [
  { id: crypto.randomUUID(), name: 'Teeth Whitening', color: '#2f80ed' },
  { id: crypto.randomUUID(), name: 'Construction', color: '#8d99ae' }
];

let state = createDefaultState();
let calendar = null;
let currentUser = null;
let editingServiceId = null;
let activeEntryId = null;
let reminderTimers = new Map();
let remoteUnsubscribe = () => {};

const appShell = document.getElementById('app-shell');
const appMessage = document.getElementById('app-message');
const accountEmail = document.getElementById('account-email');
const syncStatus = document.getElementById('sync-status');
const signOutBtn = document.getElementById('sign-out-btn');

const serviceForm = document.getElementById('service-form');
const serviceName = document.getElementById('service-name');
const serviceColor = document.getElementById('service-color');
const serviceList = document.getElementById('service-list');
const saveServiceBtn = document.getElementById('save-service-btn');
const cancelEdit = document.getElementById('cancel-edit');

const entryForm = document.getElementById('entry-form');
const entryTitle = document.getElementById('entry-title');
const entryService = document.getElementById('entry-service');
const entryDate = document.getElementById('entry-date');
const entryTime = document.getElementById('entry-time');
const entryDuration = document.getElementById('entry-duration');
const entryReminder = document.getElementById('entry-reminder');
const entryNotify = document.getElementById('entry-notify');
const entryNotes = document.getElementById('entry-notes');

const emptyState = document.getElementById('empty-state');
const scheduleList = document.getElementById('schedule-list');
const calendarEl = document.getElementById('calendar');
const calendarTitle = document.getElementById('calendar-title');
const calendarPrev = document.getElementById('calendar-prev');
const calendarNext = document.getElementById('calendar-next');
const calendarToday = document.getElementById('calendar-today');
const calendarTabs = document.querySelectorAll('[data-view]');

const entryModal = document.getElementById('entry-modal');
const entryModalForm = document.getElementById('entry-modal-form');
const entryModalClose = document.getElementById('entry-modal-close');
const modalEntryTitle = document.getElementById('modal-entry-title');
const modalEntryService = document.getElementById('modal-entry-service');
const modalEntryDate = document.getElementById('modal-entry-date');
const modalEntryTime = document.getElementById('modal-entry-time');
const modalEntryDuration = document.getElementById('modal-entry-duration');
const modalEntryColor = document.getElementById('modal-entry-color');
const modalEntryReminder = document.getElementById('modal-entry-reminder');
const modalEntryNotify = document.getElementById('modal-entry-notify');
const modalEntryNotes = document.getElementById('modal-entry-notes');
const modalDeleteEntry = document.getElementById('modal-delete-entry');
const modalUseServiceColor = document.getElementById('modal-use-service-color');

initialize();

async function initialize() {
  signOutBtn.addEventListener('click', handleSignOut);

  if (!isFirebaseConfigured) {
    showMessage(firebaseSetupError, true);
    accountEmail.textContent = 'Firebase setup required';
    syncStatus.textContent = 'Sign-in is unavailable until setup is complete.';
    return;
  }

  const user = await waitForInitialAuthState();
  if (!user) {
    window.location.replace('signin.html');
    return;
  }

  currentUser = user;
  initializeCalendar();
  registerEvents();
  resetServiceForm();
  updateAccountSummary('Loading your planner…');
  try {
    await loadInitialState();
    syncStatus.textContent = 'Planner synced to your account.';
    hideMessage();
    appShell.hidden = false;
  } catch {
    showMessage('Could not load your planner. Check your Firebase setup and Firestore rules.', true);
    syncStatus.textContent = 'Planner sync failed.';
    signOutBtn.hidden = false;
    return;
  }

  observeAuthState((nextUser) => {
    if (!nextUser) {
      window.location.replace('signin.html');
      return;
    }

    if (nextUser.uid !== currentUser?.uid) {
      window.location.reload();
    }
  });
}

function registerEvents() {
  serviceForm.addEventListener('submit', handleServiceSubmit);
  cancelEdit.addEventListener('click', resetServiceForm);
  serviceList.addEventListener('click', handleServiceListClick);

  entryForm.addEventListener('submit', handleEntrySubmit);
  scheduleList.addEventListener('click', handleScheduleListClick);

  calendarPrev.addEventListener('click', () => {
    calendar.prev();
    updateCalendarToolbar();
  });

  calendarNext.addEventListener('click', () => {
    calendar.next();
    updateCalendarToolbar();
  });

  calendarToday.addEventListener('click', () => {
    calendar.today();
    updateCalendarToolbar();
  });

  calendarTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      calendar.changeView(tab.dataset.view);
      updateCalendarToolbar();
    });
  });

  entryModalForm.addEventListener('submit', handleEntryModalSubmit);
  entryModal.addEventListener('click', (event) => {
    if (event.target.dataset.closeModal === 'true') {
      closeEntryModal();
    }
  });
  entryModalClose.addEventListener('click', closeEntryModal);
  modalDeleteEntry.addEventListener('click', handleDeleteEntry);
  modalUseServiceColor.addEventListener('click', () => {
    const service = findServiceById(modalEntryService.value);
    modalEntryColor.value = service?.color || '#2f80ed';
    modalEntryColor.dataset.linked = 'true';
  });
  modalEntryService.addEventListener('change', () => {
    if (modalEntryColor.dataset.linked === 'true') {
      const service = findServiceById(modalEntryService.value);
      modalEntryColor.value = service?.color || '#2f80ed';
    }
  });
  modalEntryColor.addEventListener('input', () => {
    modalEntryColor.dataset.linked = 'false';
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !entryModal.classList.contains('hidden')) {
      closeEntryModal();
    }
  });

  if (channel) {
    channel.addEventListener('message', (event) => {
      if (event.data?.type === 'sync' && event.data.uid === currentUser?.uid) {
        state = loadCachedState();
        render();
      }
    });
  }
}

function initializeCalendar() {
  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: window.innerWidth <= 640 ? 'timeGridDay' : 'dayGridMonth',
    editable: true,
    selectable: true,
    selectMirror: true,
    nowIndicator: true,
    height: 'auto',
    expandRows: true,
    stickyHeaderDates: true,
    eventDisplay: 'block',
    allDaySlot: false,
    slotMinTime: '06:00:00',
    slotMaxTime: '22:00:00',
    slotDuration: '00:30:00',
    eventMinHeight: 36,
    dayMaxEventRows: 4,
    headerToolbar: false,
    eventTimeFormat: {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    },
    slotLabelFormat: {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    },
    dayHeaderFormat: {
      weekday: window.innerWidth <= 640 ? 'narrow' : 'short'
    },
    select: handleCalendarSelect,
    dateClick: handleCalendarDateClick,
    eventClick: ({ event }) => openEntryModal(event.id),
    eventDrop: ({ event }) => updateEntryFromCalendarEvent(event),
    eventResize: ({ event }) => updateEntryFromCalendarEvent(event),
    datesSet: updateCalendarToolbar
  });

  calendar.render();
}

async function loadInitialState() {
  const cachedState = loadCachedState();
  const remoteState = await loadStateForUser(currentUser.uid);

  if (remoteState) {
    state = hydrateState(remoteState);
    persistCachedState();
  } else if (cachedState.entries.length || cachedState.services.length) {
    state = cachedState;
    await saveStateForUser(currentUser.uid, state);
    persistCachedState();
  } else {
    state = createDefaultState();
    await saveStateForUser(currentUser.uid, state);
    persistCachedState();
  }

  remoteUnsubscribe = subscribeToUserState(
    currentUser.uid,
    (remoteValue) => {
      if (!remoteValue) {
        return;
      }

      const nextState = hydrateState(remoteValue);
      if (JSON.stringify(nextState) === JSON.stringify(state)) {
        return;
      }

      state = nextState;
      persistCachedState();
      render();
      syncStatus.textContent = 'Planner synced to your account.';
    },
    () => {
      syncStatus.textContent = 'Unable to sync live updates right now.';
    }
  );

  render();
}

function updateAccountSummary(statusMessage) {
  accountEmail.textContent = currentUser?.email ? `Signed in as ${currentUser.email}` : 'Signed in';
  syncStatus.textContent = statusMessage;
  signOutBtn.hidden = false;
}

function getStorageKey() {
  return `${STORAGE_KEY}:${currentUser?.uid || 'guest'}`;
}

function createDefaultState() {
  return hydrateState({ services: defaultServices.map((service) => ({ ...service })), entries: [] });
}

function loadCachedState() {
  const saved = localStorage.getItem(getStorageKey());
  if (!saved) {
    return createDefaultState();
  }

  try {
    return hydrateState(JSON.parse(saved));
  } catch {
    return createDefaultState();
  }
}

function persistCachedState() {
  localStorage.setItem(getStorageKey(), JSON.stringify(state));
}

function persistAndRender() {
  persistCachedState();
  if (channel) {
    channel.postMessage({ type: 'sync', uid: currentUser?.uid });
  }
  syncStatus.textContent = 'Saving changes…';
  void saveStateForUser(currentUser.uid, state)
    .then(() => {
      syncStatus.textContent = 'Planner synced to your account.';
    })
    .catch(() => {
      syncStatus.textContent = 'Saved locally. Cloud sync failed.';
    });
  render();
}

function showMessage(message, isError = false) {
  appMessage.hidden = false;
  appMessage.textContent = message;
  appMessage.classList.toggle('status-text', true);
  appMessage.classList.toggle('error', isError);
}

function hideMessage() {
  appMessage.hidden = true;
}

async function handleSignOut() {
  signOutBtn.disabled = true;
  try {
    remoteUnsubscribe();
    await signOutUser();
  } catch {
    signOutBtn.disabled = false;
    syncStatus.textContent = 'Could not sign out right now.';
  }
}

function handleServiceSubmit(event) {
  event.preventDefault();

  const name = serviceName.value.trim();
  if (!name) {
    return;
  }

  if (editingServiceId) {
    const service = findServiceById(editingServiceId);
    if (service) {
      service.name = name;
      service.color = normalizeColor(serviceColor.value, service.color);
    }
  } else {
    state.services.push({
      id: crypto.randomUUID(),
      name,
      color: normalizeColor(serviceColor.value, '#2f80ed')
    });
  }

  resetServiceForm();
  persistAndRender();
}

function handleServiceListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }

  const { action, id } = button.dataset;

  if (action === 'edit') {
    const service = findServiceById(id);
    if (!service) {
      return;
    }

    editingServiceId = id;
    serviceName.value = service.name;
    serviceColor.value = service.color;
    saveServiceBtn.textContent = 'Update service';
    cancelEdit.style.display = '';
    serviceName.focus();
    return;
  }

  if (action === 'remove') {
    removeService(id);
    if (editingServiceId === id) {
      resetServiceForm();
    }
    persistAndRender();
  }
}

async function handleEntrySubmit(event) {
  event.preventDefault();

  const service = findServiceById(entryService.value);
  const dateTime = buildDateTime(entryDate.value, entryTime.value);
  const title = entryTitle.value.trim();
  const durationMinutes = normalizeDuration(entryDuration.value);

  if (!service || !title || !isValidDateTime(dateTime)) {
    return;
  }

  state.entries.push({
    id: crypto.randomUUID(),
    title,
    notes: entryNotes.value.trim(),
    serviceId: service.id,
    dateTime,
    durationMinutes,
    reminderMinutes: normalizeReminder(entryReminder.value),
    notify: normalizeNotify(entryNotify.value),
    color: '',
    createdAt: new Date().toISOString()
  });

  sortEntries();
  persistAndRender();
  entryForm.reset();
  entryDuration.value = DEFAULT_DURATION_MINUTES;
  await requestNotificationPermission();
  syncReminders();
}

function handleScheduleListClick(event) {
  const button = event.target.closest('[data-entry-id]');
  if (!button) {
    return;
  }

  openEntryModal(button.dataset.entryId);
}

function handleCalendarDateClick(info) {
  const clickedDate = info.date;
  populateEntryFormDate(clickedDate, info.allDay);
}

function handleCalendarSelect(info) {
  const selectionStart = info.start;
  const selectionEnd = info.end || new Date(selectionStart.getTime() + DEFAULT_DURATION_MINUTES * 60000);
  populateEntryFormDate(selectionStart, info.allDay);
  entryDuration.value = normalizeDuration((selectionEnd.getTime() - selectionStart.getTime()) / 60000);
  entryTitle.focus();
}

function handleEntryModalSubmit(event) {
  event.preventDefault();

  const entry = findEntryById(activeEntryId);
  const service = findServiceById(modalEntryService.value);
  const dateTime = buildDateTime(modalEntryDate.value, modalEntryTime.value);
  const title = modalEntryTitle.value.trim();

  if (!entry || !service || !title || !isValidDateTime(dateTime)) {
    return;
  }

  entry.title = title;
  entry.serviceId = service.id;
  entry.dateTime = dateTime;
  entry.durationMinutes = normalizeDuration(modalEntryDuration.value);
  entry.reminderMinutes = normalizeReminder(modalEntryReminder.value);
  entry.notify = normalizeNotify(modalEntryNotify.value);
  entry.notes = modalEntryNotes.value.trim();
  entry.color = modalEntryColor.dataset.linked === 'true'
    ? ''
    : normalizeColor(modalEntryColor.value, service.color);

  sortEntries();
  persistAndRender();
  closeEntryModal();
}

function handleDeleteEntry() {
  if (!activeEntryId) {
    return;
  }

  state.entries = state.entries.filter((entry) => entry.id !== activeEntryId);
  persistAndRender();
  closeEntryModal();
}

function populateEntryFormDate(date, allDay) {
  entryDate.value = formatDateInput(date);
  entryTime.value = allDay ? '09:00' : formatTimeInput(date);
}

function openEntryModal(entryId) {
  const entry = findEntryById(entryId);
  if (!entry) {
    return;
  }

  const service = findServiceById(entry.serviceId) || state.services[0];
  const start = parseLocalDateTime(entry.dateTime);

  activeEntryId = entry.id;
  populateServiceOptions(modalEntryService, service?.id);
  modalEntryTitle.value = entry.title;
  modalEntryDate.value = formatDateInput(start);
  modalEntryTime.value = formatTimeInput(start);
  modalEntryDuration.value = normalizeDuration(entry.durationMinutes);
  modalEntryReminder.value = String(normalizeReminder(entry.reminderMinutes));
  modalEntryNotify.value = normalizeNotify(entry.notify);
  modalEntryNotes.value = entry.notes || '';
  modalEntryColor.value = entry.color || service?.color || '#2f80ed';
  modalEntryColor.dataset.linked = entry.color ? 'false' : 'true';

  entryModal.classList.remove('hidden');
  entryModal.setAttribute('aria-hidden', 'false');
  modalEntryTitle.focus();
}

function closeEntryModal() {
  activeEntryId = null;
  entryModal.classList.add('hidden');
  entryModal.setAttribute('aria-hidden', 'true');
  entryModalForm.reset();
}

function removeService(serviceId) {
  const remainingServices = state.services.filter((service) => service.id !== serviceId);

  if (!remainingServices.length) {
    remainingServices.push({
      id: crypto.randomUUID(),
      name: 'General',
      color: '#2f80ed'
    });
  }

  const fallbackServiceId = remainingServices[0].id;
  state.entries.forEach((entry) => {
    if (entry.serviceId === serviceId) {
      entry.serviceId = fallbackServiceId;
      if (!entry.color) {
        entry.color = '';
      }
    }
  });

  state.services = remainingServices;
}

function updateEntryFromCalendarEvent(event) {
  const entry = findEntryById(event.id);
  if (!entry || !event.start) {
    return;
  }

  entry.dateTime = formatLocalDateTime(event.start);
  entry.durationMinutes = normalizeDuration(
    event.end ? (event.end.getTime() - event.start.getTime()) / 60000 : entry.durationMinutes
  );

  sortEntries();
  persistAndRender();
}

function render() {
  state = hydrateState(state);
  renderServiceList();
  renderServiceSelects();
  renderScheduleList();
  renderCalendarEvents();
  updateCalendarToolbar();
  emptyState.style.display = state.entries.length ? 'none' : 'block';
  syncReminders();

  if (activeEntryId && !findEntryById(activeEntryId)) {
    closeEntryModal();
  }
}

function renderServiceList() {
  serviceList.innerHTML = '';

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
  });
}

function renderServiceSelects() {
  const selectedService = entryService.value || state.services[0]?.id;
  populateServiceOptions(entryService, selectedService);

  if (activeEntryId) {
    const activeEntry = findEntryById(activeEntryId);
    populateServiceOptions(modalEntryService, activeEntry?.serviceId || state.services[0]?.id);
    if (modalEntryColor.dataset.linked === 'true') {
      const service = findServiceById(modalEntryService.value);
      modalEntryColor.value = service?.color || '#2f80ed';
    }
  }
}

function renderScheduleList() {
  scheduleList.innerHTML = '';

  state.entries.forEach((entry) => {
    const service = findServiceById(entry.serviceId);
    const start = parseLocalDateTime(entry.dateTime);
    const end = new Date(start.getTime() + normalizeDuration(entry.durationMinutes) * 60000);
    const item = document.createElement('li');
    item.className = 'schedule-item';
    item.style.borderLeftColor = getEntryColor(entry, service);
    item.innerHTML = `
      <button type="button" class="schedule-button" data-entry-id="${entry.id}">
        <strong>${escapeHtml(entry.title)}</strong>
        <div class="schedule-meta">${start.toLocaleDateString()} at ${formatDisplayTime(start)} • ${escapeHtml(service?.name || 'General')}</div>
        <div class="schedule-meta">${formatDisplayTime(start)} - ${formatDisplayTime(end)} • Reminder: ${escapeHtml(reminderLabel(entry.reminderMinutes))}</div>
        ${entry.notes ? `<div>${escapeHtml(entry.notes)}</div>` : ''}
      </button>
    `;
    scheduleList.appendChild(item);
  });
}

function renderCalendarEvents() {
  calendar.removeAllEvents();
  buildCalendarEvents().forEach((event) => {
    calendar.addEvent(event);
  });
}

function buildCalendarEvents() {
  return state.entries.map((entry) => {
    const service = findServiceById(entry.serviceId);
    const start = parseLocalDateTime(entry.dateTime);
    const color = getEntryColor(entry, service);
    return {
      id: entry.id,
      title: entry.title,
      start,
      end: new Date(start.getTime() + normalizeDuration(entry.durationMinutes) * 60000),
      backgroundColor: color,
      borderColor: color,
      textColor: getContrastColor(color)
    };
  });
}

function updateCalendarToolbar() {
  if (!calendar) {
    return;
  }

  calendarTitle.textContent = calendar.view.title;
  calendarTabs.forEach((tab) => {
    const isActive = tab.dataset.view === calendar.view.type;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.textContent = VIEW_LABELS[tab.dataset.view] || tab.textContent;
  });
  calendarToday.textContent = 'Today';
}

function populateServiceOptions(select, selectedId) {
  select.innerHTML = '';

  state.services.forEach((service) => {
    const option = document.createElement('option');
    option.value = service.id;
    option.textContent = service.name;
    option.selected = service.id === selectedId;
    select.appendChild(option);
  });

  if (!select.value && state.services[0]) {
    select.value = state.services[0].id;
  }
}

function resetServiceForm() {
  editingServiceId = null;
  saveServiceBtn.textContent = 'Save service';
  cancelEdit.style.display = 'none';
  serviceForm.reset();
  serviceColor.value = '#2f80ed';
}

function hydrateState(rawState) {
  const services = Array.isArray(rawState?.services) ? rawState.services.map(normalizeService) : [];
  const entries = Array.isArray(rawState?.entries) ? rawState.entries.map(normalizeEntry).filter(Boolean) : [];

  if (!services.length) {
    services.push(...defaultServices.map((service) => ({ ...service })));
  }

  const validServiceIds = new Set(services.map((service) => service.id));
  entries.forEach((entry) => {
    if (!validServiceIds.has(entry.serviceId)) {
      entry.serviceId = services[0].id;
    }
  });

  return {
    services,
    entries: entries.sort((a, b) => a.dateTime.localeCompare(b.dateTime))
  };
}

function normalizeService(service) {
  return {
    id: typeof service?.id === 'string' && service.id ? service.id : crypto.randomUUID(),
    name: typeof service?.name === 'string' && service.name.trim() ? service.name.trim() : 'General',
    color: normalizeColor(service?.color, '#2f80ed')
  };
}

function normalizeEntry(entry) {
  const title = typeof entry?.title === 'string' ? entry.title.trim() : '';
  const dateTime = typeof entry?.dateTime === 'string' ? entry.dateTime : '';

  if (!title || !isValidDateTime(dateTime)) {
    return null;
  }

  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : crypto.randomUUID(),
    title,
    notes: typeof entry.notes === 'string' ? entry.notes.trim() : '',
    serviceId: typeof entry.serviceId === 'string' ? entry.serviceId : '',
    dateTime,
    durationMinutes: normalizeDuration(entry.durationMinutes),
    reminderMinutes: normalizeReminder(entry.reminderMinutes),
    notify: normalizeNotify(entry.notify),
    color: entry?.color ? normalizeColor(entry.color, '') : '',
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString()
  };
}

function sortEntries() {
  state.entries.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
}

function findServiceById(serviceId) {
  return state.services.find((service) => service.id === serviceId);
}

function findEntryById(entryId) {
  return state.entries.find((entry) => entry.id === entryId);
}

function getEntryColor(entry, service) {
  return entry.color || service?.color || '#2f80ed';
}

function normalizeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback;
}

function normalizeReminder(value) {
  const minutes = Number(value);
  return [0, 5, 10, 30, 60, 1440].includes(minutes) ? minutes : 0;
}

function normalizeNotify(value) {
  return ['owner', 'partner', 'both'].includes(value) ? value : 'both';
}

function normalizeDuration(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 15) {
    return DEFAULT_DURATION_MINUTES;
  }

  return Math.max(15, Math.round(minutes / 15) * 15);
}

function buildDateTime(date, time) {
  return `${date}T${time}:00`;
}

function isValidDateTime(value) {
  return !Number.isNaN(parseLocalDateTime(value).getTime());
}

function parseLocalDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
  if (!match) {
    return new Date(value);
  }

  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  );
}

function formatLocalDateTime(date) {
  return `${formatDateInput(date)}T${formatTimeInput(date)}:00`;
}

function formatDateInput(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function formatTimeInput(date) {
  return [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0')
  ].join(':');
}

function formatDisplayTime(date) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
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

function syncReminders() {
  reminderTimers.forEach((timerId) => clearTimeout(timerId));
  reminderTimers.clear();

  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  state.entries.forEach((entry) => {
    const start = parseLocalDateTime(entry.dateTime).getTime();
    const reminderTime = start - normalizeReminder(entry.reminderMinutes) * 60 * 1000;
    const delay = reminderTime - Date.now();

    if (delay <= 0 || delay > 2147483647) {
      return;
    }

    const timerId = window.setTimeout(() => {
      const service = findServiceById(entry.serviceId);
      const target = entry.notify === 'both' ? 'Owner + Partner' : entry.notify;
      new Notification('ON TRACK reminder', {
        body: `${entry.title} (${service?.name || 'General'}) for ${target}`
      });
      reminderTimers.delete(entry.id);
    }, delay);

    reminderTimers.set(entry.id, timerId);
  });
}

function getContrastColor(hexColor) {
  const hex = normalizeColor(hexColor, '#2f80ed').slice(1);
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
  return brightness > 160 ? '#111827' : '#ffffff';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
