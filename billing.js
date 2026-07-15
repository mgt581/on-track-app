const BILLING_FUNCTIONS_BASE_URL = 'https://us-central1-on-track-73a59.cloudfunctions.net';

export const STRIPE_PAYMENT_LINKS = {
  duo: 'https://buy.stripe.com/7sY5kCgu79Uq5CG3VAcAo02',
  team5: 'https://buy.stripe.com/5kQ5kC5PtaYu5CG8bQcAo01',
  team10: 'https://buy.stripe.com/4gMcN40v9feK9SW77McAo00'
};

export function getStripePaymentLink(planKey) {
  return STRIPE_PAYMENT_LINKS[planKey] || '';
}

export async function getBillingStatus(user) {
  return requestBillingFunction('/getBillingStatus', user);
}

export async function startBillingCheckout(user, planKey) {
  return requestBillingFunction('/createCheckoutSession', user, {
    method: 'POST',
    body: JSON.stringify({ planKey })
  });
}

export async function openBillingPortal(user) {
  return requestBillingFunction('/createPortalSession', user, {
    method: 'POST'
  });
}

async function requestBillingFunction(path, user, options = {}) {
  if (!user) {
    throw new Error('Please sign in before managing billing.');
  }

  const token = await user.getIdToken();
  const response = await fetch(`${BILLING_FUNCTIONS_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || 'Billing request failed.');
  }

  return payload;
}
