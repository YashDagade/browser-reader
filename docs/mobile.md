# Hermes on iPhone and iPad

Status: implementation plan; this repository does not yet ship an iOS app or Safari extension.

Chrome on iPhone and iPad cannot install the desktop Chrome extension. Publishing Hermes in the Chrome Web Store does not change that. See [Google's compatibility guidance](https://support.google.com/chrome_webstore/answer/1698338?hl=en).

## Recommended product

An iOS app with a Safari web extension can preserve the current experience: open an article in Safari, invoke Hermes, listen through OpenAI, and follow highlighted words on the original page. Apple's [Safari extension tools](https://developer.apple.com/safari/extensions/) can package existing web-extension code, but unsupported Chrome APIs still need to be replaced and tested.

A Share to Hermes extension can also accept article URLs or selected text from mobile Chrome and other apps. That flow plays in the Hermes app; it cannot draw highlights inside Chrome. A shared URL may not expose the same signed-in article as the browser, so selected text should be an explicit fallback. Hermes must not bypass access restrictions.

## Work required

1. Reuse local article extraction, the floating reader, chunking, timing, and API request formats. Adjust controls for touch and safe-area insets.
2. Replace Chrome's `offscreen` document and related lifecycle APIs. Use native audio playback with the appropriate background audio session so narration can continue while the phone is locked. Establish a tested bridge between native playback and Safari word highlights.
3. Keep each user's API key in iOS Keychain. The app calls OpenAI directly after disclosure and consent; a Hermes backend, AWS service, or always-running Node process is unnecessary. Never bundle a developer key.
4. Add a reader view for content shared from Chrome, then reuse the same API narration and playback controls. Bound audio caches and support deletion.
5. Test on physical iPhone and iPad: audio interruption and lock screen, 0.75×–4× playback, seeking, word timing, auto-scroll, navigation, memory limits, offline/API failures, and credential removal.
6. Sign and distribute the app and extension using an Apple Developer account. Use TestFlight for device testing, then submit to the App Store. Signing, account enrollment, and review are separate from Chrome Web Store publication.

Once distributed, users install the Hermes iOS app, enable its extension under Safari settings, connect their own OpenAI key, and invoke Hermes from Safari's extensions menu. In Chrome they use Share → Hermes. These are the intended steps after the mobile implementation exists, not installation instructions for the current desktop-only package.
