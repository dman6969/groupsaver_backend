import express from 'express';
import Stripe from 'stripe';
import cors from 'cors';
import dotenv from 'dotenv';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { GoogleSpreadsheet } = require('google-spreadsheet');

dotenv.config();

// Load Google Service Account credentials from local JSON file or environment variable
import fs from 'fs';
const creds = JSON.parse(
  process.env.GSHEETS_CREDS || fs.readFileSync('./sheets-credentials.json', 'utf8')
);

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);


// Load and access the "Paid" sheet (using updated google-spreadsheet syntax)
const doc = new GoogleSpreadsheet('1wgsIPnScSk8JMPCvoEaa5YeeEkil9TjbniY1v1VTBfI');
let sheet; // will be initialised asynchronously
(async () => {
  await doc.useServiceAccountAuth({
    client_email: creds.client_email,
    private_key: creds.private_key,
  });
  await doc.loadInfo();
  sheet = doc.sheetsByTitle['Paid'];
  await sheet.loadHeaderRow();   // ensure header row exists
  console.log('✅ Google Sheet loaded and ready');
})();

const app = express();
app.use(cors({
  origin: [
    'https://dman6969.github.io',
    'https://groupsaverai.com',
    'https://www.groupsaverai.com',
    'chrome-extension://*',
    'http://localhost:5500',
    'http://localhost:3000'
  ]
}));

/**
 * Create a Stripe Checkout Session
 */
app.post('/create-session', express.json(), async (req, res) => {
  try {
    const { priceId, clientEmail } = req.body;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      client_reference_id: clientEmail,
      success_url: `https://groupsaverai.com/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://groupsaverai.com/cancel.html`,
      expand: ['line_items.data.price.product']   // <- NEW: include full line_items in webhook payload
    });
    console.log(`Created Checkout Session ${session.id} for ${clientEmail} with priceId ${priceId}`);
    res.json({ sessionId: session.id });
  } catch (err) {
    console.error('Error creating checkout session:', err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * Check if a user is whitelisted for the extension
 * GET /is-active?email=user@example.com  → { active:true/false }
 */
app.get('/is-active', async (req, res) => {
  try {
    const email = (req.query.email || '').toLowerCase();
    const rows = await sheet.getRows();
    const active = rows.some(row => row.Email?.toLowerCase() === email);
    res.json({ active });
  } catch (err) {
    console.error('Error checking active status:', err);
    res.status(500).json({ active: false });
  }
});

/**
 * Stripe webhook endpoint to record completed checkouts
 */
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    try {
      const session = event.data.object;
      console.log('Webhook received for Session', session.id);
      const email = session.client_reference_id || session.customer_email || 'unknown';
      const timestamp = new Date().toISOString();
      addEmail(email); // whitelist for Chrome extension

      // We already know this is a paid session; use a generic plan label
      const fullPlan = session.metadata?.planName || session?.display_items?.[0]?.custom?.name || 'Subscription';
      // Append to Google Sheet
      await sheet.addRow({ Email: email, Plan: fullPlan, Timestamp: timestamp });
      console.log(`✅ User ${email} subscribed to ${fullPlan}`);
    } catch (error) {
      console.error('❌ Error writing to Google Sheet:', error);
    }
  }

  res.json({ received: true });
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Listening on port ${port}`));