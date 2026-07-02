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
Firebase Auth needs the app to be served from an allowed web origin, so run a small local server from `/home/runner/work/on-track-app/on-track-app` and then open `/signing.html`.

Example:

```bash
cd /home/runner/work/on-track-app/on-track-app
python3 -m http.server 4173
```

Then visit `http://localhost:4173/signing.html` in your browser.
