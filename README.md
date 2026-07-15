# on-track-app
A simple app to stay on track.

## ON TRACK
A clean, easy-to-read calendar-style planner focused on simple shared scheduling.

### Features
- Big readable text and minimal noise UI
- Works in phone, tablet, laptop, and desktop browsers
- Email sign-in/sign-up before using the planner
- Separate Firebase accounts can join one shared calendar with a private invite link
- Link-account plans for couples, teams, clubs, organisations, and businesses
- Add services with custom colors (for example: teeth whitening blue, construction grey)
- Shared month, week, and day calendar views with drag + resize booking blocks
- Add bookings/tasks with title, notes, date, time, duration, and per-booking color
- Show only upcoming tasks in the main schedule; completed and past tasks move into month-by-month folders
- Mark a task done from the schedule and reopen it from its archive folder if needed
- Set reminder timing per booking
- Choose who gets the reminder (owner, partner, or both)
- Edit bookings from a popup without leaving the calendar
- Real-time sync across devices and open app tabs/windows via Firestore plus browser broadcast

### Run
1. Copy `firebase-config.example.js` to `firebase-config.local.js`.
2. Fill in your Firebase web app config values in `firebase-config.local.js`.
3. In Firebase, enable **Authentication > Email/Password** and create a Firestore database.
4. Serve the repository directory over HTTP (for example: `python3 -m http.server 8000`).
5. Open `http://localhost:8000/signin.html` in a browser.

On first sign-in, ON TRACK creates a shared calendar and shows a partner invite link. Send that link to the other person. They sign in with their own Firebase Auth account, open the link, and are added to that calendar. The shared data is stored in `sharedCalendars/{calendarId}` and each account keeps its own link in `users/{uid}/planner/main`.

Deploy `firestore.rules` to the same Firebase project before using separate accounts. The rules allow only calendar members to read or edit shared data; the invite code is used only for the one-time join update. Firestore writes are transactionally merged so a stale device cannot erase a booking added by the other device.
LocalStorage is kept only as an offline backup for the signed-in user if Firestore is temporarily unavailable.

### Linked-account plans

- Free: 1 account
- 2 accounts: £2.99/month
- Up to 5 accounts: £4.99/month
- Up to 10 accounts: £8.99/month
- More than 10 accounts: contact us

Stripe checkout is handled by the Firebase Functions in `functions/`. The Firebase project must use the Blaze plan for Functions deployment. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as Firebase secrets, configure the three Stripe Price IDs in `functions/.env`, deploy the functions, and register the `stripeWebhook` URL in Stripe. The owner allowlist in the functions and Firestore rules gives owner mode to `alexbryantwork3234@outlook.com` and `meganbullock881@yahoo.com` without payment or account limits.
