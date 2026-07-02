# on-track-app
A simple app to stay on track.

## ON TRACK
A clean, easy-to-read calendar-style planner focused on simple shared scheduling.

### Features
- Big readable text and minimal noise UI
- Works in phone, tablet, laptop, and desktop browsers
- Add services with custom colors (for example: teeth whitening blue, construction grey)
- Shared month, week, and day calendar views with drag + resize booking blocks
- Add bookings/tasks with title, notes, date, time, duration, and per-booking color
- Set reminder timing per booking
- Choose who gets the reminder (owner, partner, or both)
- Edit bookings from a popup without leaving the calendar
- Real-time sync across open app tabs/windows via browser broadcast + storage sync

### Run
Firebase Auth needs the app to be served from an allowed web origin, and the Firebase web config should stay out of tracked files.

1. Copy `/home/runner/work/on-track-app/on-track-app/firebase-config.example.js` to `/home/runner/work/on-track-app/on-track-app/firebase-config.local.js`
2. Paste your Firebase **web app** config into that local file
3. Do **not** put any Firebase Admin SDK private key or service account JSON in this repository
4. Run a small local server from `/home/runner/work/on-track-app/on-track-app` and then open `/signing.html`

Example:

```bash
cd /home/runner/work/on-track-app/on-track-app
cp firebase-config.example.js firebase-config.local.js
python3 -m http.server 4173
```

Then visit `http://localhost:4173/signing.html` in your browser.

The Firebase Admin SDK snippet from the Service Accounts page is for a backend/server only, not for this browser app.
