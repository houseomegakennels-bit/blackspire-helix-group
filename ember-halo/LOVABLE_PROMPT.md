# Ember Halo — Lovable Frontend Build Prompt
# Drop this entire prompt into Lovable to generate the frontend.

---

Build a luxury roses-only concierge app called **Ember Halo**.

## Brand & Visual Direction

- App name: **Ember Halo**
- Logo: Abstract ember glow with a halo/flame ring. Warm orange/gold energy. Minimal luxury mark. No roses, hearts, or romantic symbols in the logo itself.
- Color palette: Black backgrounds (#0A0A0A, #111111), deep charcoal (#1A1A1A), warm gold accents (#C9A84C, #E8C96B), deep red for rose hints (#8B1A1A), pure white text (#FAFAFA)
- Typography: Elegant serif for headings (Playfair Display or similar), clean sans-serif for body/chat (Inter or similar)
- Animations: Soft fade-in/fade-out, subtle blur dissolve, floating motion, ease-in-out. Duration 700–1200ms. No flashy, arcade-style, or gimmicky effects.
- Overall feel: Private luxury lifestyle app. Late-night concierge energy. Not a flower shop.

---

## Frontend State Machine

The app has exactly these states. Implement as a React state variable:

```
locked_gate → nda_pending → unlocked_customer_ui → quote_pending → checkout_pending → booking_confirmed → post_service_followup
```

**State rules:**
- `locked_gate`: Only the compliance chatbox visible. No packages, no prices, no navigation.
- `nda_pending`: Compliance confirmed. Privacy agreement screen appears. No main UI yet.
- `unlocked_customer_ui`: Full luxury concierge interface unlocked. Smooth cinematic transition from gate.
- `quote_pending`: Package selected, price quoted, awaiting customer confirmation.
- `checkout_pending`: Customer confirmed quote. Payment screen active.
- `booking_confirmed`: Payment webhook confirmed (never trust redirect alone). Show confirmation.
- `post_service_followup`: After delivery. Retention flow.

---

## Page 1: Locked Gate (locked_gate state)

Full-screen dark luxury background. Centered AI chatbox as the ONLY visible element.

The AI chatbox automatically sends this opening message on every new session:
> "Before we continue… please confirm you are at least 18 years old and agree to use this service only for lawful floral gifting."

**Required customer response (exact match, trim + lowercase):**
> "I confirm that I am at least 18 years old and will use this service only for lawful floral gifting."

Implementation:
- Show the required phrase in elegant small text below the input field as a hint
- Validate on submit: trim + lowercase + compare
- If wrong: display error message "Please enter the exact confirmation above to continue." — do not clear the hint
- If correct: set `lawfulUseConfirmed = true`, advance to `nda_pending` state
- Do NOT call the backend AI for gate validation — validate client-side for instant response

Design:
- Floating ember glow logo centered above chatbox
- Soft pulsing ambient glow around the chatbox
- Dark glass-morphism chat container
- Single text input + send button
- No navigation, no menu, no package cards visible

---

## Page 2: NDA / Privacy Agreement (nda_pending state)

After gate confirmation, fade in the privacy agreement screen.

Content:
> **Ember Halo — Private & Confidential**
>
> Everything shared within this platform is private, discreet, and confidential.
> By continuing, you agree not to redistribute, screenshot, or share any content from this experience.
> This service is exclusively for lawful floral gifting.

Two buttons:
- **"I Agree — Continue"** (primary, warm gold)
- **"Exit"** (secondary, subtle)

On agree: set `ndaAccepted = true`, log acceptance timestamp + session ID via `POST /api/agreement/accept`, advance to `unlocked_customer_ui`.

Transition animation: Gate screen fades out (opacity 0, blur 8px), main concierge UI fades in (opacity 1, blur 0), 900ms ease-in-out. The chatbox remains visually consistent throughout — it should feel like the room opened up, not a page change.

---

## Page 3: Main Customer Interface (unlocked_customer_ui and beyond)

After transition, the full luxury interface appears. Layout:

**Left/Center:** AI concierge chatbox (primary interaction, always visible)
**Right panel (desktop) / below (mobile):** Rose package cards

### Rose Package Cards
Fetch live from `GET /api/rose-packages?admin_id={adminId}` on page load and after each unlock.
Show: package name, rose count, pickup price, delivery price.
Cards use dark glass-morphism styling, gold borders, fade-in on load.
Tapping/clicking a card pre-fills the chat: "I'd like [X] roses."

Standard packages always shown: 15, 30, 100, 200 roses.
Special packages shown in a highlighted section if active.
Custom 200+ shown as "Custom Arrangement — Request Quote" card.

**Never hardcode any price. All prices come from the API.**

### AI Chatbox (main interface)
- Floating dark chat container
- AI messages on left, customer on right
- Smooth message fade-in animation
- Typing indicator (3-dot pulse) while AI is generating
- Input field always focused
- Send on Enter or button tap
- All messages go to `POST /api/conversation/message`
- Generate one stable `customer_session_id` per browser session and persist it in `localStorage`
- After the first backend reply, persist the returned `conversation_id` in `localStorage`
- Send both `customer_session_id` and `conversation_id` on every later chat message so the AI receives the existing conversation history and does not restart the flow

### Mobile layout
- Chatbox takes full width
- Package cards collapse into a horizontal scroll strip above the input
- Smooth scrolling, tap-friendly

---

## Checkout Flow (checkout_pending state)

When the API returns `state: 'checkout_pending'`:
1. Show order summary card: package, rose count, fulfillment type, delivery details, final price
2. Payment buttons: Cash App Pay, Apple Pay, Google Pay, Card
3. Call `POST /api/payment/create-intent` to get Stripe client_secret
4. Use Stripe.js to handle payment
5. On payment method success → show "Processing..." state
6. **Do NOT mark as confirmed on frontend redirect.** Show "Confirming your booking..." spinner.
7. Wait for webhook confirmation via polling `GET /api/order/status?order_id={id}` every 3 seconds
8. When status returns `confirmed` → advance to `booking_confirmed`

---

## Booking Confirmed (booking_confirmed state)

Elegant full-screen confirmation. Soft rose petal ambient animation (subtle, not flashy).

Message:
> "Your roses are confirmed. 🌹"
> [Order summary: package, delivery/pickup time, city]
> "You'll hear from [Concierge Name] shortly."

---

## Admin Dashboard (separate route: /admin)

Admin login via Supabase Auth email/password.

After login, dashboard shows:
- **Home tab:** Active conversations count, today's bookings, pending special requests (highlighted), revenue today, unresolved alerts
- **Conversations tab:** Live web + SMS conversation list. Click to open. "Take Over" button per conversation.
- **Pricing tab:** Edit standard package pickup/delivery prices. Edit special packages (create/activate/deactivate).
- **Location tab:** Active cities, hours, travel mode toggle, online/offline toggle.
- **Scheduling tab:** Full scheduling records with status filters, date range picker, search.
- **Profile tab:** Owner profile editor with AI bio generation.
- **Media tab:** Upload photos (multipart POST to `/api/admin/media`). View gallery in grid. Drag-to-reorder (PATCH `/api/admin/media/reorder`). Delete with soft-confirmation. Filter by category. All images display via signed URLs (`GET /api/media/signed-url?media_id=`).
- **Settings tab:** Notification preferences (SMS/email per event).

Concierge Takeover Mode: When admin clicks "Take Over" on a conversation, the chat opens in takeover mode. AI suggest-reply panel appears on the right. Admin types and sends manually. "Release" button returns conversation to AI.

All dashboard views must be fully responsive on mobile and desktop.

---

## Responsive QA Requirement

After building the initial UI, perform a full responsive QA pass:
1. Test every page on mobile (375px width) and desktop (1280px width)
2. Fix any clipped content, broken layouts, overflow issues, tap-target sizing
3. Perform a second QA pass after all API integrations are connected
4. Both passes must cover customer UI and admin dashboard

Pages to verify twice:
- Locked gate
- NDA screen
- Post-confirmation transition
- Main concierge interface (chatbox + package cards)
- Checkout flow
- Booking confirmation
- Admin dashboard all tabs
- Concierge takeover mode
- Owner profile page (public)

---

## API Integration Points

| Endpoint | When |
|---|---|
| `GET /api/rose-packages?admin_id=` | On unlock, after gate |
| `POST /api/conversation/message` | Every customer message |
| `POST /api/agreement/accept` | On NDA agreement |
| `POST /api/payment/create-intent` | On checkout |
| `GET /api/order/status?order_id=` | Poll after payment (3s interval) |
| `POST /api/admin/takeover` | Admin takes over conversation |
| `POST /api/admin/release` | Admin releases conversation |
| `POST /api/admin/send-message` | Admin sends message in takeover mode |
| `GET /api/admin/conversations` | Conversations list (with filters, pagination) |
| `GET /api/admin/conversations/:id` | Conversation detail (messages + classifications) |
| `GET /api/admin/special-requests` | Special requests queue |
| `POST /api/admin/special-requests/resolve` | Resolve a special request |
| `GET /api/admin/dashboard` | Dashboard summary stats |
| `GET /api/admin/analytics` | Analytics overview |
| `GET /api/admin/vault` | VIP client vault list |
| `GET /api/admin/media` | List admin media gallery |
| `POST /api/admin/media` | Upload media (multipart/form-data) |
| `DELETE /api/admin/media/:id` | Delete media (soft delete) |
| `PATCH /api/admin/media/reorder` | Reorder media gallery |
| `GET /api/media/signed-url?media_id=` | Get 5-min expiring signed URL for private media |
| `GET /api/admin/packages` | List packages |
| `PATCH /api/admin/packages/price` | Update package prices |
| `GET /api/admin/profile` | Admin profile |
| `POST /api/admin/profile` | Save profile |
| `POST /api/admin/profile/generate-bio` | Generate AI bio |
| `GET /api/admin/location` | Location controls |
| `PATCH /api/admin/location` | Update location |
| `POST /api/admin/location/online` | Toggle online |
| `GET /api/admin/notifications` | Notification preferences |
| `POST /api/admin/notifications` | Update preferences |
| `GET /api/scheduling/records` | Scheduling records |
| `PATCH /api/scheduling/status` | Update order status |
| `GET /api/admin/reviews` | Reviews list |
| `GET /api/admin/reviews/stats` | Review stats |

---

## Environment Variables (Lovable frontend)

```
VITE_API_BASE_URL=https://your-backend-url.com
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
VITE_SUPABASE_URL=https://kchtrvfcixnimvxxctkj.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

---

## What NOT to build yet

- Voice concierge
- Revenue heatmaps  
- Driver assignment
- Demo pages (built after production is complete)

---

Build mobile-first. Every component responsive by default. Dark luxury aesthetic throughout.
