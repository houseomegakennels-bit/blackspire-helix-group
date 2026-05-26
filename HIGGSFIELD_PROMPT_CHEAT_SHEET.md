# Higgsfield Prompt Cheat Sheet

Updated: 2026-05-24

## Fast Defaults

- `GPT Image 2` for high-fidelity images, design, banners, typography, and on-image text
- `Nano Banana 2` for character, cartoon, and reference-driven image work
- `Seedance 2.0` for serious all-purpose video
- `Marketing Studio` for ads, UGC, unboxing, product demos, and branded presenter content
- `Virality Predictor` (`brain_activity`) for scoring finished video creative

## Prompt Formula

Use this order:

```text
[subject] + [setting] + [action] + [camera] + [lighting] + [style] + [constraints]
```

Example:

```text
A woman in a silver trench coat walking through a rain-soaked alley, camera slowly dollies backward at chest height, neon reflections, moody cinematic lighting, tack sharp, no extra people
```

## Higgsfield-Specific Rules

### Keep prompts short

Installed Higgsfield guidance says to stay under roughly `200 tokens`. Very long prompts increase distortion and inconsistency.

### Use positive phrasing

Instead of negatives like:

- `no blur`
- `no people`

prefer:

- `tack sharp`
- `uninhabited landscape`

### With `--image`, describe the change

Do not redescribe the input image.

Bad:

```text
a man with brown hair in a leather jacket holding coffee, made into anime
```

Better:

```text
transform into anime style, vibrant colors, soft cel shading
```

### With `--start-image`, describe the motion

Do not redescribe the first frame. The frame is already provided.

Use verbs like:

- `slow push in`
- `dolly left`
- `sweeping pan`
- `smoke rises slowly`
- `the dancer spins`

## Model Selection

### Images

- Product concept with readable packaging or label text: `GPT Image 2`
- Character/cartoon/stylized subject: `Nano Banana 2`
- Editorial/lifestyle/fashion character: `Soul 2.0`
- Cinematic still: `Soul Cinema`
- Environment-only scene: `Soul Location`
- Fast draft iteration: `Z Image`

### Video

- Ad or branded commercial: `Marketing Studio`
- Best general-purpose serious video: `Seedance 2.0`
- Cheaper simpler single-plane shot: `Kling 3.0`
- Film-grade premium execution: `Cinema Studio Video 3.0`
- Fast batch volume: `Veo 3.1 Lite`
- Stylized/experimental: `Wan 2.6` or `Wan 2.7`

### Analysis

- Finished video hook/retention/virality review: `brain_activity`

Example:

```bash
higgsfield generate create brain_activity --video ./ad.mp4 --wait
```

## Media Role Shortcuts

- `--image` for most image models
- `--start-image` for image-to-video anchors
- `--end-image` for last-frame transitions where supported
- `--video` for video input or virality analysis
- `--audio` for `Seedance 2.0` audio reference

Important:

- `Seedance 2.0` supports `image`, `start_image`, `end_image`, `video`, and `audio`
- `Kling 3.0` supports `start_image` and `end_image`
- `Veo 3.1` supports one `start_image`
- `brain_activity` requires one `video`
- `Z Image`, `Soul Cast`, and `Soul Location` are prompt-only

## Best Aspect Ratios

- `16:9` for cinematic landscape
- `9:16` for vertical social
- `1:1` for square

Always remember some models have hard constraints:

- `Veo 3.1` only supports `16:9` or `9:16`
- `Veo 3.1` durations are `4`, `6`, or `8`
- `Seedance 2.0` generally supports `4` to `15` seconds
- `Kling 3.0` generally supports `3` to `15` seconds

## Copy-Paste Templates

### Image

```text
[subject] in [setting], [lighting], [style], [camera angle if relevant], tack sharp, clean composition, [important constraint]
```

### Image-to-image

```text
transform into [style], [palette], [finish], preserve identity and composition
```

### Image-to-video

```text
slow push in as [subject motion], [environment motion], cinematic lighting, stable identity, smooth camera motion
```

### Product ad still

```text
premium [product] hero shot, controlled studio lighting, tactile materials, luxury commercial style, clean reflections, logo readable
```

### Talking video

```text
medium close-up talking-head delivery, confident natural performance, clean background, soft flattering light, steady eye line, clear mouth visibility
```

## Low-Waste Workflow

### Pass 1

Test only:

- correct model
- correct subject
- correct motion or framing

### Pass 2

Refine only:

- camera
- timing
- consistency

### Pass 3

Add polish:

- richer light
- texture
- atmosphere
- higher resolution

## Soul Training Checklist

For `higgsfield-soul-id`:

- upload `8-12` photos if possible
- use one person only per photo
- keep eyes visible
- no heavy filters
- no sunglasses
- include multiple angles
- include varied lighting
- include varied expressions
- keep images sharp and in focus
- avoid repeated poses

## Common Mistakes

- Prompt too long
- Redefining the reference image instead of describing the change
- Asking for camera motion without naming the motion
- Using a prompt-only model with media inputs
- Using `Seedance 2.0` without `--audio` when lipsync/reference audio matters
- Using generic generation for ads when `Marketing Studio` is the better route

## Useful Commands

Check models:

```bash
higgsfield model list --json
```

Inspect one model:

```bash
higgsfield model get <model_id> --json
```

Generate and wait:

```bash
higgsfield generate create <model_id> --prompt "..." --wait
```

Image-to-video:

```bash
higgsfield generate create seedance_2_0 --prompt "slow push in, hair moves in wind" --start-image ./frame.png --duration 8 --wait
```

## Final Rule

The best Higgsfield prompt is not the most poetic one. It is the one that is shortest while still being specific about:

- subject
- action
- camera
- lighting
- constraints
