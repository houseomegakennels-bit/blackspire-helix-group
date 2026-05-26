# Higgsfield Prompt Pack

Updated: 2026-05-24

## How To Use This

Use these as starting prompts, not sacred scripts.

Rule:

- change only the parts that matter
- keep the structure
- test one variable at a time

## 1. Cinematic Fashion Video

### Template

```text
[subject] in [wardrobe] moves through [location].
Camera [movement] at [height / angle].
Lighting is [lighting style].
Style is cinematic, premium, realistic.
[Secondary motion in environment].
Keep identity, wardrobe, and mood consistent. No extra people.
```

### Example

```text
A woman in a silver trench coat moves through a rain-soaked neon alley at night.
Camera slowly dollies backward at chest height as she walks toward lens.
Lighting is moody neon with cool reflections and soft rim light.
Style is cinematic, premium, realistic.
Rain falls steadily and reflections shimmer across the pavement.
Keep identity, wardrobe, and mood consistent. No extra people.
```

Best first model:

- `Seedance 2.0`
- `Sora 2` if you want the most premium realism

## 2. Luxury Product Hero Video

### Template

```text
A premium [product] sits in [environment].
Shot begins with [opening frame], then [camera move], then [hero reveal].
Lighting is [studio lighting style].
Materials should feel tactile and realistic.
Style is luxury commercial, photoreal, high-end.
Keep logo readable. No duplicate products. No text overlays.
```

### Example

```text
A premium black glass fragrance bottle sits on polished dark stone.
Shot begins in macro on the cap, then slowly pushes back and tilts down into a full hero reveal.
Lighting is controlled studio lighting with warm specular highlights and deep shadow contrast.
Materials should feel tactile and realistic.
Style is luxury commercial, photoreal, high-end.
Keep logo readable. No duplicate products. No text overlays.
```

Best first model:

- `Sora 2`
- `WAN 2.6` if the camera move is the main point

## 3. Outdoor Atmosphere Scene

### Template

```text
Wide view of [location] at [time of day].
[Weather / atmosphere] moves naturally through the frame.
A [subject] performs [simple action].
Camera [movement or hold] with emphasis on scale and depth.
Lighting is natural and realistic.
Style is cinematic and grounded.
No crowd, no sudden camera changes.
```

### Example

```text
Wide view of a mountain road at blue hour.
Fog rolls slowly through the valley and pine trees sway lightly in the wind.
A lone car moves steadily through the curve.
Camera holds from an elevated angle with emphasis on scale and depth.
Lighting is natural and realistic.
Style is cinematic and grounded.
No crowd, no sudden camera changes.
```

Best first model:

- `Veo 3.1`

## 4. Talking Avatar / Founder Message

### Template

```text
Medium close-up talking-head delivery.
[subject] speaks directly to camera in a [tone] tone.
Background is [simple scene].
Lighting is [soft / natural / studio].
Performance is [confident / calm / urgent / friendly].
Keep mouth visibility clear, eye line steady, and body movement minimal.
```

### Example

```text
Medium close-up talking-head delivery.
A founder speaks directly to camera in a calm, confident tone.
Background is a clean modern office with soft depth.
Lighting is natural window light with subtle fill.
Performance is confident and friendly.
Keep mouth visibility clear, eye line steady, and body movement minimal.
```

Best first model:

- `Lipsync Studio`
- `Talking Avatar`
- `Marketing Studio` if it is ad-driven

## 5. UGC Ad Prompt

### Script Template

```text
Hook: [first line]
Problem: [pain point]
Proof: [visible result]
CTA: [simple next action]
```

### Visual Prompt Template

```text
Casual creator-style UGC.
[avatar type] speaks directly to camera.
Background is [room / car / kitchen / bathroom / office].
Product stays visible in hand or on table.
Natural social framing, not cinematic movie framing.
```

### Example Script

```text
Hook: I did not expect this serum to work this fast.
Problem: My skin always looked dull and uneven by the end of the day.
Proof: After one week my skin looked brighter, smoother, and way more even in photos.
CTA: If you want glow without a heavy routine, try this.
```

Best first model:

- `Marketing Studio`
- `UGC Factory`

## 6. Product Photoshoot Still

### Prompt Intent Template

```text
[product] for [usage context], [mood / aesthetic], [platform / placement]
```

### Example

```text
Glass skincare serum bottle for a clean luxury Shopify hero image, minimal white and sage aesthetic, premium editorial mood
```

Best route:

- use `higgsfield product-photoshoot create`
- not raw general prompting if the goal is polished brand product imagery

## 7. Pinterest Product Pin

### Prompt Intent Template

```text
Vertical Pinterest pin for [product], [aesthetic], [scene or mood], designed for [audience or use]
```

### Example

```text
Vertical Pinterest pin for a handmade soy candle, cozy cottagecore aesthetic, warm wood tabletop and dried florals, designed for home decor inspiration
```

Best route:

- `product-photoshoot` with `moodboard_pin`

## 8. Website Hero Banner Still

### Prompt Intent Template

```text
Wide hero banner for [brand or product], [environment], [mood], designed for [site or campaign use]
```

### Example

```text
Wide hero banner for a luxury cold brew brand, sunlit marble kitchen environment, premium minimal mood, designed for a homepage launch section
```

Best route:

- `product-photoshoot` with `hero_banner`

## 9. Product In Hands / With Person

### Template

```text
Close-up of [person type] holding or using [product].
Framing focuses on [product area].
Lighting is [style].
Style is clean, realistic, premium.
Keep hands natural and the product clearly visible.
```

### Example

```text
Close-up of a woman applying a glass serum bottle to her cheek.
Framing focuses on the hand, cheek, and product label.
Lighting is soft bathroom daylight.
Style is clean, realistic, premium.
Keep hands natural and the product clearly visible.
```

Best route:

- `product-photoshoot` with `closeup_product_with_person`

## 10. Conceptual / CGI Product Shot

### Template

```text
[product] suspended in [stylized environment].
Camera [movement or angle].
Lighting is [dramatic lighting description].
Style is surreal, premium, sculptural, photoreal.
[Effect detail such as water splash, floating particles, vapor, chrome reflections].
Keep product shape and branding readable.
```

### Example

```text
A matte black energy drink can suspended above a reflective pool of liquid chrome.
Camera slowly rotates around the can at a low angle.
Lighting is dramatic with sharp edge highlights and deep contrast.
Style is surreal, premium, sculptural, photoreal.
Floating metallic droplets and light vapor drift around the can.
Keep product shape and branding readable.
```

Best first model:

- `Sora 2` for video
- `product-photoshoot` with `conceptual_product` for stills

## 11. Image-to-Video Motion Prompt

### Template

```text
[camera motion] as [subject motion].
[environment motion].
Lighting remains [lighting behavior].
Keep identity stable and motion smooth.
```

### Example

```text
Slow push in as the woman turns her head toward camera.
Her hair moves lightly in the wind and the city lights flicker softly in the background.
Lighting remains moody and cinematic.
Keep identity stable and motion smooth.
```

Best first model:

- `Seedance 2.0`
- `Kling 3.0` for simpler cheaper runs

## 12. Scene Transition Prompt

### Template

```text
Begin in [start state].
Transition smoothly into [end state].
Camera [move].
Lighting shifts from [state A] to [state B].
Keep the transformation elegant and readable.
```

### Example

```text
Begin in a quiet daylight bedroom.
Transition smoothly into the same room at blue hour with neon city light entering through the window.
Camera slowly pans right.
Lighting shifts from warm natural daylight to cool nocturnal glow.
Keep the transformation elegant and readable.
```

Best first model:

- `WAN 2.6`
- `Seedance 2.0`

## 13. Character Consistency Prompt

### Template

```text
Same [subject] throughout all shots.
Same [hair / wardrobe / makeup / accessories].
Preserve facial structure and body proportions.
Do not change age, outfit, or identity between shots.
```

Use this as an add-on, not a full prompt.

## 14. Soul Training Intake Prompt

Use this when gathering materials for `higgsfield-soul-id`:

```text
Upload 8 to 12 clear photos of one person only.
Include front view, 3/4 left, 3/4 right, slight up/down angles.
Use varied lighting and expressions.
Avoid sunglasses, heavy filters, repeated poses, group photos, hats covering the face, and costume styling.
```

## 15. Virality Analysis Request

Use this when we want Higgsfield to score a finished ad:

```text
Analyze this finished video for hook strength, attention retention, distraction risk, and overall virality potential.
```

CLI shape:

```bash
higgsfield generate create brain_activity --video ./creative.mp4 --wait
```

## Add-On Phrase Bank

### Camera

- `locked-off close-up`
- `slow push in`
- `handheld shoulder-level framing`
- `low-angle tracking shot`
- `overhead top shot`
- `macro reveal`

### Lighting

- `soft window light`
- `controlled studio lighting`
- `moody neon reflections`
- `golden-hour backlight`
- `deep contrast with rim light`
- `clean high-key light`

### Style

- `luxury commercial`
- `grounded cinematic realism`
- `fashion editorial`
- `creator-style UGC`
- `clean premium product photography`
- `surreal sculptural CGI`

### Constraints

- `keep logo readable`
- `no extra people`
- `stable identity`
- `no duplicate products`
- `clean composition`
- `tack sharp`

## Final Rule

When a prompt is failing, do not add more adjectives first.

Fix in this order:

1. clearer subject
2. clearer action
3. clearer camera
4. clearer model choice
5. stronger constraint
