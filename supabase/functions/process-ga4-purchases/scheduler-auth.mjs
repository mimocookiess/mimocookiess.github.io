const SCHEDULER_SECRET_HEADER = "x-mimo-scheduler-secret";
const encoder = new TextEncoder();

async function sha256(value) {
  const bytes = encoder.encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function isSchedulerAuthorized(request, expectedSecret) {
  const receivedSecret = request.headers.get(SCHEDULER_SECRET_HEADER) || "";
  const normalizedExpectedSecret = expectedSecret || "";
  const [receivedDigest, expectedDigest] = await Promise.all([
    sha256(receivedSecret),
    sha256(normalizedExpectedSecret)
  ]);
  let difference = 0;

  for (let index = 0; index < receivedDigest.length; index += 1) {
    difference |= receivedDigest[index] ^ expectedDigest[index];
  }

  return receivedSecret.length > 0 &&
    normalizedExpectedSecret.length > 0 &&
    difference === 0;
}
