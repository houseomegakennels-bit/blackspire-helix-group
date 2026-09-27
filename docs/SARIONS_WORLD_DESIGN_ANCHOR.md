# Sarion's World — Canonical Design Anchor

Status: **LOCKED DESIGN SOURCE OF TRUTH**

This document records the approved visual anchor and product decisions for Sarion's World so future ChatGPT, Codex, Vercel, GitHub, and human development sessions do not drift away from the agreed design.

## Canonical visual reference

The approved design anchor is the user-supplied image from the September 11, 2026 Sarion's World planning session.

- Original attachment filename: `4993A62B-0B03-42F2-A97E-BA5B7845C68D.jpeg`
- Dimensions: `1024 x 1536`
- SHA-256: `55038bec9d4384a91807ee768cf17a162a9fa8dd7f63cf29b757ba05c8c53698`

The image itself is the visual authority. This document is the written implementation contract derived from it. Do not materially redesign the app away from this visual system unless Carlos explicitly approves a change.

## Visual language to preserve

- Bright, joyful, premium child-friendly iPad interface.
- Rounded white app cards with colorful blue, green, orange, pink, yellow, and purple accents.
- Large touch targets and simple, highly legible labels.
- Friendly 3D/illustrated family-character presentation.
- Blue-led Sarion's World branding with colorful bubble-style logo treatment and crown motif.
- iPad-like framed screen composition as the visual benchmark for major surfaces.
- Clean white/sky backgrounds and colorful category tiles rather than dense dashboards.
- No clinical-looking UI, no dark enterprise dashboard styling, and no generic SaaS template look.

## Family character source of truth

The separate approved family character sheet remains the appearance/style authority for the recurring family cast:

- Dad — Carlos Pearson
- Mom — Porshe
- Caesar — big brother
- Sarion — primary explorer

Use the family sheet for appearance, outfit language, personality presentation, and recurring illustrated-character consistency. The design-anchor image controls how those characters are integrated into the app UI.

## Core navigation shown by the anchor

The primary child-facing navigation should preserve these top-level concepts:

- Learn
- Play
- Communicate
- Sign & Talk
- My Day
- Favorites

Help, Break, Home, and All Done must remain easy to reach and must never require task completion.

## Learn

The Learn experience should visually follow the anchor's large colorful grid and support:

- Letters / ABC World
- Numbers / Number Garage
- Colors
- Shapes
- Animals
- Vehicles
- Matching
- Cause & Effect
- Emotions
- Music
- Stories
- Fine-motor activities

Activities should remain short, predictable, repeatable, and non-punitive. No timers, streak pressure, leaderboards, forced progression, or negative failure sounds.

## Play

The Play experience should use the same large-card visual system and include personalized interests and calm activities such as:

- Car Match
- Puzzle Fun
- Memory
- Shape Sort
- Music & Dance
- Drawing
- Pop / cause-and-effect play
- Build Room

Cars/vehicles, numbers, letters, matching, music, and familiar interests are priority motivators.

## Communicate

Communication is a first-class product surface, not an add-on.

The communication model is:

**AAC-style picture support + written word + optional spoken word + ASL**

Starter concepts include:

- I want
- I need
- I feel
- More
- All Done
- Food / Eat
- Drink
- Bathroom
- Help
- Play
- Mom
- Dad
- Brother
- Yes
- No
- Please
- Thank You
- Stop
- Go
- Sleep
- Hurt
- Happy
- Sad

This is supplemental communication support and must never silently replace an established AAC system.

## Sign & Talk / ASL

ASL is a full learning lane and must remain visually prominent as shown in the anchor.

Planned learning modes:

- Watch
- Copy Me
- Find the Sign
- What Does This Mean?
- Family Signs

Important implementation rule: emoji, arbitrary hand icons, or guessed poses must never be presented as the actual ASL sign. Verified sign media must be used before teaching a motion. V1 does not use camera scoring or claim to judge sign correctness.

## ASL corner stickers

Any icon, card, communication control, or navigation tab with an applicable ASL equivalent should receive a playful corner sticker.

Approved sticker direction:

- small hand-sign graphic + `ASL` label
- purple family color
- slightly tilted, sticker/tag appearance
- overlaps the corner without covering the primary icon or text
- consistent placement across the product
- functions as an ASL-availability marker only

The sticker is **not** the sign demonstration. Selecting the item should eventually open or reveal the verified sign model.

## My Day

Preserve the anchor's friendly visual-routine style with large readable steps and clear completion markers.

Example routine concepts:

- Wake Up
- Brush Teeth
- Get Dressed
- Breakfast
- Play & Learn
- Outside Time
- Quiet Time
- Bed Time

The routine is informational/supportive, never a reward lock or compliance gate.

## Break experience

The Break screen should remain visually calm, friendly, and low-demand.

- No countdown required.
- No punishment for using Break.
- Easy return to previous activity or All Done.
- Calm illustration and optional quiet audio only when enabled.

## Rewards / encouragement

The anchor's celebratory style may be used for positive encouragement, but rewards must not gate communication, bathroom, food/drink requests, Help, Break, or other basic needs.

Avoid manipulative streak mechanics or claims of clinical mastery.

## Parent mode

Parent settings should preserve the approachable visual style rather than looking like an admin console.

Controls may include:

- show/hide ASL
- show/hide pictures/AAC supports
- show written words
- optional spoken audio
- number of choices
- counting range
- routine configuration
- sound/music options
- reduced motion
- local activity summary
- reset local data

Adult gating is an accidental-tap guard only unless a stronger authentication system is explicitly added later.

## Privacy / safety baseline

V1 remains local-first and should not collect unnecessary child data.

Do not add by default:

- ads
- third-party analytics
- open web links
- camera scoring
- microphone recording
- emotion inference
- external AI chat
- child social features
- purchases/paywalls in child flows

## Accessibility / sensory requirements

- Large touch targets.
- VoiceOver-friendly labels.
- Visible focus states.
- No flashing.
- No surprise audio.
- No autoplay that cannot be stopped.
- Respect reduced-motion preferences.
- Stable predictable layouts.
- Avoid relying on color alone.

## Change-control rule

Any major UI redesign, removal of communication/ASL support, replacement of the family visual style, or material change to the core navigation should be treated as a design-anchor change and require explicit approval from Carlos before implementation.

Future build sessions should read this document together with `docs/SARIONS_WORLD_PRODUCT_BRIEF.md` before making product or visual decisions.
