# Musee website: Meta tracking, slow pages, and cart — handoff

Last updated: 2 October 2026 (Malaysia time). This is a record of work and observations, **not** a claim that the issues are fixed.

## Site and intended behaviour

- Store: <https://www.musee-my.com/> (WordPress/WooCommerce); product listing: <https://www.musee-my.com/product/>.
- Meta dataset/pixel being investigated: **991524961836380**, “Musee Platinum (MY) Event Data.” Keep this existing dataset; do not assume another pixel is interchangeable.
- Desired tracking: viewing `/product/` should produce `PageView`, not `AddToCart`; a successful add should produce one `AddToCart` with product, quantity, currency and value; a completed order should produce a `Purchase` with value.
- Original agency report also said actual add-to-cart clicks were appearing as `SubscribedButtonClick` and that cart/purchase values were missing.

## Live changes made during this work

1. Removed a code-free Meta Event Setup Tool `AddToCart` rule targeting `/product/` page views. The deletion was completed with the tool's **Finish** step and the rule was absent when reopened. There was an initial attempt that did not save; only the later completed deletion should be considered effective. Some immediately subsequent tests still showed a `cs_est:true` event, likely before propagation. Later screenshots did not establish a new page-load `AddToCart`.
2. Left **Meta for WooCommerce 3.7.6 inactive** after its configuration would not save and it conflicted with the existing integration. **Meta pixel for WordPress / official-facebook-pixel 5.2.2** remained active and connected to the existing dataset. Verify current plugin states before changing anything further.
3. Added/enabled a WPCode PHP snippet titled **“Musee Meta AddToCart payload”**, snippet ID **37912**: <https://www.musee-my.com/wp-admin/admin.php?page=wpcode-snippet-manager&snippet_id=37912>. Its purpose is to enrich the official plugin's WooCommerce `AddToCart` payload with `contents` entries (`id`, `quantity`, `item_price`) while preserving browser/CAPI event-ID pairing. Verify its current code and active state in WordPress; do not assume a local draft file is the deployed snippet.
4. No new pixel/dataset was created. No completed paid order or purchase-event test was performed. No site/cache/cart settings were changed after the severe timeouts appeared.

## Tracking evidence and remaining uncertainty

- A successful Milk Lotion add generated browser event code with `AddToCart`, `value: 150`, `currency: "myr"`, `content_ids: ["Milk Lotion_4592"]`, and `contents: [{id: "Milk Lotion_4592", quantity: 1, item_price: 150}]`. On the `/product/` listing, this code was returned in WooCommerce's AJAX cart-fragment element `#fb-pxl-ajax-code` after a cart update. Generating this code does **not** by itself prove Meta processed it.
- Meta Events Manager's earlier Test Events view showed Milk Lotion **Add to cart — Processed** (browser, partner integration) at about 2:18 pm, with value 150 MYR and the product ID. This was an earlier test, not proof that the user's later incognito test succeeded.
- The user's later incognito screenshots showed the cart incrementing to two Milk Lotion items, but Meta Ads Data Advisor showed two red **`AddToCart — Event not processed`** rows. The exact rejection/deduplication reason was not visible because the rows were not expanded. `SubscribedButtonClick` and `PageView` appeared as received. Do not treat this tracking issue as resolved until the red row details and a fresh Meta Events Manager test are checked.
- A separate product-detail test for a trial package did not increment the cart because the site requires an account to buy that package (“Please log in to purchase a Trial Package”). That specific no-event result is not evidence of an ATC tracking failure.
- On a product-detail page, browser console diagnostics previously showed `SyntaxError: Unexpected identifier 'Pixel'` in malformed inline `ViewContent` code (`Meta Pixel Event Code -->` without a valid opening HTML comment). LiteSpeed optimization was present; the exact source of this malformed script and its relationship to other problems were **not proven**.
- The local file [`work/snippet-review-pixelwp-5.2.2/candidate-wpcode.php`](work/snippet-review-pixelwp-5.2.2/candidate-wpcode.php) is a **local candidate/review artifact, not confirmed deployed code**. A local copy of official-facebook-pixel 5.2.2 source is under `work/snippet-review-pixelwp-5.2.2/source/official-facebook-pixel/` for code inspection.

## Current site-performance and cart incident

The user reported very slow loading, then showed Safari's **“Request Timeout” / “500 Internal Server Error”** page around 3:45 pm Malaysia time. External live measurements showed:

| Request | Observation |
| --- | --- |
| Cached home page | About 0.94 s total in one test. |
| Cached `/product/` listing | About 0.35 s in one test, about 4 s in a later test; response header included `x-litespeed-cache: hit`. |
| Product-detail pages (including Milk Lotion and White Essence) | No first byte within 12–35 s in repeated tests. |
| `/product/` with a unique query parameter (cache bypass check) | No first byte within 15–18 s. |
| `/?wc-ajax=get_refreshed_fragments` and `/cart/` | No first byte within 16–25 s. |

These observations point to failing or overloaded **uncached/dynamic WordPress/WooCommerce processing**. They do not identify the exact PHP plugin, database query, or host resource limit. Simply increasing “Connection Timeout” could conceal the cause. Inspect LiteSpeed/Plesk web-server and PHP-FPM logs, PHP worker saturation, MySQL/slow-query logs, and WordPress/WooCommerce errors for the incident period. Restore reliable cart and checkout responses before relying on tracking tests.

The user then reported a cart badge stuck at **6** across devices, a cart button that did nothing, and no success notification after Add to Cart. A public no-cookie HTML fetch of `/product/` contained cart count **0** in both Elementor's header cart and the side-cart markup, so **6 is not hard-coded in that public HTML snapshot**. In an existing test browser session that had repeatedly added Milk Lotion, the badge and cart contents displayed six units; its cart toggle opened. This does **not** explain why the user's different devices show six. Possibilities include an account-persisted cart, stale browser/cart fragments, or a cache/session isolation fault; none was proved. The cart-refresh and `/cart/` requests timed out, which can leave stale counts and prevent confirmation messages. Repeated clicks should be avoided because delayed requests could still add items later.

Several guest test additions of Milk Lotion were made to investigate tracking; **no checkout or payment was submitted**. Do not assume the six-item count belongs to any real customer without validating WooCommerce sessions/cookies and cache behaviour.

## Suggested next steps for the next engineer/AI

1. Treat this as an active **store availability/cart** incident first. Obtain hosting/Plesk and WordPress access and inspect server logs around 2 October 2026, especially 3:45 pm MYT. Check PHP-FPM workers, database stalls, WooCommerce AJAX (`wc-ajax=add_to_cart` and `get_refreshed_fragments`), and `/cart/` response times. Avoid making checkout-affecting changes without a backup and a rollback plan.
2. With a genuinely new, logged-out browser/session, verify initial cart count, toggle, one Add to Cart, success notification, and whether a separate clean session sees the same cart. Check LiteSpeed exclusions for WooCommerce cart/checkout, cart fragments, and session cookies. The reported cross-device six-count could be a serious session/cache issue, but requires confirmation.
3. After store responses are stable, inspect a red `AddToCart — Event not processed` row in Meta Ads Data Advisor for its detailed reason; run a fresh test in Meta Events Manager for dataset **991524961836380**. Verify one processed `AddToCart` per successful add, correct value/quantity, and browser/CAPI event-ID deduplication. Check page-load `PageView` separately. Do not add a second independent tracker blindly.
4. Inspect the active WPCode snippet and official Meta plugin integration; test/repair the malformed `ViewContent` inline script separately. Then perform a safe purchase test to verify `Purchase` value. `SubscribedButtonClick` appears to be automatically logged and should be evaluated separately from the standard WooCommerce event.

## Access and safety notes

- The user's Meta admin access had been updated earlier, but the WordPress admin session observed later redirected to reauthentication. The next operator may need the user to sign in again. **No credentials, access tokens, or session cookies are stored here.**
- This document distinguishes confirmed observations from hypotheses. In particular, neither the later red Meta rows nor the cross-device six-item badge has a confirmed root cause yet.
