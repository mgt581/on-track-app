const BILLING_FUNCTIONS_BASE_URL = 'https://us-central1-on-track-73a59.cloudfunctions.net';

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
