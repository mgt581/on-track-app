export function createReminderEngine({
  audioUrl,
  getServiceLabel,
  parseLocalDateTime,
  normalizeReminder,
  formatDisplayDateTime
}) {
  const reminderTimers = new Map();
  let alarmSound = null;
  let alarmAudioPrimed = false;
  let alarmAudioContext = null;
  let alarmAudioBuffer = null;
  let alarmAudioLoadPromise = null;

  return {
    primeAlarmAudio,
    syncReminders
  };

  function syncReminders(entries) {
    reminderTimers.forEach((timerId) => clearTimeout(timerId));
    reminderTimers.clear();

    entries.forEach((entry) => {
      const start = parseLocalDateTime(entry.dateTime).getTime();
      const reminderTime = start - normalizeReminder(entry.reminderMinutes) * 60 * 1000;
      const delay = reminderTime - Date.now();

      if (delay <= 0 || delay > 2147483647) {
        return;
      }

      const timerId = window.setTimeout(() => {
        void triggerReminderAlert(entry);
        reminderTimers.delete(entry.id);
      }, delay);

      reminderTimers.set(entry.id, timerId);
    });
  }

  async function triggerReminderAlert(entry) {
    const serviceLabel = getServiceLabel(entry.serviceId);
    const start = parseLocalDateTime(entry.dateTime);
    const reminderMinutes = normalizeReminder(entry.reminderMinutes);
    const reminderTime = new Date(start.getTime() - reminderMinutes * 60 * 1000);

    await playAlarmSound();

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('ON TRACK alarm', {
        body: `${entry.title} (${serviceLabel || 'General'}) • Alarm: ${formatDisplayDateTime(reminderTime)} • Event: ${formatDisplayDateTime(start)}`,
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        tag: `alarm-${entry.id}`,
        renotify: true
      });
    }

    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
  }

  async function primeAlarmAudio() {
    if (alarmAudioPrimed) {
      return;
    }

    try {
      await loadAlarmAudioBuffer();
      const context = getAlarmAudioContext();
      if (context.state === 'suspended') {
        await context.resume();
      }
      if (context.state === 'running') {
        alarmAudioPrimed = true;
      }
    } catch {
      // Some browsers still block sound until the user has interacted enough.
    }
  }

  async function playAlarmSound() {
    try {
      await primeAlarmAudio();

      if (alarmAudioBuffer) {
        const context = getAlarmAudioContext();
        if (context.state === 'suspended') {
          await context.resume();
        }

        const source = context.createBufferSource();
        const gain = context.createGain();
        gain.gain.value = 1;
        source.buffer = alarmAudioBuffer;
        source.connect(gain);
        gain.connect(context.destination);
        source.start(0);
        return;
      }

      if (!alarmSound) {
        alarmSound = new Audio(audioUrl);
        alarmSound.preload = 'auto';
        alarmSound.volume = 1;
        alarmSound.playsInline = true;
      }

      alarmSound.currentTime = 0;
      const playPromise = alarmSound.play();
      if (playPromise) {
        await playPromise;
      }
    } catch {
      // The notification still fires even if audio playback is blocked.
    }
  }

  function getAlarmAudioContext() {
    if (!alarmAudioContext) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error('AudioContext is not supported.');
      }
      alarmAudioContext = new AudioContextCtor();
    }

    return alarmAudioContext;
  }

  async function loadAlarmAudioBuffer() {
    if (alarmAudioBuffer) {
      return alarmAudioBuffer;
    }

    if (!alarmAudioLoadPromise) {
      alarmAudioLoadPromise = fetch(audioUrl)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to load alarm sound: ${response.status}`);
          }
          return response.arrayBuffer();
        })
        .then((arrayBuffer) => getAlarmAudioContext().decodeAudioData(arrayBuffer));
    }

    alarmAudioBuffer = await alarmAudioLoadPromise;
    return alarmAudioBuffer;
  }
}

export async function scheduleNativeReminder(reminder) {
  // Placeholder for future iOS/Android local notification scheduling.
  return {
    scheduled: false,
    reminder
  };
}
