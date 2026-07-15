const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const Stripe = require('stripe');

admin.initializeApp();
const db = admin.firestore();
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');

const OWNER_EMAILS = new Set([
  'alexbryantwork3234@outlook.com',
  'meganbullock881@yahoo.com'
]);

const PLAN_LIMITS = {
  free: 1,
  duo: 2,
  team5: 5,
  team10: 10,
  owner: 9999
};

const PLAN_PRICES = {
  duo: process.env.STRIPE_PRICE_DUO,
  team5: process.env.STRIPE_PRICE_TEAM5,
  team10: process.env.STRIPE_PRICE_TEAM10
};

const PLAN_LABELS = {
  free: 'Free',
  duo: '2-account plan',
  team5: '5-account team plan',
  team10: '10-account team plan',
  owner: 'Owner mode'
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

exports.getBillingStatus = onRequest(async (request, response) => {
  if (!handleCors(request, response)) return;

  try {
    const user = await requireUser(request);
    const status = await billingStatusForUser(user);
    response.json({ ok: true, billing: status });
  } catch (error) {
    sendError(response, error);
  }
});

exports.createCheckoutSession = onRequest({ secrets: [STRIPE_SECRET_KEY] }, async (request, response) => {
  if (!handleCors(request, response)) return;

  try {
    const user = await requireUser(request);
    const planKey = request.body?.planKey;
    const status = await billingStatusForUser(user);

    if (status.ownerMode) {
      response.json({ ok: true, ownerMode: true, url: appUrl(request) });
      return;
    }

    if (!PLAN_PRICES[planKey]) {
      throw httpError(400, 'This plan is not configured in Stripe yet.');
    }

    const stripe = getStripe();
    const customerId = status.stripeCustomerId || undefined;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      client_reference_id: user.uid,
      line_items: [{ price: PLAN_PRICES[planKey], quantity: 1 }],
      metadata: { userId: user.uid, planKey },
      subscription_data: {
        metadata: { userId: user.uid, planKey }
      },
      success_url: `${appUrl(request)}?billing=success&plan=${encodeURIComponent(planKey)}`,
      cancel_url: `${appUrl(request)}?billing=cancelled`
    });

    response.json({ ok: true, url: session.url });
  } catch (error) {
    sendError(response, error);
  }
});

exports.createPortalSession = onRequest({ secrets: [STRIPE_SECRET_KEY] }, async (request, response) => {
  if (!handleCors(request, response)) return;

  try {
    const user = await requireUser(request);
    const status = await billingStatusForUser(user);
    if (status.ownerMode) {
      response.json({ ok: true, ownerMode: true, url: appUrl(request) });
      return;
    }
    if (!status.stripeCustomerId) {
      throw httpError(400, 'No Stripe customer is linked to this account yet.');
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: status.stripeCustomerId,
      return_url: appUrl(request)
    });
    response.json({ ok: true, url: session.url });
  } catch (error) {
    sendError(response, error);
  }
});

exports.stripeWebhook = onRequest({ secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] }, async (request, response) => {
  if (request.method !== 'POST') {
    response.status(405).send('Method not allowed');
    return;
  }

  try {
    const stripe = getStripe();
    const signature = request.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(
      request.rawBody,
      signature,
      requiredSecret(STRIPE_WEBHOOK_SECRET, 'STRIPE_WEBHOOK_SECRET')
    );

    if (event.type === 'checkout.session.completed') {
      await applyCheckoutSession(stripe, event.data.object);
    }
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      await applySubscription(event.data.object);
    }

    response.json({ received: true });
  } catch (error) {
    response.status(error.statusCode || 400).send(error.message || 'Webhook error');
  }
});

async function applyCheckoutSession(stripe, session) {
  const userId = session.metadata?.userId || session.client_reference_id;
  const planKey = session.metadata?.planKey || await planKeyForCheckoutSession(stripe, session);
  if (!userId) return;
  await db.doc(`users/${userId}/billing/main`).set({
    status: 'active',
    planKey,
    maxMembers: PLAN_LIMITS[planKey] || 1,
    stripeCustomerId: session.customer || null,
    stripeSubscriptionId: session.subscription || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  await updateOwnedCalendarsPlan(userId, planKey, PLAN_LIMITS[planKey] || 1);
}

async function applySubscription(subscription) {
  let userId = subscription.metadata?.userId;
  let planKey = subscription.metadata?.planKey;
  let existingBilling = null;

  if (!userId || !planKey) {
    const matchingBilling = await findBillingRecordByCustomer(subscription.customer);
    if (matchingBilling) {
      userId = userId || matchingBilling.userId;
      existingBilling = matchingBilling.data;
    }
  }

  if (!planKey) {
    const priceId = subscription.items?.data?.[0]?.price?.id;
    planKey = planKeyForPriceId(priceId) || existingBilling?.planKey || 'free';
  }

  if (!userId) return;
  const active = ['active', 'trialing', 'past_due'].includes(subscription.status);
  await db.doc(`users/${userId}/billing/main`).set({
    status: active ? subscription.status : 'inactive',
    planKey: active ? planKey : 'free',
    maxMembers: active ? PLAN_LIMITS[planKey] || 1 : 1,
    stripeCustomerId: subscription.customer || null,
    stripeSubscriptionId: subscription.id,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  await updateOwnedCalendarsPlan(userId, active ? planKey : 'free', active ? PLAN_LIMITS[planKey] || 1 : 1);
}

async function planKeyForCheckoutSession(stripe, session) {
  const checkoutSession = session.line_items?.data?.length
    ? session
    : await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['line_items.data.price']
    });
  const priceId = checkoutSession.line_items?.data?.[0]?.price?.id;
  return planKeyForPriceId(priceId);
}

function planKeyForPriceId(priceId) {
  if (!priceId) {
    return 'free';
  }
  return Object.entries(PLAN_PRICES).find(([, configuredPriceId]) => configuredPriceId === priceId)?.[0] || 'free';
}

async function findBillingRecordByCustomer(customerId) {
  if (!customerId) {
    return null;
  }

  const snapshot = await db.collectionGroup('billing')
    .where('stripeCustomerId', '==', customerId)
    .limit(1)
    .get();
  if (snapshot.empty) {
    return null;
  }

  const billingDoc = snapshot.docs[0];
  return {
    userId: billingDoc.ref.parent.parent.id,
    data: billingDoc.data()
  };
}

async function updateOwnedCalendarsPlan(ownerUid, planKey, maxMembers) {
  const snapshot = await db.collection('sharedCalendars')
    .where('ownerUid', '==', ownerUid)
    .get();
  if (snapshot.empty) {
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((calendarDoc) => {
    batch.update(calendarDoc.ref, {
      planKey,
      maxMembers,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  await batch.commit();
}

async function billingStatusForUser(user) {
  const email = String(user.email || '').toLowerCase();
  if (OWNER_EMAILS.has(email)) {
    return {
      status: 'owner',
      planKey: 'owner',
      planLabel: PLAN_LABELS.owner,
      maxMembers: PLAN_LIMITS.owner,
      ownerMode: true,
      stripeCustomerId: null
    };
  }

  const snapshot = await db.doc(`users/${user.uid}/billing/main`).get();
  const data = snapshot.exists ? snapshot.data() : {};
  const planKey = data.status === 'active' || data.status === 'trialing' || data.status === 'past_due'
    ? data.planKey
    : 'free';
  return {
    status: data.status || 'free',
    planKey: PLAN_LIMITS[planKey] ? planKey : 'free',
    planLabel: PLAN_LABELS[planKey] || PLAN_LABELS.free,
    maxMembers: PLAN_LIMITS[planKey] || 1,
    ownerMode: false,
    stripeCustomerId: data.stripeCustomerId || null
  };
}

async function requireUser(request) {
  const header = request.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    throw httpError(401, 'Authentication required.');
  }
  return admin.auth().verifyIdToken(header.slice('Bearer '.length));
}

function getStripe() {
  return new Stripe(requiredSecret(STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY'));
}

function requiredSecret(secret, name) {
  const value = secret.value();
  if (!value) {
    throw httpError(503, `${name} is not configured.`);
  }
  return value;
}

function appUrl(request) {
  return process.env.APP_URL || `${request.protocol}://${request.get('host')}`;
}

function handleCors(request, response) {
  Object.entries(corsHeaders).forEach(([key, value]) => response.set(key, value));
  if (request.method === 'OPTIONS') {
    response.status(204).send('');
    return false;
  }
  return true;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sendError(response, error) {
  response.status(error.statusCode || 500).json({
    ok: false,
    error: error.message || 'Billing request failed.'
  });
}
