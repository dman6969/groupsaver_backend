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
await doc.useServiceAccountAuth({
  client_email: creds.client_email,
  private_key: creds.private_key,
});
await doc.loadInfo();
const sheet = doc.sheetsByTitle['Paid'];
await sheet.loadHeaderRow(); // ensure header row (Email | Plan | Timestamp) is loaded

const app = express();
app.use(cors({
  origin: [
    'https://dman6969.github.io',   // production static site
    'http://localhost:5500',        // local dev server for index.html
    'http://localhost:3000'         // self‑origin (optional)
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
      success_url: `https://dman6969.github.io/group_saver/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://dman6969.github.io/group_saver/cancel.html`,
      expand: ['line_items.data.price.product']   // <- NEW: include full line_items in webhook payload
    });
    res.json({ sessionId: session.id });
  } catch (err) {
    console.error('Error creating checkout session:', err);
    res.status(500).json({ message: err.message });
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
      const email = session.client_reference_id || session.customer_email || 'unknown';
      const timestamp = new Date().toISOString();

      // ---------- Fetch the plan details ----------
      // Some Stripe CLI fixtures return a session ID that no longer exists
      // by the time we request listLineItems.  Instead, expand line_items
      // right on the session so we always have them.
      let lineItems;

      if (session.line_items) {
        // Already expanded (live checkout with expand or future API version)
        lineItems = session.line_items;
      } else {
        // Retrieve again with the expand parameter so we get line_items
        const sessWithItems = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['line_items.data.price.product']
        });
        lineItems = sessWithItems.line_items;
      }

      const priceInfo = lineItems.data[0].price;
      const product =
        typeof priceInfo.product === 'string'
          ? await stripe.products.retrieve(priceInfo.product)
          : priceInfo.product;

      const planName = product.name || priceInfo.nickname || 'Unknown Plan';
      const interval = priceInfo.recurring?.interval || 'one-time';
      const fullPlan = `${planName} (${interval})`;

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
app.listen(port, () => console.log(`Listening on port ${port}`));