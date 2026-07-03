# on-track-app
A simple app to stay on track.

## ON TRACK
A clean, easy-to-read calendar-style planner focused on simple shared scheduling.

### Features
- Big readable text and minimal noise UI
- Works in phone, tablet, laptop, and desktop browsers
- Email sign-in/sign-up before using the planner
- Each account keeps its own saved services and bookings
- Add services with custom colors (for example: teeth whitening blue, construction grey)
- Shared month, week, and day calendar views with drag + resize booking blocks
- Add bookings/tasks with title, notes, date, time, duration, and per-booking color
- Set reminder timing per booking
- Choose who gets the reminder (owner, partner, or both)
- Edit bookings from a popup without leaving the calendar
- Real-time sync across open app tabs/windows via browser broadcast + storage sync

### Run
1. Copy `firebase-config.example.js` to `firebase-config.local.js`.
2. Fill in your Firebase web app config values in `firebase-config.local.js`.
3. In Firebase, enable **Authentication > Email/Password** and create a Firestore database.
4. Serve the repository directory over HTTP (for example: `python3 -m http.server 8000`).
5. Open `http://localhost:8000/signin.html` in a browser.

Each signed-in user gets their own saved planner data in `users/{uid}/planner/main`. To keep data private per account, configure Firestore security rules so users can only read and write their own planner document.
LocalStorage is kept only as an offline backup for the signed-in user if Firestore is temporarily unavailable.
