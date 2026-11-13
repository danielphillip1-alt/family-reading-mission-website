import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import pg from 'pg';
import Stripe from 'stripe';
import { handleStripeWebhook } from './stripe-webhook.mjs';
import { handleBooks, processDueDeliveries } from './book-delivery.mjs';
import { processPaymentLinkDeliveries } from './payment-link-delivery.mjs';

const deriveKey = promisify(scrypt);
const { DATABASE_URL, STRIPE_PRICE_ID, STRIPE_ANNUAL_PRICE_ID, APP_URL } = process.env;
// Accept well-known Stripe secret-key environment names without exposing any key.
const STRIPE_API_KEY = process.env.STRIPE_API_KEY || process.env.STRIPE_SECRET_KEY ||
  process.env.STRIPE_LIVE_SECRET_KEY || process.env.STRIPE_RESTRICTED_KEY || process.env.STRIPE_LIVE_API_KEY || process.env.Stripe_API_Key;
const appUrl = new URL(APP_URL);
const productionMode = process.env.AOM_ENV === 'production';
if (STRIPE_API_KEY && !(productionMode ? /^(rk|sk)_live_/ : /^(rk|sk)_test_/).test(STRIPE_API_KEY)) {
  throw new Error('Stripe key mode does not match the deployment environment.');
}
const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL }) : null;
const stripe = STRIPE_API_KEY && new Stripe(STRIPE_API_KEY, { maxNetworkRetries: 2, timeout: 8000 });
const productionCookies = appUrl.protocol === 'https:' ? '; Secure' : '';
const cookieName = productionCookies ? '__Host-aom-session' : 'aom-session';
const sessionSeconds = 7 * 24 * 60 * 60;
const portalConfig = process.env.STRIPE_PORTAL_CONFIGURATION_ID;
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/sample-de.html', ['sample-de.html', 'text/html; charset=utf-8']],
  ['/sample-en.html', ['sample-en.html', 'text/html; charset=utf-8']],
  ['/sample-pt.html', ['sample-pt.html', 'text/html; charset=utf-8']],
  ['/authors-on-a-mission-logo.png', ['authors-on-a-mission-logo.png', 'image/png']],
]);

if (pool) await pool.query(`
  CREATE TABLE IF NOT EXISTS members (
    id uuid PRIMARY KEY,
    email text UNIQUE NOT NULL,
    password_hash bytea NOT NULL,
    salt bytea NOT NULL,
    stripe_customer_id text UNIQUE,
    checkout_attempt uuid,
    checkout_attempt_at timestamptz
  );
  CREATE TABLE IF NOT EXISTS aom_stripe_webhook_events (
    stripe_event_id text PRIMARY KEY,
    event_type text NOT NULL,
    processed_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS aom_subscription_states (
    stripe_subscription_id text PRIMARY KEY,
    member_id uuid NOT NULL REFERENCES members(id),
    stripe_customer_id text NOT NULL,
    status text NOT NULL,
    current_period_end timestamptz,
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE members ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
  ALTER TABLE members ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en'
    CHECK (preferred_language IN ('en','de','pt-PT'));
  CREATE TABLE IF NOT EXISTS aom_releases (
    id uuid PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    status text NOT NULL CHECK (status IN ('draft','approved','published','withdrawn')),
    published_at timestamptz
  );
  CREATE TABLE IF NOT EXISTS aom_release_editions (
    release_id uuid NOT NULL REFERENCES aom_releases(id) ON DELETE CASCADE,
    language text NOT NULL CHECK (language IN ('en','de','pt-PT')),
    private_object_key text NOT NULL,
    sha256 text NOT NULL,
    approved_at timestamptz,
    PRIMARY KEY (release_id,language)
  );
  CREATE TABLE IF NOT EXISTS aom_book_files (
    storage_key text PRIMARY KEY,
    pdf_content bytea NOT NULL,
    sha256 text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT aom_pdf_size CHECK (octet_length(pdf_content) > 100 AND octet_length(pdf_content) <= 12582912)
  );
  CREATE TABLE IF NOT EXISTS aom_delivery_outbox (
    id uuid PRIMARY KEY,
    release_id uuid NOT NULL REFERENCES aom_releases(id),
    member_id uuid NOT NULL REFERENCES members(id),
    kind text NOT NULL CHECK (kind IN ('welcome','release')),
    language text NOT NULL CHECK (language IN ('en','de','pt-PT')),
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','sent','retry','failed','cancelled')),
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    provider_message_id text,
    UNIQUE (release_id,member_id,kind)
  );
  CREATE INDEX IF NOT EXISTS aom_delivery_pending_idx ON aom_delivery_outbox(state,next_attempt_at);
  CREATE TABLE IF NOT EXISTS aom_direct_subscriptions (
    stripe_subscription_id text PRIMARY KEY,
    stripe_customer_id text NOT NULL,
    email text NOT NULL,
    language text NOT NULL CHECK(language IN ('en','de','pt-PT')),
    status text NOT NULL,
    current_period_end timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS aom_direct_delivery_outbox (
    id uuid PRIMARY KEY,
    stripe_subscription_id text NOT NULL REFERENCES aom_direct_subscriptions(stripe_subscription_id),
    release_id uuid NOT NULL REFERENCES aom_releases(id),
    language text NOT NULL,
    state text NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    provider_message_id text,
    UNIQUE(stripe_subscription_id,release_id)
  );
  CREATE INDEX IF NOT EXISTS aom_direct_delivery_pending_idx ON aom_direct_delivery_outbox(state,next_attempt_at);
  CREATE TABLE IF NOT EXISTS aom_launch_interest (
    email text PRIMARY KEY,
    language text NOT NULL DEFAULT 'en',
    consented_at timestamptz NOT NULL DEFAULT now(),
    source text NOT NULL DEFAULT 'website'
  );
  CREATE TABLE IF NOT EXISTS aom_payment_link_memberships (
    stripe_subscription_id text PRIMARY KEY,
    stripe_customer_id text NOT NULL,
    email text NOT NULL,
    plan text NOT NULL CHECK (plan IN ('monthly','annual')),
    language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','de','pt-PT')),
    status text NOT NULL,
    current_period_end timestamptz,
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    joined_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS aom_payment_link_delivery_outbox (
    id uuid PRIMARY KEY,
    stripe_subscription_id text NOT NULL REFERENCES aom_payment_link_memberships(stripe_subscription_id),
    release_id uuid NOT NULL REFERENCES aom_releases(id),
    kind text NOT NULL CHECK (kind IN ('welcome','release')),
    language text NOT NULL CHECK (language IN ('en','de','pt-PT')),
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','sent','retry','failed','cancelled')),
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    provider_message_id text,
    UNIQUE (stripe_subscription_id,release_id)
  );
  CREATE INDEX IF NOT EXISTS aom_payment_link_delivery_queue_idx ON aom_payment_link_delivery_outbox(state,next_attempt_at);
  CREATE TABLE IF NOT EXISTS member_sessions (
    token_hash text PRIMARY KEY,
    member_id uuid NOT NULL REFERENCES members(id),
    expires_at timestamptz NOT NULL
  );
`);

async function publishedBookReady() {
  if (!pool) return false;
  const current = new Date();
  const year = current.getUTCFullYear() - (current.getUTCMonth() < 10 ? 1 : 0);
  const cycleStart = new Date(Date.UTC(year, 10, 1));
  const result = await pool.query(`SELECT 1 FROM aom_releases r
    JOIN aom_release_editions e ON e.release_id=r.id
    JOIN aom_book_files f ON f.storage_key=e.private_object_key AND f.sha256=e.sha256
    WHERE r.status='published' AND r.published_at<=now() AND r.published_at >= $1
      AND e.approved_at IS NOT NULL
    GROUP BY r.id HAVING COUNT(DISTINCT e.language)=3 LIMIT 1`, [cycleStart]);
  return result.rowCount > 0;
}
async function billingReady() {
  return Boolean(pool && stripe && STRIPE_PRICE_ID && STRIPE_ANNUAL_PRICE_ID &&
    process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_PORTAL_CONFIGURATION_ID &&
    process.env.AOM_RESEND_API_KEY && process.env.AOM_FROM_EMAIL) && await publishedBookReady();
}
function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

function redirect(res, url) {
  res.writeHead(303, { Location: url });
  res.end();
}

function page(title, body) {
  return `<!doctype html><html lang="en"><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | Authors on a Mission</title>
  <style>
    body{background:#fff3d7;color:#073d2e;font:1rem/1.5 Arial,sans-serif;padding:2rem}
    main{max-width:34rem;margin:auto;background:white;border-radius:1rem;padding:2rem}
    label{display:block;margin:1rem 0}input{box-sizing:border-box;width:100%;padding:.7rem;font:inherit}
    button{background:#073d2e;color:white;font:inherit;border:0;border-radius:.5rem;padding:.7rem 1rem;cursor:pointer}
    form+form{margin-top:1rem}a{color:inherit}
  </style><main><a href="/">Authors on a Mission</a><h1>${title}</h1>${body}</main></html>`;
}

function authForm(join, message = '') {
  const title = join ? (productionMode ? 'Create an account' : 'Create a test account') : 'Sign in';
  const other = join ? '<a href="/signin">Sign in</a>' : '<a href="/register">Create an account</a>';
  return page(title, `<p>${productionMode ? 'Sign in to access your membership.' : 'Stripe sandbox. Use test details and a password you do not use elsewhere.'}</p>
  ${message && `<p role="alert">${message}</p>`}
  <form method="post">
    <label>Email <input name="email" type="email" autocomplete="username" required maxlength="254"></label>
    <label>Password <input name="password" type="password" required minlength="12" maxlength="128"
      autocomplete="${join ? 'new-password' : 'current-password'}"></label>
    <button>${title}</button>
  </form><p>${other}</p>`);
}

async function credentials(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) return null;
    chunks.push(chunk);
  }
  const data = new URLSearchParams(Buffer.concat(chunks).toString());
  const email = (data.get('email') ?? '').trim().toLowerCase();
  const password = data.get('password') ?? '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 12 || password.length > 128) return null;
  return { email, password };
}

const hashToken = (token) => createHash('sha256').update(token).digest('hex');
function sessionToken(req) {
  const value = req.headers.cookie?.split('; ').find((item) => item.startsWith(cookieName + '='))?.split('=')[1];
  return /^[0-9a-f]{64}$/.test(value ?? '') ? value : null;
}

async function signIn(res, memberId) {
  const token = randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO member_sessions VALUES ($1, $2, now() + $3 * interval \'1 second\')',
    [hashToken(token), memberId, sessionSeconds],
  );
  res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionSeconds}${productionCookies}`);
  redirect(res, '/member');
}

async function currentMember(req) {
  const token = sessionToken(req);
  if (!token) return null;
  const result = await pool.query(
    `SELECT members.id, stripe_customer_id FROM member_sessions
     JOIN members ON members.id = member_id WHERE token_hash = $1 AND expires_at > now()`,
    [hashToken(token)],
  );
  return result.rows[0];
}

const attempts = new Map();
function throttle(req) {
  const ip = req.headers['x-forwarded-for']?.split(',').at(-1)?.trim() ?? req.socket.remoteAddress;
  const now = Date.now();
  if (attempts.size >= 2000) {
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    if (attempts.size >= 2000 && !attempts.has(ip)) return true;
  }
  let count = attempts.get(ip);
  if (!count || count.until < now) {
    count = { until: now + 60000, attempts: 0 };
    attempts.set(ip, count);
  }
  return ++count.attempts > 10;
}

async function handleAuth(req, res, join) {
  if (throttle(req)) return send(res, 429, authForm(join, 'Too many attempts. Try again in a minute.'));
  const input = await credentials(req);
  if (!input) return send(res, 400, authForm(join, 'Enter an email and a password between 12 and 128 characters.'));
  const { email, password } = input;
  if (join) {
    const salt = randomBytes(16);
    const hash = await deriveKey(password, salt, 64);
    const { rows } = await pool.query(
      'INSERT INTO members (id, email, password_hash, salt) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING RETURNING id',
      [randomUUID(), email, hash, salt],
    );
    if (rows[0]) return signIn(res, rows[0].id);
    return send(res, 409, authForm(join, 'Could not create this account. Try signing in or use a different test email.'));
  }
  const { rows: [member] } = await pool.query('SELECT id, password_hash, salt FROM members WHERE email = $1', [email]);
  const hash = await deriveKey(password, member?.salt ?? Buffer.alloc(16), 64);
  if (!member || !timingSafeEqual(hash, member.password_hash)) {
    return send(res, 401, authForm(false, 'Check your email and password and try again.'));
  }
  return signIn(res, member.id);
}

async function checkout(memberId, billingPlan) {
  if (!['monthly', 'annual'].includes(billingPlan)) throw new Error('Invalid membership plan');
  const selectedPrice = billingPlan === 'annual' ? STRIPE_ANNUAL_PRICE_ID : STRIPE_PRICE_ID;
  if (!selectedPrice) throw new Error('This membership plan has not been configured yet');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: [member] } = await db.query('SELECT * FROM members WHERE id = $1 FOR UPDATE', [memberId]);
    let customer = member.stripe_customer_id;
    if (!customer) {
      const created = await stripe.customers.create(
        { email: member.email, metadata: { member_id: memberId } },
        { idempotencyKey: `member-customer-${memberId}` },
      );
      customer = created.id;
      await db.query('UPDATE members SET stripe_customer_id = $1 WHERE id = $2', [customer, memberId]);
    }
    let subscribed = false;
    for await (const subscription of stripe.subscriptions.list({ customer, status: 'all', limit: 20 })) {
      if (['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'].includes(subscription.status)) {
        subscribed = true;
        break;
      }
    }
    if (subscribed) {
      await db.query('COMMIT');
      return '/member?status=existing';
    }
    const existing = await stripe.checkout.sessions.list({ customer, status: 'open', limit: 10 });
    const open = existing.data.find((session) => session.client_reference_id === memberId && session.url && session.metadata?.billing_plan === billingPlan);
    if (open) {
      await db.query('COMMIT');
      return open.url;
    }
    let attempt = member.checkout_attempt;
    if (!attempt || Date.now() - member.checkout_attempt_at.getTime() > 2 * 60 * 1000) {
      attempt = randomUUID();
      await db.query('UPDATE members SET checkout_attempt = $1, checkout_attempt_at = now() WHERE id = $2', [attempt, memberId]);
    }
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer,
        client_reference_id: memberId,
        subscription_data: { metadata: { member_id: memberId } },
        line_items: [{ price: selectedPrice, quantity: 1 }],
        metadata: { billing_plan: billingPlan },
        billing_address_collection: 'required',
        customer_update: { address: 'auto' },
        automatic_tax: { enabled: true },
        success_url: new URL('/member?status=submitted', appUrl).href,
        cancel_url: new URL('/member?status=canceled', appUrl).href,
      }, { idempotencyKey: `member-checkout-${billingPlan}-${attempt}` });
      await db.query('COMMIT');
      return session.url;
    } catch (error) {
      await db.query('COMMIT');
      throw error;
    }
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

const messages = {
  existing: 'You already have a subscription. Use Manage membership to view it.',
  submitted: 'You returned from Stripe Checkout. Use Manage membership to check your subscription.',
  canceled: 'You returned from checkout. You can start it again below.',
};

const server = createServer(async (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(req.url, appUrl);
    const { pathname } = url;
    if (pathname === '/stripe/webhook' && req.method === 'POST') {
      return handleStripeWebhook({req,res,stripe,pool,secret:process.env.STRIPE_WEBHOOK_SECRET});
    }
    if (req.method === 'POST' && !pathname.startsWith('/api/admin/') && req.headers.origin !== appUrl.origin) return send(res, 403, 'Request rejected.');
    if (pathname === '/join' && req.method === 'GET') return redirect(res,
      await billingReady() ? '/register' : '/early-access');
    if (pathname === '/health' && req.method === 'GET') return send(res, 200, 'ok', 'text/plain');
    if (pathname === '/ready' && req.method === 'GET') {
      const configured = Boolean(pool && stripe && STRIPE_PRICE_ID && STRIPE_ANNUAL_PRICE_ID &&
        process.env.STRIPE_WEBHOOK_SECRET && process.env.AOM_ADMIN_API_TOKEN);
      let database = false;
      if (pool) {
        try { await pool.query('SELECT 1'); database = true; } catch { database = false; }
      }
      const email = Boolean(process.env.AOM_RESEND_API_KEY && process.env.AOM_FROM_EMAIL);
      let bookInventory = false;
      if (database) {try {bookInventory = await publishedBookReady();} catch {bookInventory = false;}}
      const ready = configured && database && (!productionMode || (Boolean(portalConfig) && email && bookInventory));
      return send(res, ready ? 200 : 503, JSON.stringify({
        ready,
        database,
        monthly_price: Boolean(STRIPE_PRICE_ID),
        annual_price: Boolean(STRIPE_ANNUAL_PRICE_ID),
        stripe_configured: Boolean(stripe),
        webhook_configured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
        admin_configured: Boolean(process.env.AOM_ADMIN_API_TOKEN),
        portal_configured: Boolean(portalConfig),
        email_configured: email,
        approved_book_inventory: bookInventory,
        deployment: productionMode ? 'production' : 'sandbox'
      }), 'application/json; charset=utf-8');
    }
    if (files.has(pathname) && req.method === 'GET') {
      const [file, type] = files.get(pathname);
      let body = await readFile(new URL('../' + file, import.meta.url));
      if (file === 'index.html') {
        body = body.toString().replace('https://buy.stripe.com/test_5kQ8wIgah0Vk2dS1ji2ZO00', '/member')
          .replace('https://billing.stripe.com/p/login/test_5kQ8wIgah0Vk2dS1ji2ZO00', '/member');
      }
      return send(res, 200, body, type);
    }
    if (pathname === '/early-access') {
      if (req.method === 'GET') return send(res, 200, page('Get the membership launch link', `
        <p>Authors On A Mission is preparing secure memberships and the first downloadable story. Leave your email and we will contact you when purchasing is available.</p>
        <p><strong>Monthly €3.99 • Yearly €39.90</strong> (two months free). No payment is taken here.</p>
        <form method="post" action="/early-access">
          <label>Your email <input name="email" type="email" autocomplete="email" required maxlength="254"></label>
          <label>Preferred language <select name="language"><option value="en">English</option><option value="de">Deutsch</option><option value="pt-PT">Português</option></select></label>
          <label><input name="consent" type="checkbox" value="yes" required style="width:auto"> I agree to receive an email about this membership opening. I can request removal at any time.</label>
          <button>Notify me when memberships open</button>
        </form><p><a href="/">Return to the website</a></p>`));
      if (req.method === 'POST') {
        if (!pool) return send(res,503,'Database unavailable');
        if (throttle(req)) return send(res,429,page('Please try again shortly','<p>Too many requests.</p>'));
        const chunks=[];let size=0;
        for await(const chunk of req) {size+=chunk.length;if(size>2048)return send(res,413,'Request too large');chunks.push(chunk);}
        const values=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        const email=(values.get('email')||'').trim().toLowerCase(),language=values.get('language');
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 ||
           !['en','de','pt-PT'].includes(language) || values.get('consent')!=='yes')
          return send(res,400,page('Check your details','<p>Please provide a valid email, language and consent.</p><p><a href="/early-access">Try again</a></p>'));
        await pool.query(`INSERT INTO aom_launch_interest(email,language) VALUES($1,$2)
           ON CONFLICT(email) DO UPDATE SET language=excluded.language`,[email,language]);
        return send(res,200,page('Thank you','<p>You are on the launch-notification list. You have not been charged. We will email you when the books and checkout are ready.</p><p><a href="/">Return to the website</a></p>'));
      }
    }
    if (!pool) return send(res, 503, page('Member setup pending', '<p>The membership database connection is temporarily unavailable.</p>'));
    if (pathname.startsWith('/api/') && await handleBooks(req,res,url,currentMember,pool)) return;
    if (pathname === '/register' || pathname === '/signin') {
      if (req.method === 'GET') return send(res, 200, authForm(pathname === '/register'));
      if (req.method === 'POST') return await handleAuth(req, res, pathname === '/register');
    }
    if (pathname === '/member' && req.method === 'GET') {
      const member = await currentMember(req);
      if (!member) return redirect(res, '/signin');
      const status = url.searchParams.get('status');
      const notice = Object.hasOwn(messages, status) ? messages[status] : '';
      const cycleStart = new Date();
      cycleStart.setUTCFullYear(cycleStart.getUTCFullYear() - (cycleStart.getUTCMonth() < 10 ? 1 : 0), 10, 1);
      cycleStart.setUTCHours(0, 0, 0, 0);
      const { rows: [releaseCount] } = await pool.query(
        "SELECT COUNT(*)::int AS total FROM aom_releases WHERE status='published' AND published_at >= $1 AND published_at <= now()", [cycleStart]
      );
      const readyCount = releaseCount.total;
      const cycleLabel = cycleStart.getUTCFullYear();
      return send(res, 200, page(productionMode ? 'Your membership' : 'Your test membership', `
        ${notice && `<p role="status">${notice}</p>`}
        <p>Choose your plan. Both renew automatically unless you cancel before your next renewal date. Cancel through Manage membership and keep access until the paid period ends.</p>
        <section aria-labelledby="reading-year"><h2 id="reading-year" data-released="${readyCount}">Your reading year: November ${cycleLabel} – October ${cycleLabel+1}</h2>
        <p><strong>${readyCount} approved ${readyCount===1?'book has':'books have'} been released</strong> so far in this reading cycle. All released books available in your selected language are unlocked with an active membership. New books and their accompanying reading activities become available as they are published. The November reading cycle is separate from the billing anniversary: a yearly subscription renews 12 months after you sign up, not automatically every November.</p>
        <p>Example: If you join in March after four monthly books have been published (November through February), all four are available immediately. You then receive new publications as they are released while your subscription is active.</p></section>
        <form class="plan-checkout" method="post" action="/checkout">
          <input type="hidden" name="plan" value="monthly">
          <button>€3.99 per month — renews monthly</button>
        </form>
        <form class="plan-checkout" method="post" action="/checkout">
          <input type="hidden" name="plan" value="annual">
          <button>€39.90 per year — 2 months free; renews annually</button>
        </form>
        <p>Annual membership saves €7.98 (16.7%) compared with 12 monthly payments. Taxes are included where applicable.</p>
        <dialog id="aom-plan-dialog" aria-labelledby="plan-dialog-heading" style="max-width:28rem;border:1px solid #073d2e;border-radius:1rem;padding:1.5rem">
          <h2 id="plan-dialog-heading">Before you subscribe</h2>
          <p id="plan-dialog-text"></p>
          <p>You can cancel automatic renewal in Manage membership. Access continues until the end of your paid term.</p>
          <button type="button" id="confirm-plan">Continue to secure payment</button>
          <button type="button" id="close-plan" style="background:#eee;color:#073d2e">Go back</button>
        </dialog>
        <script>
          (() => {
            const d=document.getElementById('aom-plan-dialog');
            let pending=null;
            document.querySelectorAll('.plan-checkout').forEach(f=>f.addEventListener('submit',e=>{
              e.preventDefault();pending=f;
              const annual=f.querySelector('[name=plan]').value==='annual';
              document.getElementById('plan-dialog-text').textContent=
                String(document.getElementById('reading-year').dataset.released) + ' approved book(s) have been released in the current November-to-October reading cycle. You can access previously published books immediately, with new releases arriving during your active membership. '+
                (annual?'€39.90 will be charged now and automatically every 12 months unless you cancel.':'€3.99 will be charged now and automatically every month unless you cancel.');
              d.showModal();
            }));
            document.getElementById('close-plan').onclick=()=>d.close();
            document.getElementById('confirm-plan').onclick=()=>{if(pending)pending.submit();};
          })();
        </script>
        ${member.stripe_customer_id ? '<form method="post" action="/portal"><button>Manage membership</button></form>' : ''}
        <section id="aom-books-panel">
          <h2>Your books</h2>
          <label for="reading-language">Reading language</label>
          <select id="reading-language"><option value="en">English</option><option value="de">Deutsch</option><option value="pt-PT">Português</option></select>
          <button type="button" id="save-language">Save language</button>
          <p id="book-status" role="status">Checking membership...</p>
          <ul id="book-list"></ul>
        </section>
        <script>
        (async()=>{
          const status=document.getElementById('book-status'),list=document.getElementById('book-list'),choice=document.getElementById('reading-language');
          async function reload(){
            const resp=await fetch('/api/books',{credentials:'same-origin'});
            const data=await resp.json();
            list.textContent='';
            if(!resp.ok){status.textContent=data.error||'Books unavailable';return;}
            choice.value=data.language;
            status.textContent=data.books.length ? 'Choose a book to download:' : 'Your first book is not available yet.';
            for(const book of data.books){
              const item=document.createElement('li'),link=document.createElement('a');
              link.href=book.download;link.textContent=book.slug.replaceAll('-',' ');item.append(link);list.append(item);
            }
          }
          document.getElementById('save-language').addEventListener('click',async()=>{
            const resp=await fetch('/api/me/language',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({language:choice.value})});
            if(resp.ok)await reload();else status.textContent='Language update failed.';
          });
          await reload();
        })();
        </script>
        <form method="post" action="/signout"><button>Sign out</button></form>`));
    }
    if (req.method === 'POST' && ['/checkout', '/portal', '/signout'].includes(pathname)) {
      const member = await currentMember(req);
      if (!member) return redirect(res, '/signin');
      if (pathname === '/signout') {
        await pool.query('DELETE FROM member_sessions WHERE token_hash = $1', [hashToken(sessionToken(req))]);
        res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${productionCookies}`);
        return redirect(res, '/');
      }
      if (!stripe || !STRIPE_PRICE_ID) return send(res, 503, page('Checkout setup pending', '<p>The Stripe payment configuration is not ready.</p><a href="/member">Back to membership</a>'));
      if (pathname === '/checkout' && productionMode && !await billingReady())
        return send(res, 503, page('Membership opening shortly',
          '<p>Membership checkout is not open until the first approved books and delivery emails are ready.</p><p><a href="/early-access">Get a launch notification instead</a></p>'));
      if (pathname === '/checkout') {
        const parts = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 2048) return send(res, 413, 'Invalid plan');
          parts.push(chunk);
        }
        const form = new URLSearchParams(Buffer.concat(parts).toString());
        const plan = form.get('plan') || 'monthly';
        if (!['monthly', 'annual'].includes(plan)) return send(res, 400, 'Invalid plan');
        if (plan === 'annual' && !STRIPE_ANNUAL_PRICE_ID) return send(res, 503, page('Annual plan pending', '<p>The annual price is not connected yet.</p><a href="/member">Back to membership</a>'));
        return redirect(res, await checkout(member.id, plan));
      }
      if (!member.stripe_customer_id) return redirect(res, '/member');
      if (!portalConfig) return send(res, 503, page('Membership management unavailable', '<p>The customer portal has not been configured yet.</p>'));
      const portal = await stripe.billingPortal.sessions.create({
        customer: member.stripe_customer_id,
        configuration: portalConfig,
        return_url: new URL('/member', appUrl).href,
      });
      return redirect(res, portal.url);
    }
    send(res, 404, 'Page not found.');
  } catch (error) {
    console.error('Membership request failed', error.code ?? error.name, error.requestId ?? '');
    send(res, 500, page('Something went wrong', '<p>Please try again.</p><a href="/member">Back to membership</a>'));
  }
});

let deliveryBusy = false;
async function deliverDueBooks() {
  if (deliveryBusy || !pool || !process.env.AOM_RESEND_API_KEY || !process.env.AOM_FROM_EMAIL) return;
  deliveryBusy = true;
  try { await processDueDeliveries(pool); await processPaymentLinkDeliveries(pool); }
  catch (error) { console.error('Automatic book delivery failed', error?.code || error?.name); }
  finally { deliveryBusy = false; }
}
server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
setInterval(deliverDueBooks, 60_000).unref();
setTimeout(deliverDueBooks, 5_000).unref();
