# Hermes privacy policy

Updated September 20, 2026. Applies to Hermes 0.4.0 and later unless replaced by a newer policy.

Hermes reads webpage articles, selected passages, and pasted text aloud. It offers installed on-device voices and optional OpenAI voices using your own API key. The extension sends no reading content or credentials to its developer. There is no Hermes account, developer-operated data service, analytics, advertising, or sale of user data.

## What Hermes handles

| Information | Purpose and handling |
| --- | --- |
| Article, selected, or pasted text | Extracted on your device after you invoke the reader; used for narration, word highlighting, and seeking. OpenAI receives the current and a few upcoming passages only when you enable that connection and consent. |
| Current page title and URL | Held temporarily on your device with the reading session to identify the active article and detect navigation. Hermes does not build a browsing-history log or send these fields as OpenAI request metadata. The text you narrate can itself contain titles or URLs. |
| Your OpenAI API key | Used only to authenticate your requests to OpenAI. Direct mode holds it in browser-session memory, not persistent extension storage. An optional local helper instead reads your private environment file. No shared developer key is provided. |
| Custom pronunciation or delivery guidance | Held in browser-session memory and included with supported OpenAI speech requests. It is not retained with persistent preferences. |
| Generated audio and timing data | Used for playback, highlighting, and repeat listening. Improved timing sends generated audio to OpenAI transcription to obtain word timestamps. Local cached audio and numeric timings are encrypted as described below. |
| Nonsecret preferences | Voice/model choice, speed, layout, and other reading preferences are saved locally in your Chrome profile. Hermes does not use Chrome Sync. |

Text you choose to read can contain personal communications, names or contact details, health or financial information, locations, or other sensitive content. Hermes does not separately seek out those categories, but it processes them as part of the text if you ask it to read that material. Choose the on-device voice if you do not want narration content sent to OpenAI.

## OpenAI sharing and your choice

Before OpenAI narration is enabled, Hermes displays an in-product disclosure and requires you to check an explicit consent box. The request path checks that consent before making speech or word-alignment requests, including requests routed through the optional local helper. The browser voice uses an installed non-remote voice and does not contact OpenAI.

With consent, the selected text passages and applicable voice instructions are sent to OpenAI's speech API over HTTPS. A few upcoming passages may be sent ahead to reduce waiting. If **Improve timing** is enabled, generated audio is sent to OpenAI's transcription API. Your API key authenticates those requests, and usage is charged to your OpenAI API project. OpenAI also receives ordinary connection and request metadata needed to serve the request. Its handling and retention are governed by your OpenAI agreement and account settings; see [OpenAI's API data controls](https://developers.openai.com/api/docs/guides/your-data).

Direct mode connects from Chrome to fixed OpenAI HTTPS endpoints. Local-helper mode first sends the same request to a service on `127.0.0.1` on your computer, which then contacts OpenAI over HTTPS. No content passes through a Hermes developer server. The helper is optional; direct mode requires no Node installation or backend.

You can choose the on-device voice, disable improved timing, or use **Disconnect OpenAI** in Options to remove the direct-mode key and reset consent for either connection mode. Withdrawing consent blocks new OpenAI requests; it does not recall data already sent to OpenAI.

## Storage and retention

Direct-mode API keys, custom voice instructions, and the audio-cache encryption key stay in browser-session memory, including Chrome's session storage. They are not deliberately written to disk by Hermes or synced. Quitting Chrome discards them; you must provide the API key again for a new browser session. Initialization moves any API key or custom guidance retained by older versions into session memory and removes those fields from persistent local storage. The current article text, title, URL, and playback position are also temporary session data. Closing the reader or leaving its document clears the active reading session.

For repeat listening within the same browser session, Hermes encrypts audio and numeric word-timing data with **AES-256-GCM** before saving it in the extension's IndexedDB database. The cache has a **32 MiB audio-size budget**, **256-entry** limit, and **seven-day maximum lifetime**; encryption and storage metadata add overhead. The lookup identifier is a hash of speech inputs; plaintext source text, article URLs, transcription text, and API keys are not stored in that database. Earlier plaintext audio records are purged on upgrade to this format.

Only the current browser session has the encryption key. Closing and reopening the reader can reuse encrypted audio; quitting and restarting Chrome cannot. Expired or no-longer-decryptable ciphertext may remain until a later cache operation removes it or you clear it. Chrome can evict the cache earlier. During use, decrypted audio is held in a bounded memory cache of up to 12 MiB; these limits describe audio caches, not total browser memory.

The optional local helper separately holds completed audio and timing results in memory, with a 16 MiB audio limit and ten-minute expiry. Speech text and guidance are handled in the helper's memory for requests and cache lookup. Exiting the helper clears its memory. A key supplied through your own `.env.local` file remains in that file until you remove it; the extension cannot delete that file for you. Private environment files are excluded from source and extension packages.

## Deletion, security, and limited use

Use **Clear saved audio** in Options to remove the encrypted extension cache. Stop reading first if you want to avoid new audio being cached. **Disconnect OpenAI** removes the direct-mode key and optional OpenAI permission and resets consent; it is separate from clearing audio. Remove the extension to remove its Chrome-managed storage. Delete any helper environment file yourself and stop the helper when you no longer want to use it.

API credentials are restricted to trusted extension contexts, and webpage content scripts do not receive them. Trusted-event checks prevent webpage scripts from initiating paid actions through synthetic clicks. All runtime JavaScript is bundled with the extension. These controls do not protect against a compromised computer or browser session.

Hermes uses and transfers user data only to provide its disclosed reading, playback, and word-navigation features, consistent with the Chrome Web Store User Data Policy and its Limited Use requirements. It does not sell data, use it for advertisements or profiling, or use it for creditworthiness or lending decisions. The developer does not receive or review your reading content through the extension.

For questions, contact the maintainers through the [public GitHub issue tracker](https://github.com/YashDagade/browser-reader/issues). Do not post API keys or private article content. Information you voluntarily post there is public and is handled by GitHub, separately from Hermes's extension data flow.
