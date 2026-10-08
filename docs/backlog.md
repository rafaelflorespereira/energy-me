# Product backlog

## Next release: sentiment-driven overview backgrounds

Status: proposed; design exploration before implementation. Applies to the overview / summary screen only.

### Goal

Give the overview a background that reflects the selected feeling without changing check-in data, intensity values, summaries, chart calculations, or interpretation of the user's records.

### Example scenes

- **Happiness (`alegria`), intensity 4:** an open field in sunny weather, with butterflies and gentle natural movement. Four is the current maximum intensity, not five.
- **Sadness (`tristeza`):** a rainy environment with restrained grey colors and soft rain movement, without making the information difficult to read.
- Define suitable scenes for the remaining feelings during design exploration; use a neutral background for an unmapped feeling, intensity zero, or no applicable check-in data.

Treat imagery as atmosphere, not a diagnosis or a judgment about whether a feeling is good or bad. Let the user disable emotional scenery and return to the neutral overview.

### Proposed approach

- Begin with static images and explore short, muted looping video or subtle animation as an optional enhancement. An image is a complete first version, not merely a loading screen for video.
- Keep background selection in the UI layer, using stable feeling IDs and existing 0-4 intensities. Do not add scene names, media URLs, or derived visual states to check-in records or the proposed DynamoDB schema.
- The current [summary screen](../web/src/ui/SummaryScreen.tsx) already computes a selected feeling for the evolution chart. Reusing that selection is a candidate, not an approved behavior: it is initially based on the period's most-present feeling and is not necessarily today's mood.
- Keep statistics, labels, chart colors, and controls readable over every scene with a stable content surface or contrast treatment. Scenery must sit behind the overview, not inside a decorative preview card, and must not intercept taps, focus, or scrolling.
- Use a brief, gentle crossfade when changing scenes; avoid flashing, abrupt weather changes, and layout movement. Disable animated transitions when reduced motion is requested.

### Accessibility, privacy, and performance

- Respect `prefers-reduced-motion`: show the static version instead of autoplaying video or animation. Provide an accessible pause control for ongoing motion and a neutral-background option independent of the OS preference.
- Never autoplay audio. Videos must be muted and play inline on mobile. Treat background images and videos as decorative, without adding redundant screen-reader announcements when a feeling changes.
- Prefer static imagery when data saving is requested or the media cannot load. Always retain a usable neutral fallback; a slow connection or failed asset must not block the summary.
- Load only the selected scene, not an entire media library. Compress assets, choose appropriate desktop/mobile sizes, avoid excessive video preload, and pause media when the page is hidden or the overview is not active.
- Use owned or appropriately licensed assets, preferably served with the app. Do not send the user's selected feelings to an external image-generation service or an emotion-specific third-party media endpoint during browsing.
- Check text contrast, chart legibility, cropping, and overlapping controls in light/dark themes and desktop/mobile layouts. Do not let media resize the page or change chart dimensions.

### Decisions before implementation

1. **Scene driver:** the feeling selected in the chart, today's saved check-in, or the dominant feeling in the selected period? The existing screen supports multiple feelings; do not silently assume one describes the person overall.
2. **Intensity source:** today's value or the selected period's average? Define tie handling, rounding if using averages, and the difference between missing data and a saved zero. Full happiness means intensity 4 only for the chosen source.
3. **Intensity treatment:** different assets per level, or one scene per feeling with subtle visual variation? Keep the first version small; do not commit to 35 separate scenes.
4. **Media and controls:** static images first, or optional video in the first release? Decide the default animation setting and where pause / neutral-background controls belong.
5. **Asset direction:** review happy and sad examples first, then agree on the remaining feelings, licensing, mobile crops, and a media-size budget.

### Acceptance criteria

- Selecting the agreed happiness state can show a sunny field with butterflies; the sadness state can show the rainy, grey scene.
- Changing the background does not write a check-in, change any intensity, alter summaries, or modify stored history. Existing domain tests continue to pass.
- Switching the relevant feeling or period updates the scene according to the approved driver without misleadingly presenting a period average as today's check-in.
- No data, intensity zero, unavailable assets, and disabled scenery have defined neutral behavior. When media fails, existing content and controls remain usable.
- Reduced motion uses a static background; ongoing motion can be paused; no sound autoplays.
- All existing overview workflows remain accessible and readable on mobile and desktop, with no layout shift or background input interception.
- Sample data stays clearly separate from real check-ins, and visual preferences remain separate from emotional records.

This item is independent of [cloud check-in persistence](checkin-persistence.md). Backgrounds can be prototyped against the existing local data without waiting for a backend.
