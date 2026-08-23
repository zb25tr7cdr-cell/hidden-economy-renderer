// Posts the render result back to the Base44 app's renderCallback endpoint.
// Usage: node callback.js <status> <mp4_url> <message>
const url = process.env.CALLBACK_URL;
const token = process.env.CALLBACK_TOKEN;
const jobId = process.env.JOB_ID;
const status = process.argv[2] || 'failed';
const mp4Url = process.argv[3] || '';
const message = process.argv[4] || '';

if (!url || !token) {
  console.log('No callback URL/token configured — skipping callback.');
  process.exit(0);
}

const body = JSON.stringify({ job_id: jobId, status, mp4_url: mp4Url, message });

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-callback-token': token },
    body
  });
  console.log(`Callback sent (status=${status}, http=${res.status}).`);
} catch (e) {
  console.log(`Callback error: ${e.message}`);
}