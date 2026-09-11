# Sarion's World — iPad Learning App

Status: v1 prototype track

## Purpose
Sarion's World is a family-centered, iPad-first learning and communication app. It is designed as a supportive learning tool, not a medical treatment, diagnostic system, behavior-compliance system, or replacement for a child's established AAC/communication system.

## Family character reference
The approved family character sheet is the visual source of truth for the recurring family cast:

- Dad — Carlos Pearson: blue identity, warm/supportive/protective presentation.
- Mom — Porshe: pink identity, warm/caring/encouraging presentation.
- Caesar — big brother: green identity, supportive/creative role-model presentation.
- Sarion — primary explorer: bright blue identity, curious/happy/playful presentation.

Use the approved character sheet supplied by the family as the reference for appearance, outfits, proportions, styling and expression language. Do not create photorealistic identity claims from it. App artwork should remain a consistent friendly illustrated character system.

## V1 child experience
Home: four large choices — Learn, Play, Communicate, My Day — plus Break and Help. No timers, streaks, leaderboards, negative sounds or forced progression.

Learn: matching, counting/numbers, letters, colors, shapes and simple emotions. Start with low-choice activities and explicit Next/All done controls.

Play: matching, memory, cause/effect drawing/music-style interactions. No ads, open web or purchases.

Communicate: a supplemental visual board with large icon+word choices such as I want, I need, I feel, Food, Drink, Bathroom, Help, More and All done. It must be clearly described as supplemental and never silently replace an existing AAC system.

My Day: visual Now/Next and routine board. Adult configurable. Break, Help, Home and All done remain available at all times.

## Adult experience
Protected only against accidental taps, not represented as strong authentication. Controls should include activity visibility, number of answer choices, counting range, optional local tap-to-hear speech, Now/Next routine, reduced motion, sound off/on, and local progress summary.

Progress means observable app activity (completed rounds, assisted rounds, activity frequency), not clinical/developmental diagnosis or mastery claims.

## Privacy
V1 is local-first. Do not collect child name, DOB, diagnosis, school, photos, voice, location or medical records. No analytics, ads, external AI, camera, microphone, cloud account or third-party tracking in the first prototype. Settings and activity counts are browser-local and can be lost when browser data is cleared.

## Visual direction
Use the approved Sarion's World concept and family sheet: bright saturated blue/pink/green accents, white space, rounded cards, large readable labels and friendly illustrated icons. Maintain accessibility and sensory control: no flashing, no surprise audio, no auto-play, no compulsory animation. Respect reduced motion.

## Technical target
- iPad-first PWA.
- 1024×768 and 768×1024 first-class layouts, phone fallback.
- Large touch targets (64 px primary targets).
- Semantic controls, keyboard support, visible focus, VoiceOver labels.
- Browser-local settings/state in V1.
- Installable from Safari via Add to Home Screen once deployed.

## Isolation
This app lives under `apps/sarions-world` on its own feature branch/project path. It must not import or mutate ZOLA production/release code, Supabase migrations, worker authority, n8n workflows, trading systems or production secrets.
