import express from 'express';
import Stripe from 'stripe';
import cors from 'cors';
import dotenv from 'dotenv';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { GoogleSpreadsheet } = require('google-spreadsheet');

dotenv.config();

// Load Google Service Account credentials from env vars and file
import fs from 'fs';
const creds = {
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  private_key: fs.readFileSync(process.env.GOOGLE_PRIVATE_KEY_PATH, 'utf-8'),
};

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

const app = express();
app.use(cors({ origin: 'https://dman6969.github.io' }));

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

      // Fetch the plan details
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
      const priceInfo = lineItems.data[0].price;
      const price = await stripe.prices.retrieve(priceInfo.id);
      const product = await stripe.products.retrieve(price.product);
      const planName = product.name || price.nickname || 'Unknown Plan';
      const interval = price.recurring?.interval || 'one-time';
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