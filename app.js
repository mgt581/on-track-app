import {
  firebaseSetupError, 
  isFirebaseConfigured,
  loadPlannerForUser,
  observeAuthState,
  saveStateForCalendar,
  signOutUser,
  subscribeToPlannerState,
  waitForInitialAuthState
} from './auth.js';
import { createReminderEngine, scheduleNativeReminder } from './reminder-engine.js';

const STORAGE_KEY = 'on-track-calendar-v1';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('on-track-sync') : null;
const DEFAULT_DURATION_MINUTES = 60;
const ALARM_SOUND_URL = 'assets/alarmSoundfortrack.mp3';
const VIEW_LABELS = {
  dayGridMonth: 'Month',
  timeGridWeek: 'Week',
  timeGridDay: 'Day'
};
const WEEK_MODE_COMPACT = 'compact';
const WEEK_MODE_COMFORT = 'comfort';
const MOBILE_WEEK_VIEW = 'timeGridThreeDay';
const MOBILE_CALENDAR_BREAKPOINT = 640;

const defaultServices = [
  { id: crypto.randomUUID(), name: 'Teeth Whitening', color: '#2f80ed' },
  { id: crypto.randomUUID(), name: 'Construction', color: '#8d99ae' }
];

let state = createDefaultState();
let calendar = null;
let currentUser = null;
let editingServiceId = null;
let activeEntryId = null;
let focusedCalendarDate = formatDateInput(new Date());
let remoteUnsubscribe = () => {};
let pendingNotificationPromptEntry = null;
let mobileWeekMode = WEEK_MODE_COMPACT;
let syncedState = null;
let saveQueue = Promise.resolve();
let pendingSaveCount = 0;
let activeCalendar = null;

const appShell = document.getElementById('app-shell');
const appMessage = document.getElementById('app-message');
const notificationBanner = document.getElementById('notification-banner');
const notificationBannerTitle = document.getElementById('notification-banner-title');
const notificationBannerText = document.getElementById('notification-banner-text');
const notificationBannerPrimary = document.getElementById('notification-banner-primary');
const notificationBannerSecondary = document.getElementById('notification-banner-secondary');
const accountEmail = document.getElementById('account-email');
const syncStatus = document.getElementById('sync-status');
const signOutBtn = document.getElementById('sign-out-btn');
const sharingText = document.getElementById('sharing-text');
const copyInviteBtn = document.getElementById('copy-invite-btn');
const sharingResult = document.getElementById('sharing-result');

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
const entryHour = document.getElementById('entry-hour');
const entryMinute = document.getElementById('entry-minute');
const entryDuration = document.getElementById('entry-duration');
const entryReminder = document.getElementById('entry-reminder');
const entryNotify = document.getElementById('entry-notify');
const entryNotes = document.getElementById('entry-notes');

const emptyState = document.getElementById('empty-state');
const scheduleList = document.getElementById('schedule-list');
const archiveSection = document.getElementById('archive-section');
const archiveFolders = document.getElementById('archive-folders');
const calendarEl = document.getElementById('calendar');
const calendarTitle = document.getElementById('calendar-title');
const calendarPrev = document.getElementById('calendar-prev');
const calendarNext = document.getElementById('calendar-next');
const calendarToday = document.getElementById('calendar-today');
const calendarTabs = document.querySelectorAll('[data-view]');
const weekModeButtons = document.querySelectorAll('[data-week-mode]');

const entryModal = document.getElementById('entry-modal');
const entryModalForm = document.getElementById('entry-modal-form');
const entryModalClose = document.getElementById('entry-modal-close');
const modalEntryTitle = document.getElementById('modal-entry-title');
const modalEntryService = document.getElementById('modal-entry-service');
const modalEntryDate = document.getElementById('modal-entry-date');
const modalEntryHour = document.getElementById('modal-entry-hour');
const modalEntryMinute = document.getElementById('modal-entry-minute');
const modalEntryDuration = document.getElementById('modal-entry-duration');
const modalEntryColor = document.getElementById('modal-entry-color');
const modalEntryReminder = document.getElementById('modal-entry-reminder');
const modalEntryNotify = document.getElementById('modal-entry-notify');
const modalEntryNotes = document.getElementById('modal-entry-notes');
const modalDeleteEntry = document.getElementById('modal-delete-entry');
const modalUseServiceColor = document.getElementById('modal-use-service-color');
const reminderEngine = createReminderEngine({
  audioUrl: ALARM_SOUND_URL,
  getServiceLabel: (serviceId) => findServiceById(serviceId)?.name || 'General',
  parseLocalDateTime,
  normalizeReminder,
  formatDisplayDateTime
});

initialize();
window.setInterval(refreshScheduleVisibility, 60 * 1000);

function refreshScheduleVisibility() {
  if (!currentUser || !appShell || appShell.hidden) {
    return;
  }
  renderScheduleList();
  emptyState.style.display = getUpcomingEntries().length ? 'none' : 'block';
}

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
  mobileWeekMode = loadMobileWeekMode();
  initializeCalendar();
  registerEvents();
  registerWeekModeEvents();
  registerSharingEvents();
  initializeTimeSelectors();
  registerAlarmAudioPriming();
  resetServiceForm();
  updateAccountSummary('Loading your planner…');
  hideMessage();
  appShell.hidden = false;
  registerNotificationBannerEvents();
  await loadInitialState();

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

function registerNotificationBannerEvents() {
  notificationBannerPrimary.addEventListener('click', handleNotificationBannerPrimaryClick);
  notificationBannerSecondary.addEventListener('click', handleNotificationBannerSecondaryClick);
}

function registerWeekModeEvents() {
  weekModeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setMobileWeekMode(button.dataset.weekMode);
    });
  });
}

function registerSharingEvents() {
  copyInviteBtn.addEventListener('click', handleCopyInvite);
}

function getInviteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const calendarId = params.get('share');
  const inviteCode = params.get('code');
  return calendarId && inviteCode ? { calendarId, inviteCode } : null;
}

function getInviteUrl() {
  if (!activeCalendar?.calendarId || !activeCalendar?.inviteCode) {
    return '';
  }

  const inviteUrl = new URL('signin.html', window.location.href);
  inviteUrl.searchParams.set('share', activeCalendar.calendarId);
  inviteUrl.searchParams.set('code', activeCalendar.inviteCode);
  return inviteUrl.toString();
}

function renderSharingState() {
  if (!sharingText || !copyInviteBtn) {
    return;
  }

  const memberCount = activeCalendar?.memberCount || 1;
  if (memberCount > 1) {
    sharingText.textContent = `Your partner is connected. Both accounts can add and edit bookings.`;
  } else {
    sharingText.textContent = 'Invite your partner so you can both use separate logins and see the same calendar.';
  }

  copyInviteBtn.disabled = !getInviteUrl();
}

async function handleCopyInvite() {
  const inviteUrl = getInviteUrl();
  if (!inviteUrl) {
    return;
  }

  try {
    await navigator.clipboard.writeText(inviteUrl);
    sharingResult.textContent = 'Invite link copied. Send it to your partner.';
  } catch {
    sharingResult.textContent = `Copy this invite link and send it to your partner: ${inviteUrl}`;
  }
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
      changeCalendarView(tab.dataset.view);
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

function registerAlarmAudioPriming() {
  const prime = () => {
    void reminderEngine.primeAlarmAudio();
  };

  document.addEventListener('pointerdown', prime, { once: true, passive: true });
  document.addEventListener('keydown', prime, { once: true, passive: true });
  document.addEventListener('touchstart', prime, { once: true, passive: true });
}

function initializeCalendar() {
  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: isMobileCalendar() ? getResponsiveWeekViewType() : 'dayGridMonth',
    initialDate: focusedCalendarDate,
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
    views: {
      [MOBILE_WEEK_VIEW]: {
        type: 'timeGrid',
        duration: { days: 3 },
        dateIncrement: { days: 3 }
      }
    },
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
      weekday: 'short'
    },
    dayCellClassNames: getFocusedDayClassNames,
    eventContent: renderCalendarEventContent,
    select: handleCalendarSelect,
    dateClick: handleCalendarDateClick,
    eventClick: ({ event }) => openEntryModal(event.id),
    eventDrop: ({ event }) => updateEntryFromCalendarEvent(event),
    eventResize: ({ event }) => updateEntryFromCalendarEvent(event),
    datesSet: handleCalendarDatesSet
  });

  calendar.render();
}

async function loadInitialState() {
  const cachedState = readCachedState();
  state = cachedState || createDefaultState();
  render();

  try {
    activeCalendar = await loadPlannerForUser(
      currentUser.uid,
      currentUser.email || '',
      state,
      getInviteFromUrl()
    );
    state = hydrateState(activeCalendar.state || state);
    persistCachedState();

    syncedState = cloneState(state);

    syncStatus.textContent = 'Planner synced to your account.';
  } catch {
    syncedState = cloneState(state);
    persistCachedState();
    syncStatus.textContent = 'Cloud sync is temporarily unavailable. Using the local backup for now.';
  }

  remoteUnsubscribe = subscribeToPlannerState(
    activeCalendar?.calendarId,
    (remoteValue) => {
      if (!remoteValue) {
        return;
      }

      const nextState = hydrateState(remoteValue);
      syncedState = cloneState(nextState);

      if (pendingSaveCount > 0 || JSON.stringify(nextState) === JSON.stringify(state)) {
        return;
      }

      state = nextState;
      persistCachedState();
      render();
      syncStatus.textContent = 'Planner synced to your account.';
    },
    () => {
      syncStatus.textContent = 'Cloud sync is temporarily unavailable. Changes are still saved locally.';
    }
  );

  updateNotificationBanner();
  renderSharingState();
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

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadCachedState() {
  return readCachedState() || createDefaultState();
}

function readCachedState() {
  const saved = localStorage.getItem(getStorageKey());
  if (!saved) {
    return null;
  }

  try {
    return hydrateState(JSON.parse(saved));
  } catch {
    return null;
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
  render();

  const localSnapshot = cloneState(state);
  const baseSnapshot = syncedState ? cloneState(syncedState) : null;
  pendingSaveCount += 1;

  saveQueue = saveQueue
    .then(async () => {
      if (!activeCalendar?.calendarId) {
        throw new Error('Shared calendar is not ready.');
      }

      const mergedState = hydrateState(
        await saveStateForCalendar(activeCalendar.calendarId, localSnapshot, baseSnapshot)
      );
      syncedState = cloneState(mergedState);

      // Do not replace a newer local edit that happened while this write was
      // in flight. The next queued write will merge it with this result.
      if (JSON.stringify(state) === JSON.stringify(localSnapshot)) {
        state = mergedState;
        persistCachedState();
        render();
      }
      syncStatus.textContent = 'Planner synced to your account.';
    })
    .catch(() => {
      syncStatus.textContent = 'Changes saved locally. Cloud sync will retry automatically.';
    })
    .finally(() => {
      pendingSaveCount = Math.max(0, pendingSaveCount - 1);
    });
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
  const dateTime = buildDateTime(entryDate.value, entryHour.value, entryMinute.value);
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
    createdAt: new Date().toISOString(),
    completed: false,
    completedAt: '',
    archived: false
  });

  sortEntries();
  persistAndRender();
  entryForm.reset();
  setTimePickerValue(entryHour, entryMinute, new Date());
  entryDuration.value = DEFAULT_DURATION_MINUTES;
  maybeOfferNotificationPermission(state.entries[state.entries.length - 1]);
  void scheduleNativeReminder(state.entries[state.entries.length - 1]);
}

function handleScheduleListClick(event) {
  const actionButton = event.target.closest('button[data-entry-action]');
  if (actionButton) {
    const entry = findEntryById(actionButton.dataset.entryId);
    if (!entry) {
      return;
    }

    if (actionButton.dataset.entryAction === 'complete') {
      completeEntry(entry);
    } else if (actionButton.dataset.entryAction === 'reopen') {
      reopenEntry(entry);
    }
    return;
  }

  const button = event.target.closest('[data-entry-id]');
  if (!button) {
    return;
  }

  openEntryModal(button.dataset.entryId);
}

function completeEntry(entry) {
  entry.completed = true;
  entry.completedAt = new Date().toISOString();
  sortEntries();
  persistAndRender();
}

function reopenEntry(entry) {
  entry.completed = false;
  entry.completedAt = '';
  persistAndRender();
}

function handleCalendarDateClick(info) {
  const clickedDate = info.date;
  setFocusedCalendarDate(clickedDate);
  populateEntryFormDate(clickedDate, info.allDay);
  if (calendar?.view.type === 'dayGridMonth') {
    changeCalendarView('timeGridDay', clickedDate);
  }
}

function handleCalendarSelect(info) {
  const selectionStart = info.start;
  const selectionEnd = info.end || new Date(selectionStart.getTime() + DEFAULT_DURATION_MINUTES * 60000);
  setFocusedCalendarDate(selectionStart);
  populateEntryFormDate(selectionStart, info.allDay);
  entryDuration.value = normalizeDuration((selectionEnd.getTime() - selectionStart.getTime()) / 60000);
  entryTitle.focus();
}

function handleEntryModalSubmit(event) {
  event.preventDefault();

  const entry = findEntryById(activeEntryId);
  const service = findServiceById(modalEntryService.value);
  const dateTime = buildDateTime(modalEntryDate.value, modalEntryHour.value, modalEntryMinute.value);
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
  maybeOfferNotificationPermission(entry);
  void scheduleNativeReminder(entry);
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
  setTimePickerValue(entryHour, entryMinute, allDay ? new Date(`${formatDateInput(date)}T09:00:00`) : date);
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
  setTimePickerValue(modalEntryHour, modalEntryMinute, start);
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
  updateNotificationBanner();
  emptyState.style.display = getUpcomingEntries().length ? 'none' : 'block';
  reminderEngine.syncReminders(state.entries);

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

  getUpcomingEntries().forEach((entry) => {
    scheduleList.appendChild(createScheduleItem(entry, 'complete', 'Done'));
  });

  renderArchiveFolders();
}

function createScheduleItem(entry, action, actionLabel) {
  const service = findServiceById(entry.serviceId);
  const start = parseLocalDateTime(entry.dateTime);
  const end = new Date(start.getTime() + normalizeDuration(entry.durationMinutes) * 60000);
  const item = document.createElement('li');
  item.className = 'schedule-item';
  item.style.borderLeftColor = getEntryColor(entry, service);
  item.innerHTML = `
    <div class="schedule-item-body">
      <button type="button" class="schedule-button" data-entry-id="${entry.id}">
        <strong>${escapeHtml(entry.title)}</strong>
        <div class="schedule-meta">${start.toLocaleDateString()} at ${formatDisplayTime(start)} • ${escapeHtml(service?.name || 'General')}</div>
        <div class="schedule-meta">${formatDisplayTime(start)} - ${formatDisplayTime(end)} • Reminder: ${escapeHtml(reminderLabel(entry.reminderMinutes))}</div>
        ${entry.notes ? `<div>${escapeHtml(entry.notes)}</div>` : ''}
      </button>
      <div class="schedule-item-actions">
        <button type="button" class="btn-sm ${action === 'complete' ? 'btn-complete' : 'btn-secondary'}" data-entry-action="${action}" data-entry-id="${entry.id}">${actionLabel}</button>
      </div>
    </div>
  `;
  return item;
}

function renderArchiveFolders() {
  const archivedEntries = getArchivedEntries();
  archiveFolders.innerHTML = '';
  archiveSection.hidden = !archivedEntries.length;

  const folders = new Map();
  archivedEntries.forEach((entry) => {
    const key = getArchiveMonthKey(entry);
    if (!folders.has(key)) {
      folders.set(key, []);
    }
    folders.get(key).push(entry);
  });

  [...folders.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .forEach(([monthKey, entries], folderIndex) => {
      const folder = document.createElement('details');
      folder.className = 'archive-folder';
      folder.open = folderIndex === 0;
      const summary = document.createElement('summary');
      summary.textContent = `${formatArchiveMonth(monthKey)} (${entries.length})`;
      folder.appendChild(summary);

      const list = document.createElement('ul');
      list.className = 'schedule-list';
      entries
        .sort((left, right) => right.dateTime.localeCompare(left.dateTime))
        .forEach((entry) => {
          const item = createScheduleItem(entry, 'reopen', 'Reopen');
          const status = document.createElement('div');
          status.className = 'archive-status';
          status.textContent = entry.completed
            ? `Completed ${formatArchiveDate(entry.completedAt || entry.dateTime)}`
            : 'Past task';
          item.querySelector('.schedule-button').appendChild(status);
          list.appendChild(item);
        });
      folder.appendChild(list);
      archiveFolders.appendChild(folder);
    });
}

function getUpcomingEntries() {
  const now = Date.now();
  return state.entries.filter((entry) => {
    const start = parseLocalDateTime(entry.dateTime);
    return !entry.completed && !entry.archived && start.getTime() >= now;
  });
}

function getArchivedEntries() {
  const now = Date.now();
  return state.entries.filter((entry) => {
    const start = parseLocalDateTime(entry.dateTime);
    return entry.completed || entry.archived || start.getTime() < now;
  });
}

function getArchiveMonthKey(entry) {
  const archiveDate = parseLocalDateTime(entry.completedAt || entry.dateTime);
  return `${archiveDate.getFullYear()}-${String(archiveDate.getMonth() + 1).padStart(2, '0')}`;
}

function formatArchiveMonth(monthKey) {
  const date = new Date(`${monthKey}-01T12:00:00`);
  return date.toLocaleDateString([], { month: 'long', year: 'numeric' });
}

function formatArchiveDate(dateTime) {
  const date = parseLocalDateTime(dateTime);
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
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
      allDay: false,
      backgroundColor: color,
      borderColor: color,
      textColor: getContrastColor(color)
    };
  });
}

function renderCalendarEventContent(arg) {
  const content = document.createElement('div');
  content.className = 'calendar-event-content';

  if (arg.timeText) {
    const time = document.createElement('div');
    time.className = 'calendar-event-time';
    time.textContent = arg.timeText;
    content.appendChild(time);
  }

  const title = document.createElement('div');
  title.className = 'calendar-event-title';
  title.textContent = arg.event.title;
  content.appendChild(title);
  return { domNodes: [content] };
}

function getFocusedDayClassNames(arg) {
  return formatDateInput(arg.date) === focusedCalendarDate ? ['focused-calendar-day'] : [];
}

function handleCalendarDatesSet() {
  if (calendar) {
    setFocusedCalendarDate(calendar.getDate());
  }
  updateCalendarToolbar();
}

function updateCalendarToolbar() {
  if (!calendar) {
    return;
  }

  calendarTitle.textContent = calendar.view.title;
  calendarTabs.forEach((tab) => {
    const isActive = tab.dataset.view === calendar.view.type || (tab.dataset.view === 'timeGridWeek' && isResponsiveWeekView(calendar.view.type));
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.textContent = VIEW_LABELS[tab.dataset.view] || tab.textContent;
  });
  updateWeekModeButtons();
  calendarToday.textContent = 'Today';
}

function setFocusedCalendarDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return;
  }
  focusedCalendarDate = formatDateInput(date);
}

function changeCalendarView(view, date = focusedCalendarDate) {
  if (!calendar) {
    return;
  }
  const targetDate = date instanceof Date ? formatDateInput(date) : date;
  setFocusedCalendarDate(date instanceof Date ? date : new Date(`${targetDate}T12:00:00`));
  calendar.changeView(view === 'timeGridWeek' ? getResponsiveWeekViewType() : view, targetDate);
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
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
    completed: entry?.completed === true,
    completedAt: typeof entry.completedAt === 'string' ? entry.completedAt : '',
    archived: entry?.archived === true
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

function isMobileCalendar() {
  return window.innerWidth <= MOBILE_CALENDAR_BREAKPOINT;
}

function getResponsiveWeekViewType() {
  if (!isMobileCalendar()) {
    return 'timeGridWeek';
  }

  return mobileWeekMode === WEEK_MODE_COMFORT ? MOBILE_WEEK_VIEW : 'timeGridWeek';
}

function isResponsiveWeekView(viewType) {
  return viewType === 'timeGridWeek' || viewType === MOBILE_WEEK_VIEW;
}

function getWeekModeStorageKey() {
  return `${STORAGE_KEY}:${currentUser?.uid || 'guest'}:week-mode`;
}

function loadMobileWeekMode() {
  const savedMode = localStorage.getItem(getWeekModeStorageKey());
  return savedMode === WEEK_MODE_COMFORT ? WEEK_MODE_COMFORT : WEEK_MODE_COMPACT;
}

function persistMobileWeekMode() {
  localStorage.setItem(getWeekModeStorageKey(), mobileWeekMode);
}

function setMobileWeekMode(nextMode) {
  const normalizedMode = nextMode === WEEK_MODE_COMFORT ? WEEK_MODE_COMFORT : WEEK_MODE_COMPACT;

  if (normalizedMode === mobileWeekMode) {
    return;
  }

  mobileWeekMode = normalizedMode;
  persistMobileWeekMode();
  if (calendar && isResponsiveWeekView(calendar.view.type)) {
    const currentDate = calendar.getDate();
    focusedCalendarDate = formatDateInput(currentDate);
    calendar.destroy();
    initializeCalendar();
    renderCalendarEvents();
  }

  updateCalendarToolbar();
}

function updateWeekModeButtons() {
  if (!weekModeButtons.length) {
    return;
  }

  weekModeButtons.forEach((button) => {
    const isActive = button.dataset.weekMode === mobileWeekMode;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function initializeTimeSelectors() {
  populateTimeOptions(entryHour, 24);
  populateTimeOptions(modalEntryHour, 24);
  populateTimeOptions(entryMinute, 60);
  populateTimeOptions(modalEntryMinute, 60);
  setTimePickerValue(entryHour, entryMinute, new Date());
  setTimePickerValue(modalEntryHour, modalEntryMinute, new Date());
}

function populateTimeOptions(select, count) {
  select.innerHTML = '';
  for (let index = 0; index < count; index += 1) {
    const option = document.createElement('option');
    option.value = String(index).padStart(2, '0');
    option.textContent = option.value;
    select.appendChild(option);
  }
}

function setTimePickerValue(hourSelect, minuteSelect, date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  hourSelect.value = hours;
  minuteSelect.value = minutes;
}

function buildDateTime(date, hour, minute) {
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
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

function formatDisplayDateTime(date) {
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getNotificationPromptKey() {
  return `${STORAGE_KEY}:${currentUser?.uid || 'guest'}:notification-prompt-seen`;
}

function getNotificationWarningKey() {
  return `${STORAGE_KEY}:${currentUser?.uid || 'guest'}:notification-warning-dismissed`;
}

function hasReminderEnabledEntries() {
  return state.entries.some((entry) => normalizeReminder(entry.reminderMinutes) > 0);
}

function hasReminderEnabledState(entry) {
  return normalizeReminder(entry.reminderMinutes) > 0;
}

function hasPermissionPromptBeenSeen() {
  return localStorage.getItem(getNotificationPromptKey()) === 'true';
}

function markPermissionPromptSeen() {
  localStorage.setItem(getNotificationPromptKey(), 'true');
}

function hasWarningBeenDismissed() {
  return localStorage.getItem(getNotificationWarningKey()) === 'true';
}

function markWarningBeenDismissed() {
  localStorage.setItem(getNotificationWarningKey(), 'true');
}

function clearWarningDismissed() {
  localStorage.removeItem(getNotificationWarningKey());
}

function dismissNotificationBanner() {
  if (!notificationBanner) {
    return;
  }

  notificationBanner.hidden = true;
  notificationBanner.classList.add('hidden');
  notificationBanner.classList.remove('warning');
  notificationBannerTitle.textContent = 'Enable notifications for alarms';
  notificationBannerText.textContent = 'Notifications help reminders reach you even when the app is not open.';
  notificationBannerPrimary.textContent = 'Enable notifications';
  notificationBannerPrimary.hidden = false;
  notificationBannerSecondary.textContent = 'Not now';
  notificationBannerSecondary.hidden = false;
  pendingNotificationPromptEntry = null;
}

function showNotificationPrompt(message) {
  if (!notificationBanner) {
    return;
  }

  notificationBanner.hidden = false;
  notificationBanner.classList.remove('hidden', 'warning');
  notificationBannerTitle.textContent = 'Enable notifications for alarms';
  notificationBannerText.textContent = message;
  notificationBannerPrimary.textContent = 'Enable notifications';
  notificationBannerPrimary.hidden = false;
  notificationBannerSecondary.textContent = 'Not now';
  notificationBannerSecondary.hidden = false;
}

function showNotificationWarning(message) {
  if (!notificationBanner) {
    return;
  }

  notificationBanner.hidden = false;
  notificationBanner.classList.remove('hidden');
  notificationBanner.classList.add('warning');
  notificationBannerTitle.textContent = 'Notifications are off';
  notificationBannerText.textContent = message;
  notificationBannerPrimary.textContent = 'Got it';
  notificationBannerPrimary.hidden = false;
  notificationBannerSecondary.hidden = true;
}

function updateNotificationBanner() {
  if (!notificationBanner || !currentUser) {
    return;
  }

  if (!hasReminderEnabledEntries()) {
    dismissNotificationBanner();
    return;
  }

  if (!('Notification' in window)) {
    if (!hasWarningBeenDismissed()) {
      showNotificationWarning('This browser does not support notifications, so alarms may only play sound while ON TRACK is open.');
    } else {
      dismissNotificationBanner();
    }
    return;
  }

  if (Notification.permission === 'denied') {
    if (!hasWarningBeenDismissed()) {
      showNotificationWarning('Notifications are blocked in this browser. Your alarm is still saved, but sound may only play while the app is open and notifications will not appear.');
    } else {
      dismissNotificationBanner();
    }
    return;
  }

  const promptEntry = pendingNotificationPromptEntry || state.entries.find(hasReminderEnabledState) || null;
  if (Notification.permission === 'default' && !hasPermissionPromptBeenSeen() && promptEntry) {
    pendingNotificationPromptEntry = promptEntry;
    showNotificationPrompt(
      `Notifications help this alarm reach you even when ON TRACK is closed. ${promptEntry.title} is saved and ready to go.`
    );
    return;
  }

  dismissNotificationBanner();
}

function maybeOfferNotificationPermission(entry) {
  if (!entry || !currentUser || !hasReminderEnabledState(entry)) {
    return;
  }

  if (!('Notification' in window)) {
    if (!hasWarningBeenDismissed()) {
      showNotificationWarning('This browser does not support notifications, so alarms may only play sound while ON TRACK is open.');
    }
    return;
  }

  if (Notification.permission === 'denied') {
    if (!hasWarningBeenDismissed()) {
      showNotificationWarning('Notifications are blocked in this browser. Your alarm is still saved, but sound may only play while the app is open and notifications will not appear.');
    }
    return;
  }

  if (Notification.permission === 'default' && !hasPermissionPromptBeenSeen()) {
    pendingNotificationPromptEntry = entry;
    markPermissionPromptSeen();
    showNotificationPrompt(
      `Notifications help this alarm reach you even when ON TRACK is closed. ${entry.title} is saved and ready to go.`
    );
  }
}

async function handleNotificationBannerPrimaryClick() {
  if (notificationBanner?.classList.contains('warning')) {
    markWarningBeenDismissed();
    dismissNotificationBanner();
    return;
  }

  if (!('Notification' in window)) {
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      clearWarningDismissed();
      dismissNotificationBanner();
      syncStatus.textContent = 'Notifications enabled for alarms.';
      reminderEngine.syncReminders(state.entries);
      return;
    }

    if (permission === 'denied') {
      showNotificationWarning('Notifications are blocked in this browser. Your alarm is still saved, but sound may only play while the app is open and notifications will not appear.');
      syncStatus.textContent = 'Notifications were denied. Alarms still sound while the app is open.';
      return;
    }

    dismissNotificationBanner();
  } catch {
    dismissNotificationBanner();
  }
}

function handleNotificationBannerSecondaryClick() {
  markPermissionPromptSeen();
  dismissNotificationBanner();
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
