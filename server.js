import express from 'express';
import Stripe from 'stripe';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors({ origin:'https://dman6969.github.io' }));
app.use(express.json());

app.post('/create-session', async (req, res) => {
  try {
    const { priceId, clientEmail } = req.body;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      client_reference_id: clientEmail,
      success_url: `https://dman6969.github.io/?success=true`,
      cancel_url:  `https://dman6969.github.io/?canceled=true`
    });
    res.json({ sessionId: session.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// Stripe webhook endpoint to record completed checkouts
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('⚠️  Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.client_reference_id;
    // TODO: persist email → paid status in your store
    console.log(`✅ User ${email} completed checkout.`);
  }
  res.json({ received: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on port ${port}`));